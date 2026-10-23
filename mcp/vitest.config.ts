import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    // workers-oauth-provider imports "cloudflare:workers", which Node can't load: run it through Vite,
    // so test/admin-worker.test.ts can stand in for that module with vi.mock.
    server: { deps: { inline: [/workers-oauth-provider/] } },
  },
});
