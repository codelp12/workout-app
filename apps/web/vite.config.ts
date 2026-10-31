import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  resolve: {
    // Use workspace packages' TypeScript source instead of their dist.
    conditions: ["@workout-app/source", ...defaultClientConditions],
  },
  plugins: [
    react(),
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
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz$/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": serverUrl,
      "/healthz": serverUrl,
    },
  },
});
