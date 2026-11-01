import { expect, test, type Page } from "@playwright/test";

const tabs = [
  ["/", "Today"],
  ["/week", "Week"],
  ["/log", "Log"],
  ["/library", "Library"],
  ["/settings", "Settings"],
] as const;

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Tabs" });

async function expectTab(page: Page, title: string) {
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(tabBar(page).locator('[aria-current="page"]')).toHaveText(title);
}

test("deep links open the right tab", async ({ page }) => {
  for (const [path, title] of tabs) {
    await page.goto(path);
    await expectTab(page, title);
    await expect(page).toHaveTitle(`${title} · Workout`);
  }
});

test("every tab works offline, by tapping and by deep link", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);

  await context.setOffline(true);
  for (const [path, title] of tabs) {
    await tabBar(page).getByRole("link", { name: title }).click();
    await expectTab(page, title);
    await expect(page).toHaveURL(path);
  }

  // A cold load of a deep link comes from the service worker's app shell.
  await page.goto("/week");
  await expectTab(page, "Week");
  await page.screenshot({
    path: testInfo.outputPath("week-offline-390x844.png"),
  });
  await context.setOffline(false);
});

test("tabs are thumb-sized and stay on screen", async ({ page }) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  for (const [, title] of tabs) {
    const box = await tabBar(page)
      .getByRole("link", { name: title })
      .boundingBox();
    expect(box?.height, title).toBeGreaterThanOrEqual(48);
    expect(box && box.y + box.height, title).toBeLessThanOrEqual(
      viewport!.height,
    );
  }
});
