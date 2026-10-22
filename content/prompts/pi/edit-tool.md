---
layer: tools
kind: tool-prompt
title: edit tool
source: https://github.com/earendil-works/pi/blob/1c720d28504189273f1d2a165fbb5df6d84f0983/packages/coding-agent/src/core/tools/edit.ts#L21-L154
license: MIT
retrieved: 2026-10-22
note: The tool's description (L151-L152) and parameter descriptions (L21-L41) as sent to the model, then the one-line snippet and the guidelines it adds to the system prompt (L43-L51). The labels (name, description, parameters, system prompt snippet and guidelines) are ours. One call can carry several non-overlapping replacements in edits[].
---
name: edit

description: Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.

parameters:
- path (string): Path to the file to edit (relative or absolute)
- edits (array): One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.
  - oldText (string): Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.
  - newText (string): Replacement text for this targeted edit.

system prompt snippet: Make precise file edits with exact text replacement, including multiple disjoint edits in one call

system prompt guidelines:
- Use edit for precise changes (edits[].oldText must match exactly)
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
