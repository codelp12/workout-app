import type { Modality } from "@workout-app/shared";
import { useId, useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { modalityStyles } from "../modality";
import type { SessionView } from "../plan/sessions";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, input } from "../ui";
import { finishSession } from "./lift-log";

const RPE_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

/** Ends a lift or climb session with a session RPE and notes (§4). */
export function FinishSheet({
  view,
  title,
  modality,
}: {
  view: SessionView;
  title: string;
  modality: Modality;
}) {
  const notesId = useId();
  const [open, setOpen] = useState(false);
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  async function finish() {
    if (rpe === null) return;
    setSaving(true);
    try {
      await finishSession(localDb, view, { rpe, notes });
      syncSoon();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <BottomSheet
      title={title}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap w-full`}>
          {title}
        </button>
      }
    >
      <ChipGroup
        type="single"
        label="Session RPE"
        modality={modality}
        options={RPE_OPTIONS}
        value={rpe === null ? undefined : String(rpe)}
        onValueChange={(value) => setRpe(Number(value))}
      />
      <label htmlFor={notesId} className="font-medium">
        Notes
      </label>
      <textarea
        id={notesId}
        rows={3}
        className={`${input} py-2`}
        placeholder="How it went, anything to remember…"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <button
        type="button"
        className={`${buttonBase} min-h-tap ${modalityStyles[modality].fill}`}
        disabled={saving || rpe === null}
        onClick={() => void finish()}
      >
        Finish
      </button>
    </BottomSheet>
  );
}
