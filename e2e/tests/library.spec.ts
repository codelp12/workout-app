import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

const MEDIA = "/media/exercises/";

async function waitForServiceWorker(page: Page) {
  await page.goto("/library");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

test("a fresh install gets the library on its first sync", async ({ page }) => {
  await page.goto("/library");
  await expect(
    page.getByText("downloads the first time you sync"),
  ).toBeVisible();

  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  // The pull arrives in pages, so the count climbs before it settles.
  const count = page.getByText(/exercises are on this device/);
  await expect
    .poll(async () => parseInt((await count.textContent()) ?? "0"))
    .toBeGreaterThan(800);
});

test("core images load in airplane mode", async ({ page, context }) => {
  await waitForServiceWorker(page);
  const precached = await page.evaluate(async (media) => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    return urls.filter((u) => u.startsWith(media));
  }, MEDIA);
  expect(precached.length).toBeGreaterThan(250);
  expect(precached).toContain(`${MEDIA}Pushups/0.webp`);

  await context.setOffline(true);
  await page.reload();
  const sizes = await page.evaluate(
    async (urls) => {
      const out: number[] = [];
      for (const src of urls) {
        const img = new Image();
        img.src = src;
        await img.decode();
        out.push(img.naturalWidth);
      }
      return out;
    },
    [`${MEDIA}Pushups/0.webp`, `${MEDIA}Adductor/1.webp`],
  );
  expect(sizes.every((w) => w > 0)).toBe(true);
  await context.setOffline(false);
});
