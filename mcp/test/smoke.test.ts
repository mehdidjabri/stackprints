import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { READ_ONLY, registerTools, tool, ToolError } from "../src/core/tool";

describe("SDK v2 over HTTP", () => {
  it("lists and calls a tool, and returns tool errors", async () => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "t", version: "0.0.0" });
      registerTools(server, { now: Date.now }, [
        tool({ name: "echo", title: "Echo", description: "Echo", input: z.object({ text: z.string() }), annotations: READ_ONLY, run: async ({ text }) => ({ text }) }),
        tool({ name: "boom", title: "Boom", description: "Fails", input: z.object({}), run: async () => { throw new ToolError("nope", { why: "test" }); } }),
      ]);
      return server;
    });
    const client = new Client({ name: "c", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["boom", "echo"]);
    const r = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    expect(r.structuredContent).toEqual({ text: "hi" });
    const e = await client.callTool({ name: "boom", arguments: {} });
    expect(e.isError).toBe(true);
    expect(e.structuredContent).toEqual({ error: "nope", why: "test" });
  });
});
