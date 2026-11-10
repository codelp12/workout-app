import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: { entity: string; row: { text?: string; screen?: string | null } }[];
  cursor: number;
  hasMore: boolean;
};

async function waitForServiceWorker(page: Page) {
  await page.goto("/week");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

/** Problem reports on the server with this text, read through the sync API. */
async function serverReports(page: Page, text: string) {
  const rows: PullPage["changes"][number]["row"][] = [];
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as PullPage;
    rows.push(
      ...body.changes
        .filter((c) => c.entity === "problem_report" && c.row.text === text)
        .map((c) => c.row),
    );
    since = body.cursor;
    more = body.hasMore;
  }
  return rows;
}

test("a problem reported offline reaches the server after reconnecting", async ({
  page,
  context,
}, testInfo) => {
  const text = `Timer glitch ${testInfo.project.name} ${Date.now()}`;

  await waitForServiceWorker(page);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("link", { name: /^Settings/ }).click();
  const section = page.getByRole("region", { name: "Report a problem" });
  await expect(section.getByText("/week", { exact: true })).toBeVisible();
  await section.getByLabel(/What went wrong/).fill(text);
  await section.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report saved", { exact: true })).toBeVisible();
  const reports = section.getByRole("list", { name: "Your reports" });
  await expect(
    reports.getByRole("listitem").filter({ hasText: text }),
  ).toContainText("Waiting to send");

  await context.setOffline(false);
  await page.getByTestId("sync-chip").click();
  await expect(
    reports.getByRole("listitem").filter({ hasText: text }),
  ).toContainText("Sent");
  await expect
    .poll(() => serverReports(page, text))
    .toEqual([expect.objectContaining({ screen: "/week" })]);
});
