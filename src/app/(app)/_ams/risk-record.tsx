"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";
import { selectablePeople } from "@/lib/acting-person";
import { refusalNote } from "@/lib/permissions";
import {
  FINDING_RISK_KIND,
  FINDING_SOURCE,
  FINDING_STATUS,
  riskScore,
} from "@/lib/ams/fixtures/registers";
import { hasUsableEvidence } from "@/lib/ams/readiness";
import { riskBand, RISK_STATUS, TREATMENT } from "@/lib/ams/risk-scale";
import { IMPLEMENTATION, formatDate } from "@/lib/ams/labels";
import { TONE_TEXT, type Tone } from "@/lib/ams/tone";
import type { Risk } from "@/lib/ams/types";
import { ActivityPanel } from "./activity-panel";
import { Ref, StatusBadge } from "./status-badge";
import { TrackedTextarea, clip, useActivityLog } from "./use-activity-log";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";

/**
 * One risk: what it would be, what we did, what is left.
 *
 * The block that matters most is the last one. A treatment is a claim that
 * certain controls are working, so the record checks them: for each control the
 * treatment names, is it actually implemented, and does it carry evidence? A
 * residual rating resting on a control marked "in progress" with nothing
 * attached is a number somebody made up, and this is the only screen positioned
 * to say so.
 *
 * The matrix is small and deliberately restrained. It exists because risk
 * people read position before they read prose, not because a heat map is
 * decorative — so it is one grid with two labelled markers, the cells banded by
 * the same three tones the rest of the product uses, and every cell carrying its
 * own score.
 */
