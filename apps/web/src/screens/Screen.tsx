import { useEffect, type ReactNode } from "react";
import { card } from "../ui";

/** A tab's page: its heading, the document title and its content. */
export function Screen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Workout`;
  }, [title]);
  return (
    <section aria-labelledby="screen-title" className="flex flex-col gap-4">
      <h1 id="screen-title" className="text-2xl font-bold">
        {title}
      </h1>
      {children}
    </section>
  );
}

/** Stand-in copy for a screen whose real content arrives in a later epic. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return <p className={`${card} text-fg-muted`}>{children}</p>;
}
