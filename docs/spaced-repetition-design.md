# Spaced repetition design

Status: implemented. See README.md for running, testing, and backup instructions.
The implementation pins ts-fsrs 6.0.0 with FSRS-7. Timezone changes and public
deployment configuration remain manual; no timezone-change UI is exposed.

## Goal and scope

Replace random rounds with a persistent, due-date-based study queue. Each vocabulary
item has its own learning state. Correct answers generally increase the interval;
failures bring the item back for relearning. Closing the page must preserve both
completed reviews and the current unanswered question.

Keep the app static, with no account or backend. IndexedDB stores progress for one
learner in the current browser. Cross-device synchronization, automatic parameter training, and a visual redesign
are separate projects. Offline asset caching and installation were subsequently
added with a manifest and versioned service worker; see README.md.

## Findings in this repository

- `index.html` contains the entire application. `pickRandomQuestions()` shuffles
  the full vocabulary and takes ten entries; no progress is stored.
- `checkAnswers()` reveals even unanswered items. Choices remain editable, and
  `resetChoices()` permits answering again after seeing the solution. These paths
  must not generate repeated successful reviews.
- `daten.tsv` contains 1,781 nonempty rows, including two duplicate German entries
  and 14 rows with slash-separated articles. Comparing a selection with the whole
  article string makes those 14 rows impossible to answer correctly today.
- Some duplicate rows have conflicting translations, such as `der Start`. Audit
  these before assigning permanent item identities; merging strings alone would
  conceal possible vocabulary errors.
- The README uses an HTML preview host. A durable deployment origin is needed so
  a hosting change does not appear to erase progress.

## 1. Scheduler choice

