import { test, expect } from "@playwright/test";
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
}
test("caught-up screen lets the learner add ten new words without reviewing early", async ({
  page,
}) => {
  await ready(page);
  // Grade the first allowance at one instant so none of its learning cards are due.
  await page.evaluate(async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const p = await s.presentNext(db, catalog, now);
      const item = catalog.items.find((i) => i.id === p.wordId);
      await s.grade(db, catalog, p.id, item.acceptedArticles[0], false, now);
    }
    db.close();
  });
  await page.locator("#start").click();
  await expect(page.locator("#finished")).toBeVisible();
  await page.screenshot({ path: "test-results/caught-up.png", fullPage: true });
  await expect(page.locator("#finished")).not.toContainText("Next review");
  await page
    .getByRole("button", { name: "Learn 10 more words", exact: true })
    .click();
  await expect(page.locator("#study")).toBeVisible();
  await expect(page.locator("#new-count")).toHaveText("9");
  await expect(page.locator("#noun")).toHaveText("Land");
  const saved = await page.evaluate(async () => {
    const s = await import("/js/storage.js");
    const db = await s.openStorage();
    const backup = await s.exportProgress(db);
    s.validateBackup(backup);
    db.close();
    return backup;
  });
  expect(saved.reviews).toHaveLength(10);
  expect(
    saved.meta.find((m) => m.key === "extraNewAllowance").value.count,
  ).toBe(10);
  const scheduled = saved.cards.find((c) => c.reviewCount > 0).dueAt;
  await page.reload();
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").click();
  await expect(page.locator("#noun")).toHaveText("Land");
  await expect(page.locator("#new-count")).toHaveText("9");
  const tomorrow = await page.evaluate(async () => {
    const s = await import("/js/storage.js");
    const db = await s.openStorage();
    const state = await s.getState(db, Date.now() + 86400000);
    db.close();
    return {
      remaining: state.summary.newRemaining,
      dueAt: state.cards.find((c) => c.reviewCount > 0).dueAt,
    };
  });
  expect(tomorrow.remaining).toBe(10);
  expect(tomorrow.dueAt).toBe(scheduled);
});
for (const size of [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
])
  test(`desktop study and feedback fit without scrolling at ${size.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await ready(page);
    await page.locator("#start").click();
    await page.locator("input[value=das]").check();
    await page.locator("#check").click();
    await expect(page.locator("#feedback")).toBeVisible();
    const layout = await page.evaluate(() => {
      const dashboard = document
        .querySelector(".dashboard")
        .getBoundingClientRect();
      const study = document.querySelector("#study").getBoundingClientRect();
      const next = document.querySelector("#next").getBoundingClientRect();
      return {
        sideBySide: dashboard.right < study.left,
        nextVisible: next.bottom <= innerHeight,
        scroll: document.documentElement.scrollHeight > innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout).toEqual({
      sideBySide: true,
      nextVisible: true,
      scroll: false,
      overflow: false,
    });
    await page.screenshot({
      path: `test-results/desktop-${size.width}.png`,
      fullPage: true,
    });
  });
test("mobile keeps the overview above the study card", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  await page.locator("#start").click();
  await expect(page.locator("#study")).toBeVisible();
  const stacked = await page.evaluate(
    () =>
      document.querySelector(".dashboard").getBoundingClientRect().bottom <=
      document.querySelector("#study").getBoundingClientRect().top,
  );
  expect(stacked).toBe(true);
});
test("extra introductions are atomic across tabs and survive a backup restore", async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const a = await s.openStorage();
    const b = await s.openStorage();
    const catalog = await loadCatalog();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const p = await s.presentNext(a, catalog, now);
      await s.skip(a, p.id, now);
    }
    await Promise.all([
      s.allowMoreNewWords(a, now),
      s.allowMoreNewWords(b, now),
    ]);
    const backup = await s.exportProgress(a);
    s.validateBackup(backup);
    await s.eraseProgress(a);
    await s.importProgress(a, backup, catalog);
    const restored = await s.getState(a, now);
    a.close();
    b.close();
    return {
      extra: restored.meta.find((m) => m.key === "extraNewAllowance").value
        .count,
      remaining: restored.summary.newRemaining,
    };
  });
  expect(result).toEqual({ extra: 10, remaining: 10 });
});
