// A GitHub repository in memory behind the REST endpoints GitHubStore calls (refs, commits, trees,
// pulls, issues, tarballs), answering a fetch the way api.github.com would, rulesets and paged
// commit files included. Also: a gzip tarball laid out the way GitHub's are.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Files } from "../src/core/types";

type Commit = { sha: string; tree: string; parents: string[]; message: string; date: string; author: string; paths: string[] };

const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const json = (body: unknown, status = 200) => Response.json(body, { status });
const error = (status: number, message: string) => json({ message }, status);

export class FakeGitHub {
  trees = new Map<string, Files>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  pulls: { number: number; head: string; base: string; title: string; body: string; state: "open" | "closed" }[] = [];
  issues: { number: number; title: string; body: string | null; labels: string[]; state: "open" | "closed"; created_at: string; pull_request?: boolean }[] = [];
  /** Branches a ruleset keeps to pull requests: moving them answers 422 as GitHub does. */
  protectedBranches = new Set<string>();
  /** A commit's files per page (GitHub: 300); the rest follow through Link headers. */
  filesPerPage = 300;
  /** Every request, as "METHOD /path?query". */
  calls: string[] = [];
  tarballs = 0;
  /** GitHub's own Link URLs name the repository by id. */
  readonly id = 4242;
  private n = 0;

  constructor(
    readonly repo: string,
    files: Files,
  ) {
    const tree = this.tree(new Map(files));
    const sha = this.commit({ tree, parents: [], message: "initial", paths: [...files.keys()] });
    this.refs.set("main", sha);
  }

