import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Forseti — AI governance platform",
  description:
    "Inventory the AI systems a company actually uses, govern them against ISO 42001, and answer a buyer from the same records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Dark-only build: the class is fixed rather than toggled.
      className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full`}
    >
      {/*
        The root layout owns only what is universal: fonts, theme, and the
        tooltip context. The signed-in chrome (banner, sidebar) lives in
        `(app)/layout.tsx` so the auth and onboarding routes can render without
        a sidebar pointing at pages the visitor cannot reach yet.
      */}
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
