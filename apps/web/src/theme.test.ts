import { readFileSync } from "node:fs";
import { MODALITIES } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { modalityStyles } from "./modality";

// Read from disk: Vitest stubs CSS imports.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./index.css");
const indexHtml = read("../index.html");
const viteConfig = read("../vite.config.ts");

const token = (name: string) =>
  new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`).exec(css)?.[1];

describe("theme", () => {
  it("defines a color token for every modality", () => {
    for (const m of MODALITIES) {
      expect(token(m), m).toBeDefined();
      expect(modalityStyles[m].text).toBe(`text-${m}`);
    }
  });

  it("gives every modality its own color", () => {
    const colors = MODALITIES.map(token);
    expect(new Set(colors).size).toBe(MODALITIES.length);
  });

  it("uses the background token as the browser and manifest theme color", () => {
    const bg = token("bg");
    expect(bg).toBeDefined();
    expect(indexHtml).toContain(`<meta name="theme-color" content="${bg}" />`);
    expect(viteConfig).toContain(`background_color: "${bg}"`);
    expect(viteConfig).toContain(`theme_color: "${bg}"`);
  });
});
