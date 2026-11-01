import * as Dialog from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";

type BottomSheetProps = {
  title: string;
  description?: string;
  /** Element that opens the sheet, e.g. a button. Omit when controlled. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

/**
 * A modal sheet that slides up from the bottom (how-to, "Why this target?",
 * load picker). Focus moves into it and is trapped there; Escape, the Close
 * button or tapping outside closes it and returns focus to the trigger.
 */
export function BottomSheet({
  title,
  description,
  trigger,
  open,
  onOpenChange,
  children,
}: BottomSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-bg/80" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] max-w-md animate-sheet-up flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg outline-none motion-reduce:animate-none"
          // Without a description, tell Radix there is none on purpose.
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div
            aria-hidden="true"
            className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border"
          />
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close className="min-w-tap rounded-lg px-3 text-fg-muted active:bg-surface-raised">
              Close
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="text-fg-muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
