"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";
import { refusalNote } from "@/lib/permissions";
import { currentStage } from "@/lib/ams/fixtures/assessments";
import {
  ASSESSMENT_STATUS,
  DATA_CATEGORY,
  ORIGIN,
  OVERSIGHT,
  RISK_TIER,
  USE_CASE_STATUS,
  formatDate,
} from "@/lib/ams/labels";
import type {
  AISystem,
  AIUseCase,
  DataCategory,
  OversightLevel,
  RiskTier,
  UseCaseStatus,
} from "@/lib/ams/types";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import { ActivityPanel } from "./activity-panel";
import {
  UseCaseSystemsButton,
  UseCaseSystemsDialog,
} from "./use-case-systems-dialog";
import { EmptyState } from "./empty-state";
import { StatusBadge } from "./status-badge";
import { TrackedTextarea, useActivityLog } from "./use-activity-log";

/**
 * One use case: what it does, how risky it is, and who is watching it.
 *
 * **Editable, because a use case is understood after it is written down.** The
 * first person to record one usually knows the name and the team and is
 * guessing at the tier; the person who later opens an assessment against it
 * knows better. A read-only record would mean that correction happens in a
 * conversation and never reaches the register — which is where use-case
 * inventories go to die, the same way risk registers do.
 *
 * **The two questions are the block that earns its place**, and they are
 * editable in place for the same reason. Flipping "informs decisions about
 * people" to yes is the single highest-consequence edit on this screen: it is
 * what pulls a fairness and adverse-impact section into any assessment opened
 * afterwards. It is not hidden behind a dialog, and the consequence stays
 * written under it while it is being changed.
 *
 * **The systems are shown, never edited here.** A use case is implemented by
 * one or more of them, and which ones is a relation rather than a field: the
 * edit route's allowlist omits it, and changing it goes through the link and
 * unlink routes instead. `POST /api/use-cases` has the argument.
 *
 * Every editor is refused the way the rest of the product refuses: disabled,
 * with the reason on it, never absent. A caller without `useCase: ["update"]`
 * sees the whole record and can change none of it.
 */
