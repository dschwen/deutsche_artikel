import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  entryPoints: ["tools/scheduler-entry.js"],
  outfile: "vendor/fsrs.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await copyFile("node_modules/ts-fsrs/LICENSE", "vendor/ts-fsrs-LICENSE");
await copyFile(
  "node_modules/@open-spaced-repetition/srs-kit/LICENSE",
  "vendor/srs-kit-LICENSE",
);

const { generateWorker } = await import("./build-pwa.mjs");
const { writeFile } = await import("node:fs/promises");
await writeFile("sw.js", await generateWorker());
