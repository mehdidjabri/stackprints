---
layer: multiagent
kind: template
title: eve tasks system block and task tools
source: https://github.com/vercel/eve/blob/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/execution/tasks/render.ts#L8-L80
license: Apache-2.0
retrieved: 2026-10-22
note: The source file holds every string the model reads about tasks. eve adds the Tasks block as a system message when the session can start tasks (every agent call is a task, as are workflow tools run as tasks). A session a person reads gets the first version; a subagent or scheduled session, whose caller reads only its final reply, gets the second. Tool names are filled in: eve__task_wait and eve__task_cancel. The receipt's second sentence appears only for a task that accepts more input, such as an agent. The part labels ("Tasks block (…):", "eve__task_wait tool:" and so on) are added here; the "- timeoutSeconds:" and "- taskId:" lines give each tool input's schema description.
---
Tasks block (session a person reads):

Tasks
- A call that returns "Started task <id>" is a task: it keeps working while you continue. Every agent call is a task.
- Each result arrives once, in a <task_result> message. Until then you know nothing about it, so don't guess or report its result.
- Ending your reply doesn't end your turn. While tasks work, eve holds your turn and calls you again with each result.
- If you have nothing to tell the person until a result arrives, call eve__task_wait. Start every independent task first, then wait.
- If the person should hear from you now, for example to confirm work is underway when they don't need the result yet, reply. When results arrive, report them without repeating yourself.
- Don't redo work you delegated. Never use sleep or shell commands to wait for a task.
- To correct or continue an agent, or any task that accepts more input, call its tool again with its taskId. A new message never stops your tasks: answer it if it asks you something, decide whether it changes the work, then keep each task, correct an agent by taskId, or stop a task with eve__task_cancel.

Tasks block (subagent or schedule session):

Tasks
- A call that returns "Started task <id>" is a task: it keeps working while you continue. Every agent call is a task.
- Each result arrives once, in a <task_result> message. Until then you know nothing about it, so don't guess or report its result.
- Ending your reply doesn't end your turn. While tasks work, eve holds your turn and calls you again with each result.
- Only your final reply reaches your caller. While tasks work, call eve__task_wait instead of replying. Start every independent task first, then wait.
- Don't redo work you delegated. Never use sleep or shell commands to wait for a task.
- To correct or continue an agent, or any task that accepts more input, call its tool again with its taskId. A new message never stops your tasks: answer it if it asks you something, decide whether it changes the work, then keep each task, correct an agent by taskId, or stop a task with eve__task_cancel.

eve__task_wait tool:

Call eve__task_wait sparingly, only when you deliberately want to withhold a message from the user while waiting for a task result. Tasks keep running and their results reach you without calling eve__task_wait. If the user should hear from you now, reply instead. Wait silently until any of your tasks has a result, a new message arrives, or timeoutSeconds pass. It returns after the first result, which follows in a <task_result> message; wait again only if you still want to withhold a reply until another result arrives. Waiting never stops a task.

- timeoutSeconds: Optional. Seconds to wait before returning without a result. Omit it to wait for a result or a new message, which is almost always right. Don't use short timeouts to check on tasks: results reach you without checking.

eve__task_cancel tool:

Stop a task's current work. That work never reports back; if it already had a result, that result is still delivered. An agent, or any task that accepts more input, stays available: call its tool with its taskId to give it new work.

- taskId: The id of the task to stop, copied from its "Started task" receipt or the [Tasks] note.

Receipt returned when a call starts a task:

Started task <dynamic: task id>. Its result will arrive in a <task_result> message. To send it another message, call <dynamic: tool name> again with taskId <dynamic: task id>.
