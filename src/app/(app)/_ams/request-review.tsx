"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DECISIONS,
  QUESTION_SETS,
  REVIEW_TYPE,
  TRIAGE_RULES,
  ruleById,
  triage,
} from "@/lib/ams/fixtures/intake";
import { REQUEST_STATUS, daysWaiting } from "@/lib/ams/fixtures/requests";
import { MIN_NOTE, REOPENING_DECISION, isSettled } from "@/lib/ams/intake-create";
import { DATA_CATEGORY, ORIGIN, formatDate } from "@/lib/ams/labels";
import { refusalNote } from "@/lib/permissions";
import type { Tone } from "@/lib/ams/tone";
import type {
  DataCategory,
  IntakeNote,
  IntakeSubmission,
  QuestionSetField,
  ReviewType,
  SystemOrigin,
} from "@/lib/ams/types";
import { ActivityPanel } from "./activity-panel";
import { EmptyState } from "./empty-state";
import {
  EditNumber,
  EditRow,
  EditSelect,
  EditText,
  EditToggles,
} from "./field-editors";
import { Ref, StatusBadge } from "./status-badge";
import { useIntakePatch, type IntakePatcher } from "./use-intake-patch";
import type { IntakeAnswer } from "@/lib/ams/intake-patch";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";

/**
 * One request, triaged and decided.
 *
 * The recommendation is recomputed here from the submission every time the page
 * renders, not read from a stored field. That is deliberate and it is visible in
 * the demo: open a decided request from last year and you see what the rules say
 * *today* alongside what the reviewer actually chose. If those disagree, the
 * rules have changed since — which is exactly the thing a governance lead needs
 * to notice, and which a frozen recommendation would hide.
 *
 * Once decided, the *decision* becomes a record: what was chosen, who chose it,
 * the recommendation it was made against, and — where they departed from it —
 * the justification. None of that is editable afterwards, and the route refuses
 * a second one, because the value of the record is that it says what was
 * decided at the time.
 *
 * **"Needs more info" is not that, and the screen must not treat it as that.**
 * It is a decision that asked a question: the request stays open, the queue
 * keeps counting the days it has waited, and its own blurb says nothing is
 * registered "until it comes back". Reading `decision !== null` here rendered it
 * as a finished record with no controls — a request stuck on screen, visibly
 * waiting on somebody, with nothing anybody could do to it. `isSettled` is the
 * predicate the decision route refuses on, read here so the two cannot drift.
 *
 * **The submission is the other half, and it stays editable — before a decision
 * and after one.** They are separate records on purpose. A request is an
 * account of something somebody wants to do, and accounts are wrong before they
 * are complete: the DPA gets signed, the vendor turns out to be a reseller, "no
 * personal data" becomes "customer transcripts, actually". Freezing the answers
 * at the moment of decision would mean correcting one costs the reference people
 * have already quoted in an email. Because triage is recomputed rather than
 * stored, a correction to a decided request shows immediately as the rules
 * disagreeing with what was chosen — which is the divergence this screen exists
 * to surface, not a hole in it.
 */
