import { createContext, useContext } from "react";

export type ToastOptions = {
  title: string;
  description?: string;
  /** One button on the toast, e.g. Undo. */
  action?: {
    label: string;
    /** How to do the same without the toast, read to screen readers. */
    altText: string;
    onClick: () => void;
  };
  /** Milliseconds before it hides itself. Default 5000. */
  duration?: number;
};

export const ToastContext = createContext<
  ((toast: ToastOptions) => void) | null
>(null);

/** Returns `toast(options)`, which shows a toast. Needs a `ToastProvider`. */
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast needs a ToastProvider above it");
  return toast;
}
