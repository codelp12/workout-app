import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CORE_EXERCISES,
  CORE_IMAGE_BUDGET,
  DEFAULT_TEMPLATE_EXERCISES,
  MEDIA_DIRS,
  coreMediaFile,
  isCore,
  otherMediaFile,
} from "./core.js";
import { loadFreeExerciseDb } from "./load.js";

const exercises = new Map(loadFreeExerciseDb().map((e) => [e.sourceId, e]));
const core = CORE_EXERCISES.map((id) => exercises.get(id));
const corePaths = core.flatMap((e) => e?.media.map((m) => m.path) ?? []);

describe("core set", () => {
  it("is about 150 distinct imported exercises", () => {
    expect(new Set(CORE_EXERCISES).size).toBe(CORE_EXERCISES.length);
    expect(CORE_EXERCISES.length).toBeGreaterThanOrEqual(140);
    expect(CORE_EXERCISES.length).toBeLessThanOrEqual(160);
    expect(CORE_EXERCISES.filter((id) => !exercises.has(id))).toEqual([]);
  });

  it("covers every default template exercise", () => {
    const templates = Object.entries(DEFAULT_TEMPLATE_EXERCISES);
    expect(templates.map(([name]) => name)).toEqual([
      "Push A",
      "Push B",
      "Pull A",
      "Pull B",
      "Legs A",
      "Legs B",
    ]);
    for (const [, ids] of templates) {
      expect(ids.length).toBeGreaterThanOrEqual(5);
      expect(ids.length).toBeLessThanOrEqual(7);
      expect(ids.filter((id) => !isCore(id))).toEqual([]);
      expect(ids.every((id) => exercises.get(id)?.modality === "lift")).toBe(
        true,
      );
    }
  });

  it("is dumbbell, band and bodyweight first", () => {
    const light = core.filter((e) =>
      e?.equipment.some((q) =>
        ["dumbbell", "band", "bodyweight", "kettlebell"].includes(q),
      ),
    );
    expect(light.length / core.length).toBeGreaterThan(0.75);
  });

  it("has at least one image per exercise", () => {
    expect(
      core.filter((e) => !e?.media.length).map((e) => e?.sourceId),
    ).toEqual([]);
  });
});

const filesIn = (url: URL) => {
  const dir = fileURLToPath(url);
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => statSync(dir + f).isFile())
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
};

describe("core images", () => {
  it("are committed for every core media path, and nothing else is", () => {
    expect(filesIn(MEDIA_DIRS.core)).toEqual([...corePaths].sort());
  });

  it("are WebP at the target width within the size budget", async () => {
    let total = 0;
    for (const path of corePaths) {
      const file = coreMediaFile(path);
      const size = statSync(file).size;
      total += size;
      expect(size, path).toBeLessThanOrEqual(CORE_IMAGE_BUDGET.maxImageBytes);
      const meta = await sharp(fileURLToPath(file)).metadata();
      expect(meta.format, path).toBe("webp");
      expect(meta.width, path).toBe(CORE_IMAGE_BUDGET.width);
    }
    expect(total).toBeLessThanOrEqual(CORE_IMAGE_BUDGET.maxTotalBytes);
  });
});

describe("other images", () => {
  const otherPaths = loadFreeExerciseDb()
    .filter((e) => !isCore(e.sourceId!))
    .flatMap((e) => e.media.map((m) => m.path));

  it("are committed for every non-core media path, and nothing else is", () => {
    expect(filesIn(MEDIA_DIRS.other)).toEqual([...otherPaths].sort());
  });

  it("are WebP no wider than the target", async () => {
    for (const path of otherPaths) {
      const file = fileURLToPath(otherMediaFile(path));
      expect(statSync(file).size, path).toBeLessThanOrEqual(
        CORE_IMAGE_BUDGET.maxImageBytes,
      );
      const meta = await sharp(file).metadata();
      expect(meta.format, path).toBe("webp");
      expect(meta.width, path).toBeLessThanOrEqual(CORE_IMAGE_BUDGET.width);
    }
  });
});