export function RequestReview({ requestId }: { requestId: string }) {
  const { activityFor, intakeNotes, personById, requests } = useWorkspace();
  const { records } = usePermissions();
  const router = useRouter();
  const request = requests.find((r) => r.id === requestId);
  const editor = useIntakePatch(requestId);

  const result = useMemo(
    () => (request ? triage(request.submission) : null),
    [request],
  );

  const [override, setOverride] = useState<ReviewType | null>(null);
  const [justification, setJustification] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!request || !result) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <EmptyState
          title="No such request"
          body="Nothing in this organisation's queue has that reference. It may have been removed, or the link may belong to a different tenant."
          action={
            <Button variant="outline" size="sm" render={<Link href="/intake" />}>
              Back to the queue
            </Button>
          }
        />
      </div>
    );
  }

  const { submission } = request;
  /* Not `decision !== null`. "Needs more info" is a decision that asked a
   * question, and the request is still open — the queue is still counting the
   * days it has waited. The same predicate the decision route refuses on, so
   * this screen cannot offer a decision the route would 409. */
  const decided = isSettled(request.decision);
  const returned = request.decision === REOPENING_DECISION;
  /**
   * What the reviewer settled on. Only meaningful once decided, and read from
   * the record rather than recomputed — the decided panel says what *was*
   * chosen, and printing today's recommendation in that row would be the one
   * place on this screen where a recomputed value would be a lie.
   */
  const settledReview = request.reviewType ?? result.suggested;
  /**
   * The working selection while the request is still open.
   *
   * It starts at the live recommendation, **not** at the stored `reviewType`.
   * Starting from the stored one meant a request raised before a rule changed
   * opened with a button pre-selected that the panel above it did not mark as
   * recommended — and the justification box already demanding a sentence for a
   * departure nobody had made. The route measures the departure against the same
   * live recommendation, so the two cannot disagree about what counts as one.
   */
  const finalReview = override ?? result.suggested;
  const overridden = finalReview !== result.suggested;
  const chosen = DECISIONS.find((d) => d.id === request.decision);

  /**
   * Record the decision, then re-read the request.
   *
   * The route refuses a request that already carries one, so a second tab left
   * open cannot quietly rewrite what was decided — the screen disables its own
   * controls afterwards and this is the half of that a browser cannot get
   * around. A refusal surfaces here rather than being swallowed.
   */
  async function commit() {
    if (saving) return;
    setSaving(true);
    setFailure(null);

    try {
      const response = await fetch("/api/intake/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request!.id,
          decision,
          reviewType: finalReview,
          overrideJustification: overridden ? justification : null,
          comments,
        }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "The decision was not recorded."));
        return;
      }

      router.refresh();
    } catch {
      setFailure("Could not reach the server. Nothing was recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <Link
          href="/intake"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Intake &amp; triage
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <Ref>{request.reference}</Ref>
          <StatusBadge
            label={REQUEST_STATUS[request.status].label}
            tone={REQUEST_STATUS[request.status].tone}
          />
          {REQUEST_STATUS[request.status].open && (
            <span className="text-xs text-muted-foreground">
              {daysWaiting(request)} days waiting
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{submission.name}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {submission.description}
        </p>
        <p className="text-xs text-muted-foreground/70">
          Raised by {personById(request.submittedById).name} ·{" "}
          {submission.businessUnit} · {formatDate(request.submittedAt)}
        </p>
      </header>

      {/* ------------------------------------------------ the recommendation */}
      <div className="space-y-4 rounded-lg border border-brand/30 bg-secondary/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-brand" aria-hidden />
          <span className="text-xs font-medium">Recommended review type</span>
          <StatusBadge
            className="ml-auto"
            label={REVIEW_TYPE[result.suggested].label}
            tone={result.suggested === "endorsement" ? "warn" : "info"}
          />
        </div>

        <p className="text-sm leading-relaxed">{REVIEW_TYPE[result.suggested].blurb}</p>

        <div className="space-y-2">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            {result.firedRuleIds.length === 0
              ? "No rules fired"
              : `${result.firedRuleIds.length} rule${result.firedRuleIds.length === 1 ? "" : "s"} fired`}
          </p>
          {result.firedRuleIds.length === 0 ? (
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Nothing in this request meets a threshold that requires a forum
              decision. It is recorded and reviewed, not escalated.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {result.firedRuleIds.map((id) => {
                const rule = ruleById(id);
                if (!rule) return null;
                return (
                  <li key={id} className="flex items-start gap-2 text-[0.8125rem] leading-snug">
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        rule.implies === "endorsement" ? "bg-warn" : "bg-muted-foreground/40",
                      )}
                      aria-hidden
                    />
                    <span>
                      {rule.explain}
                      {rule.implies === "noting" && (
                        <span className="text-muted-foreground/60"> (context only)</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
            Rules are data, not code paths — all {TRIAGE_RULES.length} are evaluated
            against the answers below and the ones that matched are listed here.
            Recomputed on every view, so a rule change shows up against old
            decisions instead of hiding behind them.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------ decide, or the record */}
      {decided ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Decision</span>
            <StatusBadge
              className="ml-auto"
              label={chosen?.label ?? "Decided"}
              tone={(chosen?.tone as Tone) ?? "neutral"}
            />
          </div>
          <dl className="divide-y divide-border/60">
            <Row label="Review type" value={REVIEW_TYPE[settledReview].label} />
            <Row
              label="Decided by"
              value={`${personById(request.decidedById).name} · ${formatDate(request.decidedAt ?? request.submittedAt)}`}
            />
            {request.overrideJustification && (
              <Row
                label="Overrode the recommendation"
                value={request.overrideJustification}
              />
            )}
            {request.comments && <Row label="Comments" value={request.comments} />}
            <Row
              label="Inventory"
              value={
                request.createdSystemId
                  ? "Produced a system in the inventory"
                  : "Produced no inventory row — by design"
              }
            />
          </dl>
          {request.createdSystemId && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/inventory/${request.createdSystemId}`} />}
            >
              Open the system it created
            </Button>
          )}
        </div>
      ) : (
        <>
          {returned && (
            /*
             * The round that sent it back, shown before the controls that will
             * overwrite it. `comments` and `decidedById` hold one decision at a
             * time, so recording this one replaces what is printed here — the
             * activity trail keeps both, and this is what stops the reviewer
             * answering a question they can no longer see.
             */
            <div className="space-y-3 rounded-lg border border-info/30 bg-secondary/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Returned to the requester</span>
                <StatusBadge className="ml-auto" label="Awaiting an answer" tone="info" />
              </div>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                This was sent back with questions rather than decided, so it is
                still open and still yours. Decide it once the answers below have
                been corrected.
              </p>
              <dl className="divide-y divide-border/60">
                <Row
                  label="Asked by"
                  value={`${personById(request.decidedById).name} · ${formatDate(request.decidedAt ?? request.submittedAt)}`}
                />
                {request.comments && <Row label="What was asked" value={request.comments} />}
              </dl>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Reviewer override</p>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              The recommendation is not binding. Change it if it is wrong — the
              justification is what tells us the rules need fixing.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["endorsement", "noting"] as ReviewType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOverride(type)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-[0.8125rem] transition-colors",
                    finalReview === type
                      ? "border-primary/50 bg-primary/10"
                      : "border-border text-muted-foreground hover:bg-secondary/40",
                  )}
                >
                  {REVIEW_TYPE[type].label}
                  {result.suggested === type && (
                    <span className="ml-1.5 text-muted-foreground/60">recommended</span>
                  )}
                </button>
              ))}
            </div>

            {overridden && (
              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <Label htmlFor="override-why" className="text-sm font-medium">
                  Why are you overriding the recommendation?
                  <span className="ml-1 text-muted-foreground/60">*</span>
                </Label>
                <Textarea
                  id="override-why"
                  rows={2}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="The vendor DPA was signed this morning and is not yet in the record."
                  aria-invalid={justification.trim().length < 15}
                />
                {justification.trim().length < 15 && (
                  <p className="text-[0.8125rem] text-warn">
                    Required before the decision can be recorded — at least a sentence.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
              Routing
            </p>
            <dl className="divide-y divide-border/60">
              <Row label="Review type" value={REVIEW_TYPE[finalReview].label} />
              <Row label="Goes to" value={REVIEW_TYPE[finalReview].routesTo} />
              <Row label="Expected within" value={REVIEW_TYPE[finalReview].sla} />
              <Row
                label="Impact assessment"
                value={
                  finalReview === "endorsement"
                    ? "Required, and must be approved before go-live"
                    : "Required if it reaches production"
                }
              />
            </dl>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-sm font-medium">Decision</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DECISIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDecision(option.id)}
                  className={cn(
                    "space-y-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
                    decision === option.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-secondary/40",
                  )}
                >
                  <StatusBadge label={option.label} tone={option.tone as Tone} />
                  <span className="block text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {option.blurb}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="decision-comments" className="text-sm font-medium">
                Comments
              </Label>
              <Textarea
                id="decision-comments"
                rows={2}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Visible to the requester."
              />
            </div>

            {failure && (
              /* Most likely a 409: somebody decided this in another tab while
               * this one was open. The screen says which rather than looking
               * like it saved. */
              <p className="pt-1 text-xs text-critical">{failure}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Recorded against your signed-in account, with a timestamp.
              </p>
              <Button
                size="sm"
                className="ml-auto"
                disabled={
                  !decision || saving || (overridden && justification.trim().length < 15)
                }
                onClick={commit}
              >
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                Record decision
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ---------------------------------------------------- what they said */}
      <SubmissionEditor
        submission={submission}
        editor={editor}
        canEdit={records.intake.update}
        decided={decided}
      />

      {/* ----------------------------------------------- what happened after */}
      <NoteThread
        requestId={requestId}
        notes={intakeNotes}
        canAdd={records.intake.update}
      />

      {/* ------------------------------------------------ and what moved since */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Activity</h2>
        {/*
         * Read straight from the workspace rather than through
         * `useActivityLog`. That hook exists to shadow *unpersisted* local
         * edits, and nothing on this screen is one — every field commits
         * through a route that writes the trail itself, and `router.refresh()`
         * brings the real entries back. A local shadow would be a second
         * account of what happened, differing from the stored one in whichever
         * ways the two drifted.
         */}
        <ActivityPanel events={activityFor(requestId)} />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-0.5 py-2">
      <dt className="w-56 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm">{value || "—"}</dd>
    </div>
  );
}

/**
 * Everything added to the request after it was decided.
 *
 * **Append-only, and the screen says so rather than merely behaving that way.**
 * There is no edit affordance and no delete affordance on a note, because the
 * route has neither: a note is an account of a conversation, and the value of
 * one is that it cannot be revised afterwards. That is a different rule from the
 * submission directly above it, which is an account of a *system* and is meant
 * to be corrected — so the two sit next to each other and the notice explains
 * why one has pencils on it and the other does not.
 *
 * Oldest first, unlike the activity trail below. A conversation read
 * newest-first is one nobody can follow.
 */
function NoteThread({
  requestId,
  notes,
  canAdd,
}: {
  requestId: string;
  notes: IntakeNote[];
  canAdd: boolean;
}) {
  const { personById } = useWorkspace();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function add() {
    if (sending || draft.trim().length < MIN_NOTE) return;
    setSending(true);
    setFailure(null);

    try {
      const response = await fetch(
        `/api/intake/${encodeURIComponent(requestId)}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: draft }),
        },
      );
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "That note was not added."));
        return;
      }

      /* Cleared only once the server has it. A box that empties on click and
       * then fails has thrown away what somebody wrote. */
      setDraft("");
      router.refresh();
    } catch {
      setFailure("Could not reach the server. That note was not added.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Notes</h2>

      {notes.length === 0 ? (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Nothing has been added since this was raised. Notes are for what became
          true afterwards — a signed agreement, a changed scope, a vendor that was
          acquired.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-border px-3.5 py-2.5">
              <p className="text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
                {note.body}
              </p>
              <p className="pt-1.5 text-[0.6875rem] text-muted-foreground/70">
                {personById(note.authorId).name} · {formatDate(note.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canAdd ? (
        <div className="space-y-1.5">
          <Label htmlFor="new-note" className="sr-only">
            Add a note
          </Label>
          <Textarea
            id="new-note"
            rows={2}
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="The vendor DPA came back signed this morning."
          />
          {failure && <p className="text-xs text-critical">{failure}</p>}
          <div className="flex items-center gap-2">
            <p className="text-[0.6875rem] text-muted-foreground/70">
              Added to the record permanently. A note cannot be edited or removed —
              correcting one means adding another.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={sending || draft.trim().length < MIN_NOTE}
              onClick={add}
            >
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Add note
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          {refusalNote("add a note to an intake request")}
        </p>
      )}
    </section>
  );
}

/**
 * What the requester said, and the place to correct it.
 *
 * Every field commits on its own through `PATCH /api/intake/:id` — a select on
 * change, a text field on blur — which is the rule the inventory profile
 * follows and for the same reason: an activity trail with one entry per
 * keystroke is a trail nobody opens twice.
 *
 * **Editors are disabled rather than hidden** when the role cannot edit. A
 * missing control reads as "this cannot be done"; a disabled one with the
 * refusal underneath says who can do it. An auditor and a reviewer see the
 * answers and cannot change them, which is what their roles say.
 *
 * The triage panel above recomputes from these values on every render, so a
 * correction lands there immediately — an answer fixed here can move a request
 * from endorsement to noting while somebody is looking at it, and that is the
 * mechanism working rather than a race.
 */
function SubmissionEditor({
  submission,
  editor,
  canEdit,
  decided,
}: {
  submission: IntakeSubmission;
  editor: IntakePatcher;
  canEdit: boolean;
  decided: boolean;
}) {
  const off = !canEdit;

  return (
    <section className="space-y-2">
      <h2 className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        The submission
      </h2>

      {off && (
        <p className="text-[0.8125rem] text-muted-foreground">
          {refusalNote("edit an intake request")}
        </p>
      )}

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

      <dl className="divide-y divide-border/60 border-y border-border">
        <EditRow label="Name">
          <EditText
            value={submission.name}
            disabled={off}
            onCommit={(name) => editor.commit({ name })}
          />
        </EditRow>
        <EditRow label="What it is for">
          <EditText
            multiline
            value={submission.description}
            disabled={off}
            onCommit={(description) => editor.commit({ description })}
          />
        </EditRow>
        <EditRow label="Business unit">
          <EditText
            value={submission.businessUnit}
            disabled={off}
            onCommit={(businessUnit) => editor.commit({ businessUnit })}
          />
        </EditRow>
        <EditRow label="Vendor" hint="Leave it empty if we are building it ourselves.">
          <EditText
            value={submission.vendor}
            disabled={off}
            placeholder="Built in house"
            onCommit={(vendor) => editor.commit({ vendor })}
          />
        </EditRow>
        <EditRow
          label="Origin"
          hint="Decides which questions this request answers. Changing it clears the answers below — the two question sets share no fields, and an answer left over from the old one would go on firing a triage rule that no longer applies."
        >
          <EditSelect
            value={submission.origin ?? ""}
            disabled={off}
            options={(Object.keys(ORIGIN) as SystemOrigin[]).map((origin) => ({
              value: origin,
              label: ORIGIN[origin].label,
            }))}
            onCommit={(origin) => origin && editor.commit({ origin })}
          />
        </EditRow>
        <EditRow label="Generates content">
          <YesNo
            value={submission.isGenAi}
            disabled={off}
            onCommit={(isGenAi) => editor.commit({ isGenAi })}
          />
        </EditRow>
        <EditRow label="Data">
          <EditToggles
            value={submission.dataCategories}
            disabled={off}
            options={(Object.keys(DATA_CATEGORY) as DataCategory[]).map((category) => ({
              value: category,
              label: DATA_CATEGORY[category].label,
            }))}
            onCommit={(dataCategories) => editor.commit({ dataCategories })}
          />
        </EditRow>
        <EditRow label="Customer facing">
          <YesNo
            value={submission.facesCustomers}
            disabled={off}
            onCommit={(facesCustomers) => editor.commit({ facesCustomers })}
          />
        </EditRow>
        <EditRow label="Informs decisions about people">
          <YesNo
            value={submission.informsDecisionsAboutPeople}
            disabled={off}
            onCommit={(informsDecisionsAboutPeople) =>
              editor.commit({ informsDecisionsAboutPeople })
            }
          />
        </EditRow>

        {submission.origin &&
          QUESTION_SETS[submission.origin].fields.map((field) => (
            <EditRow key={field.id} label={field.label} hint={field.help}>
              <AnswerEditor
                field={field}
                value={submission.originAnswers[field.id]}
                disabled={off}
                onCommit={(value) =>
                  editor.commit({ originAnswers: { [field.id]: value } })
                }
              />
            </EditRow>
          ))}
      </dl>

      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
        The last block came from{" "}
        {submission.origin ? QUESTION_SETS[submission.origin].label : "the origin"} — a
        different origin would have asked different questions.
        {decided &&
          " Correcting an answer here does not reopen the decision above: that record says what was decided at the time, and it is written once."}
      </p>
    </section>
  );
}

/**
 * Yes, no, or nothing yet — as a select rather than a switch.
 *
 * `EditBoolean` would be the obvious reuse and it is the wrong one: these three
 * fields are `boolean | null`, and a two-state control renders "not answered" as
 * "No". Two of them feed escalating triage rules, so the difference between an
 * unanswered question and an answered "no" is the difference between a request
 * nobody has finished and one that genuinely does not touch people. There is no
 * way back to nothing, because the schema cannot express one — an answer given
 * is not un-given.
 */
function YesNo({
  value,
  onCommit,
  disabled,
}: {
  value: boolean | null;
  onCommit: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <EditSelect
      value={value === null ? "" : value ? "yes" : "no"}
      disabled={disabled}
      placeholder="Not answered"
      options={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      onCommit={(next) => next && onCommit(next === "yes")}
    />
  );
}

/**
 * One origin question, edited from its config.
 *
 * The switch is on `field.type` and nothing else — grep this function for a
 * question id and you will find none, which is the property that keeps the
 * question sets data rather than three hard-coded forms. `FieldRenderer` is the
 * wizard's answer to the same problem and deliberately not reused: it reports
 * every keystroke, which is right while a form is being filled in and wrong
 * once each commit is an audited edit to a record somebody may already have
 * been triaged against.
 *
 * A type the question sets do not currently use falls through to a read-only
 * value rather than to a control that cannot save what it collects.
 */
function AnswerEditor({
  field,
  value,
  onCommit,
  disabled,
}: {
  field: QuestionSetField;
  value: unknown;
  onCommit: (next: IntakeAnswer) => void;
  disabled?: boolean;
}) {
  const options = field.options ?? [];

  switch (field.type) {
    case "short_text":
    case "long_text":
      return (
        <EditText
          multiline={field.type === "long_text"}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onCommit={onCommit}
        />
      );

    case "single_select":
      return (
        <EditSelect
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          placeholder="Not answered"
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          onCommit={(next) => next && onCommit(next)}
        />
      );

    case "multi_select":
      return (
        <EditToggles
          value={
            Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
          }
          disabled={disabled}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          onCommit={onCommit}
        />
      );

    case "boolean":
      return (
        <YesNo
          value={typeof value === "boolean" ? value : null}
          disabled={disabled}
          onCommit={onCommit}
        />
      );

    case "number":
      return (
        <EditNumber
          value={typeof value === "number" ? value : 0}
          disabled={disabled}
          onCommit={onCommit}
        />
      );

    default:
      return (
        <p className="pt-1 text-sm">
          {options.find((o) => o.value === value)?.label ?? String(value ?? "—")}
        </p>
      );
  }
}