export function RiskRecord({ risk: initial }: { risk: Risk }) {
  const ws = useWorkspace();
  const { editRegisters } = usePermissions();
  const {
    people: PEOPLE,
    personById,
    systemById,
    getUseCase,
    controlById,
    applicabilityFor,
    findingById,
    linksForRisk,
    underminingFindings,
  } = ws;
  /*
   * The record is the working copy. Everything a risk owner does between
   * quarters happens here — re-rating the residual as treatment lands, changing
   * the treatment, closing it — so a read-only record would mean the register is
   * maintained somewhere else, which is where risk registers go to die.
   */
  const [risk, setRisk] = useState<Risk>(initial);
  const log = useActivityLog(initial.id, "risk");
  const [voided, setVoided] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Who is accepting, and why. Both are asked for rather than assumed: the
   * route refuses an acceptance with no reason, and `acting-person.ts` forbids
   * guessing the person from the account. */
  const [acceptBy, setAcceptBy] = useState("");
  const [acceptReason, setAcceptReason] = useState("");

  /**
   * Persist a change, and take the saved row back.
   *
   * The response carries the row as the database now holds it, which matters for
   * two reasons: its `version` is what the next save must send, and a re-rating
   * may have voided an acceptance the client still thought was there. Keeping a
   * local copy instead would send a stale version on the next edit and be
   * refused — correctly, and confusingly.
   */
  async function persist(
    changes: Partial<Risk>,
    options: { reason?: string } = {},
  ): Promise<Risk | null> {
    setSaveError(null);
    try {
      const res = await fetch("/api/risks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          riskId: risk.id,
          changes,
          expectedVersion: risk.version,
          reason: options.reason,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        // 409 is somebody else having saved first. Its message already names
        // both versions and says to reload, so it is shown as it arrived.
        setSaveError(payload.error ?? "Could not save that change.");
        return null;
      }
      setRisk(payload.risk as Risk);
      return payload.risk as Risk;
    } catch {
      setSaveError("Could not reach the server. Your change was not saved.");
      return null;
    }
  }

  const inherent = riskScore(risk.inherentLikelihood, risk.inherentImpact);
  const residual = riskScore(risk.residualLikelihood, risk.residualImpact);
  const moved = inherent - residual;

  /**
   * Re-rating the residual voids any acceptance of it.
   *
   * The same rule as a material change on an assessment, and for the same
   * reason: somebody accepted a specific residual position. Move it and their
   * signature is attached to a number they never saw. Carrying the acceptance
   * forward silently is how a register ends up with a CISO's name against a
   * risk that has since doubled.
   */
  async function rerate(
    likelihood: Risk["residualLikelihood"],
    impact: Risk["residualImpact"],
  ) {
    const before = riskScore(risk.residualLikelihood, risk.residualImpact);
    const after = likelihood * impact;
    if (before === after) return;

    const wasAcceptedBy = risk.acceptedById;
    const saved = await persist({
      residualLikelihood: likelihood,
      residualImpact: impact,
    });
    if (!saved) return;

    log.record("re-rated the residual", "Residual", String(before), String(after));

    /* The voiding is the server's decision, not this component's — `saveAiRisk`
     * enforces it however the row arrives. So the notice is driven by what came
     * back, rather than by what this screen predicted would happen. */
    if (wasAcceptedBy && !saved.acceptedById) {
      log.record(
        "voided the residual acceptance",
        "Residual acceptance",
        personById(wasAcceptedBy).name,
        "Nobody — the figure it was given against changed",
      );
      setVoided(
        `Residual re-rated from ${before} to ${after}. ${personById(wasAcceptedBy).name} had accepted ${before}, so that acceptance has been voided — it cannot carry to a number they never saw.`,
      );
    } else {
      setVoided(null);
    }
  }

  /**
   * Change one field and keep what came back.
   *
   * The three selects and the treatment summary all go through here so that
   * "the register is what the database says" holds for every one of them. Before
   * this they moved local state only: the screen agreed with you until you
   * refreshed, which is the worst shape for a register — it looks maintained and
   * is not.
   *
   * The log entry is written after the save rather than beside it, the same
   * order `rerate` uses. An entry for a change the server refused would be a
   * history of things that did not happen.
   */
  async function change(
    changes: Partial<Risk>,
    describe: { action: string; field: string; before: string; after: string },
  ) {
    const saved = await persist(changes);
    if (!saved) return;
    log.record(describe.action, describe.field, describe.before, describe.after);
  }

  async function acceptResidual() {
    setAccepting(true);
    const saved = await persist(
      { acceptedById: acceptBy, acceptedAt: new Date().toISOString().slice(0, 10) },
      { reason: acceptReason },
    );
    setAccepting(false);
    if (!saved) return;

    log.record(
      "accepted the residual",
      "Residual acceptance",
      "Nobody",
      `${personById(acceptBy).name} · residual ${residual}`,
    );
    setAcceptReason("");
    setVoided(null);
  }

  const system = risk.systemId ? systemById(risk.systemId) : undefined;
  const useCase = risk.useCaseId ? getUseCase(risk.useCaseId) : undefined;

  const treatingControls = risk.controlIds.map((id) => {
    const control = controlById(id);
    const row = applicabilityFor(id);
    return {
      control,
      row,
      implemented: row?.implementationStatus === "implemented",
      evidenced: row ? hasUsableEvidence(ws, row) : false,
    };
  });

  const shaky = treatingControls.filter((c) => !c.implemented || !c.evidenced);

  const links = linksForRisk(risk.id).map((link) => ({
    link,
    finding: findingById(link.findingId),
  }));
  const undermining = underminingFindings(risk.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <Link
          href="/risks"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Risk register
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{risk.title}</h1>
          <StatusBadge
            label={RISK_STATUS[risk.status].label}
            tone={RISK_STATUS[risk.status].tone}
          />
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          <Fact
            label="System"
            value={system?.name ?? "Organisation-wide"}
            href={system ? `/inventory/${system.id}` : undefined}
          />
          {useCase && (
            <Fact
              label="Use case"
              value={useCase.name}
              href={`/use-cases/${useCase.id}`}
            />
          )}
          <Fact label="Owner" value={personById(risk.ownerId).name} />
          <Fact
            label="Residual accepted by"
            value={
              risk.acceptedById
                ? `${personById(risk.acceptedById).name}${risk.acceptedAt ? ` · ${formatDate(risk.acceptedAt)}` : ""}`
                : "Nobody"
            }
            className={cn(!risk.acceptedById && "text-warn")}
          />
        </dl>
      </header>

      {/* ------------------------------------------- inherent → treatment → residual */}
      <section className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <Stage label="Inherent" likelihood={risk.inherentLikelihood} impact={risk.inherentImpact} />
            <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
                {TREATMENT[risk.treatment].label}
              </p>
              <p className="text-[0.75rem] leading-snug text-muted-foreground">
                {TREATMENT[risk.treatment].blurb}
              </p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" aria-hidden />
            <Stage label="Residual" likelihood={risk.residualLikelihood} impact={risk.residualImpact} />
          </div>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <Label htmlFor="treatment-summary" className="text-xs font-medium">
              What we are doing about it
            </Label>
            {/*
              Typing is local; the save happens on commit.

              `TrackedTextarea` snapshots on focus and fires on blur, which is
              already the right moment for the trail and is equally the right
              moment for the write — a save per keystroke would be a version
              bump per keystroke, and the next tab open would 409 against a row
              that had moved forty times while nobody read it.
            */}
            <TrackedTextarea
              rows={3}
              value={risk.treatmentSummary}
              ariaLabel="What we are doing about it"
              disabled={!editRegisters}
              title={editRegisters ? undefined : refusalNote("change a risk")}
              onChange={(v) => setRisk((r) => ({ ...r, treatmentSummary: v }))}
              onCommit={(before, after) =>
                change(
                  { treatmentSummary: after },
                  {
                    action: "rewrote the treatment",
                    field: "Treatment",
                    before: clip(before) ?? "",
                    after: clip(after) ?? "",
                  },
                )
              }
              className="text-sm leading-relaxed"
            />
          </div>

          <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
            <Field label="Treatment">
              <Select
                value={risk.treatment}
                disabled={!editRegisters}
                onValueChange={(v) => {
                  const next = (v ?? risk.treatment) as Risk["treatment"];
                  void change(
                    { treatment: next },
                    {
                      action: "changed the treatment type",
                      field: "Treatment",
                      before: TREATMENT[risk.treatment].label,
                      after: TREATMENT[next].label,
                    },
                  );
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full font-normal"
                  title={editRegisters ? undefined : refusalNote("change a risk")}
                >
                  <SelectValue>{TREATMENT[risk.treatment].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(TREATMENT).map((value) => (
                    <SelectItem key={value} value={value}>
                      {TREATMENT[value].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Status">
              {/*
                **"Accepted" is not reachable from this dropdown, on purpose.**
                The route refuses a move into accepted without a reason, so
                offering it here would be an option that always fails. More to
                the point it *should* fail: accepting residual risk names
                somebody senior enough to carry it and says why, and the block
                below asks for both. A status dropdown that could do it silently
                is exactly the shortcut that block exists to close.

                It stays in the list, disabled and explained, rather than being
                filtered out — an absent option reads as a bug, and it also has
                to remain selectable-as-a-value so a risk that *is* accepted can
                render its own status.

                Moving *away* from accepted is allowed and deliberately does not
                clear `acceptedById`: only re-rating the residual voids an
                acceptance, because only re-rating changes the number that was
                accepted. Reopening a risk at the same residual leaves the
                signature standing, which is correct — they did accept it.
              */}
              <Select
                value={risk.status}
                disabled={!editRegisters}
                onValueChange={(v) => {
                  const next = (v ?? risk.status) as Risk["status"];
                  if (next === risk.status) return;
                  void change(
                    { status: next },
                    {
                      action: "changed the status",
                      field: "Status",
                      before: RISK_STATUS[risk.status].label,
                      after: RISK_STATUS[next].label,
                    },
                  );
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full font-normal"
                  title={editRegisters ? undefined : refusalNote("change a risk")}
                >
                  <SelectValue>{RISK_STATUS[risk.status].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(RISK_STATUS).map((value) => {
                    const viaForm = value === "accepted" && risk.status !== "accepted";
                    return (
                      <SelectItem key={value} value={value} disabled={viaForm}>
                        {RISK_STATUS[value].label}
                        {viaForm && (
                          <span className="text-muted-foreground">
                            {" "}
                            — accept it below, with a reason
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Owner">
              <Select
                value={risk.ownerId}
                disabled={!editRegisters}
                onValueChange={(v) => {
                  const next = v ?? risk.ownerId;
                  void change(
                    { ownerId: next },
                    {
                      action: "reassigned the owner",
                      field: "Owner",
                      before: personById(risk.ownerId).name,
                      after: personById(next).name,
                    },
                  );
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full font-normal"
                  title={editRegisters ? undefined : refusalNote("change a risk")}
                >
                  <SelectValue>{personById(risk.ownerId).name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PEOPLE.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name} — {person.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/*
            An open finding against the treatment is direct evidence against the
            number above it. Saying so beside the residual, rather than only in a
            section further down, is the difference between a register that
            reports and one that argues with itself.
          */}
          {undermining.length > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-[0.8125rem] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                {undermining.length} open finding
                {undermining.length === 1 ? "" : "s"} say
                {undermining.length === 1 ? "s" : ""} this treatment is not
                holding, so the residual of {residual} is a claim the evidence
                currently contradicts.
              </span>
            </p>
          )}

          {moved === 0 && (
            <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-[0.8125rem] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                The treatment has not moved the number. Either it is not working,
                or it has not been done yet — both are worth saying out loud
                rather than leaving as two identical scores.
              </span>
            </p>
          )}

          {residual === 0 && (
            <p className="text-[0.8125rem] text-warn">
              A residual of zero is not credible. Treatment makes a risk smaller,
              not absent.
            </p>
          )}
        </div>

        <Matrix risk={risk} onRerate={rerate} />
      </section>

      {/* --------------------------------------------------- accepting the residue */}
      <section className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Residual acceptance</h2>
          <StatusBadge
            className="ml-auto"
            label={risk.acceptedById ? "Accepted" : "Not accepted"}
            tone={risk.acceptedById ? "ok" : "warn"}
          />
        </div>

        {saveError && (
          <p className="rounded-md border border-critical/30 bg-critical/10 px-2.5 py-2 text-[0.8125rem] text-critical">
            {saveError}
          </p>
        )}

        {voided && (
          <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-[0.8125rem] leading-relaxed">
            <Undo2 className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span>{voided}</span>
          </p>
        )}

        {risk.acceptedById ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            Residual {residual} accepted by{" "}
            <span className="text-foreground">{personById(risk.acceptedById).name}</span>
            {risk.acceptedAt && <> on {formatDate(risk.acceptedAt)}</>}. Re-rating
            the residual voids this — an acceptance belongs to the number it was
            given against.
          </p>
        ) : (
          <>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Nobody has accepted the residual {residual} we are carrying.
              Treatment is the
              owner&rsquo;s job; accepting what is left is a different act, by
              somebody senior enough to carry the consequence. A register full of
              owned-but-unaccepted risk is a register nobody has actually agreed
              to.
            </p>
            {/*
              Two required answers, and neither is guessed.

              **Who** is a picker rather than the signed-in account: accepting
              residual risk names somebody senior enough to carry it, and that is
              frequently not the person at the keyboard. `acting-person.ts` is
              explicit that an unmapped caller is recorded as unattributed rather
              than as a plausible name.

              **Why** is required by the route, not merely by this form. An
              acceptance nobody can be held to is not a weaker record, it is not
              an acceptance — so the server refuses it and the button is only a
              courtesy that saves the round trip.
            */}
            <div className="grid gap-2 pt-1 sm:max-w-lg">
              <select
                value={acceptBy}
                disabled={accepting || !editRegisters}
                onChange={(e) => setAcceptBy(e.target.value)}
                aria-label="Who is accepting the residual"
                className="rounded border border-border bg-secondary/40 px-2 py-1.5 text-[0.8125rem] disabled:opacity-60"
              >
                <option value="">Who is accepting this?</option>
                {selectablePeople(PEOPLE).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} — {person.role}
                  </option>
                ))}
              </select>

              <Textarea
                rows={2}
                value={acceptReason}
                disabled={accepting || !editRegisters}
                onChange={(e) => setAcceptReason(e.target.value)}
                aria-label="Why this residual is acceptable"
                placeholder="Why is this level of risk acceptable, and for how long?"
                className="text-[0.8125rem]"
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={
                    accepting ||
                    !editRegisters ||
                    !acceptBy ||
                    acceptReason.trim().length === 0
                  }
                  title={editRegisters ? undefined : refusalNote("change a risk")}
                  onClick={acceptResidual}
                >
                  {accepting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  Accept residual {residual}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Recorded with your account, the person accepting, and the reason.
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Activity</h2>
        <ActivityPanel events={log.events} />
      </section>

      {/* ---------------------------------------------------- findings against it */}
      {links.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-medium">Findings connected to this risk</h2>
            <span className="text-sm text-muted-foreground">
              {links.length}
              {undermining.length > 0 && (
                <>
                  , <span className="text-warn">{undermining.length} arguing against the residual</span>
                </>
              )}
            </span>
          </div>

          <ul className="divide-y divide-border/60 border-y border-border">
            {links.map(({ link, finding }) =>
              finding ? (
                <li key={`${link.findingId}-${link.riskId}`} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/findings/${finding.id}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {finding.title}
                    </Link>
                    <StatusBadge
                      label={FINDING_RISK_KIND[link.kind].label}
                      tone={FINDING_RISK_KIND[link.kind].tone}
                      title={FINDING_RISK_KIND[link.kind].blurb}
                    />
                    <StatusBadge
                      label={FINDING_STATUS[finding.status].label}
                      tone={FINDING_STATUS[finding.status].tone}
                    />
                    <span className="ml-auto text-[0.75rem] text-muted-foreground/60">
                      {FINDING_SOURCE[finding.source].label}
                    </span>
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {link.note}
                  </p>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ what the treatment rests on */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium">What the treatment rests on</h2>
          <span className="text-sm text-muted-foreground">
            {treatingControls.length} control{treatingControls.length === 1 ? "" : "s"}
            {shaky.length > 0 && (
              <>
                , <span className="text-warn">{shaky.length} not fully standing up</span>
              </>
            )}
          </span>
        </div>

        <ul className="divide-y divide-border/60 border-y border-border">
          {treatingControls.map(({ control, row, evidenced }) =>
            control ? (
              <li key={control.id} className="flex items-start gap-3 py-2.5">
                <Ref className="w-14 shrink-0 pt-0.5">{control.officialRef}</Ref>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/frameworks/iso-42001?node=${control.nodeId}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {control.shortTitle}
                    </Link>
                    {row && (
                      <StatusBadge
                        label={IMPLEMENTATION[row.implementationStatus].label}
                        tone={IMPLEMENTATION[row.implementationStatus].tone}
                      />
                    )}
                    <StatusBadge
                      label={evidenced ? "Evidenced" : "No usable evidence"}
                      tone={evidenced ? "ok" : "critical"}
                    />
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {control.requirementSummary}
                  </p>
                </div>
              </li>
            ) : null,
          )}
        </ul>

        {shaky.length > 0 && (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            A residual rating is a claim that the treatment works, and the
            treatment is these controls. {shaky.length} of them{" "}
            {shaky.length === 1 ? "is" : "are"} either unfinished or unproven,
            which makes the residual score above an estimate resting on an
            estimate.
          </p>
        )}
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- the matrix */

/**
 * A 5×5 likelihood × impact grid with the two positions marked.
 *
 * Restrained on purpose. The conventional risk matrix paints all twenty-five
 * cells green through red, which introduces a second colour language into a
 * product that already has one and leaves nothing standing out because
 * everything is coloured. Here cells carry a faint band tint, the two positions
 * are labelled chips, and the numbers are always present — a monochrome print
 * of this still reads correctly.
 */
function Matrix({
  risk,
  onRerate,
}: {
  risk: Risk;
  onRerate: (likelihood: Risk["residualLikelihood"], impact: Risk["residualImpact"]) => void;
}) {
  const levels: Risk["residualLikelihood"][] = [5, 4, 3, 2, 1];

  return (
    <figure className="shrink-0 space-y-1.5">
      <figcaption className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
        Likelihood × impact
      </figcaption>

      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-muted-foreground/50">
          <span>Likely</span>
          <span>Rare</span>
        </div>

        <table className="border-separate border-spacing-[2px]">
          <tbody>
            {levels.map((likelihood) => (
              <tr key={likelihood}>
                {[1, 2, 3, 4, 5].map((impact) => {
                  const score = likelihood * impact;
                  const band = riskBand(score);
                  const isInherent =
                    risk.inherentLikelihood === likelihood && risk.inherentImpact === impact;
                  const isResidual =
                    risk.residualLikelihood === likelihood && risk.residualImpact === impact;

                  return (
                    <td key={impact} className="p-0">
                      <button
                        type="button"
                        onClick={() =>
                          onRerate(likelihood, impact as Risk["residualImpact"])
                        }
                        aria-label={`Set residual to likelihood ${likelihood}, impact ${impact}`}
                        className={cn(
                          "relative flex size-8 items-center justify-center rounded-[3px] text-[0.6875rem] tabular transition-colors hover:ring-1 hover:ring-muted-foreground",
                          BAND_CELL[band.tone],
                          isResidual && "ring-2 ring-foreground",
                          isInherent && !isResidual && "ring-1 ring-muted-foreground/60",
                        )}
                        title={`Likelihood ${likelihood} × impact ${impact} = ${score} (${band.label})`}
                      >
                        {isResidual && isInherent ? (
                          /* Untreated, or treated with no effect — both markers
                             land on one cell and hiding one would read as a
                             rendering bug rather than the finding it is. */
                          <span className="font-semibold text-foreground">IR</span>
                        ) : isResidual ? (
                          <span className="font-semibold text-foreground">R</span>
                        ) : isInherent ? (
                          <span className="text-muted-foreground">I</span>
                        ) : (
                          <span className="text-muted-foreground/25">{score}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between pl-8 font-mono text-[0.55rem] uppercase tracking-wider text-muted-foreground/50">
        <span>Minor</span>
        <span>Severe</span>
      </div>

      <p className="pt-0.5 text-[0.6875rem] text-muted-foreground/60">
        Click a cell to re-rate the residual.
      </p>

      <ul className="space-y-0.5 pt-1 text-[0.6875rem] text-muted-foreground">
        <li>
          <span className="mr-1.5 inline-flex size-3.5 items-center justify-center rounded-[3px] ring-1 ring-muted-foreground/60">
            I
          </span>
          Inherent {riskScore(risk.inherentLikelihood, risk.inherentImpact)}
        </li>
        <li>
          <span className="mr-1.5 inline-flex size-3.5 items-center justify-center rounded-[3px] font-semibold text-foreground ring-2 ring-foreground">
            R
          </span>
          Residual {riskScore(risk.residualLikelihood, risk.residualImpact)}
        </li>
      </ul>
    </figure>
  );
}

/** Faint band tints — enough to group the grid, not enough to shout. */
const BAND_CELL: Record<Tone, string> = {
  ok: "bg-ok/10",
  warn: "bg-warn/10",
  critical: "bg-critical/10",
  info: "bg-brand/10",
  neutral: "bg-secondary/60",
};

/* ---------------------------------------------------------------- fragments */

function Stage({
  label,
  likelihood,
  impact,
}: {
  label: string;
  likelihood: number;
  impact: number;
}) {
  const score = likelihood * impact;
  const band = riskBand(score);
  return (
    <div className="shrink-0 space-y-0.5">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      <p className={cn("text-2xl font-semibold leading-none tabular", TONE_TEXT[band.tone])}>
        {score}
      </p>
      <p className="text-[0.6875rem] text-muted-foreground">
        {band.label} · L{likelihood} × I{impact}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Fact({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value: string;
  href?: string;
  className?: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd className={cn("text-sm", className)}>
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
