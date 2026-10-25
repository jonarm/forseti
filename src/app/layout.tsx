import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full`}
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
