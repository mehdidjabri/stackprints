---
layer: browser
kind: template
title: Persistent browser tool description
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/agents/src/browser/browser-tool.ts#L190-L219
license: MIT
retrieved: 2026-10-22
note: The description of browserTool from agents/browser, a Code Mode tool that drives one persistent Chrome on a Browser Run binding over CDP (the docs show it in a Think agent's getTools()). The first nine rules are BROWSER_INSTRUCTIONS in packages/agents/src/browser/session-connector.ts (lines 163-173 at this commit); the timeout rule uses the default 60-second timeout; the screenshot rule is the AI SDK adapter's hint (packages/agents/src/browser/tools/ai-sdk.ts, lines 84-85), which the TanStack AI and pi adapters replace with their own.
---
Run JavaScript that drives a persistent Chrome browser over the Chrome DevTools Protocol (CDP).

Write an async arrow function, `async () => { ... }`, and return a small JSON value. Use the `cdp` global to reach the browser. `fetch` is blocked and there is no file system or Node.js API.

## cdp

- `cdp.send({ method, params?, sessionId?, timeoutMs? })` sends a CDP command and returns its result without the JSON-RPC envelope: `Page.navigate` returns `{ frameId, errorText? }`, `Runtime.evaluate` returns `{ result: { value }, exceptionDetails? }`.
- `cdp.attachToTarget({ targetId })` makes an open tab active and returns `{ sessionId }`.
- `cdp.spec()` returns the whole protocol (about 650 KB) as `{ domains: [{ name, commands, events, types }] }`. Filter it in code, for example `spec.domains.find((d) => d.name === "Page").commands.find((c) => c.name === "navigate")`.
- `cdp.getDebugLog()` returns recent protocol traffic, for when a command fails or times out.

## Rules

- The browser persists between runs: tabs, cookies, and logins are still there next time. You never start or close it.
- If the browser was replaced (idle timeout, crash), the result says restarted: true and earlier tabs and logins are gone. Before an action that matters (submitting a form, a purchase), check you're on the page you expect.
- Page-scoped commands (Page.*, Runtime.*, DOM.*, Input.*, Network.*, Emulation.*) need sessionId: "active", your tab, which is remembered between runs. Browser.* and Target.* commands take no sessionId.
- Other open tabs (Target.getTargets) may belong to other conversations using this browser: don't close, navigate, or attach to a tab you didn't open unless the user asks.
- Target.createTarget opens a tab and makes it active. To switch to another open tab, call cdp.attachToTarget({ targetId }); the sessionId it returns keeps working in later runs, while one from a raw Target.attachToTarget only works in the current run.
- Tabs a page opens itself (popups, target=_blank links) don't become active; the result lists them as newTabs.
- Runtime.evaluate: pass returnByValue: true, or objects come back as a remote reference with no value, and awaitPromise: true for async expressions. The value is at result.value. A thrown error doesn't reject: check exceptionDetails.
- Page.navigate returns before the page loads and doesn't throw when it fails: check errorText, then poll document.readyState with Runtime.evaluate until it is 'complete'.
- Pick out what you need inside Runtime.evaluate and return only that. Results over about 24,000 characters are cut short, and a single cdp.send result over 1 MB (a full-page screenshot, say) fails the run.
- Each run times out after <dynamic: timeout in seconds, default 60>s, so split long jobs (crawling a site, say) across runs.
- To show a screenshot, return { type: 'browser_screenshot', mediaType, data } with data from Page.captureScreenshot and mediaType 'image/png', or 'image/jpeg' if you captured with format: 'jpeg'. The user sees the image; you get a short text summary.
- A `SyntaxError` from "Failed to start Worker" means your code didn't parse; its line number points into wrapper code, not yours. Check regex literals and escapes.
