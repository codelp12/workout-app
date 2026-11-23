import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

// Both browser projects share one server, so each logs its own session.
// Each shares its day with a run, which the run test leaves open on that
// day, so Today's own test always has a session to start.
const sessions: Record<string, string> = {
  chromium: "Push A",
  webkit: "Push B",
};

test("a set logs in two taps and the player resumes after a kill", async ({
  page,
  context,
}, testInfo) => {
  const title = sessions[testInfo.project.name] ?? "Push A";
  await page.goto("/week?show=lift");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  // "Synced" shows mid-pull; the server's plan items arrive after the library.
  await expect(page.getByText("No exercises yet")).toHaveCount(0);

  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Open session" })
    .click();
  const overview = page.getByRole("region", { name: "Workout overview" });
  await expect(overview.getByRole("listitem").first()).toContainText(
    /\d+ × \d+/,
  );
  await expect(page.getByRole("region", { name: "Lift player" })).toHaveCount(
    0,
  );
  await context.setOffline(true);
  await overview.getByRole("button", { name: "Start workout" }).click();
  await expect(page.getByRole("region", { name: "Lift player" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${title}, .*In progress`) })
    .click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Resume session" })
    .click();
  const player = page.getByRole("region", { name: "Lift player" });
  const first = player.getByRole("article");
  const exercise = (await first
    .getByRole("heading", { level: 2 })
    .textContent())!;

  if (title === "Push A") {
    const bench = player.getByRole("article", { name: "Dumbbell Bench Press" });
    await bench.getByRole("button", { name: "Swap" }).click();
    const sheet = page.getByRole("dialog", { name: "Swap exercise" });
    await sheet.getByRole("searchbox").pressSequentially("bench");
    await expect(sheet.getByRole("list", { name: "Substitutes" })).toHaveCount(
      0,
    );
    await expect(
      sheet.getByRole("list", { name: "Exercises" }).getByRole("button", {
        name: "Barbell Bench Press - Medium Grip",
        exact: true,
      }),
    ).toBeInViewport();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
  }
  await first.getByRole("radio", { name: "2" }).click();
  await first.getByRole("button", { name: "Log set" }).click();
  await expect(
    first.getByRole("list", { name: "Sets" }).getByRole("listitem"),
  ).toHaveCount(1);
  const rest = player.getByRole("region", { name: "Rest timer" });
  await expect(rest.getByRole("timer")).toHaveText(/^\d:\d\d$/);
  await first.getByRole("button", { name: "Add set" }).click();
  const newSet = first.getByRole("region", { name: "Set 2" });
  await expect(newSet).toBeFocused();
  await expect(newSet.getByRole("heading")).toBeInViewport();
  await first.getByRole("button", { name: "Decrease Reps" }).click();
  const reps = await first
    .getByRole("spinbutton", { name: "Reps" })
    .getAttribute("aria-valuenow");
  await page.screenshot({
    path: testInfo.outputPath("lift-player-390x844.png"),
  });

  // Kill the app: close the page and open it again on Today, still offline.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  const resumed = reopened
    .getByRole("region", { name: "Lift player" })
    .getByRole("article", { name: exercise });
  await expect(resumed).toBeVisible();
  await expect(reopened).toHaveURL(/\/session\//);
  await expect(
    reopened.getByRole("region", { name: "Rest timer" }).getByRole("timer"),
  ).toBeVisible();
  await expect(
    resumed.getByRole("list", { name: "Sets" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    resumed.getByRole("spinbutton", { name: "Reps" }),
  ).toHaveAttribute("aria-valuenow", reps!);
});

test("a timed hold counts past the target and fills actual seconds", async ({
  page,
  context,
}, testInfo) => {
  const title = testInfo.project.name === "chromium" ? "Legs A" : "Legs B";
  await page.goto("/week?show=lift");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(page.getByText("No exercises yet")).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Open session" })
    .click();
  const overview = page.getByRole("region", { name: "Workout overview" });
  await expect(
    overview.getByRole("listitem").filter({ hasText: "Side Bridge" }),
  ).toContainText("2 × 20–30 s");
  await context.setOffline(true);
  await overview.getByRole("button", { name: "Start workout" }).click();
  const player = page.getByRole("region", { name: "Lift player" });
  const next = player.getByRole("button", { name: "Next", exact: true });
  for (let i = 0; i < (title === "Legs A" ? 4 : 2); i++) await next.click();
  const card = player.getByRole("article", { name: "Side Bridge" });
  await expect(card.getByText(/2 × 20–30 s/)).toBeVisible();
  await page.clock.install();
  await card.getByRole("button", { name: "Start hold" }).click();
  await page.clock.fastForward(45_000);
  await expect(card.getByRole("timer")).toHaveText("0:45");
  await card.getByRole("button", { name: "Stop hold" }).click();
  await expect(
    card.getByRole("spinbutton", { name: "Seconds" }),
  ).toHaveAttribute("aria-valuenow", "45");
});

type PullPage = {
  changes: {
    row: {
      id?: string;
      kind?: string;
      plannedSessionId?: string;
      opId?: string;
      endedAt?: number | null;
      rpe?: number | null;
      notes?: string | null;
    };
  }[];
  cursor: number;
  hasMore: boolean;
};

test("swaps and skips sync to the server", async ({ page }, testInfo) => {
  const title = sessions[testInfo.project.name] ?? "Push A";
  await page.goto("/week?show=lift");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(page.getByText("No exercises yet")).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: /^(Open|Resume) session$/ })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  const start = page.getByRole("button", { name: "Start workout" });
  const player = page.getByRole("region", { name: "Lift player" });
  await expect(start.or(player)).toBeVisible();
  if (await start.isVisible()) await start.click();
  const sessionId = new URL(page.url()).pathname.split("/").pop()!;
  const card = player.getByRole("article");

  // The first card belongs to the other test; swap the second, skip the third.
  await player.getByRole("button", { name: "Next", exact: true }).click();
  await expect(player.getByText("Exercise 2 of")).toBeVisible();
  await card.getByRole("button", { name: "Swap" }).click();
  const sheet = page.getByRole("dialog", { name: "Swap exercise" });
  const other = sheet
    .getByRole("list", { name: "Substitutes" })
    .getByRole("button", { pressed: false })
    .first();
  const swappedTo = (await other.locator("span").first().textContent())!;
  await other.click();
  await expect(sheet).toBeHidden();
  await expect(player.getByRole("article", { name: swappedTo })).toBeVisible();

  await player.getByRole("button", { name: "Next", exact: true }).click();
  await expect(player.getByText("Exercise 3 of")).toBeVisible();
  await card.getByRole("button", { name: "Skip" }).click();
  await expect(player.getByText("Exercise 4 of")).toBeVisible();
  await player.getByRole("button", { name: "Previous" }).click();
  await expect(card.getByText("Skipped.")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("lift-skipped-390x844.png"),
  });

  await expect
    .poll(async () => {
      const kinds: string[] = [];
      for (let since = 0, more = true; more;) {
        const res = await page.request.get(`/api/sync/pull?since=${since}`);
        const body = (await res.json()) as PullPage;
        for (const { row } of body.changes) {
          // Plan overrides only: planned items carry a `kind` too.
          if (row.plannedSessionId === sessionId && "opId" in row) {
            kinds.push(row.kind!);
          }
        }
        since = body.cursor;
        more = body.hasMore;
      }
      return kinds.sort();
    })
    .toEqual(["swap", "trim"]);
});

test("a finished session shows as done and syncs", async ({
  page,
  context,
}, testInfo) => {
  const title = sessions[testInfo.project.name] ?? "Push A";
  await page.goto("/week?show=lift");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(page.getByText("No exercises yet")).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: /^(Open|Resume) session$/ })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  const start = page.getByRole("button", { name: "Start workout" });
  const player = page.getByRole("region", { name: "Lift player" });
  await expect(start.or(player)).toBeVisible();
  if (await start.isVisible()) await start.click();
  const sessionId = new URL(page.url()).pathname.split("/").pop()!;
  const card = player.getByRole("article");
  // The first test may have logged this card's only row already.
  await card.getByRole("button", { name: "Add set" }).click();
  const row = card.getByRole("region", { name: /^Set \d+$/ }).last();
  await row.getByRole("radio", { name: "2" }).click();
  await row.getByRole("button", { name: "Log set" }).click();

  await player.getByRole("button", { name: "Finish workout" }).click();
  const sheet = page.getByRole("dialog", { name: "Finish workout" });
  await sheet.getByRole("radio", { name: "8" }).click();
  await sheet.getByLabel("Notes").fill("Heavy but good");
  await sheet.getByRole("button", { name: "Finish", exact: true }).click();
  const done = player.getByRole("region", { name: "Workout finished" });
  await expect(done).toBeVisible();
  await expect(done).toContainText("RPE 8");
  await page.screenshot({
    path: testInfo.outputPath("lift-finished-390x844.png"),
  });

  let logId: string | null = null;
  await expect
    .poll(async () => {
      for (let since = 0, more = true; more;) {
        const res = await page.request.get(`/api/sync/pull?since=${since}`);
        const body = (await res.json()) as PullPage;
        for (const { row } of body.changes) {
          if (row.plannedSessionId === sessionId && "endedAt" in row) {
            logId = row.id ?? null;
            return {
              finished: row.endedAt != null,
              rpe: row.rpe,
              notes: row.notes,
            };
          }
        }
        since = body.cursor;
        more = body.hasMore;
      }
      return null;
    })
    .toEqual({ finished: true, rpe: 8, notes: "Heavy but good" });

  // The Log reads from the device, so it works offline.
  await context.setOffline(true);
  await page.getByRole("link", { name: "Log", exact: true }).click();
  const entry = page.locator(`a[href="/log/${logId}"]`);
  await expect(entry).toContainText(title);
  await entry.click();
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("RPE 8");
  await expect(summary).toContainText("Heavy but good");
  await expect(page.getByRole("list", { name: "Sets" }).first()).toContainText(
    "Set 1",
  );
  await page.screenshot({
    path: testInfo.outputPath("lift-history-390x844.png"),
    fullPage: true,
  });

  await page.getByRole("link", { name: "Log", exact: true }).click();
  await page.getByRole("radio", { name: "Grid" }).click();
  const grid = page.getByRole("table", { name: "Lifting by week" });
  await expect(grid.getByRole("rowheader").first()).toBeVisible();
  await expect(grid).toContainText("Target");
  await expect(
    page.getByRole("table", { name: "Running by week" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("log-grid-390x844.png"),
    fullPage: true,
  });
  await context.setOffline(false);

  await page.goto("/week?show=lift");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${title}, .*Done`) }),
  ).toBeVisible();
});
