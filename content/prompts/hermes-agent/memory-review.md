---
layer: memory
kind: template
title: Background memory review
source: https://github.com/NousResearch/hermes-agent/blob/c73cbcc4cbbdbfc7371a86287db1ff729f23837b/agent/background_review.py#L370-L388
license: MIT
retrieved: 2026-10-22
note: Sent as the last user message to a background fork of the agent, after the conversation so far, when the memory nudge fires (memory.nudge_interval, every 10 user turns by default). Joined in code from two static constants (_MEMORY_ROUTING_BLOCK inside _MEMORY_REVIEW_PROMPT), so this is the exact text; a /refine focus is appended when the user asks for a review. When the skill nudge fires on the same turn, a combined memory-and-skills prompt is used instead.
---
Review the conversation above and consider saving to memory if appropriate.

Memory has TWO distinct stores — pick the right one for each fact:
  • USER.md (memory tool, target='user'): who the user is — persona, preferences, communication and work style, personal details they revealed, and expectations about how you should behave.
  • MEMORY.md (memory tool, target='memory'): facts about the ENVIRONMENT you operate in — tool quirks, project conventions, config gotchas, paths and endpoints that matter.

One fact goes to ONE store, never both — writing it to both bloats both files until they hit their size limits and crowds out the facts that matter; misrouting it puts it where the next session won't look. If the tool schema lists only one target, that store is the only one enabled — use it and skip the other.

If something stands out, save it once, in the right store, using the memory tool with the matching target. If nothing is worth saving, just say 'Nothing to save.' and stop.
