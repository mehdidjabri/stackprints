// What the tools need from their runtime. Workers, the local servers and the tests each build
// these from their own pieces (see src/workers/*, src/local/*, test/helpers.ts).
import type { ApiSource } from "./api";
import type { Page } from "./receipts";
import type { StateStore } from "./state";
import type { ContentStore } from "./store";
import type { Files, Principal } from "./types";

export type PublicDeps = {
  /** The site's JSON API. */
  api: ApiSource;
  /** The content files (content/** and docs/**) the API was built from, for validation and submissions. */
  files: () => Promise<Files>;
  now: () => number;
  /** "https://stackprints.com" */
  siteUrl: string;
  /** "https://github.com/mehdidjabri/stackprints" */
  repo: string;
  /** For the public GitHub API (submission status). */
  fetch: typeof fetch;
  /**
   * A token for reading the public repo's pull requests and issues (submission status). Without one
   * GitHub allows 60 reads an hour per address, and a Worker shares its egress addresses with others.
   */
  githubToken?: string;
};

/** A post on X, as search_x returns it. */
export type XPost = {
  url: string;
  author: string;
  text: string;
  date: string;
  metrics: { likes?: number; reposts?: number; replies?: number; quotes?: number; views?: number; bookmarks?: number };
  authorFollowers?: number;
};

export type AdminDeps = PublicDeps & {
  store: ContentStore;
  state: StateStore;
  principal: Principal;
  /** Reads a page safely (no private addresses, capped size and time) and returns it unrecorded. */
  fetchPage: (url: string) => Promise<Omit<Page, "sha256" | "fetchedAt">>;
  /** Recent posts on X through the X API; undefined when no API key is configured. */
  searchX?: (q: { query: string; maxResults: number; sinceDays: number }) => Promise<XPost[]>;
};
