import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: { row: { name?: string } }[];
  cursor: number;
  hasMore: boolean;
};

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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const projects = (page: Page) => page.getByRole("list", { name: "Projects" });

async function addProject(page: Page, name: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Grade").fill("V5");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(projects(page)).toContainText(`${name} V5`);
}

/** Server rows named `name`, read through the sync API (`page.request` shares the session cookie). */
async function serverRows(page: Page, name: string) {
  const rows: PullPage["changes"][number]["row"][] = [];
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const page_ = (await res.json()) as PullPage;
    rows.push(...page_.changes.map((c) => c.row));
    since = page_.cursor;
    more = page_.hasMore;
  }
  return rows.filter((r) => r.name === name);
}

test("a project added offline syncs exactly once after reconnecting", async ({
  page,
  context,
}, testInfo) => {
  const name = `Offline ${testInfo.project.name} ${Date.now()}`;
  const chip = page.getByTestId("sync-chip");

  await waitForServiceWorker(page);
  await signIn(page);
  await expect(chip).toHaveText("Synced");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await addProject(page, name);
  await expect(projects(page)).toContainText(`${name} V5 (pending)`);
  await expect(chip).toHaveText("Offline · 1 pending");

  await page.reload();
  await expect(chip).toHaveText("Offline · 1 pending");
  await expect(projects(page)).toContainText(`${name} V5 (pending)`);

  await page.screenshot({ path: testInfo.outputPath("offline-390x844.png") });

  await context.setOffline(false);
  await expect(chip).toHaveText("Synced");
  await expect(projects(page)).not.toContainText("(pending)");
  expect(await serverRows(page, name)).toHaveLength(1);

  await page.screenshot({ path: testInfo.outputPath("synced-390x844.png") });
});

test("writes made while signed out queue until sign-in", async ({
  page,
}, testInfo) => {
  const name = `Signed out ${testInfo.project.name} ${Date.now()}`;
  const chip = page.getByTestId("sync-chip");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const rejected = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sync/push") && r.request().method() === "POST",
  );
  await addProject(page, name);
  expect((await rejected).status()).toBe(401);
  await expect(projects(page)).toContainText(`${name} V5 (pending)`);
  await expect(chip).toHaveText("Sign in to sync · 1 pending");

  await page.reload();
  await expect(chip).toHaveText("Sign in to sync · 1 pending");
  await page.screenshot({ path: testInfo.outputPath("sign-in-390x844.png") });

  await signIn(page);
  await expect(chip).toHaveText("Synced");
  expect(await serverRows(page, name)).toHaveLength(1);
});

test("another device pulls new rows and deletes", async ({
  page,
  browser,
}, testInfo) => {
  const name = `Shared ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/");
  await signIn(page);

  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  await laptop.goto("/");
  await signIn(laptop);

  await addProject(page, name);
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");

  await laptop.getByTestId("sync-chip").click();
  await expect(projects(laptop)).toContainText(`${name} V5`);

  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await laptop.getByTestId("sync-chip").click();
  await expect(projects(laptop)).not.toContainText(name);
  await laptopContext.close();
});
