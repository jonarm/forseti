"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Link2 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { currentStage } from "@/lib/ams/fixtures/assessments";
import {
  FINDING_SEVERITY,
  FINDING_STATUS,
  riskScore,
} from "@/lib/ams/fixtures/registers";
import {
  ASSESSMENT_STATUS,
  CHARACTERISTIC,
  CONTRACT_TYPE,
  DATA_CATEGORY,
  DEPLOYMENT,
  DISCOVERED_VIA,
  EVIDENCE_TYPE,
  IMPLEMENTATION,
  LIFECYCLE,
  ORIGIN,
  OVERSIGHT,
  RISK_TIER,
  VERIFICATION,
  formatDate,
  isOverdue,
} from "@/lib/ams/labels";
import { coverageTone, TONE_FILL, TONE_TEXT, TONE_TRACK, type Tone } from "@/lib/ams/tone";
import type {
  AiCharacteristic,
  AISystem,
  AIUseCase,
  DataCategory,
  DeploymentModel,
  LifecycleStage,
  RiskTier,
  SystemOrigin,
  VendorDetail,
} from "@/lib/ams/types";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { ActivityPanel } from "./activity-panel";
import { AddRiskDialog } from "./add-risk-dialog";
import { AddUseCaseDialog } from "./add-use-case-dialog";
import { EmptyState } from "./empty-state";
import { ClaimControlsDialog } from "./claim-controls-dialog";
import { EvidenceUploadDialog } from "./evidence-upload-dialog";
import { LinkRecordDialog } from "./link-record-dialog";
import { OpenAssessmentDialog } from "./open-assessment-dialog";
import { RaiseFindingDialog } from "./raise-finding-dialog";
import { Gated, RegisterCreateButton, RegisterLinkButton } from "./register-actions";
import {
  UnlinkButton,
  UnlinkFromSystemDialog,
  type UnlinkKind,
} from "./unlink-from-system-dialog";
import {
  EditBoolean,
  EditDate,
  EditList,
  EditNumber,
  EditRow,
  EditSelect,
  EditText,
  EditToggles,
} from "./field-editors";
import { useSystemPatch } from "./use-system-patch";
import { Ref, StatusBadge } from "./status-badge";
import { SuggestionCard } from "./suggestion-card";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import type { Workspace } from "@/lib/ams/workspace";

/**
 * One system, nine views of it.
 *
 * The header never moves. Whichever tab you are on, the answer to "which system
 * is this, who owns it, how risky is it and when is it next reviewed" stays on
 * screen — those four facts are the context every other tab is read against, and
 * a profile that scrolls them away makes you navigate to remember what you are
 * looking at.
 *
 * The tab order is the order the questions get asked in a review: what is it
 * (Overview), what is it used for (Use Cases), has it been assessed
 * (Assessment), what could go wrong (Risks), what are we doing about it
 * (Controls, Policies), what proves it (Evidence), what is already broken
 * (Findings), and who changed what (Activity).
 *
 * Fixtures are imported here rather than passed down as props. They are plain
 * modules with no server dependency, so plumbing eleven arrays through the page
 * would buy nothing but a longer signature.
 */
/**
 * A tab's own "add one of these" row.
 *
 * Above the content rather than inside the empty state, because a system has
 * many risks, many documents and many findings. The button that raised the
 * first one is the button that raises the fourth, and an affordance that
 * disappears the moment it works sends somebody back to the register to do
 * again what they had just done here.
 *
 * The Assessment tab deliberately does not use this. A second assessment on one
 * system is a real thing — one per use case — but it is a judgement made against
 * all of them on the register, not the obvious next step a profile tab can name.
 */
