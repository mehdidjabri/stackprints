---
layer: proactivity
kind: template
title: Scheduled automation run prompt
source: https://github.com/openclaw/openclaw/blob/4af9d73004e4297b10478cda12da9656a0dce121/src/cron/run-prompt.ts#L19-L103
license: MIT
retrieved: 2026-10-22
note: The user message for every scheduled automation (cron) run, which since the heartbeat was retired also covers periodic monitoring. Assembled by buildCronCommandBody and appendCronJobScratchPrompt: the job's own message tagged with its id and name, the current-time lines (built in src/agents/current-time.ts), the fixed unattended-run preamble (kept static for prompt caching), then the job's scratch (its editable notes, cut to 2,000 characters). Lines between <if …> and </if> appear only in that case. For webhook and Gmail hook jobs the message is instead wrapped as untrusted external content and the preamble's last two sentences are left out, so hooked content cannot claim the job's authority or delete the job. NO_REPLY is OpenClaw's silent-reply token.
---
[cron:{{job id}} {{job name}}] {{job message}}
Current time: {{local time}} ({{user timezone}})
Reference UTC: {{UTC time, YYYY-MM-DD HH:MM}} UTC

This is an unattended scheduled run. Nobody is present to clarify or approve, so complete the task with what you have. Your final reply is the deliverable — not a plan, an acknowledgement, or a request for input. If nothing needs doing, reply with exactly NO_REPLY as the entire final answer. NO_REPLY discards anything written this turn that was not sent, so send confirmations before ending silently. If you cannot complete the task, explain what blocked it and what you tried. Where the job's own instructions conflict with this preamble, the job's instructions win (a question or plan the job explicitly requests is a valid deliverable). If this job is no longer needed, remove it if your available tools allow.
<if the previous attempt was cut off by a Gateway restart>

The previous attempt was interrupted by a Gateway restart. Continue the unfinished task. Inspect the retained conversation and any tool effects before acting; do not repeat work or deliveries that already completed.
</if>
<if the job has scratch>

Automation scratch (revision {{revision}}):
{{job scratch}}
<if the scratch was cut>
[Scratch shortened for this prompt; reread the complete scratch before replacing it.]
</if>
</if>
