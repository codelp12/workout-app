import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/server/**/*.ts", "apps/web/vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },
  {
    // The engine is pure (SPEC §5.0): no I/O, no clock reads, no randomness.
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["packages/engine/src/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "Date",
          "fetch",
          "performance",
          "setTimeout",
          "setInterval",
          "crypto",
          "process",
          "localStorage",
          "indexedDB",
        ].map((name) => ({
          name,
          message: "The engine is pure; pass this in as an input.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "The engine is deterministic; pass randomness in as an input.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^node:|^(fs|path|os|http|https|child_process)$",
              message: "The engine does no I/O.",
            },
          ],
        },
      ],
    },
  },
);
