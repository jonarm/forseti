import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the `@/*` alias from tsconfig.json so tests import modules by the
    // same specifier the app does — otherwise `vi.mock("@/db")` would silently
    // fail to match the module the code under test actually imported.
    // Native since Vite 7; the vite-tsconfig-paths plugin is no longer needed.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite compiles a WASM Postgres per suite; the 5s default is tight on a
    // cold first run. Raised from 30s once the number of database-backed suites
    // grew past a dozen: they run in parallel, contend for CPU, and the slowest
    // of them (the XLSX export) started tripping 30s under that load — a red run
    // that a re-run cleared, which is the worst kind of red because it teaches
    // people to re-run rather than to read.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
