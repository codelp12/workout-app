import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { combineLifts } from "../plan/combine";
import type { SessionView } from "../plan/sessions";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase } from "../ui";

export function CombineWorkouts({
  view,
  other,
}: {
  view: SessionView;
  other: NonNullable<SessionView["combineCandidate"]>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  async function combine() {
    setSaving(true);
    try {
      if (await combineLifts(localDb, view.session.id, other.id)) {
        syncSoon();
        setOpen(false);
      } else {
        setUnavailable(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      title="Combine workouts?"
      description={`Combine ${view.title} and ${other.title} into one workout? Finishing it will count toward both planned lifts.`}
      open={open}
      onOpenChange={(next) => {
        if (!next) setUnavailable(false);
        setOpen(next);
      }}
      trigger={
        <button type="button" className={`${button} min-h-tap`}>
          Combine with {other.title}
        </button>
      }
    >
      {unavailable && (
        <p role="status">These workouts can no longer be combined.</p>
      )}
      <button
        type="button"
        className={`${buttonBase} min-h-tap bg-lift text-bg`}
        disabled={saving || unavailable}
        onClick={() => void combine()}
      >
        Combine workouts
      </button>
    </BottomSheet>
  );
}
