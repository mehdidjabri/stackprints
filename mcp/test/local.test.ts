// The built local servers (npm run build:local), started as a client would start them: over stdio.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirApi, findRoot, githubUrl, worktreeFiles } from "../src/local/dir-api";
import { ROOT, repoFiles } from "./helpers";

const MCP = path.join(ROOT, "mcp");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-local-"));

beforeAll(() => {
  execFileSync("npm", ["run", "--silent", "build:local"], { cwd: MCP, stdio: "pipe" });
}, 60_000);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function start(entry: "admin" | "public", env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(MCP, "dist", `${entry}.mjs`)],
    cwd: tmp,
    env: { ...getDefaultEnvironment(), STACKPRINTS_ROOT: ROOT, STACKPRINTS_STATE: path.join(tmp, "state.json"), ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "local-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("dist/admin.mjs over stdio", () => {
  it("starts, lists the admin tools and answers whoami as the local user", async () => {
    const client = await start("admin");
    try {
      expect(client.getServerVersion()?.name).toBe("stackprints-admin");
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["whoami", "open_changeset", "submit_changeset", "revert_commit", "list_corrections", "search_stackprints"]));
      // Keys minted here would live in this machine's state file, which nothing reads keys from.
      for (const name of ["create_api_key", "list_api_keys", "revoke_api_key"]) expect(names).not.toContain(name);
      // The catalogue readers come along, the public submission tools don't.
      expect(names).not.toContain("prepare_correction");
      const r = await client.callTool({ name: "whoami", arguments: {} });
      expect(r.isError).toBeFalsy();
      const me = r.structuredContent as { name: string; kind: string; scopes: string[]; headSha: string; can: { manageKeys: boolean } };
      expect(me.kind).toBe("local");
      expect(me.name).toMatch(/^local:/);
      expect(me.scopes).toEqual(["content:read", "content:write", "content:publish"]);
      expect(me.can.manageKeys).toBe(false);
      expect(me.headSha).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim());
    } finally {
      await client.close();
    }
  });

  it("narrows the tools to STACKPRINTS_SCOPES, and never offers key tools", async () => {
    const client = await start("admin", { STACKPRINTS_SCOPES: "content:read" });
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("whoami");
      expect(names).not.toContain("open_changeset");
      expect(names).not.toContain("create_api_key");
    } finally {
      await client.close();
    }
    const keys = await start("admin", { STACKPRINTS_SCOPES: "content:read,keys:manage" });
    try {
      expect((await keys.listTools()).tools.map((t) => t.name)).not.toContain("create_api_key");
    } finally {
      await keys.close();
    }
  });
});

describe("dist/public.mjs over stdio", () => {
  it("starts and serves the public tools from this checkout", async () => {
    const client = await start("public");
    try {
      expect(client.getServerVersion()?.name).toBe("stackprints");
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["search_stackprints", "validate_stack", "prepare_correction"]));
      expect(names).not.toContain("whoami");
      const r = await client.callTool({ name: "validate_stack", arguments: { stack: JSON.parse(repoFiles().get("content/stacks/pi.json")!) } });
      expect(r.isError).toBeFalsy();
      expect((r.structuredContent as { ok: boolean }).ok).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("local sources", () => {
  it("finds the checkout from a folder inside it, or refuses a folder that isn't one", () => {
    expect(findRoot([path.join(ROOT, "mcp", "src")])).toBe(ROOT);
    expect(findRoot([tmp, path.join(ROOT, "docs")])).toBe(ROOT);
    expect(() => findRoot([tmp], tmp)).toThrow(/STACKPRINTS_ROOT/);
  });

  it("reads the working tree like the checkout's own files", async () => {
    const files = await worktreeFiles(ROOT);
    // Compared with a plain walk of the working tree, not the pinned fixtures: content keeps changing.
    const walked: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.posix.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(json|svg|md)$/.test(e.name)) walked.push(p);
      }
    };
    walk("content");
    walk("docs");
    expect([...files.keys()].sort()).toEqual(walked.sort());
  });

  it("reads the built API by site path, null for anything else", async () => {
    const out = path.join(tmp, "out");
    fs.mkdirSync(path.join(out, "api", "layers"), { recursive: true });
    fs.writeFileSync(path.join(out, "api", "layers", "memory.json"), '{"id":"memory"}');
    fs.writeFileSync(path.join(out, "search.json"), "[]");
    fs.writeFileSync(path.join(out, "secret.json"), '{"no":true}');
    const api = new DirApi(out);
    expect(await api.json("/api/layers/memory.json")).toEqual({ id: "memory" });
    expect(await api.json("/search.json")).toEqual([]);
    expect(await api.json("/api/layers/missing.json")).toBeNull();
    expect(await api.json("/secret.json")).toBeNull();
    expect(await api.json("/api/../secret.json")).toBeNull();
    fs.writeFileSync(path.join(out, "api", "layers", "memory.json"), '{"id":"memory","v":2}');
    fs.utimesSync(path.join(out, "api", "layers", "memory.json"), new Date(), new Date(Date.now() + 5000));
    expect(await api.json("/api/layers/memory.json")).toEqual({ id: "memory", v: 2 });
  });

  it("turns GitHub remotes into repository URLs", () => {
    expect(githubUrl("git@github.com:stackprints/stackprints.git")).toBe("https://github.com/stackprints/stackprints");
    expect(githubUrl("https://x-access-token:abc@github.com/stackprints/stackprints.git\n")).toBe("https://github.com/stackprints/stackprints");
    expect(githubUrl("ssh://git@github.com/a/b")).toBe("https://github.com/a/b");
    expect(githubUrl("https://gitlab.com/a/b.git")).toBeUndefined();
    expect(githubUrl("")).toBeUndefined();
  });
});