function TabAction({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex justify-end gap-2">{children}</div>;
}

export function SystemProfile({ system }: { system: AISystem }) {
  const {
    personById,
    getUseCasesForSystem,
    assessmentsForSystem,
    risksForSystem,
    findingsForSystem,
    evidenceForSystem,
    coverageForSystem,
    /* A system is in scope on every tab here, so a use case's tier and
     * oversight are read for *this pairing* rather than off the record. The
     * register reads the baseline instead — it has no system to resolve
     * against, and the purpose's own answer is the honest one there. */
    effectiveTier,
    effectiveOversight,
    activityFor,
    controlById,
    policyById,
    policies: POLICIES,
    suggestions: SUGGESTIONS,
  } = useWorkspace();
  const owner = personById(system.ownerId);
  const overdue = isOverdue(system.nextReviewDate);
  /* The Statement of Applicability's own statement, not the inventory's: a
   * system owner may edit this system and still not decide what is in scope. */
  const { editSoa } = usePermissions();
  const router = useRouter();
  const [openAssessment, setOpenAssessment] = useState(false);
  const [addUseCase, setAddUseCase] = useState(false);
  const [addRisk, setAddRisk] = useState(false);
  const [uploadEvidence, setUploadEvidence] = useState(false);
  const [raiseFinding, setRaiseFinding] = useState(false);
  /* One per tab rather than one shared boolean: the dialogs are different
   * shapes over different registers, and a single flag would have the Risks tab
   * able to open the Evidence picker. */
  const [linkRisk, setLinkRisk] = useState(false);
  const [linkEvidence, setLinkEvidence] = useState(false);
  const [linkFinding, setLinkFinding] = useState(false);
  const [claimControls, setClaimControls] = useState(false);
  /* One tab's Unlink dialog at a time. Null rather than four booleans: the
   * dialogs are one component over four kinds, so the open one *is* the kind. */
  const [unlinking, setUnlinking] = useState<UnlinkKind | null>(null);

  const useCases = getUseCasesForSystem(system.id);
  const assessments = assessmentsForSystem(system.id);
  const risks = risksForSystem(system.id);
  const findings = findingsForSystem(system.id);
  const evidence = evidenceForSystem(system.id);
  const coverage = coverageForSystem(system.id);
  const events = activityFor(system.id);

  // Policies reached through the controls this system is claimed against —
  // a system does not own a policy, it inherits the ones its controls cite.
  const policyIds = new Set(
    coverage.rows.map((row) => row.linkedPolicyId).filter(Boolean) as string[],
  );
  const policies = POLICIES.filter((p) => policyIds.has(p.id));

  const pendingSuggestion = SUGGESTIONS.find(
    (s) => s.status === "pending" && s.target.id.startsWith(system.id),
  );

  const openFindings = findings.filter((f) => f.status !== "closed").length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="space-y-4 border-b border-border px-6 py-5">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          AI Inventory
        </Link>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{system.name}</h1>
            <StatusBadge
              label={`${RISK_TIER[system.riskTier].label} risk`}
              tone={RISK_TIER[system.riskTier].tone}
            />
            <StatusBadge
              label={ASSESSMENT_STATUS[system.assessmentStatus].label}
              tone={ASSESSMENT_STATUS[system.assessmentStatus].tone}
            />
            {system.discoveredVia && system.discoveredVia !== "manual" && (
              <StatusBadge
                label={DISCOVERED_VIA[system.discoveredVia]}
                tone="warn"
                title="Nobody registered this — it was found"
              />
            )}
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {system.purpose || "No purpose recorded yet."}
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          <Fact label="Vendor" value={system.vendor} />
          <Fact label="Origin" value={ORIGIN[system.origin].label} />
          <Fact label="Lifecycle" value={LIFECYCLE[system.lifecycleStage].label} />
          <Fact label="Owner" value={`${owner.name} · ${owner.role}`} />
          <Fact
            label="Next review"
            value={formatDate(system.nextReviewDate)}
            className={cn(overdue && "text-critical")}
          />
        </dl>
      </header>

      <Tabs defaultValue="overview" className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="line"
          className="w-full justify-start gap-4 overflow-x-auto border-b border-border px-6"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="use-cases">
            Use Cases <Count n={useCases.length} />
          </TabsTrigger>
          <TabsTrigger value="assessment">
            Assessment <Count n={assessments.length} />
          </TabsTrigger>
          <TabsTrigger value="risks">
            Risks <Count n={risks.length} />
          </TabsTrigger>
          <TabsTrigger value="controls">
            Controls <Count n={coverage.claimed} />
          </TabsTrigger>
          <TabsTrigger value="policies">
            Policies <Count n={policies.length} />
          </TabsTrigger>
          <TabsTrigger value="evidence">
            Evidence <Count n={evidence.length} />
          </TabsTrigger>
          <TabsTrigger value="findings">
            Findings <Count n={openFindings} tone={openFindings > 0 ? "critical" : "neutral"} />
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <div className="px-6 py-6">
          <TabsContent value="overview">
            <OverviewTab system={system} useCases={useCases} coverage={coverage} />
            {pendingSuggestion && (
              <div className="mt-6 max-w-3xl">
                <SuggestionCard suggestion={pendingSuggestion} targetLabel="Risk tier" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="use-cases">
            <TabAction>
              <RegisterCreateButton
                def={RECORD_KINDS.useCase}
                label="Add use case"
                action="add a use case"
                onClick={() => setAddUseCase(true)}
              />
            </TabAction>

            {useCases.length === 0 ? (
              <EmptyState
                title="No use cases recorded"
                body="A system with no use cases has not really been assessed — the risk lives in what people do with it, not in the licence. Add the jobs this tool is actually doing."
              />
            ) : (
              <div className="space-y-3">
                <p className="max-w-3xl text-sm text-muted-foreground">
                  {useCases.length} use case{useCases.length === 1 ? "" : "s"} reaching this
                  system, each
                  with its own risk tier and its own oversight. They are not
                  equally risky, which is the reason they are separate records.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {useCases.map((useCase) => (
                    <Link
                      key={useCase.id}
                      href={`/use-cases/${useCase.id}`}
                      className="group space-y-2.5 rounded-lg border border-border bg-secondary/20 p-4 transition-colors hover:border-muted-foreground/30 hover:bg-secondary/40"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium group-hover:underline">
                          {useCase.name}
                        </h3>
                        <StatusBadge
                          label={`${RISK_TIER[effectiveTier(useCase.id, system.id)].label} risk`}
                          tone={RISK_TIER[effectiveTier(useCase.id, system.id)].tone}
                        />
                        <ExternalLink
                          className="ml-auto size-3.5 shrink-0 text-muted-foreground/40"
                          aria-hidden
                        />
                      </div>
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                        {useCase.description}
                      </p>
                      <div className="space-y-1.5 border-t border-border/60 pt-2.5">
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            label={
                              OVERSIGHT[effectiveOversight(useCase.id, system.id).level].label
                            }
                            tone={
                              OVERSIGHT[effectiveOversight(useCase.id, system.id).level].tone
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            {useCase.approxUsers > 0
                              ? `${useCase.approxUsers} users`
                              : "Not yet in use"}
                          </span>
                        </div>
                        <p className="text-[0.75rem] leading-relaxed text-muted-foreground/80">
                          {effectiveOversight(useCase.id, system.id).summary}
                        </p>
                      </div>
                      {(useCase.facesCustomers || useCase.informsDecisionsAboutPeople) && (
                        <div className="flex flex-wrap gap-1.5">
                          {useCase.facesCustomers && (
                            <StatusBadge label="Customer facing" tone="warn" />
                          )}
                          {useCase.informsDecisionsAboutPeople && (
                            <StatusBadge label="Informs decisions about people" tone="critical" />
                          )}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Fixed to this system: a use case has no organisation-wide form,
              * so the dialog renders the name rather than a select it could be
              * filed away from. */}
            <AddUseCaseDialog
              open={addUseCase}
              onOpenChange={setAddUseCase}
              systemId={system.id}
              onAdded={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="assessment">
            {assessments.length === 0 ? (
              /*
               * The one tab whose button lives in the empty state rather than
               * above the content. The other three offer theirs whether or not
               * the tab has rows, because a system has many risks, many
               * documents and many findings; it usually has one assessment. A
               * second is one per use case — real, but a judgement made against
               * all of them on the register rather than the obvious next step
               * this tab can name. See `TabAction`.
               */
              <EmptyState
                title="Never assessed"
                body="No impact assessment has been started for this system. Until one is approved, nothing here is evidence of anything — and a system in production without one is a finding waiting to be written."
                action={
                  <RegisterCreateButton
                    def={RECORD_KINDS.assessment}
                    label="Open assessment"
                    action="open an impact assessment"
                    onClick={() => setOpenAssessment(true)}
                  />
                }
              />
            ) : (
              <div className="space-y-4">
                {assessments.map((assessment) => {
                  const stage = currentStage(assessment);
                  return (
                    <div
                      key={assessment.id}
                      className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium">
                          {assessment.useCaseId
                            ? useCases.find((u) => u.id === assessment.useCaseId)?.name
                            : "System-level assessment"}
                        </h3>
                        <StatusBadge
                          label={ASSESSMENT_STATUS[assessment.status].label}
                          tone={ASSESSMENT_STATUS[assessment.status].tone}
                        />
                        <Link
                          href={`/assessments/${assessment.id}`}
                          className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          Open assessment
                        </Link>
                      </div>

                      <ol className="flex flex-wrap gap-2">
                        {assessment.signOff.map((step) => (
                          <li
                            key={step.stage}
                            className={cn(
                              "flex-1 space-y-1 rounded-md border px-3 py-2",
                              step.state === "complete" && "border-ok/30 bg-ok/5",
                              step.state === "current" && "border-brand/40 bg-brand/5",
                              step.state === "pending" && "border-border bg-transparent opacity-60",
                            )}
                          >
                            <p className="text-xs font-medium">{step.label}</p>
                            <p className="text-[0.6875rem] text-muted-foreground">
                              {personById(step.assigneeId).name}
                              {step.completedAt && ` · ${formatDate(step.completedAt)}`}
                              {step.state === "current" && " · waiting"}
                            </p>
                          </li>
                        ))}
                      </ol>

                      <p className="text-xs text-muted-foreground">
                        {stage
                          ? `Held at "${stage.label}" with ${personById(stage.assigneeId).name}.`
                          : "Sign-off complete."}{" "}
                        Due {formatDate(assessment.dueAt)}
                        {isOverdue(assessment.dueAt) && (
                          <span className="text-critical"> — overdue</span>
                        )}
                        .
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* The new assessment arrives from the next server render rather
              * than being spliced in here — see `create-dialog.tsx`. The same
              * refresh is what puts it on the register at `/assessments`: both
              * screens read the one row the create route wrote. */}
            <OpenAssessmentDialog
              open={openAssessment}
              onOpenChange={setOpenAssessment}
              systemId={system.id}
              onOpened={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="risks">
            <TabAction>
              <UnlinkButton kind="risk" onClick={() => setUnlinking("risk")} />
              <RegisterLinkButton
                def={RECORD_KINDS.risk}
                action="file a risk against a system"
                onClick={() => setLinkRisk(true)}
              />
              <RegisterCreateButton
                def={RECORD_KINDS.risk}
                label="Add risk"
                action="add a risk"
                onClick={() => setAddRisk(true)}
              />
            </TabAction>

            {risks.length === 0 ? (
              <EmptyState
                title="No risks recorded against this system"
                body="Risks are raised from an assessment or by anyone who spots one. An empty register on a production system usually means nobody has looked, not that nothing is there."
              />
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Risk</th>
                    <th className={cn(TH, "text-right")}>Inherent</th>
                    <th className={TH}>Treatment</th>
                    <th className={cn(TH, "text-right")}>Residual</th>
                    <th className={TH}>Owner</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {risks.map((risk) => {
                    const inherent = riskScore(risk.inherentLikelihood, risk.inherentImpact);
                    const residual = riskScore(risk.residualLikelihood, risk.residualImpact);
                    return (
                      <tr key={risk.id} className="align-top">
                        <td className={cn(TD, "max-w-md")}>
                          <Link
                            href={`/risks/${risk.id}`}
                            className="font-medium whitespace-normal underline-offset-4 hover:underline"
                          >
                            {risk.title}
                          </Link>
                          <p className="mt-1 whitespace-normal text-xs leading-relaxed text-muted-foreground">
                            {risk.treatmentSummary}
                          </p>
                        </td>
                        <td className={cn(TD, "text-right tabular")}>
                          <ScoreChip score={inherent} />
                        </td>
                        <td className={cn(TD, "capitalize text-muted-foreground")}>
                          {risk.treatment}
                        </td>
                        <td className={cn(TD, "text-right tabular")}>
                          <ScoreChip score={residual} />
                        </td>
                        <td className={cn(TD, "text-muted-foreground")}>
                          {personById(risk.ownerId).name}
                        </td>
                        <td className={TD}>
                          <StatusBadge
                            label={risk.status}
                            tone={risk.status === "open" ? "warn" : "neutral"}
                            className="capitalize"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* The new row arrives from the next server render rather than
              * being spliced in here — see `create-dialog.tsx`. The same
              * refresh is what puts it on the register: both screens read the
              * one row the create route wrote. */}
            <AddRiskDialog
              open={addRisk}
              onOpenChange={setAddRisk}
              systemId={system.id}
              onAdded={() => router.refresh()}
            />

            {/* Filing an existing risk is an edit, not a create: its own route,
              * its own statement, and `expectedVersion` on the way through. The
              * dialog is shared with the Evidence and Findings tabs. */}
            <LinkRecordDialog
              kind="risk"
              open={linkRisk}
              onOpenChange={setLinkRisk}
              systemId={system.id}
              systemName={system.name}
              onLinked={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="controls">
            {/* Gated on the SoA rather than on a register: claiming a control
              * against a system is a scope decision, and `framework: ["update"]`
              * is deliberately not held by a system owner. Refused visibly here
              * rather than hidden, so the person reading it knows to ask the
              * governance lead rather than to look for a missing feature. */}
            <TabAction>
              <UnlinkButton kind="control" onClick={() => setUnlinking("control")} />
              <Gated
                allowed={editSoa}
                action="claim a control against a system"
                onClick={() => setClaimControls(true)}
                icon={<Link2 aria-hidden />}
                label="Link existing"
                variant="outline"
              />
            </TabAction>

            {coverage.claimed === 0 ? (
              <EmptyState
                title="No controls claimed against this system"
                body="Controls are claimed per system in the Statement of Applicability. Until one is, this system contributes nothing to ISO 42001 readiness and appears in the attention list."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Coverage percent={coverage.percent} />
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">
                      {coverage.evidenced} of {coverage.claimed}
                    </span>{" "}
                    applicable controls claimed against this system carry evidence.
                    That ratio is the coverage figure in the inventory — derived
                    from this join, not stored on the system.
                  </p>
                </div>
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>Ref</th>
                      <th className={TH}>Control</th>
                      <th className={TH}>Implementation</th>
                      <th className={TH}>Owner</th>
                      <th className={TH}>Policy</th>
                      <th className={cn(TH, "text-right")}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.rows.map((row) => {
                      const control = controlById(row.controlId);
                      const policy = policyById(row.linkedPolicyId);
                      if (!control) return null;
                      return (
                        <tr key={row.controlId} className="align-top">
                          <td className={TD}>
                            <Ref>{control.officialRef}</Ref>
                          </td>
                          <td className={cn(TD, "max-w-sm")}>
                            {/* Straight to the control itself, not to the clause
                              * it sits under: `?node=` narrows the workbench to
                              * its section and `?control=` opens the row. The
                              * framework comes off the applicability row rather
                              * than being written in, because the join is keyed
                              * by framework and control together. */}
                            <Link
                              href={`/frameworks/${row.frameworkId}?node=${control.nodeId}&control=${control.id}`}
                              className="font-medium whitespace-normal underline-offset-4 hover:underline"
                            >
                              {control.shortTitle}
                            </Link>
                            <p className="mt-1 whitespace-normal text-xs leading-relaxed text-muted-foreground">
                              {control.requirementSummary}
                            </p>
                          </td>
                          <td className={TD}>
                            <StatusBadge
                              label={IMPLEMENTATION[row.implementationStatus].label}
                              tone={IMPLEMENTATION[row.implementationStatus].tone}
                            />
                          </td>
                          <td className={cn(TD, "text-muted-foreground")}>
                            {personById(row.ownerId).name}
                          </td>
                          <td className={cn(TD, "text-muted-foreground")}>
                            {policy ? policy.title : <Dash />}
                          </td>
                          <td className={cn(TD, "text-right tabular")}>
                            {row.linkedEvidenceIds.length > 0 ? (
                              <span className="text-ok">{row.linkedEvidenceIds.length}</span>
                            ) : (
                              <span className="text-critical">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <ClaimControlsDialog
              open={claimControls}
              onOpenChange={setClaimControls}
              systemId={system.id}
              systemName={system.name}
              onClaimed={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="policies">
            {policies.length === 0 ? (
              <EmptyState
                title="No policies reach this system"
                body="A system inherits policies through the controls claimed against it. None of its controls cite one, which means the rules for using this tool exist only as custom."
              />
            ) : (
              <div className="space-y-3">
                <p className="max-w-3xl text-sm text-muted-foreground">
                  Policies reaching this system through the controls claimed
                  against it. A system does not own a policy — it inherits the
                  ones its controls cite.
                </p>
                {policies.map((policy) => (
                  <div
                    key={policy.id}
                    className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{policy.title}</h3>
                      <Ref>v{policy.version}</Ref>
                      <StatusBadge
                        label={POLICY_TONE[policy.status].label}
                        tone={POLICY_TONE[policy.status].tone}
                      />
                      <span className="ml-auto text-xs text-muted-foreground">
                        {policy.approvedAt
                          ? `Approved ${formatDate(policy.approvedAt)}`
                          : "Never approved"}
                      </span>
                    </div>
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {policy.summary}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Owner {personById(policy.ownerId).name} · next review{" "}
                      {formatDate(policy.nextReviewDate)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="evidence">
            <TabAction>
              <UnlinkButton kind="evidence" onClick={() => setUnlinking("evidence")} />
              <RegisterLinkButton
                def={RECORD_KINDS.evidence}
                action="link evidence to a system"
                onClick={() => setLinkEvidence(true)}
              />
              <RegisterCreateButton
                def={RECORD_KINDS.evidence}
                label="Upload evidence"
                action="upload evidence"
                onClick={() => setUploadEvidence(true)}
              />
            </TabAction>

            {evidence.length === 0 ? (
              <EmptyState
                title="No evidence attached"
                body="Evidence is what turns a claimed control into a demonstrated one. Without it this system's controls are assertions, and its coverage figure is zero for a reason."
              />
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Evidence</th>
                    <th className={TH}>Type</th>
                    <th className={TH}>Source</th>
                    <th className={TH}>Owner</th>
                    <th className={TH}>Collected</th>
                    <th className={TH}>Expires</th>
                    <th className={TH}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((item) => (
                    <tr key={item.id}>
                      <td className={cn(TD, "font-medium")}>
                        <Link
                          href={`/evidence/${item.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </Link>
                      </td>
                      <td className={cn(TD, "text-muted-foreground")}>
                        {EVIDENCE_TYPE[item.type]}
                      </td>
                      <td className={cn(TD, "text-muted-foreground")}>{item.source}</td>
                      <td className={cn(TD, "text-muted-foreground")}>
                        {personById(item.ownerId).name}
                      </td>
                      <td className={cn(TD, "tabular text-muted-foreground")}>
                        {formatDate(item.collectedAt)}
                      </td>
                      <td
                        className={cn(
                          TD,
                          "tabular",
                          item.expiresAt && isOverdue(item.expiresAt)
                            ? "text-critical"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.expiresAt ? formatDate(item.expiresAt) : <Dash />}
                      </td>
                      <td className={TD}>
                        <StatusBadge
                          label={VERIFICATION[item.verificationState].label}
                          tone={VERIFICATION[item.verificationState].tone}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* `systemId` is what makes the document land on this tab: the
              * route links the batch to it, and `evidenceForSystem` reads that
              * link. Without it the upload would succeed into the register and
              * this tab would still say no evidence is attached. */}
            <EvidenceUploadDialog
              open={uploadEvidence}
              onOpenChange={setUploadEvidence}
              systemId={system.id}
              systemName={system.name}
              onUploaded={() => router.refresh()}
            />

            {/* The other half of the upload: documents already in the register,
              * attached to this system without a second copy of the PDF. */}
            <LinkRecordDialog
              kind="evidence"
              open={linkEvidence}
              onOpenChange={setLinkEvidence}
              systemId={system.id}
              systemName={system.name}
              onLinked={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="findings">
            <TabAction>
              <UnlinkButton kind="finding" onClick={() => setUnlinking("finding")} />
              <RegisterLinkButton
                def={RECORD_KINDS.finding}
                action="file a finding against a system"
                onClick={() => setLinkFinding(true)}
              />
              <RegisterCreateButton
                def={RECORD_KINDS.finding}
                label="Raise finding"
                action="raise a finding"
                onClick={() => setRaiseFinding(true)}
              />
            </TabAction>

            {findings.length === 0 ? (
              <EmptyState
                title="No findings against this system"
                body="Findings come from internal audit, from a review, or from anyone who notices something is wrong. Nothing open here is good news only if someone has actually looked."
              />
            ) : (
              <div className="space-y-3">
                {findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">
                        <Link
                          href={`/findings/${finding.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {finding.title}
                        </Link>
                      </h3>
                      <StatusBadge
                        label={FINDING_SEVERITY[finding.severity].label}
                        tone={FINDING_SEVERITY[finding.severity].tone}
                      />
                      <StatusBadge
                        label={FINDING_STATUS[finding.status].label}
                        tone={FINDING_STATUS[finding.status].tone}
                      />
                      <span
                        className={cn(
                          "ml-auto text-xs tabular",
                          finding.status !== "closed" && isOverdue(finding.dueAt)
                            ? "text-critical"
                            : "text-muted-foreground",
                        )}
                      >
                        Due {formatDate(finding.dueAt)}
                      </span>
                    </div>
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {finding.summary}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Raised {formatDate(finding.raisedAt)} · owner{" "}
                      {personById(finding.ownerId).name}
                      {finding.controlId && (
                        <> · {controlById(finding.controlId)?.officialRef}</>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* The new row arrives from the next server render rather than
              * being spliced in here — see `create-dialog.tsx`. The same
              * refresh is what puts it on the register: both screens read the
              * one row the create route wrote. */}
            <RaiseFindingDialog
              open={raiseFinding}
              onOpenChange={setRaiseFinding}
              systemId={system.id}
              onRaised={() => router.refresh()}
            />

            {/* No `expectedVersion` here, and that is the store's shape rather
              * than an oversight: `saveAiFinding` takes no version option. See
              * `/api/findings/file`. */}
            <LinkRecordDialog
              kind="finding"
              open={linkFinding}
              onOpenChange={setLinkFinding}
              systemId={system.id}
              systemName={system.name}
              onLinked={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityPanel events={events} className="max-w-4xl" />
          </TabsContent>
        </div>
      </Tabs>

      {/* One dialog for all four tabs rather than one per tab: unlinking is the
        * same act on each, and the kind that is open is the state. Mounted here
        * rather than inside a `TabsContent` so it is not unmounted mid-request
        * by somebody switching tabs behind it. */}
      {unlinking && (
        <UnlinkFromSystemDialog
          kind={unlinking}
          open
          onOpenChange={(next) => !next && setUnlinking(null)}
          systemId={system.id}
          systemName={system.name}
          onUnlinked={() => router.refresh()}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ overview */

/**
 * What the register says about this system, and the only place it is changed.
 *
 * Every field commits on its own — a select on change, a text field on blur —
 * rather than through a form with a Save button. The register is edited a fact
 * at a time by somebody correcting one thing they noticed, and a form makes that
 * person responsible for everything else on the screen at the same time.
 *
 * Editors are **disabled rather than hidden** when the role cannot edit. A
 * missing control reads as "this cannot be done"; a disabled one says who can.
 */
function OverviewTab({
  system,
  useCases,
  coverage,
}: {
  system: AISystem;
  useCases: AIUseCase[];
  coverage: ReturnType<Workspace["coverageForSystem"]>;
}) {
  type VendorContractType = VendorDetail["contractType"];
  const vendor = system.vendorDetail;
  const { people, businessUnits, effectiveTier } = useWorkspace();
  const { editInventory } = usePermissions();
  const editor = useSystemPatch(system.id);
  const off = !editInventory;

  /** Patch one key of the nested vendor object without dropping the rest of it. */
  const patchVendor = (part: Partial<VendorDetail>) =>
    editor.commit({ vendorDetail: { ...vendor, ...part } });

  /*
   * The units, plus whatever this system actually holds.
   *
   * `businessUnits` is a distinct over the people, so it does not contain
   * "Unassigned" — which is exactly what an import writes when a spreadsheet's
   * department matches nothing. A select whose value is absent from its options
   * renders as though nothing were set, and the first edit would silently
   * overwrite a value the person never saw.
   */
  const unitOptions = (
    system.businessUnit && !businessUnits.includes(system.businessUnit)
      ? [system.businessUnit, ...businessUnits]
      : businessUnits
  ).map((unit) => ({ value: unit, label: unit }));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {editor.error && (
          <p
            role="alert"
            className="flex items-start justify-between gap-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical"
          >
            {editor.error}
            <button type="button" onClick={editor.dismiss} className="shrink-0 underline">
              Dismiss
            </button>
          </p>
        )}

        <Section title="Identity">
          <EditRow label="Name">
            <EditText
              value={system.name}
              disabled={off}
              onCommit={(name) => editor.commit({ name })}
            />
          </EditRow>
          <EditRow label="Vendor">
            <EditText
              value={system.vendor}
              disabled={off}
              onCommit={(v) => editor.commit({ vendor: v })}
            />
          </EditRow>
          <EditRow label="Business unit">
            <EditSelect
              value={system.businessUnit}
              disabled={off}
              options={unitOptions}
              onCommit={(businessUnit) => editor.commit({ businessUnit })}
            />
          </EditRow>
          <EditRow
            label="Origin"
            hint="Decides which questions an assessment asks. Changing it changes the sections an in-flight assessment shows — the answers are kept, but the sections the old origin asked for stop being asked."
          >
            <EditSelect
              value={system.origin}
              disabled={off}
              options={(Object.keys(ORIGIN) as SystemOrigin[]).map((origin) => ({
                value: origin,
                label: ORIGIN[origin].label,
              }))}
              onCommit={(origin) => editor.commit({ origin })}
            />
          </EditRow>
          <EditRow label="Owner" hint="An unowned system is a finding waiting to happen.">
            <EditSelect
              value={system.ownerId}
              disabled={off}
              clearable
              options={people.map((person) => ({
                value: person.id,
                label: `${person.name} — ${person.role}`,
              }))}
              onCommit={(ownerId) => editor.commit({ ownerId })}
            />
          </EditRow>
          <EditRow label="Lifecycle stage">
            <EditSelect
              value={system.lifecycleStage}
              disabled={off}
              options={(Object.keys(LIFECYCLE) as LifecycleStage[]).map((stage) => ({
                value: stage,
                label: LIFECYCLE[stage].label,
              }))}
              onCommit={(lifecycleStage) => editor.commit({ lifecycleStage })}
            />
          </EditRow>
          <EditRow
            label="Risk tier"
            hint="Set by a person. The assessment argues for it; it does not write it."
          >
            <EditSelect
              value={system.riskTier}
              disabled={off}
              options={(Object.keys(RISK_TIER) as RiskTier[]).map((tier) => ({
                value: tier,
                label: RISK_TIER[tier].label,
              }))}
              onCommit={(riskTier) => editor.commit({ riskTier })}
            />
          </EditRow>
          <EditRow label="Generates content">
            <EditBoolean
              value={system.isGenAi}
              disabled={off}
              onCommit={(isGenAi) => editor.commit({ isGenAi })}
            />
          </EditRow>
          <EditRow label="Next review">
            <EditDate
              value={system.nextReviewDate}
              disabled={off}
              onCommit={(nextReviewDate) => editor.commit({ nextReviewDate })}
            />
          </EditRow>
          <EditRow label="Purpose">
            <EditText
              multiline
              value={system.purpose}
              disabled={off}
              placeholder="What it is used for, in a sentence."
              onCommit={(purpose) => editor.commit({ purpose })}
            />
          </EditRow>
        </Section>

        <Section title="Deployment">
          <EditRow label="Deployment model">
            <EditSelect
              value={system.deploymentModel}
              disabled={off}
              options={(Object.keys(DEPLOYMENT) as DeploymentModel[]).map((model) => ({
                value: model,
                label: DEPLOYMENT[model],
              }))}
              onCommit={(deploymentModel) => editor.commit({ deploymentModel })}
            />
          </EditRow>
          <EditRow
            label="Hosting regions"
            hint="Where it runs. Not the same answer as where the data comes to rest."
          >
            <EditList
              value={system.hostingRegions}
              disabled={off}
              placeholder="EU West, US East"
              onCommit={(hostingRegions) => editor.commit({ hostingRegions })}
            />
          </EditRow>
          <EditRow label="Data residency">
            <EditText
              value={system.dataResidency}
              disabled={off}
              onCommit={(dataResidency) => editor.commit({ dataResidency })}
            />
          </EditRow>
          <EditRow label="User groups">
            <EditList
              value={system.userGroups}
              disabled={off}
              onCommit={(userGroups) => editor.commit({ userGroups })}
            />
          </EditRow>
          <EditRow label="Approximate users">
            <EditNumber
              value={system.approxUsers}
              disabled={off}
              onCommit={(approxUsers) => editor.commit({ approxUsers })}
            />
          </EditRow>
        </Section>

        <Section title="What it does">
          <EditRow
            label="AI characteristics"
            hint="What it actually does, in capability terms — this is what decides which controls apply."
          >
            <EditToggles
              value={system.characteristics}
              disabled={off}
              options={(Object.keys(CHARACTERISTIC) as AiCharacteristic[]).map((ch) => ({
                value: ch,
                label: CHARACTERISTIC[ch],
              }))}
              onCommit={(characteristics) => editor.commit({ characteristics })}
            />
          </EditRow>
          <EditRow label="Data categories touched">
            <EditToggles
              value={system.dataCategories}
              disabled={off}
              options={(Object.keys(DATA_CATEGORY) as DataCategory[]).map((dc) => ({
                value: dc,
                label: DATA_CATEGORY[dc].label,
              }))}
              onCommit={(dataCategories) => editor.commit({ dataCategories })}
            />
          </EditRow>
        </Section>

        <Section title="Vendor">
          <EditRow label="Legal entity">
            <EditText
              value={vendor.name}
              disabled={off}
              onCommit={(name) => patchVendor({ name })}
            />
          </EditRow>
          <EditRow label="Contract">
            <EditSelect
              value={vendor.contractType}
              disabled={off}
              options={(Object.keys(CONTRACT_TYPE) as VendorContractType[]).map((type) => ({
                value: type,
                label: CONTRACT_TYPE[type],
              }))}
              onCommit={(contractType) => patchVendor({ contractType })}
            />
          </EditRow>
          <EditRow label="Data processing agreement">
            <EditBoolean
              value={vendor.dataProcessingAgreement}
              disabled={off}
              yes="In place"
              no="None"
              onCommit={(dataProcessingAgreement) => patchVendor({ dataProcessingAgreement })}
            />
          </EditRow>
          <EditRow label="Trains on our data">
            <EditBoolean
              value={vendor.trainsOnCustomerData}
              disabled={off}
              yes="Yes — by default on this plan"
              no="No"
              onCommit={(trainsOnCustomerData) => patchVendor({ trainsOnCustomerData })}
            />
          </EditRow>
          <EditRow label="Model provider">
            <EditText
              value={vendor.modelProvider ?? ""}
              disabled={off}
              placeholder="Not applicable"
              onCommit={(value) => patchVendor({ modelProvider: value || null })}
            />
          </EditRow>
          <EditRow
            label="Sub-processors"
            hint="Who the vendor itself relies on. None declared is a different answer from none."
          >
            <EditList
              value={vendor.subProcessors}
              disabled={off}
              onCommit={(subProcessors) => patchVendor({ subProcessors })}
            />
          </EditRow>
          <EditRow
            label="Certifications claimed"
            hint="Claimed by the vendor, not verified by us. Recording the claim is not endorsing it."
          >
            <EditList
              value={vendor.certifications}
              disabled={off}
              onCommit={(certifications) => patchVendor({ certifications })}
            />
          </EditRow>
          <EditRow
            label="Renewal"
            hint={
              vendor.renewalDate
                ? `Currently ${formatDate(vendor.renewalDate)}.`
                : "No renewal date recorded."
            }
          >
            <EditDate
              value={vendor.renewalDate}
              disabled={off}
              onCommit={(value) => patchVendor({ renewalDate: value || null })}
            />
          </EditRow>
        </Section>
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
            ISO 42001 coverage
          </p>
          <Coverage percent={coverage.percent} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {coverage.claimed === 0 ? (
              <>
                Not a single control has been claimed against this system. Zero
                here does not mean it failed an assessment — it means nobody has
                started one.
              </>
            ) : (
              <>
                {coverage.evidenced} of {coverage.claimed} applicable controls
                claimed against this system carry evidence for it. A document
                attached to another system does not count.
              </>
            )}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
            Use cases
          </p>
          <p className="text-2xl font-semibold leading-none">{useCases.length}</p>
          <ul className="space-y-1.5">
            {useCases.map((useCase) => (
              <li key={useCase.id} className="flex items-center gap-2 text-xs">
                <StatusBadge
                  label={RISK_TIER[effectiveTier(useCase.id, system.id)].label}
                  tone={RISK_TIER[effectiveTier(useCase.id, system.id)].tone}
                />
                <span className="truncate text-muted-foreground">{useCase.name}</span>
              </li>
            ))}
            {useCases.length === 0 && (
              <li className="text-xs text-muted-foreground">None recorded.</li>
            )}
          </ul>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
            Registered
          </p>
          <p className="text-sm">{formatDate(system.registeredAt)}</p>
          <p className="text-xs text-muted-foreground">
            {system.discoveredVia ? DISCOVERED_VIA[system.discoveredVia] : "Registered manually"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- small parts */

const TH =
  "border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top whitespace-nowrap";

function Dash() {
  return <span className="text-muted-foreground/40">—</span>;
}

function Count({ n, tone = "neutral" }: { n: number; tone?: Tone }) {
  return (
    <span
      className={cn(
        "ml-1 tabular text-[0.6875rem]",
        tone === "critical" && n > 0 ? "text-critical" : "text-muted-foreground/60",
      )}
    >
      {n}
    </span>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd className={cn("text-sm", className)}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {title}
      </h2>
      <dl className="divide-y divide-border/60">{children}</dl>
    </section>
  );
}

function Coverage({ percent }: { percent: number }) {
  const tone = coverageTone(percent);
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("text-2xl font-semibold leading-none", TONE_TEXT[tone])}>
        {percent}%
      </span>
      <div className={cn("h-1.5 w-28 overflow-hidden rounded-full", TONE_TRACK[tone])}>
        <div
          className={cn("h-full rounded-full", TONE_FILL[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A risk score, banded.
 *
 * Likelihood times impact on a 1–5 scale, so 25 is the ceiling. The bands are
 * deliberately coarse — the difference between 11 and 12 is noise, the
 * difference between 6 and 16 is not.
 */
function ScoreChip({ score }: { score: number }) {
  const tone: Tone = score >= 15 ? "critical" : score >= 8 ? "warn" : "neutral";
  return <StatusBadge label={String(score)} tone={tone} className="tabular" />;
}

const POLICY_TONE: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "ok" },
  in_review: { label: "In review", tone: "warn" },
  draft: { label: "Draft", tone: "critical" },
  expired: { label: "Expired", tone: "critical" },
};

