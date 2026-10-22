---
layer: tools
kind: template
title: Tooling section of the system prompt
source: https://github.com/openclaw/openclaw/blob/4af9d73004e4297b10478cda12da9656a0dce121/src/agents/system-prompt-tool-list.ts#L20-L147
license: MIT
retrieved: 2026-10-22
note: The one-line roster of built-in tools that opens the per-run half of the main system prompt, built by buildSystemPromptToolLines and buildSystemPromptToolingSection. Shown with every core tool; only the tools this session's policy admits are listed, in this order, with any other tools after them alphabetically (image is summarised as "Analyze images"). In Code Mode exec reads "Run JavaScript Code Mode; call exact catalog tools from code", and with ACP spawning agents_list and sessions_spawn get ACP-specific wording. Lines between <if …> and </if> appear only in that case. Each tool's full description and JSON schema are sent separately through the model provider's tool API.
---
## Tooling
Tools policy-filtered. Names case-sensitive; call exact.
- read: Read files
- write: Write files
- edit: Exact file edits
- apply_patch: Patch files
- grep: Search file contents
- find: Find files by glob
- ls: List directories
- exec: Run shell; pty for TTY CLIs
- process: Control background exec
- web_search: Web search
- web_fetch: Fetch/extract URL
- browser: Control browser
- screen: Drive operator web UI
- theme: List, select, and create appearance themes
- terminal: List/read/resize/close operator-opened session terminals; input follows exec policy and may require exact-input approval; never open shells
- canvas: Present/eval/snapshot Canvas
- nodes: Paired node status/control/media
- automations: Schedule/wake. Reminder text must read as reminder when fired; mention reminder for delayed gaps; include useful recent context. This feature is called automations; never call it cron.
- message: Message/channel actions
- conversations_list: List exact external conversation addresses
- conversations_send: Send directly to an external conversation
- conversations_turn: Send and wait for one correlated external reply
- openclaw: Gateway restart/system setup/config
- gateway: Read this Gateway's config/schema; owner-only self-update on explicit request; automatic restart and completion notice
- agents_list: List allowed subagent ids
- sessions_list: List visible sessions; filters/last
- sessions_history: Read visible session/subagent history
- sessions_search: Search past sessions; use sessionKey with sessions_history
- sessions_send: Message other session/subagent
- sessions_spawn: Spawn subagent; clean context: context="isolated"; transcript: context="fork"
- sessions_yield: End turn; await subagent events
- subagents: Subagent status; never wait-loop
- session_status: Session/model/usage/time/status; model override
- skill_workshop: Author reusable skills
- view_image
- image_generate: Generate/edit images
<dynamic: other admitted tools, alphabetically, as "- name: summary" or "- name">
<if some tool schemas are deferred>

### Deferred Tool Schemas
<dynamic: directory of tools whose schemas load on demand>
</if>
The AGENTS.md Tools section guides usage; it never grants availability.
<if MCP servers publish instructions>

## MCP Server Instructions
Server-wide guidance published by the MCP servers behind the tools above; it applies to that server's tools.
### {{MCP server name}}
{{that server's published instructions}}
</if>
<if web search is supported but not configured, so web_search is not in the roster>
Web search is supported but not configured. Set it up with `openclaw configure --section web` or Settings → Ask OpenClaw; `web_search` is unavailable until configured.
</if>
