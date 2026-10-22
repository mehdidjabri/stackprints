# Agentic Stack

Every possible AI agent stack, mapped. Browse preset stacks (OpenClaw, Hermes Agent, pi, Claude Code, ChatGPT dots, Meta Muse, Instinct…), change any layer, rename, save and share your own.

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

All data lives in [`content/`](content): `layers.json` and one file per stack in `content/stacks/`.

## Develop

```bash
npm install
npm run dev
```

`npm run build` validates `content/` and writes the static site to `out/`. Set `NEXT_PUBLIC_SITE_URL` to your domain for canonical URLs and the sitemap.

## Contribute

See [/contribute](app/contribute/page.tsx) or just open a PR that edits `content/`. Run `npm run check` first.
Closed products are described from public reporting; say so in the description and link a source.

MIT licensed.
