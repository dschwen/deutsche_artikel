import { test, expect } from "@playwright/test";
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
}
async function run(page, fn) {
  return page.evaluate(fn);
}
test("actual browser scheduler, reload recovery, feedback and no duplicate grading", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "Start studying" }).click();
  await expect(page.locator("#noun")).toHaveText("Jahr");
  await page.reload();
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").click();
  await expect(page.locator("#noun")).toHaveText("Jahr");
  await page.locator("input[value=das]").check();
  await page.locator("#check").click();
  await expect(page.locator("#feedback")).toHaveText("das JahrCorrect.");
  const data = await run(page, async () => {
    const s = await import("/js/storage.js");
    const db = await s.openStorage();
    const data = await s.exportProgress(db);
    db.close();
    return data;
  });
  expect(data.reviews).toHaveLength(1);
  expect(data.presentations).toHaveLength(1);
  expect(data.cards.find((c) => c.reviewCount)).toMatchObject({
    correctCount: 1,
    presentationCount: 1,
    phase: "learning",
  });
  await page.locator("#next").click();
  await expect(page.locator("#noun")).toHaveText("Mal");
  await page.locator("#reveal").click();
  await expect(page.locator("#feedback")).toContainText("Answer revealed.");
  expect(errors).toEqual([]);
});
test("concurrent tabs and retries commit one exposure and one answer", async ({
  page,
  context,
}) => {
  await ready(page);
  const second = await context.newPage();
  await ready(second);
  const present = (p) =>
    run(p, async () => {
      const s = await import("/js/storage.js");
      const { loadCatalog } = await import("/js/catalog.js");
      const db = await s.openStorage();
      const p = await s.presentNext(db, await loadCatalog());
      db.close();
      return p;
    });
  const [a, b] = await Promise.all([present(page), present(second)]);
  expect(a.id).toBe(b.id);
  const grade = (p) =>
    p.evaluate(async (id) => {
      const s = await import("/js/storage.js");
      const { loadCatalog } = await import("/js/catalog.js");
      const db = await s.openStorage();
      const r = await s.grade(db, await loadCatalog(), id, "das");
      db.close();
      return r;
    }, a.id);
  const [r1, r2] = await Promise.all([grade(page), grade(second)]);
  expect(r1).toEqual(r2);
  const counts = await run(page, async () => {
    const s = await import("/js/storage.js");
    const db = await s.openStorage();
    const d = await s.exportProgress(db);
    db.close();
    return [d.reviews.length, d.presentations.length];
  });
  expect(counts).toEqual([1, 1]);
});
test("daily introduction budget, skips, next day, and backwards clock", async ({
  page,
}) => {
  await ready(page);
  const result = await run(page, async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    const now = Date.now() + 1000;
    for (let i = 0; i < 10; i++) {
      const p = await s.presentNext(db, catalog, now + i);
      await s.skip(db, p.id, now + i);
    }
    const capped = await s.presentNext(db, catalog, now + 11);
    let backwards = false;
    try {
      await s.presentNext(db, catalog, now - 1000);
    } catch {
      backwards = true;
    }
    await s.newSession(db);
    const revisit = await s.presentNext(db, catalog, now + 12);
    await s.skip(db, revisit.id, now + 12);
    // A new study day must clear the previous day's skip exclusions.
    const tomorrow = await s.presentNext(db, catalog, now + 86400000);
    const data = await s.exportProgress(db);
    db.close();
    return {
      capped,
      backwards,
      revisit: !!revisit,
      tomorrow: !!tomorrow,
      reviews: data.reviews.length,
    };
  });
  expect(result).toEqual({
    capped: null,
    backwards: true,
    revisit: true,
    tomorrow: true,
    reviews: 0,
  });
});
test("backup round trip, malformed import preserves data, reconciliation invalidates changed facts", async ({
  page,
}) => {
  await ready(page);
  const result = await run(page, async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    const p = await s.presentNext(db, catalog);
    await s.grade(db, catalog, p.id, "das", true);
    const backup = JSON.parse(JSON.stringify(await s.exportProgress(db)));
    s.validateBackup(backup);
    await s.eraseProgress(db);
    await s.importProgress(db, backup, catalog);
    const restored = await s.exportProgress(db);
    const broken = structuredClone(backup);
    broken.cards[0].correctCount = 999;
    let rejected = false;
    try {
      await s.importProgress(db, broken, catalog);
    } catch {
      rejected = true;
    }
    const unchanged = await s.exportProgress(db);
    const open = await s.presentNext(db, catalog);
    const changed = structuredClone(catalog);
    changed.items.find((i) => i.id === open.wordId).contentRevision++;
    await s.reconcile(db, changed);
    const after = await s.exportProgress(db);
    db.close();
    return {
      restored: restored.reviews.length,
      guessed: restored.reviews[0].rating,
      rejected,
      unchanged:
        JSON.stringify(unchanged.cards) === JSON.stringify(restored.cards),
      invalidated: after.presentations.find((p) => p.id === open.id).status,
    };
  });
  expect(result).toEqual({
    restored: 1,
    guessed: 1,
    rejected: true,
    unchanged: true,
    invalidated: "invalidated",
  });
});
test("a transaction abort leaves no partial history and retry succeeds", async ({
  page,
}) => {
  await ready(page);
  const result = await run(page, async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    const p = await s.presentNext(db, catalog);
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, ...rest) {
      if (this.name === "reviews") {
        this.transaction.abort();
        throw new Error("injected abort");
      }
      return original.call(this, value, ...rest);
    };
    let failed = false;
    try {
      await s.grade(db, catalog, p.id, "das");
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.add = original;
    }
    const before = await s.exportProgress(db);
    await s.grade(db, catalog, p.id, "das");
    const after = await s.exportProgress(db);
    db.close();
    return {
      failed,
      before: before.reviews.length,
      open: before.presentations[0].status,
      after: after.reviews.length,
    };
  });
  expect(result).toEqual({ failed: true, before: 0, open: "open", after: 1 });
});
test("all accepted article variants are graded correctly", async ({ page }) => {
  await ready(page);
  const result = await run(page, async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    const item = catalog.items.find((i) => i.noun === "E-Mail");
    const restricted = { ...catalog, items: [{ ...item, order: 0 }] };
    await s.reconcile(db, restricted);
    const results = [];
    for (const article of item.acceptedArticles) {
      const p = await s.presentNext(
        db,
        restricted,
        Date.now() + results.length * 86400000,
      );
      const r = await s.grade(
        db,
        restricted,
        p.id,
        article,
        false,
        Date.now() + results.length * 86400000,
      );
      results.push(r.outcome);
    }
    db.close();
    return results;
  });
  expect(result).toEqual(["correct", "correct"]);
});
test("study day changes release skipped words even when the entire catalog was skipped", async ({
  page,
}) => {
  await ready(page);
  const result = await run(page, async () => {
    const s = await import("/js/storage.js");
    const { loadCatalog } = await import("/js/catalog.js");
    const db = await s.openStorage();
    const catalog = await loadCatalog();
    catalog.items = catalog.items.slice(0, 1);
    await s.reconcile(db, catalog);
    const now = Date.now() + 100;
    const first = await s.presentNext(db, catalog, now);
    await s.skip(db, first.id, now);
    const none = await s.presentNext(db, catalog, now + 1);
    const next = await s.presentNext(db, catalog, now + 86400000);
    db.close();
    return { none, sameWord: next?.wordId === first.wordId };
  });
  expect(result).toEqual({ none: null, sameWord: true });
});
test("storage denial is visible and disables studying", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#error")).toContainText("Storage access denied");
  await expect(page.locator("#start")).toBeDisabled();
});
test("mobile study flow fits the viewport and exposes accessible answer controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  await page.locator("#start").click();
  await page.getByRole("radio", { name: "das", exact: true }).check();
  await page.locator("#check").click();
  await expect(page.locator("#feedback")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-study.png",
    fullPage: true,
  });
});
test("progress survives closing and reopening a browser profile", async ({
  playwright,
}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  const options = {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: "chrome" }),
    args: ["--no-sandbox"],
  };
  let context = await playwright.chromium.launchPersistentContext(
    profile,
    options,
  );
  let page = await context.newPage();
  await page.goto("http://127.0.0.1:8000");
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").click();
  await page.locator("#reveal").click();
  await expect(page.locator("#feedback")).toBeVisible();
  await context.close();
  context = await playwright.chromium.launchPersistentContext(profile, options);
  page = await context.newPage();
  await page.goto("http://127.0.0.1:8000");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#totals")).toContainText("1 graded answers");
  await context.close();
});
test("database upgrades close the old connection and request a reload", async ({
  page,
}) => {
  await ready(page);
  await run(page, async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("deutsche-artikel", 2);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
  await expect(page.locator("#error")).toContainText("database changed");
  await expect(page.locator("#start")).toBeDisabled();
});
