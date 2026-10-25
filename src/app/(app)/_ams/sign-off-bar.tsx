"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Mail, MessageSquare, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/ams/labels";
import type { SignOffStep } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The sign-off chain, and the question of who may actually move it.
 *
 * The answer this bar encodes: **sign-off happens here, in the platform, by the
 * person the stage is assigned to.** Notifications go out by email and Teams
 * because a CISO does not log in weekly, but their job is to bring somebody to
 * this page — not to let them approve from an inbox. An approve button inside an
 * email is a mechanism for approving without reading, and the whole value of the
 * third signature is that the person accepting residual risk opened the
 * document. So the bar shows what would be sent, and still makes you be here.
 *
 * Three rules follow from that, and each one is visible:
 *
 *   - **Only the assignee acts.** Everyone else sees who it is waiting on. The
 *     "viewing as" switcher above exists so a demo can show all three views;
 *     in the real product it is just who you are.
 *   - **Either reviewer can send it back**, with a reason that is mandatory. An
 *     endorser whose only options are "endorse" or "do nothing" chooses to do
 *     nothing, and the assessment sits.
 *   - **A submitted document is frozen.** To change an answer the owner has to
 *     withdraw it, which resets every review already given — because a reviewer
 *     endorsed the document they read, not the one it might become.
 */
export function SignOffBar({
  steps,
  viewerId,
  outstanding,
  onAdvance,
  onSendBack,
  onWithdraw,
}: {
  steps: SignOffStep[];
  viewerId: string;
  outstanding: number;
  onAdvance: () => void;
  onSendBack: (reason: string) => void;
  onWithdraw: () => void;
}) {
  const { personById } = useWorkspace();
  const [busy, setBusy] = useState<"advance" | "back" | "withdraw" | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");

  const current = steps.find((s) => s.state === "current");
  const isAssignee = current?.assigneeId === viewerId;
  const isOwner = steps[0].assigneeId === viewerId;
  const submitted = steps[0].state === "complete";
  const isReviewStage = current ? steps.indexOf(current) > 0 : false;
  const complete = outstanding === 0;
  const anyReviewDone = steps.slice(1).some((s) => s.state === "complete");

  function run(kind: "advance" | "back" | "withdraw", fn: () => void) {
    setBusy(kind);
    window.setTimeout(() => {
      fn();
      setBusy(null);
      setSendingBack(false);
      setReason("");
    }, 800);
  }

  return (
    <footer className="sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
      {sendingBack && (
        <div className="space-y-2 border-b border-border bg-warn/5 px-6 py-3">
          <Label htmlFor="send-back-why" className="text-sm font-medium">
            Why are you sending this back?
            <span className="ml-1 text-muted-foreground/60">*</span>
          </Label>
          <p className="text-[0.8125rem] text-muted-foreground">
            Goes to {personById(steps[0].assigneeId).name} with the assessment.
            Any review already given is reset — they will be redone against
            whatever comes back.
          </p>
          <Textarea
            id="send-back-why"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The disparity testing answer describes the vendor's figures, not ours. We need a test on our own applicant pool before this can be endorsed."
            aria-invalid={reason.trim().length < 15}
          />
          <div className="flex items-center gap-2">
            {reason.trim().length < 15 && (
              <p className="text-[0.8125rem] text-warn">
                A sentence at least — this is what the owner has to act on.
              </p>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSendingBack(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={reason.trim().length < 15 || busy !== null}
                onClick={() => run("back", () => onSendBack(reason))}
              >
                {busy === "back" ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}
                Send back
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {steps.map((step, i) => (
            <li key={step.stage} className="flex items-center gap-2">
              {i > 0 && (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30" aria-hidden />
              )}
              <div
                className={cn(
                  "rounded-md border px-2.5 py-1.5",
                  step.state === "complete" && "border-ok/30 bg-ok/5",
                  step.state === "current" && "border-brand/40 bg-brand/5",
                  step.state === "pending" && "border-border opacity-50",
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {step.state === "complete" && <Check className="size-3 text-ok" aria-hidden />}
                  {step.label}
                </p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {personById(step.assigneeId).name}
                  {step.completedAt && ` · ${formatDate(step.completedAt)}`}
                  {step.state === "current" && (isAssignee ? " · your turn" : " · waiting")}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {/* The owner's route back into a frozen document. */}
          {submitted && isOwner && !isAssignee && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => run("withdraw", onWithdraw)}
              title={
                anyReviewDone
                  ? "Withdrawing resets every review already given"
                  : "Reopen for editing"
              }
            >
              {busy === "withdraw" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Undo2 aria-hidden />
              )}
              Withdraw and edit
            </Button>
          )}

          {!current ? (
            <p className="text-xs text-ok">Sign-off complete.</p>
          ) : !isAssignee ? (
            <p className="max-w-xs text-right text-xs text-muted-foreground">
              Waiting on{" "}
              <span className="text-foreground">{personById(current.assigneeId).name}</span>.
              You are not the assignee for this stage, so you cannot advance it.
            </p>
          ) : (
            <>
              {!complete && (
                <p className="text-xs text-warn">
                  {outstanding} required answer{outstanding === 1 ? "" : "s"} outstanding
                </p>
              )}
              {isReviewStage && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setSendingBack(true)}
                >
                  <Undo2 aria-hidden />
                  Send back
                </Button>
              )}
              <Button
                size="sm"
                disabled={!complete || busy !== null}
                onClick={() => run("advance", onAdvance)}
              >
                {busy === "advance" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                {current.label.replace(/s$/, "")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* What happens after the click, stated rather than implied. */}
      {current && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 px-6 py-2 text-[0.6875rem] text-muted-foreground/70">
          <MessageSquare className="size-3 shrink-0" aria-hidden />
          <Mail className="size-3 shrink-0" aria-hidden />
          <span>
            {personById(current.assigneeId).name} is notified in Teams and by
            email, with a link to this page.
            {steps.indexOf(current) === 2 && (
              <>
                {" "}
                Accepting residual risk cannot be done from either — it is the
                signature that has to mean the document was opened.
              </>
            )}
          </span>
        </p>
      )}
    </footer>
  );
}

/** Shown at the top of a document that has been returned by a reviewer. */
export function SentBackNotice({ reason, byId }: { reason: string; byId: string }) {
  const { personById } = useWorkspace();
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/5 px-3.5 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          Sent back by {personById(byId).name}
        </p>
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
