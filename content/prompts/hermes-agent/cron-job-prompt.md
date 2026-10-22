---
layer: proactivity
kind: template
title: Scheduled cron job prompt
source: https://github.com/NousResearch/hermes-agent/blob/c73cbcc4cbbdbfc7371a86287db1ff729f23837b/cron/scheduler_prompt.py#L260-L365
license: MIT
retrieved: 2026-10-22
note: Built by _build_job_prompt for each run of a scheduled job, in a fresh session: _CRON_HINT first, then any optional context blocks (shown with their literal headings and intros; another job's output uses the heading '## Output from job ...'), then the job's own prompt (followed by a '## Run Context' section when a run passes extra context; a failed script shows as '## Script Error' instead). If the job lists skills, their contents come first and this text follows as the user instruction.
---
[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest. SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]" (nothing else) to suppress delivery. [SILENT] is a literal ASCII control token — never translate or rephrase it, whatever language the rest of your answer uses. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more. FAILURE: If a delegated child fails and this cron run must be recorded as failed, put [CRON_FAILURE] on the first line by itself, then explain the child failure on following lines. RECURSION: This is a run of an EXISTING scheduled job — execute the task now. NEVER create or update a cron job because of recurring or future-schedule language in the task prompt below; treat phrasing like "each Monday" or "every day at 9" as context for this run, not as a request to schedule another job.]

<dynamic: the job's notepad section, when it has one>## Your previous run's output
The following is this job's most recent non-silent output from a previous run. Use it for continuity: avoid repeating what was already reported, and continue where the last run left off.

```
<dynamic: previous output, when the job sets context_from: self>
```

## Script Output
The following data was collected by a pre-run script. Use it as context for your analysis.

```
<dynamic: pre-run script stdout, when the job has a script>
```

<dynamic: the job's prompt>
