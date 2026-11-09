import type { ReactNode } from "react";
import { card } from "../ui";

/** The planned targets a player stub shows until its logging lands. */
export function PlanList({
  label,
  rows,
  footer,
}: {
  label: string;
  rows: { key: string; title: string; detail: string }[];
  footer: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className={`${card} text-fg-muted`}>
          Nothing is planned for this session yet.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className={`${card} flex flex-col`}>
            <span className="font-semibold">{row.title}</span>
            <span className="text-fg-muted tabular-nums">{row.detail}</span>
          </li>
        ))}
      </ul>
      <p className={`${card} text-fg-muted`}>{footer}</p>
    </section>
  );
}
