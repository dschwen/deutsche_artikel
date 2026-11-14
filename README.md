# German Article Trainer

[Open the trainer](https://dschwen.github.io/deutsche_artikel/).

A static webapp for learning German articles with FSRS-7 spaced repetition.
It presents one word at a time, prioritizes due reviews, and introduces up to ten
new words per study day by default. Progress is stored in IndexedDB in the current browser. The app can be installed
and used offline after its first complete online visit.

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Serve the whole repository; opening `index.html` as a
`file://` URL does not support the module/data loading flow. No build or runtime
CDN is needed: the scheduler browser bundle is checked in under `vendor/`.

The public app is served by GitHub Pages from `main` / repository root. Use the
Pages link above consistently so your saved progress remains on the same origin.
The old HTML Preview link redirects there: HTML Preview runs module scripts as
classic scripts and cannot host this app's service worker.

## Install and use offline

Serve the app over HTTPS (or localhost for development). Open it once while
online and wait for **Ready for offline study**. The service worker caches the
entire app, scheduler, icons, and vocabulary. Subsequent launches and studying
work offline, including saving progress and exporting backups.

Use **Install app** when your browser offers it, the browser's install menu, or
**Share → Add to Home Screen** on iPhone/iPad. The manifest and service worker use
relative paths so the app also works under `/deutsche_artikel/` on GitHub Pages.
Installation availability depends on the browser and platform.

New versions download in the background. If an update is ready, close all
trainer tabs and installed-app windows, then reopen. Existing windows keep their
current release until closed, avoiding mixed scripts and vocabulary. Updates
replace only this app's asset caches; IndexedDB progress is preserved. Clearing
site data can remove both progress and offline files.

## Study and backups

Choose an article and check the answer, or use “I don’t know.” Correct, unguessed
answers count as remembered; incorrect answers, reveals, and correct guesses
schedule reinforcement. Skip leaves the schedule unchanged. Unanswered questions
resume after reload. New-word limits and skipped words persist across tabs;
a new study day starts a new session. When “You’re caught up” appears, use
**Learn 10 more words** to extend today's allowance. You can also revisit skipped
words or check for due reviews. Extra introductions do not bring future reviews
forward, and tomorrow’s allowance returns to ten. Due reviews resume automatically while the pause screen stays open.
Review schedules run in the background; individual repetition times are not shown. Learning steps are one and ten minutes;
longer intervals are calculated by FSRS at a 90% target retention.

The study timezone is fixed at first use, so travel does not reset your daily
budget. There is currently no timezone-change UI. Lifetime accuracy measures
article recognition, including lucky guesses, rather than unaided recall.

Use **Progress & backups** to export/import JSON, request persistent storage, or
erase progress. Import replaces existing progress after confirmation. Your data
stays on this device, browser profile, and origin (scheme, hostname, and port).
Clearing site data, private browsing, or changing addresses can lose or separate
progress. Export backups regularly. Cross-device synchronization is not included.

## Development and checks

Use Node.js 24 or newer for the scheduler's supported development environment.

```sh
npm ci
npm run build
npm test
npm run test:browser
```

Browser tests use installed Google Chrome by default. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another compatible Chromium executable.
They start a local HTTP server automatically. `npm run build` regenerates the
pinned local scheduler bundle, copies dependency licenses, and generates `sw.js`
with a content hash of all offline assets. **Run the build and commit `sw.js` after
any change to an app asset**, including vocabulary, HTML, scripts, styles, icons,
or the manifest. `npm test` checks that the offline release is current. The
service worker's source template and asset list live under `tools/`. Icons are
checked in; `python3 tools/create-icons.py` regenerates them with Pillow and the
DejaVu Sans Bold font.

Commit the bundle with scheduler changes; scheduler/model/configuration upgrades need an explicit
progress migration.

See [the design](docs/spaced-repetition-design.md) for the storage model and
transaction rules, and [catalog notes](data/README.md) for vocabulary maintenance.

On desktop, the overview and backup controls sit beside the study card to keep
answering and feedback in view. Mobile keeps the stacked layout.
