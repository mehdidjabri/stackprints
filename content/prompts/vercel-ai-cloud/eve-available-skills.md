---
layer: skills
kind: template
title: eve Available skills section
source: https://github.com/vercel/eve/blob/12a1e90627ae04681271d0f6c5be522784ed82f2/packages/eve/src/execution/skills/instructions.ts#L29-L84
license: Apache-2.0
retrieved: 2026-10-22
note: formatAvailableSkillsSection, appended to the system prompt for every skill that is not deferred (deferred skills are found through eve__search instead), and re-sent as an announcement when dynamic skills change. Constants are filled in: the skill tool is eve__skill, the skill root $HOME/.agents/skills and the fallback /workspace/skills. The "(path: …)" suffix is left off for a skill with no files. A loaded skill's instructions arrive as the result of the eve__skill call, never in the system prompt.
---
Available skills
Listed skills are available in this run. Do not claim a listed skill is inaccessible unless activation or workspace inspection actually fails.
Dynamic skill announcements replace earlier dynamic skills and override static skills with the same name. Static skills omitted from a dynamic announcement remain available.
If the user names a skill or the request clearly matches one of the descriptions below, load it with eve__skill({ name }) before proceeding.
If multiple skills match, activate the minimal set that covers the task. After activation, follow the returned instructions instead of improvising around them.
If activation fails, say so briefly and continue with the best available alternative.
Skill files live under `$HOME/.agents/skills/<skill>/`, with `/workspace/skills/<skill>/` as the fallback when `$HOME` is unavailable.
When a loaded SKILL.md mentions sibling files such as `references/foo.md`, resolve them relative to the directory containing that specific SKILL.md.
- <dynamic: skill name>: <dynamic: skill description> (path: $HOME/.agents/skills/<dynamic: skill name>/SKILL.md)
