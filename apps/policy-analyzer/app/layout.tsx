import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "Policy Analyzer — HorseInsurance.ai",
  description:
    "Upload an equine insurance policy and receive a source-grounded, plain-English reading of what the documents actually say.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-[#faf9f7] text-[#1f2933] antialiased`}>
        <header className="border-b border-[#e5e7eb] bg-[#0b3c5d] text-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight no-underline">
              HorseInsurance.ai <span className="font-normal text-[#d4a017]">Policy Analyzer</span>
            </Link>
            <p className="text-xs text-white/70">A Bridle &amp; Bit Magazine property</p>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs leading-relaxed text-[#6b7280]">
          This tool reads the documents you upload. It does not sell insurance, approve claims, or replace your
          carrier, agent, veterinarian, or attorney. Findings about your policy are limited to text found in the
          upload. Educational notes are labeled and do not add coverage.
        </footer>
      </body>
    </html>
  );
}
