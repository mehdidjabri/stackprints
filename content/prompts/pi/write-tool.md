---
layer: tools
kind: tool-prompt
title: write tool
source: https://github.com/earendil-works/pi/blob/1c720d28504189273f1d2a165fbb5df6d84f0983/packages/coding-agent/src/core/tools/write.ts#L11-L55
license: MIT
retrieved: 2026-10-22
note: The tool's description and parameter descriptions as sent to the model, then the one-line snippet and guideline it adds to the system prompt. The labels (name, description, parameters, system prompt snippet and guideline) are ours.
---
name: write

description: Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

parameters:
- path (string): Path to the file to write (relative or absolute)
- content (string): Content to write to the file

system prompt snippet: Create or overwrite files

system prompt guideline: Use write only for new files or complete rewrites.
