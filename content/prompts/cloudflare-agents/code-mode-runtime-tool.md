---
layer: mcp
kind: template
title: Code Mode runtime tool description (Think's execute tool)
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/codemode/src/proxy-tool.ts#L553-L602
license: MIT
retrieved: 2026-10-22
note: The default description built by buildDescription in @cloudflare/codemode for a durable Code Mode runtime tool, whose only input is code. Think's createExecuteTool (the execute tool) and browser_execute both use it, unless a custom description replaces it. The connector names fill the globals list and the Available connectors list; Think's execute tool adds a one-line hint for its tools and cdp connectors (connectorHints in packages/think/src/tools/execute.ts, lines 285-308 at this commit), shown after the dash.
---
Execute JavaScript in a sandbox with access to connector SDKs.

## Workflow

1. `const matches = await codemode.search("short intent phrase");`
2. `const docs = await codemode.describe(matches.results[0].path);`
3. Call the method: `await <connector>.<method>(args);`

## Rules

- The ONLY globals are <dynamic: connector names, e.g. `tools`, `cdp`> and `codemode` (plus standard JavaScript). There is no `host`, `fs`, `require`, `process`, or Node.js API — all I/O goes through the connectors below.
- Never guess method names. If you have not used a connector in this conversation, run a discovery pass first: `codemode.search(query)` returns ranked matches across connector methods and saved snippets.
- `codemode.describe("connector.method")` returns TypeScript type declarations.
- `codemode.step(name, fn)` wraps side-effectful or nondeterministic work (raw fetch, random, time) so it runs once and is replayed on resume. Use it for anything that isn't a connector call.
- Some methods require approval. The run pauses until the user approves, then resumes automatically. Write code as if the call returns normally.
- A result with `status: "paused"` means the run is awaiting human approval. Tell the user what is pending and wait — do NOT re-issue the code; the run resumes on its own once approved.
- All code outside connector calls and `codemode.step` must be deterministic so resume can replay it.
- Do not use `fetch` — use connector SDKs.

## Snippets

Snippets are saved scripts you can reuse.
- `codemode.run("name", input)` runs a saved snippet. Snippets appear in `codemode.search` results.
- If a script may be saved as a snippet later, write it as `async (input) => { ... }` so it can take input.

## Available connectors

- `<dynamic: connector name>` — <dynamic: connector hint, when one is set>
