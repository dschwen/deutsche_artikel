import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { workerSource } from "./service-worker-source.mjs";
export const ASSETS = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/launch.js",
  "js/app.js",
  "js/pwa.js",
  "js/catalog.js",
  "js/queue.js",
  "js/scheduler.js",
  "js/storage.js",
  "data/catalog.json",
  "vendor/fsrs.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
export async function generateWorker() {
  const hash = createHash("sha256");
  hash.update(workerSource.toString());
  for (const asset of ASSETS) {
    hash.update(asset);
    hash.update(await readFile(asset));
  }
  return workerSource(hash.digest("hex").slice(0, 16), ASSETS);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile("sw.js", await generateWorker());
}
