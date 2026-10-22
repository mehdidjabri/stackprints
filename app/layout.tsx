import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import Link from "next/link";
import { MenuCloser } from "@/components/MenuCloser";
import { Modal } from "@/components/Modal";
import { PrimaryNav } from "@/components/PrimaryNav";
import { SearchBox } from "@/components/SearchBox";
import { SectionLink } from "@/components/SectionLink";
import { WebMcp } from "@/components/WebMcp";
import { SITE, getLayers } from "@/lib/data";
import "./globals.css";

// A link to a stack (#s=… or #from=…) hides the editor until it has loaded that stack, so the default
// one never flashes first. The editor clears the flag; the CSS shows the board anyway after 4s.
const HASH_FLAG =
  "try{if(location.pathname==='/'&&/(^#|&)(s|from)=/.test(location.hash))document.documentElement.setAttribute('data-hash-stack','')}catch(e){}";

// Self-hosted at build time: no request to Google at runtime.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "Agentic Stack — every AI agent stack, mapped", template: "%s · Agentic Stack" },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["agentic stack", "AI agent stack", "agent architecture", "LLM", "MCP", "agent harness", "agent memory", "sandbox", "OpenRouter", "AI SDK"],
  // No canonical, markdown twin or og:url here: every page names its own (the home page in app/page.tsx),
  // so a page that doesn't, like the 404, never inherits the home page's.
  openGraph: { type: "website", siteName: SITE.name, title: "Agentic Stack", description: SITE.description },
  twitter: { card: "summary_large_image", title: "Agentic Stack", description: SITE.description },
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
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HASH_FLAG }} />
      </head>
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
            <PrimaryNav />
          </div>
        </header>
        <main id="main" className="wrap">
          {children}
        </main>
        <footer className="foot">
          <div className="wrap">
            <span>
              Open source. <Link href="/submit/">List your product</Link> or <SectionLink id="publish">publish your stack</SectionLink>.
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
        <WebMcp layers={getLayers().map(({ id, name }) => ({ id, name }))} />
      </body>
    </html>
  );
}
