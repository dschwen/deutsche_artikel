export const NEW_LIMIT = 10;
export function studyDay(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function selectCard(cards, items, presentations, sessionId, day, now) {
  const skipped = new Set(
    presentations
      .filter((p) => p.sessionId === sessionId && p.status === "skipped")
      .map((p) => p.wordId),
  );
  const introduced = presentations.filter(
    (p) => p.studyDay === day && p.isIntroduction,
  ).length;
  const catalog = new Map(items.map((i) => [i.id, i]));
  const eligible = cards.filter(
    (c) =>
      c.active &&
      c.phase !== "suspended" &&
      catalog.has(c.wordId) &&
      !skipped.has(c.wordId),
  );
  const rank = (c) =>
    c.phase === "new"
      ? c.presentationCount
        ? 2
        : 3
      : c.phase === "review"
        ? 1
        : 0;
  return (
    eligible
      .filter((c) =>
        c.phase === "new"
          ? c.presentationCount > 0 || introduced < NEW_LIMIT
          : c.dueAt <= now,
      )
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (rank(a) < 2
            ? a.dueAt - b.dueAt
            : catalog.get(a.wordId).order - catalog.get(b.wordId).order) ||
          a.wordId.localeCompare(b.wordId),
      )[0] ?? null
  );
}
export function summarize(cards, presentations, day, now) {
  const active = cards.filter((c) => c.active && c.phase !== "suspended");
  return {
    learning: active.filter(
      (c) => ["learning", "relearning"].includes(c.phase) && c.dueAt <= now,
    ).length,
    due: active.filter((c) => c.phase === "review" && c.dueAt <= now).length,
    newRemaining: Math.max(
      0,
      NEW_LIMIT -
        presentations.filter((p) => p.studyDay === day && p.isIntroduction)
          .length,
    ),
    nextDue: Math.min(
      ...active.filter((c) => c.dueAt > now).map((c) => c.dueAt),
    ),
    reviews: cards.reduce((n, c) => n + c.reviewCount, 0),
    correct: cards.reduce((n, c) => n + c.correctCount, 0),
    learned: active.filter((c) => c.reviewCount > 0).length,
  };
}
