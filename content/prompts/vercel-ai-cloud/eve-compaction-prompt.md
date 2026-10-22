---
layer: harness
kind: template
title: eve compaction checkpoint prompt
source: https://github.com/vercel/eve/blob/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/harness/compaction/prompt.ts#L6-L145
license: Apache-2.0
retrieved: 2026-10-22
note: eve's default harness compacts on its own when history reaches thresholdPercent of the context window (0.9 by default), and clients can request it between turns. It first tries capping large old tool results without a model call; if that is not enough, it sends the older messages to the compaction model with this system prompt and user prompt. The previous checkpoint is "(none)" on the first compaction. The transcript renders each message as "### role" followed by its text, "Called <tool> with <input>" and "Tool <tool> returned|errored <output>" lines (payloads clipped to 2,000 characters) and "Attached file <name> (<type>)" stubs. The summary then replaces the older messages as a user message "Summary of our conversation so far:" followed by the summary as an assistant message; the recent tail stays verbatim. The "System prompt:" and "User prompt:" labels are added here.
---
System prompt:

You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:

- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done, with clear next steps
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work. Write in the same language as the conversation. Do not continue the conversation, answer its questions, or invent facts. Only output the handoff summary.

User prompt:

<previous-checkpoint>
<dynamic: previous checkpoint, or (none)>
</previous-checkpoint>

<conversation>
Conversation transcript:
<dynamic: transcript>
</conversation>

Update the previous checkpoint with the newer information in the conversation. If there is no previous checkpoint, create one from the conversation.

Make completed work explicit so the next model does not repeat it. Keep completed work separate from current and remaining work, and do not describe completed work as pending unless later messages show it must be redone. Preserve exact file paths, function names, commands, error messages, identifiers, and measured values when they are needed to continue.

Large tool outputs are the main thing to compress: reduce each to the findings the next model needs — what was searched or read, what it established, and the exact identifiers involved — rather than reproducing the output. The next model cannot see the originals, so nothing it would need to act on may be lost.
