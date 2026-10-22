---
layer: memory
kind: tool-prompt
title: memory tool description
source: https://github.com/NousResearch/hermes-agent/blob/c73cbcc4cbbdbfc7371a86287db1ff729f23837b/tests/fixtures/prompt_surface/tools/memory.json#L2
license: MIT
retrieved: 2026-10-22
note: The description of the memory tool that edits the bounded MEMORY.md and USER.md notes, from the committed prompt-surface snapshot. The parameter schema (action, target, content, old_text, new_text, operations) is in the source file.
---
Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.

HOW: make ALL your changes to one target in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/patch stale entries to free room AND add new ones, even when an add alone would overflow. The response reports current/limit chars and confirms completion; one batch call finishes the update, so don't repeat it. Use the bare action/content/old_text fields only for a single lone change.

WHEN: only for facts that apply to EVERY session regardless of task: who the user is, stable environment facts, standing conventions with no task home. Anything learned while doing a task (procedures, pitfalls, and the user's preferences and corrections for that kind of work) belongs in the task's skill via skill_manage, where it loads only when relevant; memory is injected into every turn and must stay small.

IF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens enough stale entries and adds the new one together.

TARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes (environment, conventions, tool quirks, lessons).

SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state (use session_search for those). Reusable procedures belong in a skill, not memory.
