import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

// Both browser projects share one server, so each moves its own session.
const sessions: Record<string, string> = {
  chromium: "Push A",
  webkit: "Push B",
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
  const title = sessions[testInfo.project.name] ?? "Push A";
  await signIn(page);
  await expect(page.getByRole("button", { name: /, (AM|PM)/ })).toHaveCount(11);
  await page.screenshot({ path: testInfo.outputPath("week-390x844.png") });

  await page.getByRole("radio", { name: "Running" }).click();
  await expect(page).toHaveURL(/show=run/);
  await expect(page.getByRole("button", { name: /, (AM|PM)/ })).toHaveCount(3);
  await page.getByRole("radio", { name: "All" }).click();

  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await sheet.getByRole("radio", { name: /^Sat/ }).click();
  await sheet.getByRole("radio", { name: "PM" }).click();
  await page.screenshot({ path: testInfo.outputPath("week-move-390x844.png") });
  await sheet.getByRole("button", { name: "Move" }).click();
  const moved = day(page, "Saturday").getByRole("button", {
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
    day(phone, "Saturday").getByRole("button", {
      name: `${title}, PM, moved`,
    }),
  ).toBeVisible();
  await other.close();
});
