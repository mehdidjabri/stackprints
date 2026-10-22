---
layer: mcp
kind: template
title: Code Mode tool description
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/codemode/src/shared.ts#L10-L19
license: MIT
retrieved: 2026-10-22
note: DEFAULT_DESCRIPTION of createCodeTool in @cloudflare/codemode, the single tool that replaces a set of tools with one that runs model-written JavaScript against them. {{types}} is replaced with TypeScript declarations generated from the wrapped tools, which the code calls as methods on codemode. codeMcpServer, which wraps an MCP server the same way, uses the same text with the example line generated from the server's first tool.
---
Execute code to achieve a goal.

Available:
{{types}}

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

Example: async () => { const r = await codemode.searchWeb({ query: "test" }); return r; }
