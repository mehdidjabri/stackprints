---
layer: tools
kind: tool-prompt
title: eve built-in tool descriptions (bash, read_file, write_file, web_fetch, glob, grep)
source: https://github.com/vercel/eve/tree/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/tools/provided
license: Apache-2.0
retrieved: 2026-10-22
note: Model-facing descriptions and parameter descriptions of eve's framework-provided tools, each in its own file in this folder at this commit (bash.ts, read-file.ts, write-file.ts, web-fetch.ts, glob.ts, grep.ts). bash, read_file, write_file and web_fetch are default tools; glob and grep are opt-in. The 30 seconds in bash is BASH_YIELD_SECONDS. web_search is also a default tool, but it is the model vendor's or AI Gateway's hosted search (Exa by default), so its description is not eve's. Each default can be overridden or disabled from agent/tools/<name>.ts. The tool-name labels ("bash:", "glob (opt-in):" and so on) and the "Parameters:" headings are added here, with each input's schema description listed under them; "Usage:" and "Usage notes:" are part of the descriptions.
---
bash:
Execute a shell command in the shared workspace environment. A command still running after 30 seconds keeps running in the background and returns status "running" with its output so far and how to check on or stop it.

Parameters:
- command: The shell command to execute.

read_file:
Read a file from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path or begin with $HOME/.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents "foo\n", you will receive "1: foo\n".
- Any line longer than 2000 characters is truncated.
- PNG, JPEG, GIF, and WebP images up to 3 MiB and PDFs up to 20 MiB are shown to you as files, including files named in `Attached file <path>` references.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.

Parameters:
- filePath: The absolute path to the file to read. A leading $HOME is supported.
- limit: Maximum number of lines to return. Defaults to 2000.
- offset: 1-based line number to start from. Defaults to 1.

write_file:
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the read_file tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.

Parameters:
- content: Complete replacement file contents.
- filePath: The absolute path to the file to write. A leading $HOME is supported.

web_fetch:
Fetch a webpage and return its content in the requested format. Use this to retrieve and analyze content from URLs.

Usage notes:
- The URL must be a fully-formed valid URL starting with https://
- HTML responses are automatically converted to markdown or plain text based on the requested format
- Format options: "markdown" (default), "text", or "html"
- Default timeout is 30 seconds (max 120 seconds)
- Maximum response size is 5 MB; content is further capped at the shared tool-output budget (50 KB / 2000 lines)
- This tool is read-only and does not modify any files

Parameters:
- format: The format to return the content in (text, markdown, or html). HTML responses are automatically converted to the requested format. Defaults to "markdown".
- timeout: Optional timeout in seconds. Defaults to 30, max 120.
- url: The fully-formed URL to fetch content from. Must start with https://.

glob (opt-in):
Fast file pattern matching tool that works with any codebase size.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts".
- Returns matching file paths.
- Call this tool in parallel when you know there are multiple patterns to search for.

Parameters:
- limit: Maximum number of results to return. Defaults to 100.
- path: The directory to search in. Defaults to /workspace. Must be an absolute path or begin with $HOME/. Omit to use the default.
- pattern: The glob pattern to match files against (e.g. "**/*.ts", "src/**/*.js").

grep (opt-in):
Fast content search tool that works with any codebase size.

Usage:
- Searches file contents using regular expressions.
- Supports full regex syntax (e.g. "log.*Error", "function\s+\w+").
- Filter files by pattern with the glob parameter (e.g. "*.js", "*.{ts,tsx}").
- Returns matching lines with file paths and line numbers.
- Call this tool in parallel when you have multiple independent searches.
- Any line longer than 2000 characters is truncated.

Parameters:
- context: Number of surrounding context lines to include before and after each match. Defaults to 0.
- glob: Filter files by glob pattern (e.g. "*.ts", "*.{ts,tsx}").
- ignoreCase: Perform case-insensitive search. Defaults to false.
- limit: Maximum number of matches to return per file. Defaults to 100.
- literal: Treat the pattern as a literal string instead of a regular expression. Defaults to false.
- path: The directory or file to search in. Defaults to /workspace. Must be an absolute path or begin with $HOME/. Omit to use the default.
- pattern: The regex pattern to search for in file contents (e.g. "log.*Error", "function\s+\w+").
