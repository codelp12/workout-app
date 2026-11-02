import type { Template, TemplateSlot, UpsertData } from "@workout-app/shared";
import { localDb, save } from "../sync";

/** Live lifting templates, by name. */
export async function liftTemplates(): Promise<Template[]> {
  const rows = await localDb.rows("template").toArray();
  return rows
    .filter((t) => t.deletedAt === null && t.modality === "lift")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The live template, or `null` if it doesn't exist or was deleted. */
export async function readTemplate(id: string): Promise<Template | null> {
  const row = await localDb.rows("template").get(id);
  return row && row.deletedAt === null ? row : null;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Applies `change` to the latest saved template and saves it through the
 * outbox. Updates run one at a time, so quick taps don't overwrite each other.
 */
export function updateTemplate(
  id: string,
  change: (current: Template) => Partial<UpsertData<"template">>,
): Promise<void> {
  const run = queue.then(async () => {
    const current = await readTemplate(id);
    if (!current) return;
    // `save` sets `userId` and `serverSeq` itself, so the extra keys are harmless.
    await save("template", {
      ...current,
      ...change(current),
      id,
      updatedAt: Date.now(),
    });
  });
  queue = run.catch(() => {});
  return run;
}

/** Changes slot `index` of a template. */
export function updateSlot(
  id: string,
  index: number,
  change: (slot: TemplateSlot) => Partial<TemplateSlot>,
): Promise<void> {
  return updateTemplate(id, (t) => ({
    slots: t.slots.map((slot, i) =>
      i === index ? { ...slot, ...change(slot) } : slot,
    ),
  }));
}
