---
layer: tools
kind: template
title: Workspace tool descriptions (read, write, edit, exec…)
source: https://github.com/cloudflare/computer/tree/220388bcbc0a3a96132704aa1d7854dc44f9fc9c/packages/computer/src/tools/common
license: MIT
retrieved: 2026-10-22
note: Think's built-in workspace tools come from createAITools in Cloudflare's @cloudflare/computer package (MIT, its own repo); each description is defined in this folder at this commit, in fs/read.ts, fs/list.ts, fs/find.ts, fs/grep.ts, fs/write.ts, fs/edit.ts, fs/delete.ts, exec.ts and publish.ts. Numbers are the defaults (read 2000 lines or 256KB, listings 200 entries, exec output 2000 lines or 64.0KB). exec is added when the Workspace has execution backends and publish when an assets publisher is configured; the exec description is assembled from the backends, shown here for several backends (a single backend gets a shorter form that starts "Run a shell command in the workspace." or, for a callable backend, "Run code in the workspace."), and its last paragraph appears only when some backend is callable. The tool-name labels ("read:", "ls:" and so on) are added here.
---
read:
Read a workspace file. Images and PDFs are passed to capable models. Text output is capped at <dynamic: maxLines, default 2000> lines or <dynamic: maxBytes, default 256>KB and includes line and byte continuations when truncated.

ls:
List entries in a workspace directory with file sizes and modification times. The result defaults to 200 entries; use limit and offset to page through large directories.

find:
Find files and directories matching a glob. * stays within one path segment, ** crosses directories, and ? matches one character.

grep:
Search workspace text with a literal string or regular expression. Results include paths and line numbers and can include surrounding lines.

write:
Write content to a file. Overwrites any existing file at the path.

edit:
Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes touch the same block, merge them into one edit.

delete:
Delete a file or directory. Set recursive to true to remove a non-empty directory.

exec (several backends):
Run a shell command in the workspace. The workspace exposes multiple backends, each with different capabilities.
Pick the cheapest backend that can run the command; fall back to a heavier one only when the lighter backend's command set doesn't cover what you need.

Backends:
- "<dynamic: backend id>"<dynamic: " (callable)" for a callable backend>: <dynamic: backend description>

Name a backend on every call. If a command fails with a "command not found" or a similar capability error, retry on a backend whose description covers the missing tool.
Use for builds, test runs, typechecks, formatters, and git plumbing. Prefer the dedicated read, write, and edit tools for file operations. Each of stdout and stderr is cut to its last <dynamic: maxLines, default 2000> lines or <dynamic: maxBytes, default 64.0KB>, whichever is hit first; when it is, the full output is saved to a file the reply names, which the read and grep tools can open.

Callable backends (<dynamic: callable backend ids>) run `command` as module source rather than a shell command. Pass an `input` object to hand the module structured values, and read its return value back from the `result` field. Other backends reject `input`.

publish:
Publish a file from the workspace through the configured assets publisher and return a time-limited link. Use this to hand the user an artifact you produced, such as a chart, screenshot, build output, or report.
