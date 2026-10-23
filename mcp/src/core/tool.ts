// One way to declare a tool for both servers: a zod input, the scope it needs, and a function that
// returns plain data. The helper registers it only for callers with the scope, turns the data into
// structured content plus a JSON text mirror, turns thrown errors into tool errors, and audits writes.
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { audit, shorten } from "./audit";
import type { StateStore } from "./state";
import { type Principal, type Scope, can } from "./types";

/** An error the caller can act on: the message says what to change. */
export class ToolError extends Error {
  constructor(
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolSpec<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Needed on the admin server. Public tools leave it out. */
  scope?: Scope;
  annotations?: ToolAnnotations;
  /** Defaults to true for content:write, content:publish and keys:manage tools. */
  audit?: boolean;
  run: (args: z.infer<S>) => Promise<unknown>;
};

export const tool = <S extends z.ZodObject>(spec: ToolSpec<S>) => spec as unknown as ToolSpec;

type Ctx = { principal?: Principal; state?: StateStore; now: () => number };

const asObject = (data: unknown): Record<string, unknown> =>
  data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { result: data };

export function registerTools(server: McpServer, ctx: Ctx, specs: ToolSpec[]) {
  for (const spec of specs) {
    if (spec.scope && (!ctx.principal || !can(ctx.principal, spec.scope))) continue;
    const audited = spec.audit ?? (spec.scope !== undefined && spec.scope !== "content:read");
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        annotations: { title: spec.title, ...spec.annotations },
      },
      // biome-ignore lint: the SDK infers args from the schema; ours are already typed by the spec.
      (async (args: unknown) => {
        const note = async (outcome: "ok" | "error", detail?: string) => {
          if (!audited || !ctx.state || !ctx.principal) return;
          const p = ctx.principal;
          await audit(ctx.state, { who: { name: p.name, kind: p.kind, ...(p.keyId ? { keyId: p.keyId } : {}) }, tool: spec.name, args: shorten(args), outcome, ...(detail ? { detail } : {}) }, ctx.now()).catch(() => {});
        };
        try {
          const data = asObject(await spec.run(args as never));
          await note("ok", typeof data.url === "string" ? data.url : undefined);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
        } catch (e) {
          const err = e as Error;
          const known = err instanceof ToolError;
          const message = known ? err.message : `Unexpected error: ${err.message}`;
          await note("error", message);
          return {
            isError: true,
            content: [{ type: "text" as const, text: message + (known && (err as ToolError).data ? `\n${JSON.stringify((err as ToolError).data, null, 2)}` : "") }],
            ...(known && (err as ToolError).data ? { structuredContent: { error: message, ...(err as ToolError).data } } : {}),
          };
        }
      }) as never,
    );
  }
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
