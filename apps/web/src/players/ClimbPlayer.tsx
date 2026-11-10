import { GRADE_SCALES } from "@workout-app/engine";
import {
  ASCENT_STYLES,
  type Ascent,
  type AscentStyle,
  type ClimbDiscipline,
} from "@workout-app/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { Stepper } from "../components/Stepper";
import {
  formatRange,
  type ClimbTargets,
  type SessionView,
} from "../plan/sessions";
import { readSettings } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import {
  CLIMB_TAGS,
  editAscent,
  hardestSend,
  isSend,
  logAscent,
  pyramid,
  readClimbSession,
  removeAscent,
  startClimb,
  type AscentEntry,
  type ClimbSession,
  type ProjectView,
} from "./climb-log";
import { FinishSheet } from "./FinishSheet";
import { formatDuration } from "./run-log";

const HOLD_MS = 500;

const STYLE_LABELS: Record<AscentStyle, string> = {
  flash: "Flash",
  onsight: "Onsight",
  send: "Send",
  attempt: "Attempt",
};
const STYLE_OPTIONS = ASCENT_STYLES.map((style) => ({
  value: style,
  label: STYLE_LABELS[style],
}));
const TAG_OPTIONS = CLIMB_TAGS.map((tag) => ({ value: tag, label: tag }));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(ascent: Ascent, projects: readonly ProjectView[]): string {
  const project = projects.find((p) => p.project.id === ascent.projectId);
  return [
    ascent.grade,
    STYLE_LABELS[ascent.style],
    ascent.attempts > 1 && plural(ascent.attempts, "attempt"),
    ascent.tags.length > 0 && ascent.tags.join(", "),
    project?.project.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function PlannedClimb({ view }: { view: SessionView }) {
  if (view.items.length === 0) {
    return (
      <p className={`${card} text-fg-muted`}>
        Nothing is planned for this session yet.
      </p>
    );
  }
  return (
    <ul aria-label="Planned climb" className={`${card} flex flex-col gap-1`}>
      {view.items.map((item) => {
        const climb = item.targets as ClimbTargets;
        return (
          <li key={item.id} className="flex flex-col">
            <span className="font-medium tabular-nums">
              {climb.grades ? formatRange(climb.grades) : "Grades by feel"}
            </span>
            <span className="text-fg-muted tabular-nums">
              {[
                `${formatRange(climb.problems)} problems`,
                climb.maxHardAttempts !== null &&
                  `up to ${climb.maxHardAttempts} hard attempts`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Time since the session started, from its timestamp (§3.4). */
function SessionClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <p className="text-2xl font-semibold tabular-nums">
      <span className="sr-only">Session time </span>
      <span role="timer">{formatDuration(sec)}</span>
    </p>
  );
}

/** Tap to log a send; hold to open the sheet for flash, attempts and tags. */
function GradeChip({
  grade,
  onTap,
  onHold,
}: {
  grade: string;
  onTap: () => void;
  onHold: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className="min-h-tap min-w-tap touch-manipulation select-none rounded-full bg-surface-raised px-4 font-medium text-fg [-webkit-touch-callout:none] active:bg-climb active:text-bg"
      onPointerDown={() => {
        held.current = false;
        cancel();
        timer.current = setTimeout(() => {
          held.current = true;
          timer.current = null;
          onHold();
        }, HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onTap();
      }}
    >
      {grade}
    </button>
  );
}

type SheetState = { initial: AscentEntry; editing: Ascent | null };

function AscentSheet({
  state,
  discipline,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  state: SheetState;
  discipline: ClimbDiscipline;
  projects: readonly ProjectView[];
  onClose: () => void;
  onSave: (entry: AscentEntry) => Promise<void>;
  onDelete: (ascent: Ascent) => Promise<void>;
}) {
  const { initial, editing } = state;
  const nameId = useId();
  const [grade, setGrade] = useState(initial.grade);
  const [style, setStyle] = useState<AscentStyle>(initial.style);
  const [attempts, setAttempts] = useState(initial.attempts);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [project, setProject] = useState(initial.projectId ?? "none");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const firstTry = style === "flash" || style === "onsight";
  const projectOptions = [
    { value: "none", label: "None" },
    ...projects
      .filter(
        (p) =>
          p.project.status === "active" || p.project.id === initial.projectId,
      )
      .map((p) => ({
        value: p.project.id,
        label: `${p.project.name} (${p.project.grade})`,
      })),
    { value: "new", label: "New project" },
  ];
  const ready = project !== "new" || name.trim() !== "";

  async function run(action: () => Promise<void>) {
    setSaving(true);
    try {
      await action();
      syncSoon();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      title={editing ? `Edit ${editing.grade}` : "Log a climb"}
      open
      onOpenChange={(open) => !open && onClose()}
    >
      <ChipGroup
        type="single"
        label="Grade"
        modality="climb"
        options={GRADE_SCALES[discipline].map((g) => ({ value: g, label: g }))}
        value={grade}
        onValueChange={setGrade}
      />
      <ChipGroup
        type="single"
        label="Style"
        modality="climb"
        options={STYLE_OPTIONS}
        value={style}
        onValueChange={setStyle}
      />
      {!firstTry && (
        <Stepper
          label="Attempts"
          value={attempts}
          onValueChange={setAttempts}
          min={1}
          max={99}
        />
      )}
      <ChipGroup
        type="multiple"
        label="Tags"
        modality="climb"
        options={TAG_OPTIONS}
        value={tags}
        onValueChange={setTags}
      />
      <ChipGroup
        type="single"
        label="Project"
        modality="climb"
        options={projectOptions}
        value={project}
        onValueChange={setProject}
      />
      {project === "new" && (
        <>
          <label htmlFor={nameId} className="font-medium">
            Project name
          </label>
          <input
            id={nameId}
            className={`${input} min-h-tap`}
            placeholder="e.g. Blue roof traverse"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </>
      )}
      <button
        type="button"
        className={`${buttonBase} min-h-tap bg-climb text-bg`}
        disabled={saving || !ready}
        onClick={() =>
          void run(() =>
            onSave({
              grade,
              style,
              attempts: firstTry ? 1 : attempts,
              tags,
              projectId:
                project === "none" || project === "new" ? null : project,
              newProject: project === "new" ? name : undefined,
            }),
          )
        }
      >
        {editing ? "Save" : "Log climb"}
      </button>
      {editing && (
        <button
          type="button"
          className={`${button} min-h-tap`}
          disabled={saving}
          onClick={() => void run(() => onDelete(editing))}
        >
          Delete climb
        </button>
      )}
    </BottomSheet>
  );
}

function Pyramid({
  ascents,
  discipline,
}: {
  ascents: readonly Ascent[];
  discipline: ClimbDiscipline;
}) {
  const rows = pyramid(ascents, discipline);
  const most = Math.max(1, ...rows.map((r) => r.sends));
  const sends = ascents.filter((a) => isSend(a.style)).length;
  const tries = ascents.reduce((sum, a) => sum + a.attempts, 0);
  return (
    <section aria-label="Pyramid" className={`${card} flex flex-col gap-2`}>
      <h2 className="font-semibold">Pyramid</h2>
      {rows.length === 0 ? (
        <p className="text-fg-muted">Your sends show up here.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-1">
            {rows.map((row) => (
              <li
                key={row.grade}
                aria-label={`${row.grade}: ${plural(row.sends, "send")}`}
                className="flex items-center gap-2 tabular-nums"
              >
                <span className="w-12 shrink-0">{row.grade}</span>
                <span className="flex flex-1 justify-center">
                  <span
                    aria-hidden="true"
                    className="block h-4 rounded bg-climb"
                    style={{
                      width: row.sends ? `${(row.sends / most) * 100}%` : 0,
                    }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right">{row.sends}</span>
              </li>
            ))}
          </ol>
          <p className="text-fg-muted tabular-nums">
            {plural(sends, "send")} · {plural(tries, "attempt")} · hardest{" "}
            {rows[0]!.grade}
          </p>
        </>
      )}
    </section>
  );
}

function Projects({ projects }: { projects: readonly ProjectView[] }) {
  return (
    <section aria-label="Projects" className={`${card} flex flex-col gap-2`}>
      <h2 className="font-semibold">Projects</h2>
      {projects.length === 0 ? (
        <p className="text-fg-muted">
          No projects yet. Hold a grade to start one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map(({ project, attempts, sessions }) => (
            <li key={project.id} className="flex flex-col">
              <span className="font-medium">
                {project.name} · {project.grade}
                {project.status === "sent" && (
                  <span className="text-climb"> · Sent</span>
                )}
              </span>
              <span className="text-fg-muted tabular-nums">
                {plural(attempts, "attempt")} over {plural(sessions, "session")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AscentList({
  data,
  onEdit,
}: {
  data: ClimbSession;
  onEdit?: (ascent: Ascent) => void;
}) {
  if (data.ascents.length === 0) return null;
  return (
    <ol aria-label="This session" className="flex flex-col gap-1">
      {data.ascents.map((ascent) => {
        const text = describe(ascent, data.projects);
        return (
          <li key={ascent.id}>
            {onEdit ? (
              <button
                type="button"
                className="flex min-h-tap w-full items-center rounded-lg bg-surface-raised px-4 py-2 text-left font-medium text-fg tabular-nums active:opacity-80"
                onClick={() => onEdit(ascent)}
              >
                {text}
              </button>
            ) : (
              <span className="tabular-nums">{text}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ClimbLogger({
  view,
  data,
  discipline,
}: {
  view: SessionView;
  data: ClimbSession;
  discipline: ClimbDiscipline;
}) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [status, setStatus] = useState("");
  const planned = (view.items[0]?.targets as ClimbTargets | undefined)?.grades;
  const blank = (grade: string): AscentEntry => ({
    grade,
    style: "send",
    attempts: 1,
    tags: [],
    projectId: null,
  });

  async function log(entry: AscentEntry) {
    const settings = await readSettings();
    await logAscent(localDb, view, entry, settings);
    syncSoon();
    setStatus(
      `Logged ${entry.grade} ${STYLE_LABELS[entry.style].toLowerCase()}.`,
    );
  }

  async function start() {
    const settings = await readSettings();
    await startClimb(localDb, view, settings);
    syncSoon();
  }

  return (
    <>
      <section
        aria-label="Log climbs"
        className={`${card} flex flex-col gap-3`}
      >
        {data.log ? (
          <SessionClock startedAt={data.log.startedAt} />
        ) : (
          <button
            type="button"
            className={`${button} min-h-tap self-start`}
            onClick={() => void start()}
          >
            Start session
          </button>
        )}
        <p className="text-fg-muted">
          Tap a grade to log a send. Hold it for flash, attempts, tags or a
          project.
        </p>
        <div role="group" aria-label="Grades" className="flex flex-wrap gap-2">
          {GRADE_SCALES[discipline].map((grade) => (
            <GradeChip
              key={grade}
              grade={grade}
              onTap={() => void log(blank(grade))}
              onHold={() => setSheet({ initial: blank(grade), editing: null })}
            />
          ))}
        </div>
        <button
          type="button"
          className={`${button} min-h-tap self-start`}
          onClick={() =>
            setSheet({
              initial: blank(
                data.ascents.at(-1)?.grade ??
                  planned?.min ??
                  GRADE_SCALES[discipline][0]!,
              ),
              editing: null,
            })
          }
        >
          More options
        </button>
        <p role="status" className="text-fg-muted">
          {status}
        </p>
        <AscentList
          data={data}
          onEdit={(ascent) =>
            setSheet({
              initial: {
                grade: ascent.grade,
                style: ascent.style,
                attempts: ascent.attempts,
                tags: ascent.tags,
                projectId: ascent.projectId,
              },
              editing: ascent,
            })
          }
        />
        {data.ascents.length > 0 && (
          <FinishSheet view={view} title="Finish session" modality="climb" />
        )}
      </section>
      {sheet && (
        <AscentSheet
          state={sheet}
          discipline={discipline}
          projects={data.projects}
          onClose={() => setSheet(null)}
          onSave={(entry) =>
            sheet.editing
              ? editAscent(localDb, sheet.editing, entry)
              : log(entry)
          }
          onDelete={(ascent) => removeAscent(localDb, ascent)}
        />
      )}
    </>
  );
}

function ClimbFinished({
  data,
  discipline,
}: {
  data: ClimbSession;
  discipline: ClimbDiscipline;
}) {
  const log = data.log!;
  const sends = data.ascents.filter((a) => isSend(a.style)).length;
  const hardest = hardestSend(data.ascents, discipline);
  const minutes = Math.max(
    1,
    Math.round((log.endedAt! - log.startedAt) / 60_000),
  );
  const facts = [
    plural(sends, "send"),
    hardest && `hardest ${hardest}`,
    `${minutes} min`,
    log.rpe !== null && `RPE ${log.rpe}`,
  ].filter(Boolean);
  return (
    <section
      aria-label="Session finished"
      className={`${card} flex flex-col gap-2`}
    >
      <h2 className="text-xl font-semibold text-climb">Session finished</h2>
      <p className="tabular-nums">{facts.join(" · ")}</p>
      {log.notes && <p className="whitespace-pre-wrap">{log.notes}</p>}
      <AscentList data={data} />
      <Link to="/" className={`${button} min-h-tap self-start`}>
        Back to Today
      </Link>
    </section>
  );
}

/** Climb logging: grade chips, session clock, live pyramid, projects (§6.5). */
export function ClimbPlayer({ view }: { view: SessionView }) {
  const sessionId = view.session.id;
  const query = useCallback(
    () => readClimbSession(localDb, sessionId),
    [sessionId],
  );
  const data = useLiveQuery<ClimbSession | undefined>(query, undefined);
  const settings = useLiveQuery(readSettings, null);
  if (!data || !settings) return <section aria-label="Climb player" />;
  const discipline =
    (view.items[0]?.targets as ClimbTargets | undefined)?.discipline ??
    settings.onboarding?.climb?.discipline ??
    "boulder";
  return (
    <section aria-label="Climb player" className="flex flex-col gap-3">
      <PlannedClimb view={view} />
      {data.log?.endedAt != null ? (
        <ClimbFinished data={data} discipline={discipline} />
      ) : (
        <ClimbLogger view={view} data={data} discipline={discipline} />
      )}
      <Pyramid ascents={data.ascents} discipline={discipline} />
      <Projects projects={data.projects} />
    </section>
  );
}
