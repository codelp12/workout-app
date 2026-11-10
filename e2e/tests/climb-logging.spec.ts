import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: {
    row: {
      id: string;
      plannedSessionId?: string | null;
      sessionLogId?: string;
      endedAt?: number | null;
      rpe?: number | null;
      grade?: string;
      style?: string;
      attempts?: number;
      projectId?: string | null;
      name?: string;
      status?: string;
    };
  }[];
  cursor: number;
  hasMore: boolean;
};

// Both browser projects share one server, so each logs a different climb.
// Only Chromium finishes its session, which is never today's.
const climbIndex: Record<string, number> = { chromium: 0, webkit: 1 };

test("a climb session logs offline with a live pyramid and syncs", async ({
  page,
  context,
}, testInfo) => {
  const projectName = `Roof ${testInfo.project.name}`;
  await page.goto("/week?show=climb");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(page.getByText("No exercises yet")).toHaveCount(0);

  const climbName = /^(Limit climb|Volume climb), /;
  const days = page.getByRole("list", { name: "Days" });
  // Other days first: Today's own test needs today's sessions left open.
  const climbs = [
    ...(await days
      .locator('li:not([aria-current="date"])')
      .getByRole("button", { name: climbName })
      .all()),
    ...(await days
      .locator('li[aria-current="date"]')
      .getByRole("button", { name: climbName })
      .all()),
  ];
  const pick = climbs[climbIndex[testInfo.project.name] ?? 0]!;
  const title = (await pick.getAttribute("aria-label"))!.split(", ")[0]!;
  await pick.click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Open session" })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionId = new URL(page.url()).pathname.split("/").pop()!;
  const player = page.getByRole("region", { name: "Climb player" });
  const grades = player.getByRole("group", { name: "Grades" });
  const pyramid = player.getByRole("region", { name: "Pyramid" });
  await expect(grades).toBeVisible();

  await context.setOffline(true);
  await grades.getByRole("button", { name: "V2", exact: true }).click();
  await grades.getByRole("button", { name: "V3", exact: true }).click();
  await grades.getByRole("button", { name: "V3", exact: true }).click();
  await expect(player.getByRole("timer")).toBeVisible();
  await expect(
    pyramid.getByRole("listitem", { name: "V3: 2 sends" }),
  ).toBeVisible();
  await expect(
    pyramid.getByRole("listitem", { name: "V2: 1 send" }),
  ).toBeVisible();

  // Hold V5 for the sheet: three attempts on a new project.
  await grades.getByRole("button", { name: "V5", exact: true }).hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const sheet = page.getByRole("dialog", { name: "Log a climb" });
  await sheet.getByRole("radio", { name: "Attempt" }).click();
  await sheet.getByRole("button", { name: "Increase Attempts" }).click();
  await sheet.getByRole("button", { name: "Increase Attempts" }).click();
  await sheet.getByRole("radio", { name: "New project" }).click();
  await sheet.getByLabel("Project name").fill(projectName);
  await sheet.getByRole("button", { name: "Log climb" }).click();
  const projects = player.getByRole("region", { name: "Projects" });
  await expect(projects).toContainText(`${projectName} · V5`);
  await expect(pyramid).toContainText("3 sends · 6 attempts · hardest V3");
  await page.screenshot({
    path: testInfo.outputPath("climb-logging-390x844.png"),
    fullPage: true,
  });

  const finishes = testInfo.project.name === "chromium";
  if (finishes) {
    await player.getByRole("button", { name: "Finish session" }).click();
    const finish = page.getByRole("dialog", { name: "Finish session" });
    await finish.getByRole("radio", { name: "6" }).click();
    await finish.getByRole("button", { name: "Finish" }).click();
    const done = player.getByRole("region", { name: "Session finished" });
    await expect(done).toContainText("3 sends · hardest V3");
    await expect(done).toContainText("RPE 6");
    await page.screenshot({
      path: testInfo.outputPath("climb-finished-390x844.png"),
      fullPage: true,
    });
  }

  await context.setOffline(false);
  await expect
    .poll(async () => {
      let logId: string | null = null;
      let rpe: number | null | undefined = null;
      const ascents: PullPage["changes"][number]["row"][] = [];
      const projectRows = new Map<string, string>();
      for (let since = 0, more = true; more;) {
        const res = await page.request.get(`/api/sync/pull?since=${since}`);
        const body = (await res.json()) as PullPage;
        for (const { row } of body.changes) {
          if (row.plannedSessionId === sessionId && "endedAt" in row) {
            logId = !finishes || row.endedAt != null ? row.id : null;
            rpe = row.rpe;
          }
          if ("style" in row) ascents.push(row);
          if ("name" in row && "status" in row && row.name) {
            projectRows.set(row.id, row.name);
          }
        }
        since = body.cursor;
        more = body.hasMore;
      }
      const mine = ascents.filter((a) => a.sessionLogId === logId);
      return {
        rpe,
        ascents: mine
          .map(
            (a) =>
              `${a.grade} ${a.style} ${a.attempts}` +
              (a.projectId ? ` ${projectRows.get(a.projectId)}` : ""),
          )
          .sort(),
      };
    })
    .toEqual({
      rpe: finishes ? 6 : null,
      ascents: [
        "V2 send 1",
        "V3 send 1",
        "V3 send 1",
        `V5 attempt 3 ${projectName}`,
      ],
    });

  if (finishes) {
    await page.goto("/week?show=climb");
    await expect(
      page.getByRole("button", { name: new RegExp(`^${title}, .*Done`) }),
    ).toBeVisible();
  }
});
