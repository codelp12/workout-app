import type { ReactNode } from "react";

/**
 * A placeholder block shown while content loads (SPEC §6: skeletons, not
 * spinners). Size it with classes, e.g. `h-6 w-32`. Hidden from screen
 * readers; wrap a screen's skeletons in `Loading` to announce them once.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={`animate-pulse rounded-md bg-surface-raised motion-reduce:animate-none ${className}`}
    />
  );
}

/** Announces `label` ("Loading exercises") in place of the skeletons inside. */
export function Loading({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
