import { ShieldCheck } from "lucide-react";

/**
 * Signed-out chrome: centred card, no sidebar. Kept deliberately plain — the
 * first screen should look like a product someone bought, not a demo.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">Forseti</h1>
            <p className="text-sm text-muted-foreground">
              AI Trust Readiness Copilot
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
