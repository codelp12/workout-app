import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("a fresh install walks through onboarding once", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByText("Step 1 of 4: Equipment")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await page
    .getByRole("button", { name: "I know my dumbbell split squat weight" })
    .click();
  await page
    .getByRole("button", { name: "Increase Dumbbell split squat weight" })
    .click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Add a recent run" }).click();
  await page.screenshot({
    path: testInfo.outputPath("onboarding-390x844.png"),
  });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "I climb" }).click();
  await page.getByRole("radio", { name: "V5" }).first().click();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Run setup again" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Dumbbell split squat weight" }),
  ).toHaveValue("30");
});

test("skipping doesn't ask again on this device", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL("/");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
});
