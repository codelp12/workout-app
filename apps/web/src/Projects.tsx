import { newId, type Project } from "@workout-app/shared";
import { useState, type FormEvent } from "react";
import { localDb, pendingRowIds, remove, save } from "./sync";
import { useLiveQuery } from "./use-live-query";

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
    <section>
      <h2>Projects</h2>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>{" "}
        <label>
          Grade{" "}
          <input value={grade} onChange={(e) => setGrade(e.target.value)} />
        </label>{" "}
        <button type="submit">Add project</button>
      </form>
      <ul aria-label="Projects">
        {projects.map((p) => (
          <li key={p.id}>
            {p.name}
            {p.grade && ` ${p.grade}`}
            {pending.has(p.id) && " (pending)"}{" "}
            <button
              type="button"
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
