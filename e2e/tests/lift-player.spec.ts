import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

// Both browser projects share one server, so each logs its own session.
const sessions: Record<string, string> = {
  chromium: "Legs A",
  webkit: "Legs B",
};

test("a set logs in two taps and the player resumes after a kill", async ({
  page,
  context,
}, testInfo) => {
  const title = sessions[testInfo.project.name] ?? "Legs A";
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
  const player = page.getByRole("region", { name: "Lift player" });
  const first = player.getByRole("article");
  const exercise = (await first
    .getByRole("heading", { level: 2 })
    .textContent())!;

  await context.setOffline(true);
  await first.getByRole("radio", { name: "2" }).click();
  await first.getByRole("button", { name: "Log set" }).click();
  await expect(
    first.getByRole("list", { name: "Sets" }).getByRole("listitem"),
  ).toHaveCount(1);
  const rest = player.getByRole("region", { name: "Rest timer" });
  await expect(rest.getByRole("timer")).toHaveText(/^\d:\d\d$/);
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
