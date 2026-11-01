// Converts the core set's images (src/core.ts) from free-exercise-db's JPEGs at
// the pinned commit to 480 px wide WebP under media/, and deletes any others.
// Run with `pnpm --filter @workout-app/exercise-data images`.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CORE_EXERCISES,
  CORE_IMAGE_BUDGET,
  FREE_EXERCISE_DB,
  coreMediaFile,
  loadRawFreeExerciseDb,
  webpPath,
} from "../src/index.js";

const byId = new Map(loadRawFreeExerciseDb().map((raw) => [raw.id, raw]));
const jobs = CORE_EXERCISES.flatMap((id) => {
  const raw = byId.get(id);
  if (!raw) throw new Error(`Core exercise ${id} is not in the dataset`);
  return raw.images.map((path) => ({ path, out: webpPath(path) }));
});

async function convert({ path, out }: { path: string; out: string }) {
  const url = `https://raw.githubusercontent.com/${FREE_EXERCISE_DB.repo}/${FREE_EXERCISE_DB.commit}/exercises/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ width: CORE_IMAGE_BUDGET.width, withoutEnlargement: true })
    .webp({ quality: CORE_IMAGE_BUDGET.quality, effort: 6 })
    .toBuffer();
  const file = coreMediaFile(out);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, webp);
  return webp.length;
}

const sizes: number[] = [];
for (let i = 0; i < jobs.length; i += 8) {
  sizes.push(...(await Promise.all(jobs.slice(i, i + 8).map(convert))));
}

const mediaDir = fileURLToPath(coreMediaFile(""));
const wanted = new Set(jobs.map((job) => job.out));
for (const entry of await readdir(mediaDir, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const rel =
    `${entry.parentPath.slice(mediaDir.length)}/${entry.name}`.replace(
      /^\//,
      "",
    );
  if (!wanted.has(rel)) await rm(`${entry.parentPath}/${entry.name}`);
}

const total = sizes.reduce((a, b) => a + b, 0);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `${CORE_EXERCISES.length} exercises, ${sizes.length} images: total ${kb(total)}, ` +
    `mean ${kb(total / sizes.length)}, max ${kb(Math.max(...sizes))}`,
);
