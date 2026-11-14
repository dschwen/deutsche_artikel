# German Article Trainer

A static webapp for learning German articles with FSRS-7 spaced repetition.
It presents one word at a time, prioritizes due reviews, and introduces up to ten
new words per study day. Progress is stored in IndexedDB in the current browser.

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Serve the whole repository; opening `index.html` as a
`file://` URL does not support the module/data loading flow. No build or runtime
CDN is needed: the scheduler browser bundle is checked in under `vendor/`.

For a durable public address, enable GitHub Pages for this repository's main
branch/root and use that address consistently. The old HTML preview URL is no
longer the recommended launch method. Deployment settings have not been changed.

## Study and backups

Choose an article and check the answer, or use “I don’t know.” Correct, unguessed
answers count as remembered; incorrect answers, reveals, and correct guesses
schedule reinforcement. Skip leaves the schedule unchanged. Unanswered questions
resume after reload. New-word limits and skipped words persist across tabs;
a new study day starts a new session. Learning steps are one and ten minutes;
longer intervals are calculated by FSRS at a 90% target retention.

The study timezone is fixed at first use, so travel does not reset your daily
budget. There is currently no timezone-change UI. Lifetime accuracy measures
article recognition, including lucky guesses, rather than unaided recall.

Use **Progress & backups** to export/import JSON, request persistent storage, or
erase progress. Import replaces existing progress after confirmation. Your data
stays on this device, browser profile, and origin (scheme, hostname, and port).
Clearing site data, private browsing, or changing addresses can lose or separate
progress. Export backups regularly. No cross-device sync or offline asset cache
is included.

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
pinned local scheduler bundle and copies dependency licenses. Commit the bundle
with scheduler changes; scheduler/model/configuration upgrades need an explicit
progress migration.

See [the design](docs/spaced-repetition-design.md) for the storage model and
transaction rules, and [catalog notes](data/README.md) for vocabulary maintenance.
