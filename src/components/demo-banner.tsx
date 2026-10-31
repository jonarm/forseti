import { FlaskConical } from "lucide-react";

/**
 * Persistent, non-dismissible reminder that this build must only ever be used
 * with synthetic company data. It is deliberately not closeable.
 */
export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs font-medium text-amber-300">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>Experimental build — sample data only. Assessment sign-off, evidence verification and finding closure are previews. Do not enter confidential data.</span>
    </div>
  );
}
