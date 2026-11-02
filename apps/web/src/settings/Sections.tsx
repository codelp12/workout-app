import { useId, type ReactNode } from "react";
import { card } from "../ui";

/** A card with an `h2`, for one group of settings. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A titled part of a {@link Section}. */
export function Subsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-medium">
        {title}
      </h3>
      {children}
    </section>
  );
}
