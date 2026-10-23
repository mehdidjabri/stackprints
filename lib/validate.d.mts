export type ValidationCounts = { layers: number; options: number; news: number; stacks: number; prompts: number; hot: number };
export type ValidationResult = { errors: string[]; warnings: string[]; counts: ValidationCounts };
/** Validates the content of Stackprints from a map of repo-relative paths to text. */
export function validateContent(files: Map<string, string>, options?: { now?: number }): ValidationResult;

/** An https URL that opens where it says: no credentials, no spaces, a dotted host. */
export function httpsUrl(v: unknown): boolean;
/** A bare host with an optional plain path, like "example.com/docs": an option's url. */
export function bareUrl(v: unknown): boolean;

export const LOGO_MAX_BYTES: number;
/** An element of a parsed logo: attributes in order, text kept for <title> only. */
export type SvgNode = { name: string; attrs: [string, string][]; children: SvgNode[]; text: string };
/** Parses a logo strictly; `root` is null whenever there is a problem. */
export function parseLogo(svg: string): { problems: string[]; root: SvgNode | null };
/** Why an SVG can't be a logo, one line each; empty when it can. */
export function logoProblems(svg: string): string[];
