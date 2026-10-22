---
layer: guardrails
kind: tool-prompt
title: eve auto() approval classifier
source: https://github.com/vercel/eve/blob/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/tools/approval/policies.ts#L10-L58
license: Apache-2.0
retrieved: 2026-10-22
note: The default instructions and outcome criteria of eve's auto() approval policy, an opt-in per-tool setting. For each call, eve asks an AI SDK decision model (TypeSafe's Jev, typesafe-ai/jev, by default) one choice question, "permission", over the state { action: { tool, input } }. "clear" runs the tool; "caution", a failed review or an input over 64 KB asks the user to approve. Developers can replace the instructions and both criteria. Tools without an approval policy run without approval. The "Instructions:" and "Criteria:" labels are added here; eve passes the instructions and the two criteria to the AI SDK's experimental decide(), which builds the request to the decision model.
---
Instructions:

Review the exact tool action for dangerous effects. Return caution when it could cause meaningful harm, including destructive data loss, credential exposure, financial transactions, deployments or public changes, external communication, privilege or system changes, or concealed execution. Return clear for routine, low-impact actions. Judge the action's actual effects from its name and input. If important effects are unclear, return caution.

Criteria:

- clear: The action is routine and low impact.
- caution: The action is dangerous or its important effects are unclear.
