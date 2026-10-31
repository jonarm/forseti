/** Make nonpersistent workflow demonstrations distinguishable from saved edits. */
export function PreviewNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      <strong>Workflow preview.</strong> {children}
    </p>
  );
}
