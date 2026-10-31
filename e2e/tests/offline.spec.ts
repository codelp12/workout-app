import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

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

async function signIn(page: Page) {
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function writeNote(page: Page, body: string) {
  await page.getByLabel("Note").fill(body);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("local-notes")).toContainText(
    `${body} (pending)`,
  );
}

async function serverCopies(page: Page, body: string) {
  // page.request shares the page's session cookie.
  const res = await page.request.get("/api/spike");
  expect(res.ok()).toBe(true);
  const notes = (await res.json()) as { body: string }[];
  return notes.filter((n) => n.body === body).length;
}

test("a note written offline syncs exactly once after reconnecting", async ({
  page,
  context,
}, testInfo) => {
  const body = `Offline note ${testInfo.project.name} ${Date.now()}`;
  const pending = page.getByTestId("pending");

  await waitForServiceWorker(page);
  await signIn(page);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Offline spike" }),
  ).toBeVisible();

  await writeNote(page, body);
  await expect(pending).toHaveText("1 pending");

  await page.reload();
  await expect(pending).toHaveText("1 pending");

  await page.screenshot({ path: testInfo.outputPath("offline-390x844.png") });

  await context.setOffline(false);
  await expect(pending).toHaveText("0 pending");
  await expect(page.getByTestId("server-notes")).toContainText(body);
  expect(await serverCopies(page, body)).toBe(1);

  await page.screenshot({ path: testInfo.outputPath("synced-390x844.png") });
});

test("notes written while signed out queue until sign-in", async ({
  page,
}, testInfo) => {
  const body = `Signed-out note ${testInfo.project.name} ${Date.now()}`;
  const pending = page.getByTestId("pending");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await writeNote(page, body);
  const rejected = page.waitForResponse(
    (r) => r.url().endsWith("/api/spike") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sync now" }).click();
  expect((await rejected).status()).toBe(401);
  await expect(pending).toHaveText("1 pending");

  await page.reload();
  await expect(pending).toHaveText("1 pending");
  await page.screenshot({ path: testInfo.outputPath("sign-in-390x844.png") });

  await signIn(page);
  await expect(pending).toHaveText("0 pending");
  expect(await serverCopies(page, body)).toBe(1);
});
