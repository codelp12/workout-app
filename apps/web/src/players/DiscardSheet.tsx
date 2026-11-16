import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { button, buttonBase } from "../ui";

/** Confirms throwing away a started session and everything logged in it. */
export function DiscardSheet({
  title,
  onDiscard,
}: {
  /** e.g. "Discard workout". */
  title: string;
  onDiscard: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  async function discard() {
    setSaving(true);
    try {
      await onDiscard();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <BottomSheet
      title={`${title}?`}
      description="Everything logged in this session is deleted, and it goes back to not started. This can't be undone."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={`${button} min-h-tap w-full text-danger`}
        >
          {title}
        </button>
      }
    >
      <button
        type="button"
        className={`${buttonBase} min-h-tap bg-danger text-bg`}
        disabled={saving}
        onClick={() => void discard()}
      >
        {title}
      </button>
      <button
        type="button"
        className={`${button} min-h-tap`}
        onClick={() => setOpen(false)}
      >
        Keep going
      </button>
    </BottomSheet>
  );
}
