---
layer: memory
kind: template
title: Context blocks and the set_context / search_context tools
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/agents/src/context/blocks.ts
license: MIT
retrieved: 2026-10-22
note: From agents/context, which Think uses to build its system prompt from labelled blocks (a block declared without a provider is a writable, durable per-agent SQLite note, such as a "memory" block). Each block renders as a section between two rules of 46 "═" characters, sections joined by blank lines; empty readonly blocks are left out. The reminder is sent after the cached prompt prefix when a block declared whenChanged "remind" has changed since the prompt was frozen. set_context is offered when any block is writable and search_context when any block is searchable; the metadata parameter and the last paragraph of set_context appear only when a writable block is searchable. Labels, descriptions and token counts come from the agent's block configuration; a section header shows the description only when the block has one, and the token gauge only when it has a maxTokens. The part labels ("Each block in the system prompt:", "set_context tool:" and so on) are added here, and the Parameters lists give each input's schema description.
---
Each block in the system prompt:

══════════════════════════════════════════════
<dynamic: LABEL in upper case> (<dynamic: description>) [<dynamic: percent>% — <dynamic: tokens>/<dynamic: maxTokens> tokens] [<dynamic: searchable | readonly | writable>]
══════════════════════════════════════════════
<dynamic: block content>

Reminder after a block changes:

These context blocks changed after the system prompt was written. Their current values below replace the ones in the system prompt.

<dynamic: the changed blocks, rendered as above>

set_context tool:

Write to a context block. Available blocks:
- "<dynamic: label>" (<dynamic: writable | searchable, keyed entries>): <dynamic: description, or "no description">

Writes are durable and persist across sessions.

For searchable blocks, pass `metadata: { title, description }` — title stabilises updates, description helps the model pick entries. Metadata is optional.

Parameters:
- label: Block label to write to
- content: The main content to write to the block.
- action: replace (default) or append
- metadata: Optional metadata for keyed entries (searchable blocks: "<dynamic: labels>"). A title keeps updates stable; a description helps the model pick the right entry.
  - title: Short title. Used as a stable identifier — entries with the same title are updated in place, different titles create new entries.
  - description: One-line summary shown alongside the title in the system prompt so the model can decide when to load the entry.

search_context tool:

Search for information in a searchable context block. ONLY these blocks are searchable: "<dynamic: labels>". Other blocks cannot be searched.

Parameters:
- label: Searchable block label
- query: Search query
