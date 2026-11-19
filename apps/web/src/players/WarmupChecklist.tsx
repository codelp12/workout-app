import type { Checklist } from "@workout-app/shared";
import { useCallback, useState } from "react";
import type { SessionView } from "../plan/sessions";
import { readSettings } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { readWarmup, toggleChecked } from "./checklist";

/**
 * The session type's warm-up list (#121), ticked off one tap per item. Open
 * until the session's first set or entry; it never blocks logging.
 */
export function WarmupChecklist({
  view,
  checked,
  startOpen,
}: {
  view: SessionView;
  checked: readonly string[];
  startOpen: boolean;
}) {
  const { session } = view;
  const query = useCallback(() => readWarmup(localDb, session), [session]);
  const list = useLiveQuery<Checklist | null>(query, null);
  const [open, setOpen] = useState(startOpen);
  if (!list || list.items.length === 0) return null;
  const done = list.items.filter((i) => checked.includes(i.id)).length;

  async function toggle(itemId: string) {
    const settings = await readSettings();
    await toggleChecked(localDb, view, itemId, settings.timezone);
    syncSoon();
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={card}
    >
      <summary className="min-h-tap cursor-pointer content-center font-medium">
        Warm-up · {done} of {list.items.length}
      </summary>
      <ul aria-label="Warm-up checklist" className="flex flex-col">
        {list.items.map((item) => (
          <li key={item.id}>
            <label className="flex min-h-tap cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-6 shrink-0"
                checked={checked.includes(item.id)}
                onChange={() => void toggle(item.id)}
              />
              <span>
                {item.name}
                {item.detail && (
                  <span className="text-fg-muted"> · {item.detail}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
