---
layer: skills
kind: template
title: Skills catalog and skill tools
source: https://github.com/cloudflare/agents/blob/cbf047d020ba7470517e82822765e5f2057cca57/packages/agents/src/skills/registry.ts
license: MIT
retrieved: 2026-10-22
note: SkillRegistry from agents/skills. Think adds the catalog to its system prompt as a readonly context block labelled think_skills with the description "Think skills: available skill catalog" (think.ts, lines 6479-6485 at this commit), so it renders under that block header. The workspace line appears only when skill files are copied into the workspace; run_skill_script is offered only when a script runner is configured. activate_skill returns the skill wrapped as shown, then a list of bundled resources. The part labels ("System prompt block:", "activate_skill tool:" and so on) are added here; "Bundled resources:" is part of the tool result.
---
System prompt block:

══════════════════════════════════════════════
THINK_SKILLS (Think skills: available skill catalog) [readonly]
══════════════════════════════════════════════
Available skills. When a task matches a skill, use activate_skill with its name before proceeding.
Skill files are available at <dynamic: workspace skills root>. Workspace edits affect later activations and resource reads.

- <dynamic: skill name>: <dynamic: skill description>

activate_skill tool:

Activate a skill by name. Use this when the user's task matches one of the available skills.

activate_skill result:

<skill_content name="<dynamic: name>" version="<dynamic: version>">
<dynamic: SKILL.md body>

<skill_resources>
  <file kind="<dynamic: kind>" encoding="<dynamic: encoding>" size="<dynamic: size>"><dynamic: path></file>
</skill_resources>
</skill_content>

Bundled resources:
- <dynamic: path> (<dynamic: kind>, <dynamic: encoding>, <dynamic: mime type>, <dynamic: size> bytes)

read_skill_resource tool:

Read a bundled resource from an available skill by relative path. Pass name and path, or use a qualified path like skill-name/references/file.md.

run_skill_script tool:

Run a bundled script resource from an available skill. Use only when a skill instructs you to run a script.
