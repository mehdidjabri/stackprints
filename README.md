# Agentic Stack

Every possible AI agent stack, mapped, and drawn as an abstract motherboard: each layer is a component on the board (models and harnesses are the processor sockets), each choice a chip with its logo, name and subtitle. Browse preset stacks (OpenClaw, Hermes Agent, Pi, Claude Code, ChatGPT dots, Meta Muse, Instinct…), change any layer, rename, save, share, or publish your own as a page.

- **Static.** Next.js `output: "export"`, no server, no database. Deploy `out/` anywhere.
- **Fast.** System fonts, inlined CSS, one small client component (the editor). Everything else is server-rendered HTML.
- **Findable.** Per-page metadata and canonicals, JSON-LD, sitemap, robots, generated OG images.
- **Agent-ready.** `/llms.txt` and `/stacks.json` expose the whole dataset.
- **Share without accounts.** Stacks you build are encoded in the URL hash; "Save" keeps them in your browser.

## The model

28 layers in five bands, drawn as regions of a motherboard. Each layer has a fixed silkscreen designator.

| Band | Board region | Layers |
| --- | --- | --- |
| Surface | rear I/O strip | Channels J1, Triggers Y1, Interface J2, Voice J3, Devices J4, Agent access J5 |
| Brain | processor area | Harness U1, Model U2, Model gateway U3, Inference U4, Instructions U5, Multi-agent U6 |
| Hands | expansion slots | Built-in tools, Web search, Sandbox, Browser & computer use, Tool interface, Connectors, Payments, Skills & plugins (PCIE1–8) |
| Files | memory sticks | Memory DIMM1, Retrieval DIMM2, Sessions & files DIMM3 |
| Ops | bottom-edge headers | Hosting PS1, Durable execution BT1, Guardrails F1, Identity & secrets U7, Observability & evals J6 |

Brain and hands follow Anthropic's Managed Agents split (brain = model + harness; hands = tools and sandboxes). Unused layers show as empty slots, so every board has the same floorplan.

All data lives in [`content/`](content):

- `layers.json`: the layers, their band and board designator
- `options/<layer>/<id>.json`: one file per product or pattern, so submissions never conflict
- `stacks/<slug>.json`: one file per stack; each becomes a page at `/stack/<slug>/`
- `logos/<name>.svg`: one-colour marks, combined at build time into a single cached `/logos.svg` sprite

## Develop

```bash
npm install
npm run dev
```

`npm run build` validates `content/` and writes the static site to `out/`. Set `NEXT_PUBLIC_SITE_URL` to your domain for canonical URLs and the sitemap.

## Contribute

- **Companies:** list your product with the `/submit` form. It opens a prefilled pull request.
- **Anyone:** build a stack on the home page and press **Publish as a page**.
- Or edit `content/` by hand; see [/contribute](app/contribute/page.tsx). Run `npm run check` first.
Closed products are described from public reporting; say so in the description and link a source.

MIT licensed. Logos come from [Simple Icons](https://simpleicons.org) (CC0) and [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT); marks belong to their owners.
