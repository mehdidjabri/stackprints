---
layer: multiagent
kind: template
title: eve agent tool (delegate to a copy of itself)
source: https://github.com/vercel/eve/blob/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/tools/framework/agent-contract.ts#L6-L24
license: Apache-2.0
retrieved: 2026-10-22
note: The description of eve's root-only agent tool, which starts a fresh copy of the root agent as a task. The last two sentences are AGENT_SERVE_TOOL_DESCRIPTION, which eve appends to every agent tool's description, and the taskId parameter is the one eve adds to task tools; both are in packages/eve/src/execution/tasks/render.ts (lines 51-56 at this commit). The child's reply comes back later as a task result (see "eve tasks system block"). The Parameters list gives each input's schema description; the label is added here.
---
Delegate a focused subtask to a copy of yourself. Use it to isolate complex work or split a large task into independent pieces. Each call starts a task, so several agents can work at once: start every independent one before you wait. A new child has fresh history and state but reuses your tools and sandbox, so give parallel writers non-overlapping scopes. In message, state the goal, what to return, and whether it may change files. It does not see this conversation, so put everything it needs in message. To correct or continue an agent task, call this tool again with its taskId; without taskId, each call starts a new agent.

Parameters:
- message: The message to send to the agent, with everything it needs to do the work.
- taskId: The id of a task this tool started, copied from its "Started task" receipt or the [Tasks] note, to send it this input. Omit it to start a new task.
