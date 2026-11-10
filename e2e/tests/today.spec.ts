import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

const players = {
  Lifting: "Lift player",
  Running: "Run player",
  Climbing: "Climb player",
} as const;

test("Today works offline and Start opens the session's player", async ({
  page,
  context,
}, testInfo) => {
  const chip = page.getByTestId("sync-chip");
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(chip).toHaveText("Synced");
  // "Synced" shows mid-pull; the server's plan items arrive after the library.
  await expect(page.getByText("No exercises yet")).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("region", { name: "Coach note" })).toBeVisible();
  // The default week has a session every day.
  const start = page.getByRole("button", { name: /^Start / }).first();
  await expect(start).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("today-390x844.png") });

  const title = (await start.getAttribute("aria-label"))!.slice(
    "Start ".length,
  );
  const card = page.getByRole("listitem", { name: title, exact: true });
  const modality = (await card
    .getByText(/^(Lifting|Running|Climbing)$/)
    .textContent()) as keyof typeof players;

  await start.click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: players[modality] }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("player-390x844.png") });
});
