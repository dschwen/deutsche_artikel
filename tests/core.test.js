import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectCard, studyDay } from "../js/queue.js";
import { reviewCard, validateStoredCard } from "../js/scheduler.js";
import { validateCatalog } from "../js/catalog.js";
const now = Date.parse("2026-01-01T12:00:00Z");
test("catalog has unique permanent IDs and valid variants", () => {
  const catalog = validateCatalog(
    JSON.parse(readFileSync("data/catalog.json")),
  );
  assert.equal(catalog.items.length, 1779);
  assert.equal(catalog.items.filter((i) => i.noun === "Start").length, 1);
  assert.deepEqual(
    catalog.items.find((i) => i.noun === "Teil").acceptedArticles,
    ["der", "das"],
  );
  assert.throws(() =>
    validateCatalog({
      ...catalog,
      items: [catalog.items[0], catalog.items[0]],
    }),
  );
});
test("learning steps, graduation, lapse, and serialization retain memory", () => {
  const first = reviewCard({
    storedCard: null,
    rating: 1,
    nowMs: now,
    cardId: "test",
  });
  assert.equal(first.dueAt, now + 60000);
  assert.equal(first.phase, "learning");
  const good = reviewCard({
    storedCard: first.nextStoredCard,
    rating: 3,
    nowMs: first.dueAt,
    cardId: "test",
  });
  assert.equal(good.dueAt, first.dueAt + 600000);
  const graduate = reviewCard({
    storedCard: good.nextStoredCard,
    rating: 3,
    nowMs: good.dueAt,
    cardId: "test",
  });
  assert.equal(graduate.phase, "review");
  assert(graduate.dueAt > good.dueAt);
  const lapse = reviewCard({
    storedCard: graduate.nextStoredCard,
    rating: 1,
    nowMs: graduate.dueAt,
    cardId: "test",
  });
  assert.equal(lapse.phase, "relearning");
  assert.equal(lapse.dueAt, graduate.dueAt + 60000);
  validateStoredCard(JSON.parse(JSON.stringify(lapse.nextStoredCard)));
  assert.equal(lapse.nextStoredCard.lapses, 1);
  assert.deepEqual(
    first,
    reviewCard({ storedCard: null, rating: 1, nowMs: now, cardId: "test" }),
  );
});
test("queue prioritizes learning then oldest review, respects due boundary and cap", () => {
  const items = ["a", "b", "c", "d"].map((id, order) => ({ id, order }));
  const card = (wordId, phase, dueAt, presentationCount = 0) => ({
    wordId,
    phase,
    dueAt,
    presentationCount,
    active: true,
  });
  const cards = [
    card("a", "new", null),
    card("b", "review", now - 999),
    card("c", "learning", now),
    card("d", "review", now + 1),
  ];
  assert.equal(selectCard(cards, items, [], "s", "day", now).wordId, "c");
  cards[2].dueAt = now + 1;
  assert.equal(selectCard(cards, items, [], "s", "day", now).wordId, "b");
  cards[1].active = false;
  const ps = Array.from({ length: 10 }, () => ({
    studyDay: "day",
    isIntroduction: true,
  }));
  assert.equal(selectCard(cards, items, ps, "s", "day", now), null);
  assert.equal(selectCard(cards, items, ps, "s", "tomorrow", now).wordId, "a");
  cards[0].presentationCount = 1;
  assert.equal(selectCard(cards, items, ps, "s", "day", now).wordId, "a");
  ps.push({ wordId: "a", status: "skipped", sessionId: "s" });
  assert.equal(selectCard(cards, items, ps, "s", "day", now), null);
});
test("study days use saved timezone across midnight and DST", () => {
  assert.equal(
    studyDay(Date.parse("2026-01-02T01:00Z"), "America/Boise"),
    "2026-01-01",
  );
  assert.equal(
    studyDay(Date.parse("2026-03-08T08:59Z"), "America/Boise"),
    "2026-03-08",
  );
  assert.equal(
    studyDay(Date.parse("2026-03-08T09:01Z"), "America/Boise"),
    "2026-03-08",
  );
});