Use FSRS through the maintained `ts-fsrs` library, behind a small application
adapter. Do not implement memory equations locally or use lifetime accuracy as
the interval calculation. FSRS models memory difficulty and stability and uses
elapsed time when scheduling reviews. The library supplies scheduling and
learning-step policies; the app supplies grading, persistence, and queue selection.
See the [official library documentation](https://open-spaced-repetition.github.io/ts-fsrs/).

Initial policy:

| Setting | Decision |
| --- | --- |
| Memory model | FSRS-7, explicitly selected |
| Desired retention | 0.90, an initial scheduling target rather than a guarantee |
| Weights | Library defaults for the selected model; no personal optimization yet |
| Learning / relearning steps | 1 minute, then 10 minutes; graduate after successful completion |
| Maximum review interval | 365 days initially |
| Interval fuzz | Disabled initially for reproducible scheduling |
| New items | 10 distinct first presentations per study day by default; the learner can explicitly add another set of up to 10 |

Pin the exact library release and configuration in the implementation. Produce a
browser-compatible local ESM bundle, including its license, so serving the app
does not require a runtime CDN or Node.js. Verify the chosen release and its
learning-step configuration in a browser before integrating the UI. Library
versions and FSRS model versions are separate; never silently change either.

The adapter contract is deliberately independent of the library's field names:

```js
createCard({ nowMs, cardId, config })
reviewCard({ storedCard, rating, nowMs, config })
// => { nextStoredCard, dueAt, phase, schedulerLog }
```

Persist the full library card, including all memory and learning-step fields,
through a versioned serializer. Convert library dates to UTC epoch milliseconds
on storage and restore their types on read. Do not reconstruct the scheduler
card from the counters described below.

### Grading

- Correct `der`, `die`, or `das` choice: `Good`.
- Incorrect choice, “I don't know,” or requesting the solution: `Again`.
- An explicit “I guessed” choice on a correct answer: `Again`. This records the
  correct choice in statistics but does not claim successful recall.
- Skipping or leaving a question unanswered: no scheduler update.

Keep the three article choices; do not add Hard/Easy ratings initially. Never
infer Easy from response speed. Three-way recognition allows lucky guesses, so
the retention target describes this task, not guaranteed unaided article recall.
A future free-recall mode should have separate progress or an explicit migration.

## 2. Vocabulary identities and reconciliation

Introduce a checked-in catalog with explicit immutable IDs, generated initially
from `daten.tsv` and reviewed. Each item contains:

```js
{ id, noun, english, acceptedArticles: ["der"], order, contentRevision, active }
```

Use an opaque ID rather than a row number, translation, noun, or array index as
the persistence key. Keep different senses separate when they test different
facts. Merge true duplicates after auditing translations. Preserve catalog order
as an introduction order without claiming it is a verified frequency ranking.

Parse articles into a validated set containing only `der`, `die`, and `das`.
Where the supplied context permits several articles, accept any listed article
and explain the alternatives in feedback. If articles depend on meaning, split
the entry into contextualized senses. Audit plural-only entries such as `die
Leute` and describe the exercise as grammatical article selection, not exclusively
singular gender. Reject malformed rows with actionable diagnostics.

On catalog updates:

- Translation, spelling, or order edits retain the existing ID and progress if
  the tested fact is unchanged.
- New items receive new IDs. Removed items become inactive; retain their history
  but exclude them from queues.
- Changed accepted answers or changed meaning require an explicit content
  revision migration. Preserve old logs, reset the affected card's learning
  state, and invalidate any pending presentation of the old revision.
- Never reassign a retired ID to a different fact. Archive inactive progress in
  exports as well.

## 3. IndexedDB schema

Database: `deutsche-artikel`, schema version `1`. All timestamps are epoch
milliseconds; all IDs are strings. Null means an event has never occurred.

| Store / key | Fields and purpose | Indexes |
| --- | --- | --- |
| `cards` / `wordId` | `contentRevision`, `active`, `phase`, `dueAt`, `schedulerCard`, `schedulerConfigId`, `revision`, `firstPresentedAt`, `lastPresentedAt`, `lastReviewedAt`, `presentationCount`, `reviewCount`, `correctCount`, `incorrectCount`, `revealedCount`, `guessedCount`, `recallStreak` | `dueAt` |
| `presentations` / `id` | UUID, `wordId`, `contentRevision`, `cardRevision`, `sessionId`, `presentedAt`, `studyDay`, `isIntroduction`, `status` (`open`, `answered`, `skipped`, `invalidated`), `closedAt` | `wordId`, `studyDay`, `sessionId` |
| `reviews` / `presentationId` | `wordId`, `answeredAt`, selected article or null, outcome (`correct`, `incorrect`, `revealed`), `guessed`, scheduler rating, scheduler log, pre/post scheduler card, `schedulerConfigId`, content snapshot/revision | `[wordId, answeredAt]`, `answeredAt` |
| `meta` / `key` | App settings, immutable scheduler configurations, catalog version, installation study timezone, current session/presentation pointer, last observed time | None |

Create `cards` records for the entire active catalog, including `new` items.
New cards have `dueAt: null` and no scheduler memory state until first grading;
IndexedDB date-range queries exclude null keys. Suspended/inactive cards are
filtered out after querying. This vocabulary is small enough to load card
summaries in memory; retain the index for efficient due queries.

Important counter definitions:

- Presentations count distinct exposures, including skipped questions. Resuming
  the same presentation after reload does not add another exposure.
- `lastPresentedAt` changes on exposure, independently of `lastReviewedAt`.
- Reviews count graded presentations only. `correctCount + incorrectCount +
  revealedCount === reviewCount`; guessed is a subset of correct outcomes.
- `recallStreak` increases only for correct, unguessed answers and resets on
  `Again`. Scheduler lapse counts retain their library-defined meaning.
- Unanswered exposures do not change the interval, recall streak, or review count.

History is authoritative evidence of what happened; card summaries support fast
display. Keep configuration snapshots and pre/post scheduler state so upgrades
and discrepancies can be investigated without reinterpreting old answers.

## 4. Queue selection and study-day rules

Replace ten simultaneously visible questions with one question at a time. Keep
ten graded answers as an optional session goal, never a limit on due reviews.
Select again after each committed answer rather than freezing a random batch.

For a single captured `nowMs`, select in this order:

1. Resume the existing open presentation, if still valid.
2. Due learning/relearning cards, earliest `dueAt` first.
3. Due review cards, earliest `dueAt` first (oldest overdue first).
4. A previously exposed but ungraded new card, then a never-presented card in
   catalog order, subject to the introduction budget for never-presented cards.

Resolve ties with stable word IDs. Never select an inactive or suspended item.
Do not fill a short session with reviews whose due date is still in the future.
If nothing is eligible, show “Caught up” and the next due time. Timers are only
wake-up hints: re-query on timer firing, tab focus, visibility changes, and reload.

Count the new-item budget when the first presentation is saved, so skipping,
reloading, or opening another tab cannot introduce unlimited words. Compute it
from `presentations.isIntroduction` and the stored `studyDay`; no separate daily
counter is required. Previously exposed new items can be revisited without
consuming another introduction. Skips are excluded for the remainder of the
current session; if only skipped eligible items remain, show a session end state
with an explicit option to revisit them. Preserve this exclusion on reload.

A study day is the calendar date in the installation's saved IANA timezone,
defaulting to the browser timezone at setup. Travel does not silently reset the
budget. Store the timezone used in exports; timezone changes apply at the next
study-day boundary. Due dates themselves remain UTC instants and are compared
with `dueAt <= nowMs`; do not round intervals to local midnight. Returning after
a long absence schedules from the actual review time, through the scheduler.

Use an injectable clock. If the wall clock goes backwards relative to persisted
activity, pause grading with a clock correction message rather than supplying
negative elapsed time. Do not silently normalize implausible clock changes;
there is no trusted server clock in this design.

## 5. Presentation and grading transactions

Persist an exposure before enabling its answer controls. A presentation means
the app committed to showing that question; a crash between commit and paint is
resumed as the same presentation. This is the practical boundary, since browser
painting and a database transaction cannot commit atomically.

**Present:** in one read/write transaction over `cards`, `presentations`, and
`meta`, check for an existing open presentation, recheck eligibility and the daily
budget, create the presentation, update exposure fields, and save the current
pointer. Only one open presentation exists globally for this installation.
Multiple tabs resume the same question.

**Grade:** disable controls immediately and run one read/write transaction over
`cards`, `presentations`, `reviews`, and `meta`:

1. If a review already exists for this presentation, return it without updates.
2. Require an open presentation with matching content and card revisions. Reject
   stale answers and refresh the displayed question.
3. Grade against the current matching catalog revision. Call the synchronous
   scheduler adapter with the persisted card and one captured answer timestamp.
4. Add the immutable review, update the scheduler state and counters, increment
   card revision, close the presentation, and clear the current pointer.
5. Show saved feedback only after transaction completion. On abort, preserve the
   chosen answer and presentation ID for an idempotent retry; do not advance.

Skipping closes the presentation without inserting a review or changing its
schedule, and records the session exclusion. Disallow “Reset choices” after a
grade. Before submission, editing the selection is harmless. “Next” advances
only after feedback; a learning card may return later when its step becomes due.

IndexedDB transactions provide the shared serialization boundary across tabs;
the revision check ensures a stale tab cannot grade an already changed card.
Use `BroadcastChannel` as an optional refresh notification, with focus-based
refresh as fallback. It is not the correctness mechanism.

Keep fetches, library initialization, and other unrelated asynchronous work out
of open transactions. A request succeeding is insufficient: use the transaction
`complete` event as the save boundary, as described in
[MDN's transaction documentation](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).

## 6. User-facing behavior and storage lifecycle

Show due reviews, due learning items, and remaining new-item allowance before
starting. During study show the noun/context, three choices, “I guessed,” “I don't
know,” and Skip. Feedback shows the full article plus noun, accepted variants,
and next scheduled review. Expose lifetime counts in a small progress view;
distinguish recognition accuracy from the scheduler's memory estimate.

Open IndexedDB and load/validate the catalog before enabling study. Use
`onupgradeneeded` for schema changes; close connections on `versionchange` and
show an actionable message if an upgrade is blocked. Never delete progress as
an automatic recovery strategy. Unsupported storage, quota failures, or denied
access stop saved study with a retry option. A temporary practice mode can be a
later explicit feature; do not silently pretend progress was saved.

Provide versioned JSON export/import and an explicitly confirmed “Erase progress”
action. Export all stores and catalog/configuration identifiers from one consistent
readonly snapshot. The first importer supports replacement only: fully validate
format, schema, IDs, dates, counters, scheduler payloads, and configuration
compatibility before an atomic replacement. Reject unsupported versions without
touching existing data. Do not introduce history-merging semantics in version 1.

Use a stable HTTPS origin (for example, the repository's GitHub Pages deployment)
and update README instructions during implementation. Progress is local to the
origin, browser profile, and device; a preview host and production host have
separate storage. Browser storage may be cleared or evicted. Offer a supported
persistent-storage request and backups, without promising permanent retention.
See [MDN's storage lifecycle documentation](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## 7. Implementation structure and sequence

Keep native browser modules and static hosting:

```text
index.html                 UI shell and styles
js/app.js                  initialization and UI state machine
js/catalog.js              vocabulary validation and reconciliation
js/scheduler.js            pinned FSRS adapter and serializer
js/storage.js              IndexedDB schema and atomic operations
js/queue.js                pure eligibility and ordering functions
data/catalog.json          audited vocabulary with permanent IDs
vendor/                    browser scheduler bundle and license
tests/                     scheduler/queue units and browser persistence tests
```

1. Audit vocabulary, assign IDs, and test parsing/accepted variants.
2. Pin and browser-test FSRS; implement serializer and deterministic adapter tests.
3. Implement schema, presentation/grade transactions, reload recovery, and export/
   import before wiring answer buttons to persistence.
4. Implement due queue and introduction limits with an injected clock.
5. Replace random rounds and batch checking with the study state machine; add
   counts, feedback, storage errors, and accessible keyboard/focus handling.
6. Verify browser behavior, establish a stable deployment URL, and document backup
   and local-data limits. No historical migration is necessary: the current app
   does not store progress.

## 8. Acceptance criteria

- A correct, unguessed answer and a failure produce the pinned scheduler's
  expected states/due times, including learning and relearning transitions.
- Reloading restores the unanswered item without another presentation count;
  completed reviews, schedules, and counters survive closing/reopening the browser.
- Double-clicks, retries, and two tabs answering the same question commit exactly
  one review. A stale catalog/card revision cannot be graded.
- A simulated transaction failure commits neither history nor summary changes;
  retrying the same presentation commits once.
- Revealing records `Again`; skipping never increments graded counts. Editing or
  revisiting a revealed answer cannot earn an extra `Good`.
- Review selection respects due boundaries, learning priority, inactive cards,
  and deterministic ties. No eligible cards produces a caught-up screen.
- Ten first presentations exhaust the daily new budget across sessions and tabs;
  skips/reloads do not bypass it. Test the next day, DST, timezone policy, and
  a backwards clock using a controlled clock.
- Translation/order edits preserve progress; changed facts invalidate pending
  presentations; new and retired items reconcile without lost history.
- Both accepted variants work for audited multi-article entries. Duplicate and
  malformed catalog IDs fail validation.
- Export/import round-trips all progress. Invalid or incompatible imports leave
  existing data untouched. Schema upgrade blocking and storage denial are visible.

Use unit tests for queue/scheduler boundaries and real-browser integration tests
for IndexedDB commits, reloads, upgrades, and cross-tab races. An in-memory mock
alone cannot verify transaction lifetime and browser persistence behavior.
