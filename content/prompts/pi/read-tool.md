---
layer: tools
kind: template
title: read tool
source: https://github.com/earendil-works/pi/blob/1c720d28504189273f1d2a165fbb5df6d84f0983/packages/coding-agent/src/core/tools/read.ts#L14-L98
license: MIT
retrieved: 2026-10-22
note: The tool's description and parameter descriptions as sent to the model, then the one-line snippet and guideline it adds to the system prompt. The labels (name, description, parameters, system prompt snippet and guideline) are ours. The description interpolates two constants from tools/truncate.ts, which are 2000 lines and 50 KB at this commit.
---
name: read

description: Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES / 1024}}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.

parameters:
- path (string): Path to the file to read (relative or absolute)
- offset (number, optional): Line number to start reading from (1-indexed)
- limit (number, optional): Maximum number of lines to read

system prompt snippet: Read file contents

system prompt guideline: Use read to examine files instead of cat or sed.
