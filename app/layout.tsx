import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import Link from "next/link";
import { MenuCloser } from "@/components/MenuCloser";
import { Modal } from "@/components/Modal";
import { SearchBox } from "@/components/SearchBox";
import { WebMcp } from "@/components/WebMcp";
import { SITE } from "@/lib/data";
import { withMarkdown } from "@/lib/links";
import "./globals.css";

// Self-hosted at build time: no request to Google at runtime.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "Agentic Stack — every AI agent stack, mapped", template: "%s · Agentic Stack" },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["agentic stack", "AI agent stack", "agent architecture", "LLM", "MCP", "agent harness", "agent memory", "sandbox", "OpenRouter", "AI SDK"],
  alternates: withMarkdown("/"),
  openGraph: { type: "website", siteName: SITE.name, url: "/", title: "Agentic Stack", description: SITE.description },
  twitter: { card: "summary_large_image", title: "Agentic Stack", description: SITE.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              agentic stack
            </Link>
            <SearchBox />
            <nav aria-label="Primary">
              <Link href="/trending/">Trending</Link>
              <Link href="/#stacks">Stacks</Link>
              <Link href="/layers/">Layers</Link>
              <Link href="/mine/">Mine</Link>
              <Link href="/contribute/">Contribute</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="wrap">
          {children}
        </main>
        <footer className="foot">
          <div className="wrap">
            <span>
              Open source. <Link href="/submit/">List your product</Link> or <Link href="/#publish">publish your stack</Link>.
            </span>
            <nav aria-label="Footer">
              <Link href="/about/">About</Link>
              <Link href="/api/">API</Link>
              <a href="/llms.txt">llms.txt</a>
              <Link href="/contact/">Contact</Link>
              <Link href="/privacy/">Privacy</Link>
              <a href={SITE.repo}>GitHub</a>
            </nav>
          </div>
        </footer>
        <MenuCloser />
        <Modal />
        <WebMcp />
      </body>
    </html>
  );
}
