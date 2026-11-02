import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

const MEDIA = "/media/exercises/";

type PullPage = {
  changes: { entity: string; row: { name?: string; notes?: string | null } }[];
  cursor: number;
  hasMore: boolean;
};

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

const resultCount = (page: Page) => page.getByText(/^\d+ exercises?$/);

/** Signs in and waits until every page of the library has been pulled. */
async function syncLibrary(page: Page) {
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  // The pull arrives in pages, so the count climbs before it settles.
  await expect
    .poll(async () =>
      (await resultCount(page).count())
        ? parseInt((await resultCount(page).textContent()) ?? "0")
        : 0,
    )
    .toBeGreaterThan(800);
}

async function serverExercise(page: Page, name: string) {
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as PullPage;
    const hit = body.changes.find(
      (c) => c.entity === "exercise" && c.row.name === name,
    );
    if (hit) return hit.row;
    since = body.cursor;
    more = body.hasMore;
  }
}

const exerciseLink = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Exercises" })
    .getByRole("link")
    .filter({ has: page.getByText(name, { exact: true }) });

test("a fresh install gets the library on its first sync", async ({ page }) => {
  await page.goto("/library");
  await expect(
    page.getByText("downloads the first time you sync"),
  ).toBeVisible();
  await syncLibrary(page);
});

test("search, filters and exercise pages work offline", async ({
  page,
  context,
}) => {
  await waitForServiceWorker(page);
  await syncLibrary(page);
  await context.setOffline(true);
  await page.reload();

  const search = page.getByLabel("Search exercises");
  await search.fill("dumbbell bench");
  await expect(exerciseLink(page, "Dumbbell Bench Press")).toBeVisible();
  const unfiltered = parseInt((await resultCount(page).textContent())!);

  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("button", { name: "Chest", exact: true }).click();
  await sheet.getByRole("button", { name: "Dumbbell", exact: true }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Filters (2)" })).toBeVisible();
  await expect(exerciseLink(page, "Dumbbell Bench Press")).toBeVisible();
  expect(parseInt((await resultCount(page).textContent())!)).toBeLessThan(
    unfiltered,
  );

  await exerciseLink(page, "Dumbbell Bench Press").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Dumbbell Bench Press" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Instructions" }),
  ).toBeVisible();
  const photo = page.getByRole("img", {
    name: /Dumbbell Bench Press, photo 1/,
  });
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(search).toHaveValue("dumbbell bench");
  await expect(page.getByRole("button", { name: "Filters (2)" })).toBeVisible();
  await context.setOffline(false);
});

test("personal notes saved offline sync after reconnecting", async ({
  page,
  context,
}, testInfo) => {
  // One exercise per browser, so parallel projects don't overwrite each other.
  const name = testInfo.project.name === "webkit" ? "Plank" : "Pushups";
  const notes = `Notes from ${testInfo.project.name} ${Date.now()}`;
  await waitForServiceWorker(page);
  await syncLibrary(page);
  await context.setOffline(true);

  await page.getByLabel("Search exercises").fill(name);
  await exerciseLink(page, name).click();
  await page.getByLabel("Personal notes").fill(notes);
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();
  await expect(page.getByTestId("sync-chip")).toHaveText("Offline · 1 pending");

  await page.reload();
  await expect(page.getByLabel("Personal notes")).toHaveValue(notes);

  await context.setOffline(false);
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect
    .poll(async () => (await serverExercise(page, name))?.notes)
    .toBe(notes);
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
