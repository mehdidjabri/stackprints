---
layer: tools
kind: template
title: bash tool
source: https://github.com/earendil-works/pi/blob/1c720d28504189273f1d2a165fbb5df6d84f0983/packages/coding-agent/src/core/tools/bash.ts#L40-L48
license: MIT
retrieved: 2026-10-22
note: The tool's description (L255, a template shared with the PowerShell tool, where shellName is bash for this one) and parameter descriptions (L40-L43) as sent to the model, then the one-line snippet and guideline it adds to the system prompt (L45-L48). The labels (name, description, parameters, system prompt snippet and guideline) are ours. The two size constants come from tools/truncate.ts and are 2000 lines and 50 KB at this commit. The guideline is left out when the session environment is not exposed to the shell.
---
name: bash

description: Execute a {{shellName}} command in the current working directory. Returns stdout and stderr. Output is truncated to last {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES / 1024}}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.

parameters:
- command (string): Shell command to execute
- timeout (number, optional): Timeout in seconds (optional, no default timeout)

system prompt snippet: Execute bash commands (ls, grep, find, etc.)

system prompt guideline: You can inspect PI_* environment variables for current model and session details.
