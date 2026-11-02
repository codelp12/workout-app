import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: {
    entity: string;
    row: { equipment?: { bands: string[] }; liftFreeDay?: number | null };
  }[];
  cursor: number;
  hasMore: boolean;
};

async function waitForServiceWorker(page: Page) {
  await page.goto("/settings");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

async function serverSettings(page: Page) {
  let settings: PullPage["changes"][number]["row"] | undefined;
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as PullPage;
    settings =
      body.changes.findLast((c) => c.entity === "settings")?.row ?? settings;
    since = body.cursor;
    more = body.hasMore;
  }
  return settings;
}

test("settings changed offline persist and sync after reconnecting", async ({
  page,
  context,
}, testInfo) => {
  const band = `Band ${testInfo.project.name} ${Date.now()}`;
  const chip = page.getByTestId("sync-chip");

  await waitForServiceWorker(page);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

  await page.getByLabel("Band name").fill(band);
  await page.getByRole("button", { name: "Add band" }).click();
  const bands = page.getByRole("list", { name: "Bands" });
  await expect(bands).toContainText(band);
  await expect(chip).toHaveText(/^Offline · \d+ pending$/);

  await page.reload();
  await expect(bands).toContainText(band);

  await page.screenshot({
    path: testInfo.outputPath("settings-390x844.png"),
    fullPage: true,
  });

  await context.setOffline(false);
  await expect(chip).toHaveText("Synced");
  await expect
    .poll(async () => (await serverSettings(page))?.equipment?.bands)
    .toContain(band);
});
