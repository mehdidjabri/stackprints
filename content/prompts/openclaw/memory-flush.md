---
layer: memory
kind: template
title: Pre-compaction memory flush
source: https://github.com/openclaw/openclaw/blob/4af9d73004e4297b10478cda12da9656a0dce121/extensions/memory-core/src/flush-plan.ts#L16-L38
license: MIT
retrieved: 2026-10-22
note: A silent maintenance turn the memory-core plugin runs when a session is about to be auto-compacted (by default about 4,000 tokens before the compaction threshold, or once the transcript passes 2 MB), so durable facts reach the daily note before old turns are summarized away. Built in buildMemoryFlushPlan from string constants. The first paragraph is appended to the run's system prompt; the second is the user message, followed by the current-time lines. {{date}} is today's date in the user's timezone (every YYYY-MM-DD in the constants is replaced with it) and NO_REPLY is OpenClaw's silent-reply token. Turned off with agents.defaults.compaction.memoryFlush.enabled=false.
---
Pre-compaction memory flush turn. The session is near auto-compaction; capture durable memories to disk. Store durable memories only in memory/{{date}}.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md, DREAMS.md, SOUL.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them. If memory/{{date}}.md already exists, APPEND new content only and do not overwrite existing entries. You may reply, but usually NO_REPLY is correct.

Pre-compaction memory flush. Store durable memories only in memory/{{date}}.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md, DREAMS.md, SOUL.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them. If memory/{{date}}.md already exists, APPEND new content only and do not overwrite existing entries. Do NOT create timestamped variant files (e.g., {{date}}-HHMM.md); always use the standard {{date}}.md filename. If nothing to store, reply with NO_REPLY.
Current time: {{local time}} ({{user timezone}})
Reference UTC: {{UTC time, YYYY-MM-DD HH:MM}} UTC
