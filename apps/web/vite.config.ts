import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  defaultClientConditions,
  defaultServerConditions,
  defineConfig,
} from "vite";
import { VitePWA } from "vite-plugin-pwa";

const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3000";

// The core exercise images, which the server serves at /media/exercises/.
// They're pre-cached so the library has photos offline (SPEC §7).
const exerciseMedia = fileURLToPath(
  new URL("../../packages/exercise-data/media/core/", import.meta.url),
);
const coreImages = readdirSync(exerciseMedia, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".webp"))
  .sort()
  .map((path) => ({
    url: `/media/exercises/${path.split("\\").join("/")}`,
    revision: createHash("md5")
      .update(readFileSync(`${exerciseMedia}/${path}`))
      .digest("hex"),
  }));

export default defineConfig({
  define: {
    // Shown in problem reports, so each maps to a build.
    __APP_BUILD__: JSON.stringify(
      process.env.APP_BUILD ?? `${new Date().toISOString().slice(0, 16)}Z`,
    ),
  },
  resolve: {
    // Use workspace packages' TypeScript source instead of their dist.
    conditions: ["@workout-app/source", ...defaultClientConditions],
  },
  // Vitest runs tests in Node through the SSR resolver.
  ssr: {
    resolve: {
      conditions: ["@workout-app/source", ...defaultServerConditions],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload on our own: a new build waits for the user to accept
      // the update prompt (SPEC §8).
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Workout App",
        short_name: "Workout",
        description: "Plan and log lifting, running and climbing.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Keep equal to --color-bg in src/index.css.
        background_color: "#111827",
        theme_color: "#111827",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/healthz$/],
        additionalManifestEntries: coreImages,
        // Any other exercise image is kept once it has been viewed.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/media/"),
            handler: "CacheFirst",
            options: {
              cacheName: "exercise-media",
              expiration: { maxEntries: 1000 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": serverUrl,
      "/healthz": serverUrl,
      "/media": serverUrl,
    },
  },
});