  private tree(files: Files) {
    const sha = hash([...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, t]) => `${p}\0${hash(t)}`).join("\n"));
    this.trees.set(sha, files);
    return sha;
  }

  private commit(c: Omit<Commit, "sha" | "date" | "author">) {
    const sha = hash(`commit ${++this.n} ${c.tree} ${c.message}`);
    this.commits.set(sha, { ...c, sha, date: new Date(Date.UTC(2026, 9, 22, 12, 0, this.n)).toISOString(), author: "tester" });
    return sha;
  }

  /** A person pushing straight to main. */
  push(changes: Record<string, string | null>, message = "outside change") {
    const parent = this.commits.get(this.refs.get("main")!)!;
    const files = new Map(this.trees.get(parent.tree));
    for (const [p, t] of Object.entries(changes)) t === null ? files.delete(p) : files.set(p, t);
    const sha = this.commit({ tree: this.tree(files), parents: [parent.sha], message, paths: Object.keys(changes) });
    this.refs.set("main", sha);
    return sha;
  }

  filesAt(ref: string) {
    const c = this.commits.get(this.refs.get(ref) ?? ref)!;
    return new Map(this.trees.get(c.tree)!);
  }

  private resolve(ref: string) {
    if (this.refs.has(ref)) return this.refs.get(ref)!;
    return [...this.commits.keys()].find((s) => ref.length >= 4 && s.startsWith(ref));
  }

  private isAncestor(ancestor: string, of: string): boolean {
    if (ancestor === of) return true;
    return (this.commits.get(of)?.parents ?? []).some((p) => this.isAncestor(ancestor, p));
  }

  /** A commit as the API returns it, with `files` (one page of them for GET /commits/<sha>). */
  private apiCommit(c: Commit, files = c.paths) {
    return {
      sha: c.sha,
      html_url: `https://github.com/${this.repo}/commit/${c.sha}`,
      commit: { message: c.message, author: { name: c.author, date: c.date } },
      files: files.map((filename) => ({ filename })),
    };
  }

  /** Answers one request to api.github.com/repos/<repo>/… (or /repositories/<id>/…); null when the URL is not for this repository. */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const prefix = [`/repos/${this.repo}`, `/repositories/${this.id}`].find((p) => url.pathname.startsWith(`${p}/`));
    if (url.origin !== "https://api.github.com" || !prefix) return null;
    if (request.headers.get("authorization") !== "Bearer test-token") return error(401, "Bad credentials");
    const path = url.pathname.slice(prefix.length);
    const m = request.method;
    this.calls.push(`${m} ${path}${url.search}`);
    const body = m === "GET" || m === "DELETE" ? undefined : ((await request.json()) as Record<string, any>);
    let r: RegExpExecArray | null;

    if (m === "GET" && (r = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = this.refs.get(decodeURIComponent(r[1]));
      return sha ? json({ ref: `refs/heads/${r[1]}`, object: { sha, type: "commit" } }) : error(404, "Not Found");
    }
    if (m === "GET" && (r = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path))) {
      const c = this.commits.get(r[1]);
      return c ? json({ sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : error(404, "Not Found");
    }
    if (m === "GET" && path === "/commits") {
      const n = Number(url.searchParams.get("per_page") ?? 30);
      const out = [];
      for (let c = this.commits.get(this.refs.get(url.searchParams.get("sha") ?? "main")!); c && out.length < n; c = this.commits.get(c.parents[0])) {
        const scope = url.searchParams.get("path");
        if (!scope || c.paths.some((p) => p.startsWith(`${scope}/`))) out.push(this.apiCommit(c));
      }
      return json(out);
    }
    if (m === "GET" && (r = /^\/commits\/(.+)$/.exec(path))) {
      const sha = this.resolve(decodeURIComponent(r[1]));
      if (!sha) return error(422, "No commit found for SHA");
      const c = this.commits.get(sha)!;
      const page = Number(url.searchParams.get("page") ?? 1);
      const res = json(this.apiCommit(c, c.paths.slice((page - 1) * this.filesPerPage, page * this.filesPerPage)));
      const last = Math.ceil(c.paths.length / this.filesPerPage);
      const at = (n: number) => `<https://api.github.com/repositories/${this.id}/commits/${sha}?page=${n}>`;
      if (page < last) res.headers.set("link", `${at(page + 1)}; rel="next", ${at(last)}; rel="last"`);
      return res;
    }
    if (m === "GET" && (r = /^\/tarball\/([0-9a-f]{40})$/.exec(path))) {
      const c = this.commits.get(r[1]);
      if (!c) return error(404, "Not Found");
      this.tarballs++;
      const top = `${this.repo.replace("/", "-")}-${c.sha.slice(0, 7)}`;
      // Some real repository files besides content, which the store must leave out.
      const files = new Map([...this.trees.get(c.tree)!, ["README.md", "# readme"], ["app/page.tsx", "export {}"]]);
      return new Response(tarball(top, files, c.sha), { headers: { "content-type": "application/x-gzip" } });
    }
    if (m === "POST" && path === "/git/trees") {
      const files = new Map(this.trees.get(body!.base_tree)!);
      for (const e of body!.tree as { path: string; sha?: null; content?: string }[]) {
        if (e.sha === null) {
          if (!files.has(e.path)) return error(422, `GitRPC::BadObjectState: ${e.path}`);
          files.delete(e.path);
        } else files.set(e.path, e.content!);
      }
      return json({ sha: this.tree(files) }, 201);
    }
    if (m === "POST" && path === "/git/commits") {
      const parent = this.commits.get(body!.parents[0])!;
      const before = this.trees.get(parent.tree)!;
      const after = this.trees.get(body!.tree)!;
      const paths = [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p));
      const sha = this.commit({ tree: body!.tree, parents: body!.parents, message: body!.message, paths });
      if (body!.author) this.commits.get(sha)!.author = body!.author.name;
      return json({ sha }, 201);
    }
    if (m === "PATCH" && (r = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const name = decodeURIComponent(r[1]);
      const current = this.refs.get(name);
      if (!current) return error(422, "Reference does not exist");
      if (this.protectedBranches.has(name)) return error(422, "Repository rule violations found\n\nChanges must be made through a pull request.\n\n");
      if (!body!.force && !this.isAncestor(current, body!.sha)) return error(422, "Update is not a fast forward");
      this.refs.set(name, body!.sha);
      return json({ ref: `refs/heads/${name}`, object: { sha: body!.sha } });
    }
    if (m === "POST" && path === "/git/refs") {
      const name = String(body!.ref).replace(/^refs\/heads\//, "");
      if (this.refs.has(name)) return error(422, "Reference already exists");
      this.refs.set(name, body!.sha);
      return json({ ref: body!.ref, object: { sha: body!.sha } }, 201);
    }
    if (m === "DELETE" && (r = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      this.refs.delete(decodeURIComponent(r[1]));
      return new Response(null, { status: 204 });
    }
    if (m === "POST" && path === "/pulls") {
      if (!this.refs.has(body!.head)) return error(422, "Validation Failed");
      const number = this.pulls.length + 1;
      this.pulls.push({ number, head: body!.head, base: body!.base, title: body!.title, body: body!.body, state: "open" });
      return json({ number, html_url: `https://github.com/${this.repo}/pull/${number}` }, 201);
    }
    if (m === "GET" && path === "/pulls") {
      // head is "owner:branch", as GitHub wants it.
      const head = url.searchParams.get("head");
      const state = url.searchParams.get("state") ?? "open";
      const owner = this.repo.split("/")[0];
      const found = this.pulls.filter((p) => (!head || `${owner}:${p.head}` === head) && (state === "all" || p.state === state));
      return json(found.map((p) => ({ number: p.number, state: p.state, html_url: `https://github.com/${this.repo}/pull/${p.number}`, head: { ref: p.head } })));
    }
    if (m === "GET" && path === "/issues") {
      const labels = (url.searchParams.get("labels") ?? "").split(",").filter(Boolean);
      const state = url.searchParams.get("state") ?? "open";
      const n = Number(url.searchParams.get("per_page") ?? 30);
      const found = this.issues
        .filter((i) => labels.every((l) => i.labels.includes(l)) && (state === "all" || i.state === state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, n);
      return json(
        found.map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body,
          state: i.state,
          created_at: i.created_at,
          html_url: `https://github.com/${this.repo}/${i.pull_request ? "pull" : "issues"}/${i.number}`,
          labels: i.labels.map((name) => ({ name, color: "ededed" })),
          ...(i.pull_request ? { pull_request: { url: `https://api.github.com/repos/${this.repo}/pulls/${i.number}` } } : {}),
        })),
      );
    }
    return error(404, `fake GitHub has no ${m} ${path}`);
  }
}

