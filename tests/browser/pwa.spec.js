import { test, expect } from "@playwright/test";
async function readyOffline(page, path = "/") {
  await page.goto(path);
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#offline-status")).toContainText(
    "Ready for offline study",
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
}
for (const prefix of ["/", "/deutsche_artikel/"]) {
  test(`manifest and complete cold offline study work at ${prefix}`, async ({
    page,
    context,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await readyOffline(page, prefix);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    expect(new URL(manifest.url).pathname).toBe(
      `${prefix}manifest.webmanifest`,
    );
    const contents = JSON.parse(manifest.data);
    expect(contents.display).toBe("standalone");
    expect(contents.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(
      contents.icons.some(
        (i) => i.sizes === "512x512" && i.purpose === "maskable",
      ),
    ).toBe(true);
    const sizes = await page.evaluate(
      async (icons) =>
        Promise.all(
          icons.map(
            (icon) =>
              new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () =>
                  resolve(`${img.naturalWidth}x${img.naturalHeight}`);
                img.onerror = reject;
                img.src = icon.src;
              }),
          ),
        ),
      contents.icons,
    );
    expect(sizes).toEqual(contents.icons.map((i) => i.sizes));
    // A fresh page, not just a reload, must work without any network access.
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(prefix + "?installed=1");
    await expect(offline.locator("#start")).toBeEnabled();
    await expect(offline.locator("#offline-status")).toContainText("Offline —");
    await offline.locator("#start").click();
    await expect(offline.locator("#noun")).toHaveText("Jahr");
    await offline.locator("input[value=das]").check();
    await offline.locator("#check").click();
    await expect(offline.locator("#feedback")).toContainText("Correct!");
    await offline.reload();
    await expect(offline.locator("#start")).toBeEnabled();
    await expect(offline.locator("#totals")).toContainText("1 graded answers");
    await offline.locator("#start").click();
    await expect(offline.locator("#noun")).toHaveText("Mal");
    await offline.locator("#reveal").click();
    await expect(offline.locator("#feedback")).toContainText("Take a moment");
    expect(errors).toEqual([]);
  });
}
test("activation removes only old caches for this app scope", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await caches.open("another-app:keep");
    await caches.open(
      "deutsche-artikel:http://127.0.0.1:8000/deutsche_artikel/:old",
    );
  });
  await readyOffline(page, "/deutsche_artikel/");
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain("another-app:keep");
  expect(names).not.toContain(
    "deutsche-artikel:http://127.0.0.1:8000/deutsche_artikel/:old",
  );
  expect(
    names.filter((n) =>
      n.startsWith("deutsche-artikel:http://127.0.0.1:8000/deutsche_artikel/:"),
    ),
  ).toHaveLength(1);
});
test("failed updates retain offline access; complete updates wait for existing windows", async ({
  page,
  context,
  request,
}) => {
  await request.get("/__pwa_test_mode?mode=initial");
  await readyOffline(page, "/pwa-update/");
  await page.locator("#start").click();
  await page.locator("#reveal").click();
  await expect(page.locator("#feedback")).toBeVisible();
  await request.get("/__pwa_test_mode?mode=broken");
  const failed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const change = new Promise((resolve) =>
      registration.addEventListener(
        "updatefound",
        () => {
          const worker = registration.installing;
          worker.addEventListener("statechange", () => {
            if (worker.state === "redundant") resolve(true);
          });
        },
        { once: true },
      ),
    );
    await registration.update();
    return change;
  });
  expect(failed).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#totals")).toContainText("1 graded answers");
  await context.setOffline(false);
  await request.get("/__pwa_test_mode?mode=updated");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
      ),
    )
    .toBe(true);
  await expect(page.locator("#offline-status")).toContainText(
    "Update downloaded",
  );
  const versions = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { active: r.active.state, waiting: r.waiting.state };
  });
  expect(versions).toEqual({ active: "activated", waiting: "installed" });
  // Keep a reference to the newly installed worker, then release the old client.
  const workers = context.serviceWorkers();
  let waiting;
  for (const worker of workers) {
    if (
      await worker
        .evaluate(() => VERSION.startsWith("updated-"))
        .catch(() => false)
    )
      waiting = worker;
  }
  expect(waiting).toBeTruthy();
  const activated = waiting.evaluate(
    () =>
      new Promise((resolve) => {
        if (
          self.registration.active?.state === "activated" &&
          !self.registration.waiting
        )
          resolve();
        else self.addEventListener("activate", () => resolve(), { once: true });
      }),
  );
  await page.close();
  await activated;
  const reopened = await context.newPage();
  await readyOffline(reopened, "/pwa-update/");
  await expect(reopened.locator("#totals")).toContainText("1 graded answers");
  await context.setOffline(true);
  await reopened.reload();
  await expect(reopened.locator("#start")).toBeEnabled();
  const names = await reopened.evaluate(() => caches.keys());
  const own = names.filter((n) =>
    n.startsWith("deutsche-artikel:http://127.0.0.1:8000/pwa-update/:"),
  );
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("updated-");
});
test("Chrome reports no installability errors in a regular browser profile", async ({
  playwright,
}, testInfo) => {
  const context = await playwright.chromium.launchPersistentContext(
    testInfo.outputPath("install-profile"),
    {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: "chrome" }),
      args: ["--no-sandbox"],
    },
  );
  try {
    const page = await context.newPage();
    await readyOffline(page, "http://127.0.0.1:8000/deutsche_artikel/");
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
