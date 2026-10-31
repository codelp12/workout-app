import { expect, test, type Page } from "@playwright/test";

async function waitForServiceWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load isn't controlled yet; a reload hands it to the worker.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

test("a note written offline syncs exactly once after reconnecting", async ({
  page,
  context,
  request,
}, testInfo) => {
  const body = `Offline note ${testInfo.project.name} ${Date.now()}`;
  const pending = page.getByTestId("pending");
  const local = page.getByTestId("local-notes");

  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Offline spike" }),
  ).toBeVisible();

  await page.getByLabel("Note").fill(body);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(local).toContainText(`${body} (pending)`);
  await expect(pending).toHaveText("1 pending");

  await page.reload();
  await expect(pending).toHaveText("1 pending");

  await page.screenshot({ path: testInfo.outputPath("offline-390x844.png") });

  await context.setOffline(false);
  await expect(pending).toHaveText("0 pending");
  await expect(page.getByTestId("server-notes")).toContainText(body);

  const res = await request.get("/api/spike");
  const notes = (await res.json()) as { body: string }[];
  expect(notes.filter((n) => n.body === body)).toHaveLength(1);

  await page.screenshot({ path: testInfo.outputPath("synced-390x844.png") });
});
