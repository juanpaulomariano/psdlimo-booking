import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { TopBar } from "./components/TopBar";

// UI text. Optical sizing keeps small labels legible without going heavier.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Display only — headings and the price. A soft serif reads as considered
// rather than corporate, which is the whole brief for this brand.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "PSDLimo — Book a Chauffeur",
  description:
    "Private chauffeur service across the San Francisco Bay Area. Instant pricing, confirmed in minutes.",
  // Demo build — keep it out of search results.
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the session server-side (from the httpOnly cookie) and pass a SAFE
  // subset to the client bar — never the token, only name/email/role.
  const session = await getSession();
  const barSession = session
    ? { name: session.name, email: session.email, role: session.role }
    : null;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="bg-ink-900 text-paper-100 flex min-h-full flex-col">
        <TopBar session={barSession} />
        {children}
      </body>
    </html>
  );
}
