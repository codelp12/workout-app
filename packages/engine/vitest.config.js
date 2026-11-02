import { defineConfig } from "vitest/config";

// Use workspace packages' TypeScript source instead of their dist.
const conditions = ["@workout-app/source", "module", "node"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