export function UseCaseRecord({ useCase: initial }: { useCase: AIUseCase }) {
  const ws = useWorkspace();
  const { records } = usePermissions();
  const mayEdit = records.useCase.update;
  const { personById, systemById, assessmentById, people: PEOPLE, risks: RISKS } =
    ws;

  /*
   * The record is the working copy. The server's saved row replaces it after
   * every write, so `version` is always the one the next save must send — a
   * client keeping its own copy would send a stale version and be refused,
   * correctly and confusingly.
   */
  const [useCase, setUseCase] = useState<AIUseCase>(initial);
  const log = useActivityLog(initial.id, "use_case");
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Null rather than two booleans: one dialog serves both directions, so the
   * open one *is* the direction. */
  const [changingSystems, setChangingSystems] = useState<"link" | "unlink" | null>(
    null,
  );

  /*
   * Every system implementing this purpose, in the join's order. The first is
   * the one the back-link returns to — not because it is primary, but because a
   * back-link has to go somewhere and the alternative is not offering one.
   *
   * **Resolved from the working copy, not from the workspace.** This screen
   * holds the use case in state and replaces it with whatever the server
   * saved — that is how every field on it updates without a reload, and the
   * systems are no different. `getSystemsForUseCase` reads the workspace, which
   * is the server render and does not move until the page is fetched again: a
   * link or unlink would write, return, update the record, and change nothing on
   * screen until somebody pressed reload. The register and the audit pack still
   * use the accessor, correctly — they render server data and edit nothing.
   */
  const systems = useCase.systemIds
    .map((id) => systemById(id))
    .filter((s): s is AISystem => Boolean(s));
  const system = systems[0];
  const owner = personById(useCase.ownerId);
  const assessment = useCase.assessmentId
    ? assessmentById(useCase.assessmentId)
    : undefined;
  const stage = assessment ? currentStage(assessment) : null;
  const risks = RISKS.filter((r) => r.useCaseId === useCase.id);

  /** Persist a change, and take the saved row back. See `risk-record.tsx`. */
  async function persist(changes: Partial<AIUseCase>): Promise<void> {
    setSaveError(null);
    try {
      const res = await fetch("/api/use-cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useCaseId: useCase.id,
          changes,
          expectedVersion: useCase.version,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        // 409 is somebody else having saved first. Its message already names
        // both versions and says to reload, so it is shown as it arrived.
        setSaveError(payload.error ?? "Could not save that change.");
        return;
      }
      setUseCase(payload.useCase as AIUseCase);
    } catch {
      setSaveError("Could not reach the server. Your change was not saved.");
    }
  }

  /**
   * Change one field, record what moved, and save it.
   *
   * For controls that commit the moment they change — the selects and the tick
   * boxes — so `useCase[field]` still holds the old value when this runs, and
   * comparing against it is what stops a re-selection of the same option writing
   * a version bump and a trail entry saying nothing changed.
   *
   * **Not for the text inputs.** A controlled input updates the record as it is
   * typed, so by the time it blurs this comparison would always say the value is
   * unchanged and nothing would ever save. Those use `commitTyped` below.
   */
  function commit<K extends keyof AIUseCase>(
    field: K,
    value: AIUseCase[K],
    label: string,
    before: string,
    after: string,
  ) {
    if (value === useCase[field]) return;
    log.record(`changed the ${label}`, label, before, after);
    setUseCase((u) => ({ ...u, [field]: value }));
    void persist({ [field]: value } as Partial<AIUseCase>);
  }

  /**
   * What the field held when somebody started typing in it.
   *
   * The same snapshot-on-focus, compare-on-blur that `TrackedTextarea` performs
   * for the two prose fields, and it exists for both of that hook's reasons:
   * anything shorter records a trail entry per keystroke, and the record itself
   * cannot serve as the "before" once a controlled input has been typing into
   * it. One ref rather than one per input — only one field can have focus.
   */
  const typedFrom = useRef("");

  /** A text input's blur: save it if it actually moved. */
  function commitTyped<K extends keyof AIUseCase>(
    field: K,
    value: AIUseCase[K],
    label: string,
    after: string,
  ) {
    const before = typedFrom.current;
    if (before === after) return;
    log.record(`changed the ${label}`, label, before, after);
    void persist({ [field]: value } as Partial<AIUseCase>);
  }

  const refusal = mayEdit ? undefined : refusalNote("change a use case");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="space-y-4 border-b border-border px-6 py-5">
        <Link
          href={system ? `/inventory/${system.id}` : "/use-cases"}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {system?.name ?? "System"}
        </Link>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{useCase.name}</h1>
            <StatusBadge
              label={`${RISK_TIER[useCase.riskTier].label} risk`}
              tone={RISK_TIER[useCase.riskTier].tone}
            />
            <StatusBadge
              label={USE_CASE_STATUS[useCase.status].label}
              tone={USE_CASE_STATUS[useCase.status].tone}
            />
            {useCase.facesCustomers && <StatusBadge label="Customer facing" tone="warn" />}
            {useCase.informsDecisionsAboutPeople && (
              <StatusBadge label="Informs decisions about people" tone="critical" />
            )}
          </div>
          <TrackedTextarea
            value={useCase.description}
            onChange={(value) => setUseCase((u) => ({ ...u, description: value }))}
            onCommit={(before, after) => {
              log.record("changed the description", "description", before, after);
              void persist({ description: after });
            }}
            rows={2}
            ariaLabel="What this use case does"
            placeholder="What this use case actually does."
            className="max-w-3xl"
            disabled={!mayEdit}
            title={refusal}
          />
        </div>

        {saveError && (
          <p role="alert" className="text-xs text-critical">
            {saveError}
          </p>
        )}

        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          {/* Shown, never chosen here — the relation is edited through the link
            * and unlink routes rather than as a field on this form. */}
          <div className="space-y-1">
            <Fact
              label={systems.length === 1 ? "System" : "Systems"}
              value={systems.length > 0 ? systems.map((s) => s.name).join(", ") : "—"}
            />
            {/* The relation's only write path from this screen. Unlink is absent
              * rather than disabled when there is nothing it could remove — a
              * single-system use case has no second system to take away, which
              * is a property of the record and not a refusal aimed at anybody. */}
            <div className="flex flex-wrap gap-2 pt-1">
              <UseCaseSystemsButton
                direction="link"
                onClick={() => setChangingSystems("link")}
              />
              {systems.length > 1 && (
                <UseCaseSystemsButton
                  direction="unlink"
                  onClick={() => setChangingSystems("unlink")}
                />
              )}
            </div>
          </div>
          {/* Origin is a property of a system, so it is only answerable when
            * there is one of them. Two tools implementing one purpose can have
            * been procured and built respectively, and "Procured SaaS" would be
            * half a fact stated as a whole one. */}
          <Fact
            label="Origin"
            value={systems.length === 1 ? ORIGIN[systems[0].origin].label : "—"}
          />

          <Editor label="Business unit">
            <Input
              value={useCase.businessUnit}
              onChange={(e) => setUseCase((u) => ({ ...u, businessUnit: e.target.value }))}
              onFocus={(e) => {
                typedFrom.current = e.target.value;
              }}
              onBlur={(e) =>
                commitTyped(
                  "businessUnit",
                  e.target.value,
                  "business unit",
                  e.target.value,
                )
              }
              className="h-8 w-40 text-sm"
              aria-label="Business unit"
              disabled={!mayEdit}
              title={refusal}
            />
          </Editor>

          <Editor label="Owner">
            <Select
              value={useCase.ownerId}
              onValueChange={(value) =>
                commit(
                  "ownerId",
                  value ?? "",
                  "owner",
                  owner.name,
                  value ? personById(value).name : "Unassigned",
                )
              }
              disabled={!mayEdit}
            >
              <SelectTrigger size="sm" className="w-52 font-normal" title={refusal}>
                <SelectValue>{owner.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PEOPLE.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name} — {person.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Editor>

          <Editor label="Users">
            <Input
              type="number"
              min={0}
              value={String(useCase.approxUsers)}
              onChange={(e) =>
                setUseCase((u) => ({ ...u, approxUsers: Number(e.target.value) || 0 }))
              }
              onFocus={(e) => {
                typedFrom.current = e.target.value;
              }}
              onBlur={(e) =>
                commitTyped(
                  "approxUsers",
                  Number(e.target.value) || 0,
                  "user count",
                  String(Number(e.target.value) || 0),
                )
              }
              className="h-8 w-24 text-sm"
              aria-label="Approximate users"
              disabled={!mayEdit}
              title={refusal}
            />
          </Editor>
        </dl>
      </header>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-2">
            <SectionHeading>Risk tier and status</SectionHeading>
            <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Risk tier</Label>
                <Select
                  value={useCase.riskTier}
                  onValueChange={(value) =>
                    commit(
                      "riskTier",
                      (value ?? useCase.riskTier) as RiskTier,
                      "risk tier",
                      RISK_TIER[useCase.riskTier].label,
                      RISK_TIER[(value ?? useCase.riskTier) as RiskTier].label,
                    )
                  }
                  disabled={!mayEdit}
                >
                  <SelectTrigger size="sm" className="w-full font-normal" title={refusal}>
                    <SelectValue>{RISK_TIER[useCase.riskTier].label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RISK_TIER) as RiskTier[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {RISK_TIER[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/70">
                  This use, not the system. A limited-risk system can carry a
                  high-risk use case; that is the point of the record.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select
                  value={useCase.status}
                  onValueChange={(value) =>
                    commit(
                      "status",
                      (value ?? useCase.status) as UseCaseStatus,
                      "status",
                      USE_CASE_STATUS[useCase.status].label,
                      USE_CASE_STATUS[(value ?? useCase.status) as UseCaseStatus].label,
                    )
                  }
                  disabled={!mayEdit}
                >
                  <SelectTrigger size="sm" className="w-full font-normal" title={refusal}>
                    <SelectValue>{USE_CASE_STATUS[useCase.status].label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(USE_CASE_STATUS) as UseCaseStatus[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {USE_CASE_STATUS[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/70">
                  Where this use is in its own life, which is not where its system
                  is. Retiring it here retires nothing else.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeading>Human oversight</SectionHeading>
            <div className="space-y-2.5 rounded-lg border border-border bg-secondary/20 p-4">
              <Select
                value={useCase.oversightLevel}
                onValueChange={(value) =>
                  commit(
                    "oversightLevel",
                    (value ?? useCase.oversightLevel) as OversightLevel,
                    "oversight level",
                    OVERSIGHT[useCase.oversightLevel].label,
                    OVERSIGHT[(value ?? useCase.oversightLevel) as OversightLevel].label,
                  )
                }
                disabled={!mayEdit}
              >
                <SelectTrigger size="sm" className="w-full font-normal" title={refusal}>
                  <SelectValue>{OVERSIGHT[useCase.oversightLevel].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OVERSIGHT) as OversightLevel[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {OVERSIGHT[key].label} — {OVERSIGHT[key].blurb}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {OVERSIGHT[useCase.oversightLevel].blurb}
              </p>
              <div className="border-t border-border/60 pt-2.5">
                <TrackedTextarea
                  value={useCase.oversightSummary}
                  onChange={(value) =>
                    setUseCase((u) => ({ ...u, oversightSummary: value }))
                  }
                  onCommit={(before, after) => {
                    log.record(
                      "changed the oversight summary",
                      "oversight summary",
                      before,
                      after,
                    );
                    void persist({ oversightSummary: after });
                  }}
                  rows={2}
                  ariaLabel="How the oversight actually works"
                  placeholder="What the person actually does, not that there is a policy."
                  disabled={!mayEdit}
                  title={refusal}
                />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeading>Risks raised against this use case</SectionHeading>
            {risks.length === 0 ? (
              <EmptyState
                title="No risks recorded"
                body="Risks can be raised against a system, a use case, or both. Nothing has been raised at this level yet."
              />
            ) : (
              <div className="space-y-3">
                {risks.map((risk) => (
                  <div
                    key={risk.id}
                    className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">
                        <Link
                          href={`/risks/${risk.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {risk.title}
                        </Link>
                      </h3>
                      <span className="ml-auto flex items-center gap-1.5 text-xs tabular">
                        <span className="text-muted-foreground">
                          {risk.inherentLikelihood * risk.inherentImpact}
                        </span>
                        <span className="text-muted-foreground/40">→</span>
                        <span className="text-foreground">
                          {risk.residualLikelihood * risk.residualImpact}
                        </span>
                      </span>
                    </div>
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {risk.treatmentSummary}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Treatment: {risk.treatment} · owner {personById(risk.ownerId).name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeading>Activity</SectionHeading>
            <ActivityPanel events={log.events} />
          </section>
        </div>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
            <SectionHeading>Impact assessment</SectionHeading>
            {assessment ? (
              <>
                <StatusBadge
                  label={ASSESSMENT_STATUS[assessment.status].label}
                  tone={ASSESSMENT_STATUS[assessment.status].tone}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {stage
                    ? `Held at "${stage.label}" with ${personById(stage.assigneeId).name}.`
                    : "Sign-off complete."}{" "}
                  Due {formatDate(assessment.dueAt)}.
                </p>
                <Link
                  href={`/assessments/${assessment.id}`}
                  className="inline-block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Open assessment
                </Link>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                This use case has no assessment of its own. It is covered by the
                system-level assessment, which is a defensible position for a
                low-risk use and a poor one for anything above it.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
            <SectionHeading>Data touched</SectionHeading>
            <div className="space-y-1.5">
              {(Object.keys(DATA_CATEGORY) as DataCategory[]).map((category) => {
                const held = useCase.dataCategories.includes(category);
                return (
                  <label
                    key={category}
                    className={cn(
                      "flex items-center gap-2 text-[0.8125rem]",
                      mayEdit ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                    )}
                    title={refusal}
                  >
                    <Checkbox
                      checked={held}
                      disabled={!mayEdit}
                      onCheckedChange={() => {
                        const next = held
                          ? useCase.dataCategories.filter((c) => c !== category)
                          : [...useCase.dataCategories, category];
                        log.record(
                          "changed the data touched",
                          "data touched",
                          useCase.dataCategories
                            .map((c) => DATA_CATEGORY[c].label)
                            .join(", ") || "none",
                          next.map((c) => DATA_CATEGORY[c].label).join(", ") || "none",
                        );
                        setUseCase((u) => ({ ...u, dataCategories: next }));
                        void persist({ dataCategories: next });
                      }}
                    />
                    {DATA_CATEGORY[category].label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
            <SectionHeading>The two questions</SectionHeading>
            <Answer
              id="uc-customers"
              question="Does it face customers?"
              yes={useCase.facesCustomers}
              note="Determines whether a wrong output reaches someone outside the organisation."
              disabled={!mayEdit}
              title={refusal}
              onChange={(next) =>
                commit(
                  "facesCustomers",
                  next,
                  "customer-facing answer",
                  useCase.facesCustomers ? "Yes" : "No",
                  next ? "Yes" : "No",
                )
              }
            />
            <Answer
              id="uc-decisions"
              question="Does it inform decisions about people?"
              yes={useCase.informsDecisionsAboutPeople}
              note="A yes pulls a whole fairness and adverse-impact section into the assessment."
              disabled={!mayEdit}
              title={refusal}
              onChange={(next) =>
                commit(
                  "informsDecisionsAboutPeople",
                  next,
                  "decisions-about-people answer",
                  useCase.informsDecisionsAboutPeople ? "Yes" : "No",
                  next ? "Yes" : "No",
                )
              }
            />
          </div>
        </div>
      </div>

      {/* One dialog for both directions, mounted once rather than per button so
        * switching between them cannot unmount a request in flight. */}
      {changingSystems && (
        <UseCaseSystemsDialog
          direction={changingSystems}
          open
          onOpenChange={(next) => !next && setChangingSystems(null)}
          useCaseId={useCase.id}
          useCaseName={useCase.name}
          systemIds={useCase.systemIds}
          expectedVersion={useCase.version}
          onChanged={(saved) => {
            /* The screen updates from the working copy immediately; the
             * refresh is for everywhere else. The register's System column and
             * the profile's Use Cases tab are server-rendered, and Next serves
             * a cached payload on the way back — so without this, navigating
             * away and returning shows the relation as it was. */
            setUseCase(saved);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
      {children}
    </h2>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/** A fact that can be changed: the same label, with a control under it. */
function Editor({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One of the two questions.
 *
 * The consequence stays under it while it is being answered, rather than
 * appearing once at creation and never again — the person re-answering it a year
 * later is usually not the person who answered it first.
 */
function Answer({
  id,
  question,
  yes,
  note,
  disabled,
  title,
  onChange,
}: {
  id: string;
  question: string;
  yes: boolean;
  note: string;
  disabled: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1 border-t border-border/60 pt-2 first-of-type:border-0 first-of-type:pt-0">
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={yes}
          disabled={disabled}
          title={title}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <Label
          htmlFor={id}
          className={cn(
            "text-xs leading-snug",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            yes ? "text-warn" : "text-muted-foreground",
          )}
          title={title}
        >
          {question}
        </Label>
      </div>
      <p className="pl-6 text-[0.6875rem] leading-relaxed text-muted-foreground/70">
        {note}
      </p>
    </div>
  );
}
