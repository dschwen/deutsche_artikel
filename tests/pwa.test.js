import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateWorker, ASSETS } from "../tools/build-pwa.mjs";
test("checked-in worker matches all current app assets", async () => {
  assert.equal(
    await readFile("sw.js", "utf8"),
    await generateWorker(),
    "Run npm run build to update the offline release.",
  );
  const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const icon of manifest.icons) assert(ASSETS.includes(icon.src));
});
