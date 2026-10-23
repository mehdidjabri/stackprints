// The local servers' sources on this machine: the site's JSON API as `npm run build` wrote it to out/,
// and the content as it stands in the working tree. Both are read when asked, so a rebuild or an edit
// shows up without restarting the server. Node only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiSource } from "../core/api";
import type { Files } from "../core/types";

// The site's API paths: /api/... and /search.json, nothing else out/ holds.
const API_PATH = /^\/(api\/[a-z0-9._/-]+\.json|search\.json)$/;
const CONTENT_FILE = /\.(json|md|svg)$/;

/** The built JSON API in <outDir>/api/**.json and <outDir>/search.json; null when a path isn't there. */
export class DirApi implements ApiSource {
  private cache = new Map<string, { mtimeMs: number; value: unknown }>();
  constructor(readonly outDir: string) {}

  async json<T>(sitePath: string): Promise<T | null> {
    if (!API_PATH.test(sitePath) || sitePath.split("/").includes("..")) return null;
    const file = path.join(this.outDir, sitePath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const hit = this.cache.get(sitePath);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value as T;
    const value = JSON.parse(await fs.promises.readFile(file, "utf8")) as T;
    this.cache.set(sitePath, { mtimeMs: stat.mtimeMs, value });
    return value;
  }

  /** Whether the site was built here at all: without out/api the catalogue tools have nothing to read. */
  exists() {
    return fs.existsSync(path.join(this.outDir, "api"));
  }
}

/** content/** and docs/** (.json, .md, .svg) as they are in the working tree, uncommitted edits included. */
export async function worktreeFiles(root: string, trees = ["content", "docs"]): Promise<Files> {
  const files: Files = new Map();
  const walk = async (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && CONTENT_FILE.test(e.name)) files.set(p, await fs.promises.readFile(path.join(root, p), "utf8"));
    }
  };
  for (const t of trees) await walk(t);
  return files;
}

/** A git remote's https://github.com/<owner>/<repo>, or undefined when it isn't on GitHub. Credentials are dropped. */
export function githubUrl(remote: string) {
  const m = remote.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

/** The repository root: `explicit` if given, else the first folder up from each start that has content/layers.json. */
export function findRoot(starts: string[], explicit?: string) {
  const isRoot = (dir: string) => fs.existsSync(path.join(dir, "content", "layers.json"));
  if (explicit) {
    const dir = path.resolve(explicit);
    if (!isRoot(dir)) throw new Error(`${dir} has no content/layers.json: STACKPRINTS_ROOT must point at a Stackprints checkout`);
    return dir;
  }
  for (const start of starts) {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      if (isRoot(dir)) return dir;
      if (path.dirname(dir) === dir) break;
    }
  }
  throw new Error(`no Stackprints checkout found above ${starts.join(" or ")}: run from inside one, or set STACKPRINTS_ROOT`);
}

/** Whether the module at `moduleUrl` is the program node was started with (through a symlink too). */
export function isMain(moduleUrl: string) {
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return Boolean(process.argv[1]) && real(process.argv[1]!) === real(fileURLToPath(moduleUrl));
}
