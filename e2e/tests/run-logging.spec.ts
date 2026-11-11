import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: {
    row: {
      id: string;
      plannedSessionId?: string | null;
      sessionLogId?: string;
      endedAt?: number | null;
      distanceValue?: number | null;
      durationSec?: number | null;
      rpe?: number | null;
    };
  }[];
  cursor: number;
  hasMore: boolean;
};

// Both browser projects share one server, so each logs a different run.
const runIndex: Record<string, number> = { chromium: 0, webkit: 1 };

test("a run logs offline with its pace and syncs", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/week?show=run");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(page.getByText("No exercises yet")).toHaveCount(0);

  const runName = /^(Easy run|Threshold run|Intervals|Long run), /;
  const days = page.getByRole("list", { name: "Days" });
  // Other days first: Today's own test needs today's sessions left open.
  const runs = [
    ...(await days
      .locator('li:not([aria-current="date"])')
      .getByRole("button", { name: runName })
      .all()),
    ...(await days
      .locator('li[aria-current="date"]')
      .getByRole("button", { name: runName })
      .all()),
  ];
  const pick = runs[runIndex[testInfo.project.name] ?? 0]!;
  const title = (await pick.getAttribute("aria-label"))!.split(", ")[0]!;
  await pick.click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Open session" })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionId = new URL(page.url()).pathname.split("/").pop()!;
  const player = page.getByRole("region", { name: "Run player" });
  await expect(
    player.getByRole("list", { name: "Planned workout" }),
  ).toBeVisible();

  await context.setOffline(true);
  const form = player.getByRole("form", { name: "Log run" });
  await form.getByLabel("Distance (mi)").fill("3.1");
  await form.getByLabel("Minutes").fill("26");
  await form.getByLabel("Seconds").fill("21");
  await expect(form.getByText("Pace 8:30 /mi")).toBeVisible();
  await form.getByRole("radio", { name: "4" }).click();
  await page.screenshot({ path: testInfo.outputPath("run-form-390x844.png") });
  await form.getByRole("button", { name: "Save run" }).click();
  const logged = player.getByRole("region", { name: "Run logged" });
  await expect(logged).toContainText("3.1 mi · 26:21 · 8:30 /mi · RPE 4");
  await page.screenshot({
    path: testInfo.outputPath("run-logged-390x844.png"),
  });

  await context.setOffline(false);
  await expect
    .poll(async () => {
      let logId: string | null = null;
      const rows: PullPage["changes"][number]["row"][] = [];
      for (let since = 0, more = true; more;) {
        const res = await page.request.get(`/api/sync/pull?since=${since}`);
        const body = (await res.json()) as PullPage;
        for (const { row } of body.changes) {
          if (row.plannedSessionId === sessionId && "endedAt" in row) {
            logId = row.endedAt != null ? row.id : null;
          }
          if ("distanceValue" in row) rows.push(row);
        }
        since = body.cursor;
        more = body.hasMore;
      }
      const run = rows.find((r) => r.sessionLogId === logId);
      return (
        run && {
          distance: run.distanceValue,
          durationSec: run.durationSec,
          rpe: run.rpe,
        }
      );
    })
    .toEqual({ distance: 3.1, durationSec: 1581, rpe: 4 });

  await page.goto("/week?show=run");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${title}, .*Done`) }),
  ).toBeVisible();
});
