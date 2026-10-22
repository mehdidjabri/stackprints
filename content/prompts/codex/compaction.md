---
layer: harness
kind: tool-prompt
title: Compaction prompt
source: https://github.com/openai/codex/blob/a3d93e1e692f1144cf8685175a5d1f6bf7294f57/codex-rs/prompts/templates/compact/prompt.md
license: Apache-2.0
retrieved: 2026-10-22
note: Sent as the last user message when Codex compacts a long conversation locally; the reply goes back into the history behind the prefix in codex-rs/prompts/templates/compact/summary_prefix.md. Overridable with compact_prompt in config. With OpenAI and Azure Responses providers Codex compacts on the server instead, and that prompt is not published.
---
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
