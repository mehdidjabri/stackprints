// The public MCP server: anyone's agent, no sign-in. It reads the catalogue and prepares
// submissions; the user opens the pull request or issue on GitHub as themselves.
import { McpServer } from "@modelcontextprotocol/server";
import type { PublicDeps } from "../core/deps";
import { registerTools } from "../core/tool";
import { STACK_READING, publicTools } from "../tools/public";

export const PUBLIC_INSTRUCTIONS = `Stackprints (stackprints.com) maps how AI agents are built. Every agent is drawn as a stack of 28 layers in 5 bands: surface (channels, triggers, interface, voice, devices, agent access), brain (harness, model, model gateway, inference, instructions, multi-agent), hands (built-in tools, web search, sandbox, browser and computer use, tool interface, connectors, payments, skills), files (memory, retrieval, sessions and files) and ops (hosting, durable execution, guardrails, identity and secrets, observability and evals). Each layer lists options: the products, models, protocols and patterns that fill it, with sourced datasheets. Stacks are real agents (OpenClaw, Claude Code, Codex…) mapped layer by layer with evidence, plus a few example designs.

Where to start: search_stackprints for a name or topic; list_layers to map a goal onto layers; get_layer to compare the options in one; get_option for one datasheet; list_stacks and get_stack for how real agents are built; get_hot for what people are talking about this week. Every answer carries the page URL to cite.

Reading a stack: ${STACK_READING}

Reading an option: facts marked "(vendor-reported)" are the vendor's own numbers, and a missing fact was not researched, never zero or absent. An option with an affiliation is made by the people behind Stackprints; say so whenever you recommend it.

This server is read-only and stores nothing. To add or fix content the user opens a pull request or an issue on GitHub as themselves: validate_stack checks a draft with the same rules as CI, prepare_stack_submission and prepare_option_submission return the exact file and a prefilled GitHub link, prepare_correction returns a prefilled correction issue, and get_submission_status follows it afterwards. Never say something was submitted: show the user the link to open.`;

export function createPublicServer(deps: PublicDeps) {
  const server = new McpServer(
    {
      name: "stackprints",
      title: "Stackprints",
      version: "0.1.0",
      websiteUrl: deps.siteUrl,
      description: "How AI agents are built, layer by layer, with sources: read the catalogue and prepare submissions.",
    },
    { instructions: PUBLIC_INSTRUCTIONS },
  );
  registerTools(server, { now: deps.now }, publicTools(deps));
  return server;
}
