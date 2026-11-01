// Converts every exercise's images from free-exercise-db's JPEGs at the pinned
// commit to 480 px wide WebP: core ones (src/core.ts) under media/core/, the
// rest under media/other/. Deletes any image no longer wanted.
// Run with `pnpm --filter @workout-app/exercise-data images`.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CORE_EXERCISES,
  CORE_IMAGE_BUDGET,
  FREE_EXERCISE_DB,
  MEDIA_DIRS,
  isCore,
  loadFreeExerciseDb,
  loadRawFreeExerciseDb,
  webpPath,
} from "../src/index.js";

type Job = { path: string; out: URL };

const imported = new Set(loadFreeExerciseDb().map((e) => e.sourceId));
const raws = loadRawFreeExerciseDb();
for (const id of CORE_EXERCISES)
  if (!raws.some((raw) => raw.id === id))
    throw new Error(`Core exercise ${id} is not in the dataset`);

const jobs: Job[] = raws
  .filter((raw) => imported.has(raw.id))
  .flatMap((raw) =>
    raw.images.map((path) => ({
      path,
      out: new URL(
        webpPath(path),
        isCore(raw.id) ? MEDIA_DIRS.core : MEDIA_DIRS.other,
      ),
    })),
  );

async function convert({ path, out }: Job) {
  const url = `https://raw.githubusercontent.com/${FREE_EXERCISE_DB.repo}/${FREE_EXERCISE_DB.commit}/exercises/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ width: CORE_IMAGE_BUDGET.width, withoutEnlargement: true })
    .webp({ quality: CORE_IMAGE_BUDGET.quality, effort: 6 })
    .toBuffer();
  await mkdir(new URL(".", out), { recursive: true });
  await writeFile(out, webp);
  return webp.length;
}

const sizes = new Map<URL, number>();
for (let i = 0; i < jobs.length; i += 8) {
  const batch = jobs.slice(i, i + 8);
  const done = await Promise.all(batch.map(convert));
  batch.forEach((job, j) => sizes.set(job.out, done[j]!));
}

const wanted = new Set(jobs.map((job) => fileURLToPath(job.out)));
for (const dir of Object.values(MEDIA_DIRS)) {
  const root = fileURLToPath(dir);
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    const file = `${entry.parentPath}/${entry.name}`.replace(/\/+/g, "/");
    if (entry.isFile() && !wanted.has(file)) await rm(file);
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
for (const [name, dir] of Object.entries(MEDIA_DIRS)) {
  const set = [...sizes].filter(([out]) => out.href.startsWith(dir.href));
  const total = set.reduce((a, [, n]) => a + n, 0);
  console.log(
    `${name}: ${set.length} images, total ${kb(total)}, ` +
      `mean ${kb(total / set.length)}, max ${kb(Math.max(...set.map(([, n]) => n)))}`,
  );
}
