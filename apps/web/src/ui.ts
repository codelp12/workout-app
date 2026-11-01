// Shared class strings for plain buttons, inputs and cards. Widgets with
// behavior (steppers, chips, sheets, toasts) live in src/components.
export const buttonBase =
  "inline-flex min-w-tap items-center justify-center rounded-lg px-4 font-medium active:opacity-80 disabled:opacity-50";
export const button = `${buttonBase} bg-surface-raised text-fg`;
export const input =
  "w-full rounded-lg border border-border bg-surface px-3 text-fg placeholder:text-fg-muted";
export const card = "rounded-xl bg-surface p-4";
