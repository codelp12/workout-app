import { GRADE_SCALES, gradeIndex } from "@workout-app/engine";
import {
  localDateAt,
  newId,
  sessionLogId,
  type Ascent,
  type AscentStyle,
  type ClimbDiscipline,
  type Project,
  type SessionLog,
  type Settings,
} from "@workout-app/shared";
import type { SessionView } from "../plan/sessions";
import type { LocalDb } from "../sync/local-db";
import { deleteRow, saveRow } from "../sync/writes";

/** Style tags offered when logging a climb (§5.3: slab, overhang, crimp …). */
export const CLIMB_TAGS = [
  "slab",
  "vertical",
  "overhang",
  "crimp",
  "sloper",
  "pinch",
  "dyno",
  "compression",
] as const;

export const isSend = (style: AscentStyle) => style !== "attempt";

/** A project with its attempts summed over every session. */
export type ProjectView = {
  project: Project;
  attempts: number;
  sessions: number;
};

export type ClimbSession = {
  log: SessionLog | null;
  /** This session's ascents, oldest first. */
  ascents: Ascent[];
  /** Active projects, plus any this session touched. */
  projects: ProjectView[];
};

export async function readClimbSession(
  db: LocalDb,
  sessionId: string,
): Promise<ClimbSession> {
  const found = await db.rows("session_log").get(sessionLogId(sessionId));
  const log = found && found.deletedAt === null ? found : null;
  const all = (await db.rows("ascent").toArray()).filter(
    (a) => a.deletedAt === null,
  );
  const ascents = log
    ? all
        .filter((a) => a.sessionLogId === log.id)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const touched = new Set(ascents.map((a) => a.projectId));
  const projects = (await db.rows("project").toArray())
    .filter(
      (p) =>
        p.deletedAt === null && (p.status === "active" || touched.has(p.id)),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((project) => {
      const on = all.filter((a) => a.projectId === project.id);
      return {
        project,
        attempts: on.reduce((sum, a) => sum + a.attempts, 0),
        sessions: new Set(on.map((a) => a.sessionLogId)).size,
      };
    });
  return { log, ascents, projects };
}

/** Sends per grade, hardest first, with empty grades in between (§6.5). */
export function pyramid(
  ascents: readonly Pick<Ascent, "grade" | "style">[],
  discipline: ClimbDiscipline,
): { grade: string; sends: number }[] {
  const counts = new Map<number, number>();
  for (const ascent of ascents) {
    if (!isSend(ascent.style)) continue;
    const index = gradeIndex(discipline, ascent.grade);
    if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const indices = [...counts.keys()];
  const scale = GRADE_SCALES[discipline];
  const rows = [];
  for (let i = Math.max(...indices); i >= Math.min(...indices); i--) {
    rows.push({ grade: scale[i]!, sends: counts.get(i) ?? 0 });
  }
  return rows;
}

export function hardestSend(
  ascents: readonly Pick<Ascent, "grade" | "style">[],
  discipline: ClimbDiscipline,
): string | null {
  return pyramid(ascents, discipline)[0]?.grade ?? null;
}

type ClimbSettings = Pick<Settings, "timezone">;

/** Starts the session clock, if it isn't running yet. */
export async function startClimb(
  db: LocalDb,
  view: SessionView,
  settings: ClimbSettings,
  now = Date.now(),
): Promise<string> {
  const id = sessionLogId(view.session.id);
  const existing = await db.rows("session_log").get(id);
  if (existing && existing.deletedAt === null) return id;
  await saveRow(
    db,
    "session_log",
    {
      id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      plannedSessionId: view.session.id,
      modality: "climb",
      startedAt: now,
      endedAt: null,
      localDate: localDateAt(settings.timezone, now),
      timezone: settings.timezone,
      rpe: null,
      notes: null,
    },
    now,
  );
  return id;
}

export type AscentEntry = {
  grade: string;
  style: AscentStyle;
  attempts: number;
  tags: string[];
  projectId: string | null;
  /** Name for a new project at this grade; wins over `projectId`. */
  newProject?: string;
};

/** Marks a project sent once a live send is logged on it, or active again. */
async function refreshProject(
  db: LocalDb,
  projectId: string | null,
  now: number,
): Promise<void> {
  if (!projectId) return;
  const project = await db.rows("project").get(projectId);
  if (!project || project.deletedAt !== null || project.status === "dropped") {
    return;
  }
  const sends = (await db.rows("ascent").toArray()).filter(
    (a) => a.deletedAt === null && a.projectId === projectId && isSend(a.style),
  );
  const sentAt = sends.length
    ? Math.min(...sends.map((a) => a.createdAt))
    : null;
  const status = sentAt === null ? "active" : "sent";
  if (status === project.status && sentAt === project.sentAt) return;
  await saveRow(
    db,
    "project",
    {
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: now,
      deletedAt: null,
      name: project.name,
      grade: project.grade,
      status,
      sentAt,
      notes: project.notes,
    },
    now,
  );
}

async function projectFor(
  db: LocalDb,
  entry: AscentEntry,
  now: number,
): Promise<string | null> {
  const name = entry.newProject?.trim();
  if (!name) return entry.projectId;
  const id = newId();
  await saveRow(
    db,
    "project",
    {
      id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      name,
      grade: entry.grade,
      status: "active",
      sentAt: null,
      notes: null,
    },
    now,
  );
  return id;
}

const attemptsOf = (entry: AscentEntry) =>
  entry.style === "flash" || entry.style === "onsight"
    ? 1
    : Math.max(1, Math.round(entry.attempts));

/** Logs one problem; starts the session if it hasn't started (§4 ascent). */
export async function logAscent(
  db: LocalDb,
  view: SessionView,
  entry: AscentEntry,
  settings: ClimbSettings,
  now = Date.now(),
): Promise<void> {
  const logId = await startClimb(db, view, settings, now);
  const projectId = await projectFor(db, entry, now);
  await saveRow(
    db,
    "ascent",
    {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      sessionLogId: logId,
      projectId,
      grade: entry.grade,
      style: entry.style,
      attempts: attemptsOf(entry),
      tags: entry.tags,
    },
    now,
  );
  await refreshProject(db, projectId, now);
}

export async function editAscent(
  db: LocalDb,
  ascent: Ascent,
  entry: AscentEntry,
  now = Date.now(),
): Promise<void> {
  const projectId = await projectFor(db, entry, now);
  await saveRow(
    db,
    "ascent",
    {
      id: ascent.id,
      createdAt: ascent.createdAt,
      updatedAt: now,
      deletedAt: null,
      sessionLogId: ascent.sessionLogId,
      projectId,
      grade: entry.grade,
      style: entry.style,
      attempts: attemptsOf(entry),
      tags: entry.tags,
    },
    now,
  );
  await refreshProject(db, ascent.projectId, now);
  if (projectId !== ascent.projectId) {
    await refreshProject(db, projectId, now);
  }
}

export async function removeAscent(
  db: LocalDb,
  ascent: Ascent,
  now = Date.now(),
): Promise<void> {
  await deleteRow(db, "ascent", ascent.id, now);
  await refreshProject(db, ascent.projectId, now);
}
