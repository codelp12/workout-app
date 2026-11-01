// Downloads free-exercise-db at a pinned commit into data/free-exercise-db/.
//
//   pnpm --filter @workout-app/exercise-data dataset           re-fetch the pinned commit
//   pnpm --filter @workout-app/exercise-data dataset <commit>   move the pin to <commit>
//
// Re-fetching the pinned commit fails if any file's SHA-256 differs from
// source.json, so the vendored copy is always exactly that commit's files.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const dir = new URL("../data/free-exercise-db/", import.meta.url);
const sourceUrl = new URL("source.json", dir);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));

const commit = process.argv[2] ?? source.commit;
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`Expected a full 40-character commit SHA, got "${commit}"`);
}
const repinning = commit !== source.commit;

const downloads = [];
for (const [name, file] of Object.entries(source.files)) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${commit}/${file.path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!repinning && sha256 !== file.sha256) {
    throw new Error(
      `${name} at ${commit} has SHA-256 ${sha256}, expected ${file.sha256}`,
    );
  }
  downloads.push({ name, bytes });
  file.sha256 = sha256;
}

for (const { name, bytes } of downloads) {
  await writeFile(new URL(name, dir), bytes);
}
source.commit = commit;
await writeFile(sourceUrl, `${JSON.stringify(source, null, 2)}\n`);
console.log(
  `${repinning ? "Pinned" : "Verified"} ${source.repo}@${commit} (${downloads.length} files)`,
);
