---
layer: proactivity
kind: template
title: Session heartbeat prompt
source: https://github.com/NousResearch/hermes-agent/blob/c73cbcc4cbbdbfc7371a86287db1ff729f23837b/hermes_cli/heartbeat.py#L22-L26
license: MIT
retrieved: 2026-10-22
note: HEARTBEAT_PROMPT_TEMPLATE, injected as a plain user message into an idle session each time a session heartbeat (/heartbeat) comes due; it never fires while the user is mid-turn.
---
[Heartbeat — recurring instruction, fires every <dynamic: interval, e.g. 10m>]
<dynamic: the user's heartbeat instruction>

If there is nothing meaningful to do or report for this instruction right now, reply briefly that nothing has changed and stop — do not invent work.
