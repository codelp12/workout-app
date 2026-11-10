import "fake-indexeddb/auto";
import { newId, type PlannedSession } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../plan/sessions";
import { openLocalDb } from "../sync/local-db";
import {
  editAscent,
  hardestSend,
  logAscent,
  pyramid,
  readClimbSession,
  removeAscent,
  startClimb,
} from "./climb-log";

describe("pyramid", () => {
  it("counts sends per grade, hardest first, with gaps filled", () => {
    const rows = pyramid(
      [
        { grade: "V2", style: "send" },
        { grade: "V2", style: "flash" },
        { grade: "V5", style: "send" },
        { grade: "V6", style: "attempt" },
        { grade: "V3", style: "onsight" },
      ],
      "boulder",
    );
    expect(rows).toEqual([
      { grade: "V5", sends: 1 },
      { grade: "V4", sends: 0 },
      { grade: "V3", sends: 1 },
      { grade: "V2", sends: 2 },
    ]);
  });

  it("leaves out attempts and grades off the scale", () => {
    expect(
      pyramid(
        [
          { grade: "V7", style: "attempt" },
          { grade: "5.10a", style: "send" },
        ],
        "boulder",
      ),
    ).toEqual([]);
    expect(hardestSend([{ grade: "V7", style: "attempt" }], "boulder")).toBe(
      null,
    );
  });

  it("works on the route scale", () => {
    expect(
      hardestSend(
        [
          { grade: "5.10d", style: "send" },
          { grade: "5.11a", style: "send" },
          { grade: "5.9", style: "send" },
        ],
        "route",
      ),
    ).toBe("5.11a");
  });
});

describe("climb logging", () => {
  const db = openLocalDb("climb-log-test");
  const planned = (): PlannedSession => ({
    id: newId(),
    userId: 1,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    serverSeq: 1,
    weekId: null,
    date: "2026-11-10",
    slot: "pm",
    modality: "climb",
    workoutType: "limit",
    templateId: null,
    intent: "key",
    status: "planned",
    generatedBy: "engine@stub-1",
  });
  const settings = { timezone: "America/New_York" };
  const send = {
    grade: "V4",
    style: "send" as const,
    attempts: 1,
    tags: [],
    projectId: null,
  };

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("starts the session on the first climb and queues both rows", async () => {
    const view = { session: planned() } as SessionView;
    const now = Date.UTC(2026, 10, 10, 22);
    await logAscent(db, view, { ...send, tags: ["crimp"] }, settings, now);
    const { log, ascents } = await readClimbSession(db, view.session.id);
    expect(log).toMatchObject({
      modality: "climb",
      startedAt: now,
      endedAt: null,
      localDate: "2026-11-10",
      plannedSessionId: view.session.id,
    });
    expect(ascents).toHaveLength(1);
    expect(ascents[0]).toMatchObject({
      sessionLogId: log!.id,
      grade: "V4",
      style: "send",
      attempts: 1,
      tags: ["crimp"],
      projectId: null,
    });
    const ops = await db.outbox.toArray();
    expect(ops.map((op) => op.entity)).toEqual(["session_log", "ascent"]);
  });

  it("keeps the start time of a session already started", async () => {
    const view = { session: planned() } as SessionView;
    await startClimb(db, view, settings, 1000);
    await logAscent(db, view, send, settings, 5000);
    const { log } = await readClimbSession(db, view.session.id);
    expect(log!.startedAt).toBe(1000);
  });

  it("counts a flash or onsight as one attempt", async () => {
    const view = { session: planned() } as SessionView;
    await logAscent(
      db,
      view,
      { ...send, style: "flash", attempts: 4 },
      settings,
    );
    const { ascents } = await readClimbSession(db, view.session.id);
    expect(ascents[0]!.attempts).toBe(1);
  });

  it("carries a project's attempts across sessions until it's sent", async () => {
    const first = { session: planned() } as SessionView;
    await logAscent(
      db,
      first,
      {
        ...send,
        grade: "V6",
        style: "attempt",
        attempts: 3,
        newProject: " Roof ",
      },
      settings,
      1000,
    );
    let { projects } = await readClimbSession(db, first.session.id);
    expect(projects).toHaveLength(1);
    const project = projects[0]!.project;
    expect(project).toMatchObject({
      name: "Roof",
      grade: "V6",
      status: "active",
    });

    const second = { session: planned() } as SessionView;
    ({ projects } = await readClimbSession(db, second.session.id));
    expect(projects[0]).toMatchObject({ attempts: 3, sessions: 1 });

    await logAscent(
      db,
      second,
      { ...send, grade: "V6", attempts: 2, projectId: project.id },
      settings,
      2000,
    );
    ({ projects } = await readClimbSession(db, second.session.id));
    expect(projects[0]).toMatchObject({ attempts: 5, sessions: 2 });
    expect(projects[0]!.project).toMatchObject({
      status: "sent",
      sentAt: 2000,
    });

    // A sent project drops off the list of sessions that didn't touch it.
    const third = { session: planned() } as SessionView;
    ({ projects } = await readClimbSession(db, third.session.id));
    expect(projects).toEqual([]);
  });

  it("reopens a project when its send is undone", async () => {
    const view = { session: planned() } as SessionView;
    await logAscent(
      db,
      view,
      { ...send, style: "attempt", attempts: 2, newProject: "Arete" },
      settings,
      1000,
    );
    let data = await readClimbSession(db, view.session.id);
    const projectId = data.projects[0]!.project.id;
    await logAscent(db, view, { ...send, projectId }, settings, 2000);
    data = await readClimbSession(db, view.session.id);
    expect(data.projects[0]!.project.status).toBe("sent");

    await removeAscent(db, data.ascents[1]!, 3000);
    data = await readClimbSession(db, view.session.id);
    expect(data.ascents).toHaveLength(1);
    expect(data.projects[0]!.project).toMatchObject({
      status: "active",
      sentAt: null,
    });

    await editAscent(
      db,
      data.ascents[0]!,
      {
        ...send,
        style: "send",
        attempts: 2,
        projectId,
      },
      4000,
    );
    data = await readClimbSession(db, view.session.id);
    expect(data.projects[0]!.project).toMatchObject({
      status: "sent",
      sentAt: 1000,
    });
  });
});
