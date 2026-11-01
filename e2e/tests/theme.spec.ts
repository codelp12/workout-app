import { expect, test } from "@playwright/test";

test("the app is dark with thumb-sized tap targets", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      background: style.backgroundColor,
      numerals: style.fontVariantNumeric,
    };
  });
  expect(body.background).toBe("rgb(17, 24, 39)");
  expect(body.numerals).toBe("tabular-nums");

  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height, await button.innerText()).toBeGreaterThanOrEqual(48);
  }
  await page.screenshot({ path: "test-results/theme.png", fullPage: true });
});
