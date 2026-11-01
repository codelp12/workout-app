import * as RadixToast from "@radix-ui/react-toast";
import { useCallback, useState, type ReactNode } from "react";
import { ToastContext, type ToastOptions } from "./toast-context";

type ShownToast = ToastOptions & { id: number };

let nextId = 1;

/**
 * Renders toasts raised with `useToast()`. Toasts appear at the top, clear
 * of the thumb and the bottom tabs, are announced by screen readers, pause
 * while hovered or focused, and can be swiped up or closed with Escape
 * (F8 focuses them).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ShownToast[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId++;
    setToasts((current) => [...current, { ...options, id }]);
  }, []);

  function remove(id: number) {
    setToasts((current) => current.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={toast}>
      <RadixToast.Provider swipeDirection="up" duration={5000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) remove(t.id);
            }}
            className="flex items-center gap-3 rounded-xl bg-surface-raised p-4 shadow-lg data-[state=open]:animate-toast-in data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y) motion-reduce:animate-none"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <RadixToast.Title className="font-medium">
                {t.title}
              </RadixToast.Title>
              {t.description && (
                <RadixToast.Description className="text-sm text-fg-muted">
                  {t.description}
                </RadixToast.Description>
              )}
            </div>
            {t.action && (
              <RadixToast.Action
                altText={t.action.altText}
                onClick={t.action.onClick}
                className="min-w-tap rounded-lg bg-accent px-4 font-medium text-bg active:opacity-80"
              >
                {t.action.label}
              </RadixToast.Action>
            )}
            <RadixToast.Close
              aria-label="Dismiss"
              className="min-w-tap rounded-lg text-xl text-fg-muted active:bg-surface"
            >
              ×
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))] outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
