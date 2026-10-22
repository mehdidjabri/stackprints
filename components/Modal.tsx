"use client";

import { useEffect, useRef, useState } from "react";

// Component (option) pages open in a modal when clicked from anywhere on the site. Stacks don't.
// The modal shows the page's own prerendered <article>, so direct visits, crawlers
// and the modal all read the same static HTML.
const MODAL_PATH = /^\/layer\/[^/]+\/[^/]+\/$/;

/** A component page as the modal shows it: its article, the tab title, and its heading to name the dialog. */
type Page = { html: string; title: string; name: string };

const cache = new Map<string, Promise<Page>>();
function load(href: string) {
  if (!cache.has(href)) {
    cache.set(
      href,
      fetch(href)
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          doc.querySelectorAll("script").forEach((s) => s.remove());
          const article = doc.querySelector("main article");
          return {
            html: article?.outerHTML ?? "",
            title: doc.title,
            name: article?.querySelector("h1")?.textContent?.trim() ?? "",
          };
        })
        .catch((e) => {
          cache.delete(href);
          throw e;
        }),
    );
  }
  return cache.get(href)!;
}

const target = (e: Event) => {
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return null;
  return MODAL_PATH.test(a.pathname) ? a : null;
};

export function Modal() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [href, setHref] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [name, setName] = useState("");
  const pushed = useRef(false);
  // The page's own tab title, put back on close: while open, the tab names the component, as the address bar does.
  const pageTitle = useRef("");

  const show = (path: string) => {
    setHref(path);
    if (!dialog.current?.open) {
      pageTitle.current = document.title;
      dialog.current?.showModal();
    }
    load(path).then(
      (p) => {
        setHtml(p.html);
        setName(p.name);
        if (p.title && dialog.current?.open) document.title = p.title;
      },
      () => (location.href = path),
    );
    dialog.current?.querySelector(".modal-body")?.scrollTo(0, 0);
  };

  const hide = () => {
    dialog.current?.close();
    if (pageTitle.current) document.title = pageTitle.current;
    setHref(null);
    setHtml("");
    setName("");
  };

  // Close from the UI: rewind every modal entry we pushed, so the page URL comes back
  // in one step while the browser's Back button still walks card by card.
  const close = () => {
    const depth = history.state?.depth ?? 0;
    if (pushed.current && depth > 0) history.go(-depth);
    else hide();
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = target(e);
      if (!a || a.pathname === location.pathname) return;
      e.preventDefault();
      history.pushState({ modal: a.pathname, depth: (history.state?.depth ?? 0) + 1 }, "", a.pathname);
      pushed.current = true;
      show(a.pathname);
    };
    const onHover = (e: Event) => {
      const a = target(e);
      if (a) load(a.pathname).catch(() => {});
    };
    const onPop = (e: PopStateEvent) => {
      // Modal history entries are ours: keep Next's router from treating them as route changes.
      if (!e.state?.modal && !pushed.current) return;
      e.stopImmediatePropagation();
      if (e.state?.modal) {
        pushed.current = true;
        show(e.state.modal);
      } else {
        pushed.current = false;
        hide();
      }
      // Next's router follows pushState but not this popstate: replacing the entry with itself tells it
      // the URL again, so usePathname (the header's current section, SectionLink) matches the address bar.
      const { modal, depth } = e.state ?? {};
      history.replaceState(modal ? { modal, depth } : null, "", location.href);
    };
    // Capture phase: runs before Next's <Link>, which then sees defaultPrevented and stands down.
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onHover, { passive: true });
    window.addEventListener("popstate", onPop, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerover", onHover);
      window.removeEventListener("popstate", onPop, true);
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={name || "Component"}
      onCancel={(e) => {
        // Esc
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === dialog.current && close()}
    >
      <div className="modal-frame">
        <div className="modal-bar">
          <span className="silk">Component</span>
          {href && (
            <a href={href} className="modal-open" onClick={(e) => (e.preventDefault(), (location.href = href))}>
              Open page ↗
            </a>
          )}
          <button className="modal-close" onClick={close} aria-label="Close">
            Close <kbd>esc</kbd>
          </button>
        </div>
        <div className="modal-body" aria-busy={!html}>
          {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div className="modal-loading" />}
        </div>
      </div>
    </dialog>
  );
}
