// Where the content lives and how changes reach it. The repository is the database: GitHub in
// production (src/stores/github.ts), this machine's checkout for the local server (src/stores/fs.ts).
import type { Files } from "./types";

/** A file's new text, or null to delete it. */
export type Changes = Record<string, string | null>;

export type CommitResult =
  | { mode: "publish"; sha: string; url: string }
  | {
      mode: "pr";
      sha: string;
      url: string;
      number: number;
      branch: string;
      /** false when the branch exists but no pull request was opened (the local store without a remote or gh); `note` says what to run. */
      pushed?: boolean;
      note?: string;
    };

export type CommitInfo = { sha: string; message: string; date: string; url: string; author: string; paths: string[] };

/** An open GitHub issue labelled 'correction': what prepare_correction files for the public. */
export type Correction = { number: number; title: string; url: string; body: string; createdAt: string; labels: string[] };

export interface ContentStore {
  /** The commit main points at now. */
  head(): Promise<string>;
  /** Every file under content/ and docs/ at a commit (default: head). */
  files(sha?: string): Promise<Files>;
  /**
   * Writes the changes on top of `baseSha`.
   * - publish: one commit on main. Fails with a ConflictError if main moved past baseSha, a
   *   ProtectedBranchError if main only takes pull requests, a WrongBranchError if a local checkout is
   *   on another branch.
   * - pr: one commit on a new branch from baseSha, and a pull request into main.
   */
  commit(input: { baseSha: string; changes: Changes; message: string; mode: "publish" | "pr"; branch?: string; prTitle?: string; prBody?: string }): Promise<CommitResult>;
  /** Recent commits on main that touched content/, newest first. */
  history(limit?: number): Promise<CommitInfo[]>;
  /** One commit on main, with the paths it changed. */
  commitInfo(sha: string): Promise<CommitInfo>;
  /** Open issues labelled 'correction', newest first; rejects when they can't be read. Absent where there are none to read. */
  corrections?(): Promise<Correction[]>;
}

/** Main moved past the base: rebase on the new head and try again. */
export class ConflictError extends Error {
  constructor(message = "main moved since this change was based; retry against the new head") {
    super(message);
    this.name = "ConflictError";
  }
}

/** The local checkout is not on the store's branch. Retrying won't help until someone checks it out. */
export class WrongBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongBranchError";
  }
}

/** Main takes changes only through pull requests (a ruleset or branch protection). */
export class ProtectedBranchError extends Error {
  constructor(message = "main is protected and takes changes only through pull requests: submit with mode pr") {
    super(message);
    this.name = "ProtectedBranchError";
  }
}

/** Content and docs paths a change may touch: nothing else in the repo. */
export const WRITABLE = /^content\/(layers\.json|hot\.json|options\/[a-z0-9-]+\/[a-z0-9-]+\.json|news\/[a-z0-9-]+\/[a-z0-9-]+\.json|stacks\/[a-z0-9-]+\.json|prompts\/[a-z0-9-]+\/[a-z0-9-]+\.md|logos\/[a-z0-9-]+\.svg)$/;
