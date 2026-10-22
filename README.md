# Agentic Stack

Every possible AI agent stack, mapped, and drawn as an abstract motherboard: each layer is a component on the board (models and harnesses are the processor sockets), each choice a chip with its logo, name and subtitle. Browse preset stacks (OpenClaw, Hermes Agent, Pi, Claude Code, ChatGPT dots, Meta Muse, Instinct…), change any layer, rename, save, share, or publish your own as a page.

- **Static.** Next.js `output: "export"`, no server, no database. Deploy `out/` anywhere.
- **Fast.** System fonts, inlined CSS, one small client component (the editor). Everything else is server-rendered HTML.
- **Findable.** Per-page metadata and canonicals, JSON-LD, sitemap, robots, generated OG images.
- **Agent-ready.** `/llms.txt` and `/stacks.json` expose the whole dataset.
- **Share without accounts.** Stacks you build are encoded in the URL hash; "Save" keeps them in your browser.

## The model

27 layers in five bands, top to bottom:

| Band | Layers |
| --- | --- |
| Surface | Channels, Interface, Voice, Devices |
| Brain | Model, Router, Inference host, Harness, Persona, Multi-agent |
| Hands | Core tools, Protocols, Connectors, Skills, Compute, Browser use |
| Files | Memory, Retrieval, State |
| Ops | Proactivity, Durable execution, Guardrails, Identity & secrets, Payments, Observability, Hosting, Agent readiness |

All data lives in [`content/`](content):

- `layers.json`: the layers
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
