import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": serverUrl,
      "/healthz": serverUrl,
    },
  },
});
