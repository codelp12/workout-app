import { newId, type Project } from "@workout-app/shared";
import { useState, type FormEvent } from "react";
import { modalityStyles } from "./modality";
import { localDb, pendingRowIds, remove, save } from "./sync";
import { button, buttonBase, card, input } from "./ui";
import { useLiveQuery } from "./use-live-query";

const climb = modalityStyles.climb;

const activeProjects = () =>
  localDb
    .rows("project")
    .filter((p) => p.deletedAt === null)
    .sortBy("createdAt");

/** Placeholder climbing project list that exercises the sync engine until #58 replaces it. */
export function Projects() {
  const projects = useLiveQuery<Project[]>(activeProjects, []);
  const pending = useLiveQuery(pendingRowIds, new Set<string>());
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const now = Date.now();
    await save("project", {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      name: name.trim(),
      grade: grade.trim(),
      status: "active",
      sentAt: null,
      notes: null,
    });
    setName("");
    setGrade("");
  }

  return (
    <section className={card}>
      <h2 className={`text-lg font-semibold ${climb.text}`}>Projects</h2>
      <form
        className="mt-3 grid grid-cols-[1fr_6rem] gap-3"
        onSubmit={(e) => void onSubmit(e)}
      >
        <label className="flex flex-col gap-1 text-sm">
          Name{" "}
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>{" "}
        <label className="flex flex-col gap-1 text-sm">
          Grade{" "}
          <input
            className={input}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
        </label>{" "}
        <button
          type="submit"
          className={`${buttonBase} col-span-2 ${climb.fill}`}
        >
          Add project
        </button>
      </form>
      <ul aria-label="Projects" className="mt-3 flex flex-col gap-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-2 rounded-lg bg-bg py-1 pr-1 pl-3 ${climb.accent}`}
          >
            <span className="flex-1">
              {p.name}
              {p.grade && (
                <span className={`font-semibold ${climb.text}`}>
                  {` ${p.grade}`}
                </span>
              )}
              {pending.has(p.id) && (
                <span className="text-sm text-fg-muted"> (pending)</span>
              )}
            </span>{" "}
            <button
              type="button"
              className={button}
              aria-label={`Delete ${p.name}`}
              onClick={() => void remove("project", p.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
