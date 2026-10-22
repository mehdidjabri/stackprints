---
layer: tools
kind: template
title: apply_patch tool
source: https://github.com/openai/codex/blob/a3d93e1e692f1144cf8685175a5d1f6bf7294f57/codex-rs/core/src/tools/handlers/apply_patch_spec.rs#L5-L27
license: Apache-2.0
retrieved: 2026-10-22
note: A freeform (custom) tool: the one-line description, then the Lark grammar sent as its format (codex-rs/core/assets/tools/apply_patch.lark, included at line 5). When a turn spans several environments, the start rule gains an optional `*** Environment ID:` line.
---
The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.

start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
