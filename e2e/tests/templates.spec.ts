import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../credentials";

type PullPage = {
  changes: {
    entity: string;
    row: { id: string; name?: string; slots?: { sets: number }[] };
  }[];
  cursor: number;
  hasMore: boolean;
};

async function serverTemplate(page: Page, name: string) {
  let found: PullPage["changes"][number]["row"] | undefined;
  for (let since = 0, more = true; more;) {
    const res = await page.request.get(`/api/sync/pull?since=${since}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as PullPage;
    for (const c of body.changes)
      if (c.entity === "template" && c.row.id === found?.id) found = c.row;
      else if (c.entity === "template" && c.row.name === name) found = c.row;
    since = body.cursor;
    more = body.hasMore;
  }
  return found;
}

test("default templates arrive on first sync and edits made offline sync", async ({
  page,
  context,
}, testInfo) => {
  // One template per browser, so parallel projects don't overwrite each other.
  const name = testInfo.project.name === "webkit" ? "Pull B" : "Push A";
  const chip = page.getByTestId("sync-chip");

  await page.goto("/settings");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(chip).toHaveText("Synced");

  const list = page.getByRole("list", { name: "Lifting templates" });
  await expect(list.getByRole("link")).toHaveCount(6);
  const before = (await serverTemplate(page, name))?.slots?.[0]?.sets ?? 0;

  await context.setOffline(true);
  await list.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: /^1\./ });
  await first.getByRole("button", { name: "Increase Sets" }).click();
  await expect(first.getByRole("spinbutton", { name: "Sets" })).toHaveValue(
    String(before + 1),
  );
  await expect(chip).toHaveText(/^Offline · \d+ pending$/);

  await page.reload();
  await expect(first.getByRole("spinbutton", { name: "Sets" })).toHaveValue(
    String(before + 1),
  );
  await page.screenshot({
    path: testInfo.outputPath("template-editor-390x844.png"),
  });

  await context.setOffline(false);
  await expect(chip).toHaveText("Synced");
  await expect
    .poll(async () => (await serverTemplate(page, name))?.slots?.[0]?.sets)
    .toBe(before + 1);
});
