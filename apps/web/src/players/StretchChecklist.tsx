import type {
  ChecklistItem,
  Exercise,
  PlannedSession,
  SessionLog,
} from "@workout-app/shared";
import { useCallback, useId, useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { ExercisePhotos } from "../library/ExercisePhotos";
import { localDb, syncSoon } from "../sync";
import { button, card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { readChecklist, toggleStretchChecked } from "./checklist";

function StretchHowTo({
  item,
  exercise,
}: {
  item: ChecklistItem;
  exercise: Exercise | undefined;
}) {
  if (!exercise && !item.instruction) return null;
  return (
    <BottomSheet
      title={item.name}
      description={item.detail ? `Hold gently for ${item.detail}.` : undefined}
      trigger={
        <button
          type="button"
          className={`${button} min-h-tap shrink-0 text-sm`}
          aria-label={`How to: ${item.name}`}
        >
          How to
        </button>
      }
    >
      {exercise && <ExercisePhotos exercise={exercise} />}
      {item.instruction ? (
        <p>{item.instruction}</p>
      ) : (
        <ol className="list-decimal space-y-2 pl-5">
          {exercise?.instructions.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}
    </BottomSheet>
  );
}

/** Optional, so the completed session and its summary never depend on it. */
export function StretchChecklist({
  session,
  log,
}: {
  session: PlannedSession;
  log: SessionLog;
}) {
  const { modality, workoutType } = session;
  const query = useCallback(async () => {
    const list = await readChecklist(
      localDb,
      { modality, workoutType },
      "stretch",
    );
    if (!list?.items.length) return null;
    return Promise.all(
      list.items.map(async (item) => {
        const exercise = item.exerciseId
          ? await localDb.rows("exercise").get(item.exerciseId)
          : undefined;
        return {
          item,
          exercise: exercise?.deletedAt === null ? exercise : undefined,
        };
      }),
    );
  }, [modality, workoutType]);
  const rows = useLiveQuery(query, null);
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState(true);
  if (!rows || log.endedAt === null) return null;
  const done = rows.filter(({ item }) => log.checked.includes(item.id)).length;

  async function toggle(itemId: string) {
    await toggleStretchChecked(localDb, log.id, itemId);
    syncSoon();
  }

  return (
    <section aria-labelledby={titleId} className={card}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id={titleId} className="font-semibold">
            Post-session stretches
          </h2>
          <p className="text-sm text-fg-muted">
            Optional · {done} of {rows.length}
          </p>
        </div>
        <button
          type="button"
          className={`${button} min-h-tap`}
          aria-controls={listId}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide stretches" : "Show stretches"}
        </button>
      </div>
      <ul id={listId} hidden={!open} className="divide-y divide-border">
        {rows.map(({ item, exercise }) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 py-1"
          >
            <label className="flex min-h-tap cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-6 shrink-0"
                checked={log.checked.includes(item.id)}
                onChange={() => void toggle(item.id)}
              />
              <span>
                {item.name}
                {item.detail && (
                  <span className="block text-sm text-fg-muted">
                    {item.detail}
                  </span>
                )}
              </span>
            </label>
            <StretchHowTo item={item} exercise={exercise} />
          </li>
        ))}
      </ul>
    </section>
  );
}
