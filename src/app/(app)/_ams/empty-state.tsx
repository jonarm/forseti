import { cn } from "@/lib/utils";

/**
 * The empty state, once.
 *
 * Every table and panel in the product gets one, and they all say the same kind
 * of thing: what would be here, and what puts it here. "No data" tells the
 * reader nothing they had not already worked out from the blank space — the
 * useful sentence is the one that explains what fills it.
 *
 * Deliberately not centred in a huge box with an icon. An empty tab in a dense
 * tool should occupy about as much room as a short list would, so the layout
 * does not lurch when the first record arrives.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2 rounded-lg border border-dashed border-border px-4 py-8", className)}>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