/** A .tar.gz with GitHub's layout: a pax global header naming the commit, a top folder, then the files. */
export function tarball(top: string, files: Files, sha = "0".repeat(40)) {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  const header = (name: string, size: number, type: string, prefix = "") => {
    const h = new Uint8Array(512);
    const put = (s: string, at: number, len: number) => h.set(enc.encode(s).subarray(0, len), at);
    put(name, 0, 100);
    put("0000644\0", 100, 8);
    put("0000000\0", 108, 8);
    put("0000000\0", 116, 8);
    put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
    put("00000000000\0", 136, 12);
    put("        ", 148, 8);
    put(type, 156, 1);
    put("ustar\0", 257, 6);
    put("00", 263, 2);
    put(prefix, 345, 155);
    put(`${h.reduce((a, b) => a + b, 0).toString(8).padStart(6, "0")}\0 `, 148, 8);
    return h;
  };
  const data = (bytes: Uint8Array) => {
    blocks.push(bytes);
    if (bytes.length % 512) blocks.push(new Uint8Array(512 - (bytes.length % 512)));
  };
  const pax = (key: string, value: string) => {
    const rest = ` ${key}=${value}\n`;
    let len = enc.encode(rest).length;
    while (String(len).length + enc.encode(rest).length !== len) len = String(len).length + enc.encode(rest).length;
    return enc.encode(`${len}${rest}`);
  };
  const comment = pax("comment", sha);
  blocks.push(header("pax_global_header", comment.length, "g"));
  data(comment);
  blocks.push(header(`${top}/`, 0, "5"));
  let i = 0;
  for (const [p, text] of files) {
    const name = `${top}/${p}`;
    const bytes = enc.encode(text);
    // Three ways real archives name a file: a pax path record, a ustar prefix, or the plain name.
    if (i % 3 === 0 || name.length > 100) {
      const rec = pax("path", name);
      blocks.push(header("PaxHeader/x", rec.length, "x"));
      data(rec);
      blocks.push(header(name.slice(0, 100), bytes.length, "0"));
    } else if (i % 3 === 1) {
      const cut = name.lastIndexOf("/");
      blocks.push(header(name.slice(cut + 1), bytes.length, "0", name.slice(0, cut)));
    } else {
      blocks.push(header(name, bytes.length, "0"));
    }
    data(bytes);
    i++;
  }
  blocks.push(new Uint8Array(1024));
  return gzipSync(Buffer.concat(blocks));
}
