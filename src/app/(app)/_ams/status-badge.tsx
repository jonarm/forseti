import { cn } from "@/lib/utils";
import { TONE_BADGE, type Tone } from "@/lib/ams/tone";

/**
 * The one badge in the product.
 *
 * Every status across every screen renders through here, which is what makes
 * the vocabulary restrained rather than merely consistent: there is exactly one
 * place to add a colour, so adding one is a decision instead of an accident.
 *
 * Two rules it enforces by construction. The label is always present, so colour
 * is never the only carrier of meaning — a monochrome screenshot of any table
 * still reads correctly. And `neutral` is the default, so a new status has to
 * argue for colour rather than receive it.
 */
export function StatusBadge({
  label,
  tone = "neutral",
  className,
  title,
}: {
  label: string;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center whitespace-nowrap rounded-md border px-1.5 text-[0.6875rem] font-medium leading-none",
        TONE_BADGE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * A citation, not a status.
 *
 * Control refs, system ids and clause numbers are identifiers people read
 * character by character and compare against another document, so they get the
 * mono face and never a badge — a rounded pill invites you to read a reference
 * as a state.
 */
export function Ref({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)}>
      {children}
    </span>
  );
}
