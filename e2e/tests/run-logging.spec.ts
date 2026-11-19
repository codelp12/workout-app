import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: {
    row: {
      id: string;
      plannedSessionId?: string | null;
      sessionLogId?: string;
      endedAt?: number | null;
      checked?: string[];
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

test("a run and its stretches log offline and sync", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/week?show=run");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
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
  const warmup = player.getByRole("checkbox", {
    name: /Easy walking or jogging/,
  });
  await expect(warmup).toBeVisible();

  await context.setOffline(true);
  await warmup.click();
  await expect(warmup).toBeChecked();
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

  const stretches = player.getByRole("region", {
    name: "Post-session stretches",
  });
  const calf = stretches.getByRole("checkbox", {
    name: "Calf stretch 20–30 s per side",
  });
  await expect(calf).toBeVisible();
  await stretches.getByRole("button", { name: "How to: Calf stretch" }).click();
  const howTo = page.getByRole("dialog", { name: "Calf stretch" });
  await expect(howTo.getByText(/Stand facing a wall/)).toBeVisible();
  const photo = howTo.getByRole("img", { name: /photo 1 of/ });
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await howTo.getByRole("button", { name: "Close" }).click();
  await calf.click();
  await expect(stretches).toContainText("1 of 3");
  await stretches.getByRole("button", { name: "Hide stretches" }).click();
  await expect(calf).toBeHidden();
  await expect(logged).toBeVisible();
  await page.reload();
  await expect(calf).toBeChecked();
  await stretches.evaluate((panel) =>
    panel.scrollIntoView({ block: "center" }),
  );
  await page.screenshot({
    path: testInfo.outputPath("post-session-stretches-390x844.png"),
  });

  await context.setOffline(false);
  let logId: string | null = null;
  await expect
    .poll(async () => {
      const rows: PullPage["changes"][number]["row"][] = [];
      let checked: string[] | undefined;
      for (let since = 0, more = true; more;) {
        const res = await page.request.get(`/api/sync/pull?since=${since}`);
        const body = (await res.json()) as PullPage;
        for (const { row } of body.changes) {
          if (row.plannedSessionId === sessionId && "endedAt" in row) {
            logId = row.endedAt != null ? row.id : null;
            checked = row.checked;
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
          checked,
        }
      );
    })
    .toEqual({
      distance: 3.1,
      durationSec: 1581,
      rpe: 4,
      checked: ["easy-jog", "stretch-calf"],
    });

  // The Log reads from the device, so it works offline.
  await context.setOffline(true);
  await page.getByRole("link", { name: "Log", exact: true }).click();
  const entry = page.locator(`a[href="/log/${logId}"]`);
  await expect(entry).toContainText(title);
  await expect(entry).toContainText("3.1 mi · 26:21 · 8:30 /mi · RPE 4");
  await entry.click();
  await expect(
    page.getByRole("region", { name: "Run", exact: true }),
  ).toContainText("3.1 mi · 26:21 · 8:30 /mi · RPE 4");
  await page.screenshot({
    path: testInfo.outputPath("run-history-390x844.png"),
  });

  // Export reads the device too.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const exports = page.getByRole("region", { name: "Export" });
  const downloading = page.waitForEvent("download");
  await exports.getByRole("button", { name: "Runs (CSV)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^workout-app-runs-.*\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  // Which run was picked depends on the weekday, so match its type.
  const type = (
    {
      "Easy run": "easy",
      "Threshold run": "threshold",
      Intervals: "intervals",
      "Long run": "long",
    } as Record<string, string>
  )[title];
  expect(csv.split("\r\n").slice(1)).toContainEqual(
    expect.stringMatching(
      new RegExp(`^\\d{4}-\\d{2}-\\d{2},${type},3\\.1,mi,1581,`),
    ),
  );
  await context.setOffline(false);

  await page.goto("/week?show=run");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${title}, .*Done`) }),
  ).toBeVisible();
});
