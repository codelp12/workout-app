import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

// Both browser projects share one server, so each moves its own session.
const sessions: Record<string, string> = {
  chromium: "Pull A",
  webkit: "Pull B",
};

async function signIn(page: Page) {
  await page.goto("/week");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  // "Synced" shows mid-pull; the server's plan items arrive after the library.
  await expect(page.getByText("No exercises yet")).toHaveCount(0);
}

const day = (page: Page, weekday: string) =>
  page.getByRole("listitem", { name: new RegExp(`^${weekday},`) });

test("Week filters by modality and a move syncs to another device", async ({
  page,
  browser,
}, testInfo) => {
  const title = sessions[testInfo.project.name] ?? "Pull A";
  await signIn(page);
  await expect(page.getByRole("button", { name: /, (AM|PM)/ })).toHaveCount(11);
  await page.screenshot({ path: testInfo.outputPath("week-390x844.png") });

  await page.getByRole("radio", { name: "Running" }).click();
  await expect(page).toHaveURL(/show=run/);
  await expect(page.getByRole("button", { name: /, (AM|PM)/ })).toHaveCount(3);
  await page.getByRole("radio", { name: "All" }).click();

  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await sheet.getByRole("radio", { name: /^Thu/ }).click();
  await sheet.getByRole("radio", { name: "PM" }).click();
  await page.screenshot({ path: testInfo.outputPath("week-move-390x844.png") });
  await sheet.getByRole("button", { name: "Move" }).click();
  const moved = day(page, "Thursday").getByRole("button", {
    name: `${title}, PM, moved`,
  });
  await expect(moved).toBeVisible();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");

  const other = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(page.url()).origin,
          localStorage: [
            { name: "workout-app:onboarding-offered", value: "1" },
          ],
        },
      ],
    },
  });
  const phone = await other.newPage();
  await signIn(phone);
  await expect(
    day(phone, "Thursday").getByRole("button", {
      name: `${title}, PM, moved`,
    }),
  ).toBeVisible();
  await other.close();
});

test("same-slot lifts combine offline after confirmation and appear once in history", async ({
  page,
  context,
}) => {
  await signIn(page);
  // Both projects share the same server and planned lifts.
  await context.setOffline(true);
  await page.getByRole("button", { name: /^Legs B, / }).click();
  const move = page.getByRole("dialog", { name: "Legs B" });
  await move.getByRole("radio", { name: /^Wed/ }).click();
  await move.getByRole("radio", { name: "PM" }).click();
  await move.getByRole("button", { name: "Move", exact: true }).click();

  await page.getByRole("button", { name: "Legs A, PM, can combine" }).click();
  await page.getByRole("button", { name: "Open session" }).click();
  await page.getByRole("button", { name: "Combine with Legs B" }).click();
  const confirmation = page.getByRole("dialog", { name: "Combine workouts?" });
  await expect(confirmation).toContainText("both planned lifts");
  await confirmation
    .getByRole("button", { name: "Combine workouts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Legs A + Legs B", exact: true }),
  ).toBeVisible();

  const player = page.getByRole("region", { name: "Lift player" });
  await player.getByRole("radio", { name: "2" }).click();
  await player.getByRole("button", { name: "Log set" }).click();
  await player.getByRole("button", { name: "Finish workout" }).click();
  const finish = page.getByRole("dialog", { name: "Finish workout" });
  await finish.getByRole("radio", { name: "8" }).click();
  await finish.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(
    player.getByRole("region", { name: "Workout finished" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Legs A + Legs B, PM, Done" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Legs B, / })).toHaveCount(0);
  await page.getByRole("link", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Legs A \+ Legs B/ }),
  ).toHaveCount(1);
});
