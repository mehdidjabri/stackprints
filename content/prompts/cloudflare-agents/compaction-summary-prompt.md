---
layer: harness
kind: template
title: Compaction summary prompt
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/agents/src/sessions/compaction-helpers.ts#L183-L262
license: MIT
retrieved: 2026-10-22
note: buildSummaryPrompt from agents/sessions, used by the reference createCompactFunction that a Think agent or Session wires in with onCompaction(); compaction is opt-in. The middle of the conversation (between a protected head and tail) is rendered as "[role]" blocks of text plus "[Tool: name]" lines with input and output each cut to 500 characters, separated by "---". The budget is about 20% of the compressed tokens, at least 100. The first version is used on the first compaction, the second when a previous summary exists; the "First compaction:" and "Later compactions:" labels are added here, and the source defines the second version first.
---
First compaction:

Create a concise summary of this conversation that preserves the important information for future context.

CONVERSATION TO SUMMARIZE:
<dynamic: rendered messages>

Use this structure:

## Topic
[What the conversation is about]

## Key Points
[Important information, decisions, and conclusions from the conversation]

## Current State
[Where things stand now — what has been done, what is in progress]

## Open Items
[Unresolved questions, pending tasks, or next steps discussed]

Target ~<dynamic: budget> tokens. Be factual — only include information that was explicitly discussed in the conversation. Do NOT invent file paths, commands, or details that were not mentioned. Write only the summary body.

Later compactions:

You are updating a conversation summary. A previous summary exists below. New conversation turns have occurred since then and need to be incorporated.

PREVIOUS SUMMARY:
<dynamic: previous summary>

NEW TURNS TO INCORPORATE:
<dynamic: rendered messages>

Update the summary. PRESERVE existing information that is still relevant. ADD new information. Remove information only if it is clearly obsolete.

## Topic
[What the conversation is about]

## Key Points
[Important information, decisions, and conclusions from the conversation]

## Current State
[Where things stand now — what has been done, what is in progress]

## Open Items
[Unresolved questions, pending tasks, or next steps discussed]

Target ~<dynamic: budget> tokens. Be factual — only include information that was explicitly discussed in the conversation. Do NOT invent file paths, commands, or details that were not mentioned. Write only the summary body.
