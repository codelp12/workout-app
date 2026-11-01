import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PushResult = { opId: string; status: string };
type PullPage = {
  changes: { row: { name?: string } }[];
  cursor: number;
  hasMore: boolean;
};
type ExportFile = { format: string; ops: { opId: string }[] };

async function signIn(page: Page) {
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const projects = (page: Page) => page.getByRole("list", { name: "Projects" });
const warning = (page: Page) =>
  page.getByRole("status", { name: "Unsynced data" });

async function serverRows(page: Page, name: string) {
  const rows: PullPage["changes"][number]["row"][] = [];
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as PullPage;
    rows.push(...body.changes.map((c) => c.row));
    since = body.cursor;
    more = body.hasMore;
  }
  return rows.filter((r) => r.name === name);
}

test("unsynced data exports to a file that another device and the server can import", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const name = `Exported ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/");
  await signIn(page);
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(warning(page)).toBeHidden();

  // Block the API instead of going offline, so the page stays loaded.
  await context.route("**/api/sync/**", (route) => route.abort());
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Grade").fill("V2");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(warning(page)).toContainText("1 unsynced change");
  await page.screenshot({ path: testInfo.outputPath("unsynced-390x844.png") });

  const downloading = page.waitForEvent("download");
  await warning(page)
    .getByRole("button", { name: "Export unsynced data" })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^workout-app-unsynced-.*\.json$/,
  );
  const path = await download.path();
  const file = JSON.parse(await readFile(path, "utf8")) as ExportFile;
  expect(file.format).toBe("workout-app/unsynced");
  expect(file.ops).toHaveLength(1);

  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  await laptop.goto("/");
  await signIn(laptop);
  await laptop.getByLabel("Import unsynced data").setInputFiles(path);
  await expect(laptop.getByText("Imported 1 change.")).toBeVisible();
  await expect(projects(laptop)).toContainText(`${name} V2`);
  await expect(laptop.getByTestId("sync-chip")).toHaveText("Synced");
  expect(await serverRows(laptop, name)).toHaveLength(1);

  // The file's ops are a valid push body; the server has them all already.
  const res = await laptop.request.post("/api/sync/push", {
    data: { ops: file.ops },
  });
  expect(res.ok()).toBe(true);
  const { results } = (await res.json()) as { results: PushResult[] };
  expect(results.map((r) => r.status)).toEqual(["duplicate"]);
  await laptopContext.close();

  // The phone's own queued op then lands as a duplicate too.
  await context.unrouteAll();
  await page.getByTestId("sync-chip").click();
  await expect(page.getByTestId("sync-chip")).toHaveText("Synced");
  await expect(warning(page)).toBeHidden();
  expect(await serverRows(page, name)).toHaveLength(1);
});
