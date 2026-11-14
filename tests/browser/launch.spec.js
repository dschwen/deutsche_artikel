import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("the old HTML Preview loader can execute the entry point and redirect to Pages", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source = await readFile("js/launch.js", "utf8");
  // Reproduce htmlpreview.js loadJS: inject source into an ordinary script.
  await page.route("https://htmlpreview.github.io/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body><script>const script = document.createElement('script'); script.textContent = ${JSON.stringify(source)}; document.body.appendChild(script);</script>`,
    }),
  );
  await page.route("https://dschwen.github.io/deutsche_artikel/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Trainer on Pages</h1>",
    }),
  );
  await page.goto(
    "https://htmlpreview.github.io/?https://github.com/dschwen/deutsche_artikel/blob/main/index.html",
  );
  await expect(page).toHaveURL("https://dschwen.github.io/deutsche_artikel/");
  await expect(page.getByRole("heading")).toHaveText("Trainer on Pages");
  expect(errors).toEqual([]);
});
