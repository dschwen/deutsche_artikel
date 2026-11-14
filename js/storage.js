import {
  CONFIG,
  CONFIG_ID,
  reviewCard,
  validateStoredCard,
} from "./scheduler.js";
import {
  selectCard,
  studyDay,
  summarize,
  dailyNewLimit,
  NEW_LIMIT,
} from "./queue.js";
const STORES = ["cards", "presentations", "reviews", "meta"];
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const uuid = () => crypto.randomUUID();
const counters = [
  "presentationCount",
  "reviewCount",
  "correctCount",
  "incorrectCount",
  "revealedCount",
  "guessedCount",
  "recallStreak",
];
function newCard(item) {
  return {
    wordId: item.id,
    contentRevision: item.contentRevision,
    acceptedArticles: item.acceptedArticles,
    active: item.active,
    phase: "new",
    dueAt: null,
    schedulerCard: null,
    schedulerConfigId: CONFIG_ID,
    revision: 0,
    firstPresentedAt: null,
    lastPresentedAt: null,
    lastReviewedAt: null,
    ...Object.fromEntries(counters.map((k) => [k, 0])),
  };
}
export async function openStorage(onChange = () => {}) {
  if (!globalThis.indexedDB)
    throw new Error("This browser does not support IndexedDB.");
  const req = indexedDB.open("deutsche-artikel", 1);
  req.onblocked = () =>
    onChange(
      "Close other trainer tabs to finish the database upgrade, then reload.",
    );
  req.onupgradeneeded = () => {
    const db = req.result;
    const cards = db.createObjectStore("cards", { keyPath: "wordId" });
    cards.createIndex("dueAt", "dueAt");
    const p = db.createObjectStore("presentations", { keyPath: "id" });
    for (const key of ["wordId", "studyDay", "sessionId"])
      p.createIndex(key, key);
    const r = db.createObjectStore("reviews", { keyPath: "presentationId" });
    r.createIndex("wordIdAnsweredAt", ["wordId", "answeredAt"]);
    r.createIndex("answeredAt", "answeredAt");
    db.createObjectStore("meta", { keyPath: "key" });
  };
  const db = await request(req);
  db.onversionchange = () => {
    db.close();
    onChange("The database changed in another tab. Reload to continue.");
  };
  return db;
}
// All awaits inside this helper are IndexedDB requests. No network or timer work
// is permitted inside a transaction. Resolve only after the transaction commits.
async function transaction(db, mode, fn) {
  const tx = db.transaction(STORES, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error ?? new Error("Save aborted. Please retry."));
    tx.onerror = () => {};
  });
  const stores = Object.fromEntries(STORES.map((k) => [k, tx.objectStore(k)]));
  try {
    const value = await fn(stores, tx);
    await done;
    return value;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await done.catch(() => {});
    throw error;
  }
}
async function readAll(s) {
  const [cards, presentations, reviews, meta] = await Promise.all(
    STORES.map((k) => request(s[k].getAll())),
  );
  return { cards, presentations, reviews, meta };
}
const setting = (rows, key) => rows.find((r) => r.key === key)?.value;
function checkClock(meta, now) {
  if (now < (setting(meta, "lastObservedAt") ?? 0))
    throw new Error(
      "Your clock moved backwards. Correct the device clock before continuing.",
    );
}
export async function reconcile(db, catalog) {
  return transaction(db, "readwrite", (s) => reconcileStores(s, catalog));
}
async function reconcileStores(s, catalog) {
  const data = await readAll(s);
  const config = setting(data.meta, "config");
  if (
    config &&
    JSON.stringify(config) !==
      JSON.stringify({ id: CONFIG_ID, options: CONFIG })
  )
    throw new Error(
      "This app cannot read the saved scheduler configuration. Load the matching app version.",
    );
  const items = new Map(catalog.items.map((i) => [i.id, i]));
  for (const old of data.cards) {
    const item = items.get(old.wordId);
    if (!item) {
      s.cards.put({ ...old, active: false });
      continue;
    }
    if (item.contentRevision < old.contentRevision)
      throw new Error(
        "This app has an older vocabulary than your progress. Reload the latest version.",
      );
    const changed = item.contentRevision !== old.contentRevision;
    if (
      !changed &&
      JSON.stringify(item.acceptedArticles) !==
        JSON.stringify(old.acceptedArticles)
    )
      throw new Error(
        `Vocabulary answer changed without a revision: ${item.noun}`,
      );
    s.cards.put(
      changed
        ? {
            ...old,
            contentRevision: item.contentRevision,
            acceptedArticles: item.acceptedArticles,
            active: item.active,
            phase: "new",
            dueAt: null,
            schedulerCard: null,
            recallStreak: 0,
            revision: old.revision + 1,
          }
        : { ...old, active: item.active },
    );
    if (changed || !item.active)
      for (const p of data.presentations.filter(
        (p) => p.wordId === item.id && p.status === "open",
      )) {
        s.presentations.put({
          ...p,
          status: "invalidated",
          closedAt: Date.now(),
        });
      }
    items.delete(old.wordId);
  }
  for (const item of items.values()) s.cards.add(newCard(item));
  for (const p of data.presentations.filter(
    (p) =>
      p.status === "open" &&
      !catalog.items.some((i) => i.id === p.wordId && i.active),
  ))
    s.presentations.put({ ...p, status: "invalidated", closedAt: Date.now() });
  if (
    data.presentations.some(
      (p) =>
        p.status === "open" &&
        !catalog.items.some(
          (i) =>
            i.id === p.wordId &&
            i.active &&
            i.contentRevision === p.contentRevision,
        ),
    )
  )
    s.meta.put({ key: "currentPresentation", value: null });
  if (!setting(data.meta, "timezone"))
    s.meta.put({
      key: "timezone",
      value: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  if (!setting(data.meta, "sessionId"))
    s.meta.put({ key: "sessionId", value: uuid() });
  s.meta.put({ key: "config", value: { id: CONFIG_ID, options: CONFIG } });
  s.meta.put({ key: "catalogVersion", value: catalog.version });
}
export async function getState(db, now = Date.now()) {
  return transaction(db, "readonly", async (s) => {
    const data = await readAll(s);
    const day = studyDay(now, setting(data.meta, "timezone"));
    return {
      ...data,
      summary: summarize(
        data.cards,
        data.presentations,
        day,
        now,
        dailyNewLimit(setting(data.meta, "extraNewAllowance"), day),
      ),
    };
  });
}
export async function presentNext(db, catalog, now = Date.now()) {
  return transaction(db, "readwrite", async (s) => {
    const data = await readAll(s);
    checkClock(data.meta, now);
    const existing = data.presentations.find((p) => p.status === "open");
    if (existing) {
      const item = catalog.items.find((i) => i.id === existing.wordId);
      if (!item?.active || item.contentRevision !== existing.contentRevision)
        throw new Error(
          "Vocabulary changed in another tab. Reload to continue.",
        );
      return existing;
    }
    const day = studyDay(now, setting(data.meta, "timezone"));
    let sessionId = setting(data.meta, "sessionId");
    if (setting(data.meta, "sessionDay") !== day) {
      sessionId = uuid();
      s.meta.put({ key: "sessionId", value: sessionId });
      s.meta.put({ key: "sessionDay", value: day });
    }
    const card = selectCard(
      data.cards,
      catalog.items,
      data.presentations,
      sessionId,
      day,
      now,
      dailyNewLimit(setting(data.meta, "extraNewAllowance"), day),
    );
    if (!card) return null;
    if (
      catalog.items.find((i) => i.id === card.wordId)?.contentRevision !==
      card.contentRevision
    )
      throw new Error("Vocabulary changed in another tab. Reload to continue.");
    const p = {
      id: uuid(),
      wordId: card.wordId,
      contentRevision: card.contentRevision,
      cardRevision: card.revision,
      sessionId,
      presentedAt: now,
      studyDay: day,
      isIntroduction: card.firstPresentedAt === null,
      status: "open",
      closedAt: null,
    };
    s.presentations.add(p);
    s.cards.put({
      ...card,
      firstPresentedAt: card.firstPresentedAt ?? now,
      lastPresentedAt: now,
      presentationCount: card.presentationCount + 1,
    });
    s.meta.put({ key: "currentPresentation", value: p.id });
    s.meta.put({ key: "lastObservedAt", value: now });
    return p;
  });
}
export async function grade(
  db,
  catalog,
  presentationId,
  selected,
  guessed = false,
  now = Date.now(),
) {
  return transaction(db, "readwrite", async (s) => {
    const previous = await request(s.reviews.get(presentationId));
    if (previous) return previous;
    const p = await request(s.presentations.get(presentationId));
    if (!p || p.status !== "open")
      throw new Error("This question is no longer open. Refresh to continue.");
    const card = await request(s.cards.get(p.wordId));
    const item = catalog.items.find((i) => i.id === p.wordId);
    if (
      !item?.active ||
      !card.active ||
      card.revision !== p.cardRevision ||
      item.contentRevision !== p.contentRevision ||
      card.contentRevision !== p.contentRevision
    )
      throw new Error(
        "This question changed in another tab. Refresh to continue.",
      );
    const meta = await request(s.meta.getAll());
    checkClock(meta, now);
    if (card.schedulerConfigId !== CONFIG_ID)
      throw new Error("Unsupported scheduler configuration.");
    if (selected !== null && !["der", "die", "das"].includes(selected))
      throw new Error("Choose an article.");
    const outcome =
      selected === null
        ? "revealed"
        : item.acceptedArticles.includes(selected)
          ? "correct"
          : "incorrect";
    const rating = outcome === "correct" && !guessed ? 3 : 1;
    const result = reviewCard({
      storedCard: card.schedulerCard,
      rating,
      nowMs: now,
      cardId: card.wordId,
    });
    const review = {
      presentationId,
      wordId: card.wordId,
      answeredAt: now,
      selected,
      guessed: outcome === "correct" && guessed,
      outcome,
      rating,
      schedulerLog: result.schedulerLog,
      preCard: card.schedulerCard,
      postCard: result.nextStoredCard,
      schedulerConfigId: CONFIG_ID,
      contentRevision: item.contentRevision,
      contentSnapshot: item,
    };
    s.reviews.add(review);
    s.cards.put({
      ...card,
      schedulerCard: result.nextStoredCard,
      dueAt: result.dueAt,
      phase: result.phase,
      revision: card.revision + 1,
      lastReviewedAt: now,
      reviewCount: card.reviewCount + 1,
      correctCount: card.correctCount + (outcome === "correct"),
      incorrectCount: card.incorrectCount + (outcome === "incorrect"),
      revealedCount: card.revealedCount + (outcome === "revealed"),
      guessedCount: card.guessedCount + review.guessed,
      recallStreak: rating === 3 ? card.recallStreak + 1 : 0,
    });
    s.presentations.put({ ...p, status: "answered", closedAt: now });
    s.meta.put({ key: "currentPresentation", value: null });
    s.meta.put({ key: "lastObservedAt", value: now });
    return review;
  });
}
export async function skip(db, id, now = Date.now()) {
  return transaction(db, "readwrite", async (s) => {
    const p = await request(s.presentations.get(id));
    if (!p || p.status !== "open")
      throw new Error("This question was already closed. Refresh to continue.");
    checkClock(await request(s.meta.getAll()), now);
    s.presentations.put({ ...p, status: "skipped", closedAt: now });
    s.meta.put({ key: "currentPresentation", value: null });
    s.meta.put({ key: "lastObservedAt", value: now });
  });
}
// An explicit request extends only today's introduction budget. Rechecking the
// remaining allowance inside this transaction makes concurrent clicks idempotent.
export async function allowMoreNewWords(db, now = Date.now()) {
  return transaction(db, "readwrite", async (s) => {
    const data = await readAll(s);
    checkClock(data.meta, now);
    const day = studyDay(now, setting(data.meta, "timezone"));
    const limit = dailyNewLimit(setting(data.meta, "extraNewAllowance"), day);
    const summary = summarize(data.cards, data.presentations, day, now, limit);
    if (summary.newRemaining > 0 || summary.unintroduced === 0) return;
    s.meta.put({
      key: "extraNewAllowance",
      value: {
        day,
        count: limit - NEW_LIMIT + Math.min(NEW_LIMIT, summary.unintroduced),
      },
    });
    s.meta.put({ key: "lastObservedAt", value: now });
  });
}
export async function newSession(db) {
  return transaction(db, "readwrite", (s) => {
    s.meta.put({ key: "sessionId", value: uuid() });
  });
}
export async function exportProgress(db) {
  return transaction(db, "readonly", async (s) => ({
    format: "deutsche-artikel",
    version: 1,
    exportedAt: Date.now(),
    ...(await readAll(s)),
  }));
}
export async function eraseProgress(db) {
  return transaction(db, "readwrite", (s) => {
    for (const name of STORES) s[name].clear();
  });
}
export function validateBackup(data) {
  const fail = () => {
    throw new Error(
      "Invalid or incompatible progress backup. No data was changed.",
    );
  };
  if (
    data?.format !== "deutsche-artikel" ||
    data.version !== 1 ||
    STORES.some((k) => !Array.isArray(data[k]))
  )
    fail();
  const unique = (rows, key) =>
    rows.every((r) => r && typeof r[key] === "string" && r[key]) &&
    new Set(rows.map((r) => r[key])).size === rows.length;
  if (
    !unique(data.cards, "wordId") ||
    !unique(data.presentations, "id") ||
    !unique(data.reviews, "presentationId") ||
    !unique(data.meta, "key")
  )
    fail();
  if (
    JSON.stringify(setting(data.meta, "config")) !==
    JSON.stringify({ id: CONFIG_ID, options: CONFIG })
  )
    fail();
  try {
    studyDay(Date.now(), setting(data.meta, "timezone"));
  } catch {
    fail();
  }
  if (
    typeof setting(data.meta, "timezone") !== "string" ||
    typeof setting(data.meta, "sessionId") !== "string" ||
    setting(data.meta, "catalogVersion") !== 1
  )
    fail();
  const date = (v) => Number.isSafeInteger(v) && v > 0 && v < 8640000000000000;
  if (
    setting(data.meta, "lastObservedAt") !== undefined &&
    !date(setting(data.meta, "lastObservedAt"))
  )
    fail();
  const allowance = setting(data.meta, "extraNewAllowance");
  if (
    allowance !== undefined &&
    (!allowance ||
      !/^\d{4}-\d{2}-\d{2}$/.test(allowance.day) ||
      !Number.isSafeInteger(allowance.count) ||
      allowance.count < 0)
  )
    fail();
  const cards = new Map(data.cards.map((c) => [c.wordId, c]));
  const ps = new Map(data.presentations.map((p) => [p.id, p]));
  for (const c of data.cards) {
    if (
      !Number.isInteger(c.contentRevision) ||
      c.contentRevision < 1 ||
      !Number.isInteger(c.revision) ||
      c.revision < 0 ||
      typeof c.active !== "boolean" ||
      !["new", "learning", "relearning", "review", "suspended"].includes(
        c.phase,
      ) ||
      c.schedulerConfigId !== CONFIG_ID ||
      counters.some((k) => !Number.isSafeInteger(c[k]) || c[k] < 0) ||
      c.correctCount + c.incorrectCount + c.revealedCount !== c.reviewCount ||
      c.guessedCount > c.correctCount ||
      c.presentationCount < c.reviewCount ||
      c.recallStreak > c.reviewCount ||
      !Array.isArray(c.acceptedArticles) ||
      !c.acceptedArticles.length ||
      c.acceptedArticles.some((a) => !["der", "die", "das"].includes(a)) ||
      ["firstPresentedAt", "lastPresentedAt", "lastReviewedAt"].some(
        (k) => c[k] !== null && !date(c[k]),
      )
    )
      fail();
    if (c.schedulerCard) {
      validateStoredCard(c.schedulerCard);
      if (
        c.schedulerCard.cardId !== c.wordId ||
        c.schedulerCard.dueAt !== c.dueAt ||
        c.phase !==
          (c.schedulerCard.state === 3
            ? "relearning"
            : c.schedulerCard.scheduleStatus)
      )
        fail();
    } else if (c.dueAt !== null || c.phase !== "new") fail();
  }
  if (data.presentations.filter((p) => p.status === "open").length > 1) fail();
  for (const p of data.presentations) {
    if (
      !cards.has(p.wordId) ||
      !date(p.presentedAt) ||
      typeof p.isIntroduction !== "boolean" ||
      typeof p.sessionId !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.studyDay) ||
      !Number.isInteger(p.contentRevision) ||
      p.contentRevision < 1 ||
      !Number.isInteger(p.cardRevision) ||
      p.cardRevision < 0 ||
      !["open", "answered", "skipped", "invalidated"].includes(p.status) ||
      (p.status === "open"
        ? p.closedAt !== null
        : !date(p.closedAt) || p.closedAt < p.presentedAt)
    )
      fail();
  }
  for (const p of data.presentations.filter((p) => p.status === "open")) {
    const c = cards.get(p.wordId);
    if (
      !c.active ||
      p.cardRevision !== c.revision ||
      p.contentRevision !== c.contentRevision
    )
      fail();
  }
  const current = setting(data.meta, "currentPresentation");
  if (current != null && ps.get(current)?.status !== "open") fail();
  for (const r of data.reviews) {
    const p = ps.get(r.presentationId);
    if (
      !p ||
      p.status !== "answered" ||
      p.wordId !== r.wordId ||
      !date(r.answeredAt) ||
      r.answeredAt < p.presentedAt ||
      !["correct", "incorrect", "revealed"].includes(r.outcome) ||
      typeof r.guessed !== "boolean" ||
      ![1, 3].includes(r.rating) ||
      r.rating !== (r.outcome === "correct" && !r.guessed ? 3 : 1) ||
      r.schedulerConfigId !== CONFIG_ID ||
      !(r.selected === null || ["der", "die", "das"].includes(r.selected)) ||
      !r.contentSnapshot ||
      r.contentSnapshot.id !== r.wordId ||
      r.contentRevision !== p.contentRevision ||
      r.contentSnapshot.contentRevision !== r.contentRevision ||
      !Array.isArray(r.contentSnapshot.acceptedArticles) ||
      !r.contentSnapshot.acceptedArticles.length ||
      r.contentSnapshot.acceptedArticles.some(
        (a) => !["der", "die", "das"].includes(a),
      ) ||
      typeof r.contentSnapshot.noun !== "string" ||
      typeof r.contentSnapshot.english !== "string" ||
      r.outcome !==
        (r.selected === null
          ? "revealed"
          : r.contentSnapshot.acceptedArticles.includes(r.selected)
            ? "correct"
            : "incorrect") ||
      (r.guessed && r.outcome !== "correct") ||
      p.closedAt !== r.answeredAt
    )
      fail();
    validateStoredCard(r.postCard);
    if (r.preCard) validateStoredCard(r.preCard);
    if (
      r.postCard.cardId !== r.wordId ||
      r.postCard.lastReviewAt !== r.answeredAt ||
      (r.preCard && r.preCard.cardId !== r.wordId)
    )
      fail();
  }
  for (const c of data.cards) {
    const history = data.reviews.filter((r) => r.wordId === c.wordId);
    const exposures = data.presentations.filter((p) => p.wordId === c.wordId);
    const latest = history.toSorted((a, b) => b.answeredAt - a.answeredAt)[0];
    if (
      (latest?.answeredAt ?? null) !== c.lastReviewedAt ||
      (exposures.length
        ? Math.min(...exposures.map((p) => p.presentedAt))
        : null) !== c.firstPresentedAt ||
      (exposures.length
        ? Math.max(...exposures.map((p) => p.presentedAt))
        : null) !== c.lastPresentedAt ||
      exposures.filter((p) => p.isIntroduction).length !==
        (exposures.length ? 1 : 0)
    )
      fail();
    if (
      c.schedulerCard &&
      (!latest ||
        latest.contentRevision !== c.contentRevision ||
        JSON.stringify(latest.postCard) !== JSON.stringify(c.schedulerCard))
    )
      fail();
    if (
      history.length !== c.reviewCount ||
      data.presentations.filter((p) => p.wordId === c.wordId).length !==
        c.presentationCount ||
      ["correct", "incorrect", "revealed"].some(
        (o) => history.filter((r) => r.outcome === o).length !== c[`${o}Count`],
      ) ||
      history.filter((r) => r.guessed).length !== c.guessedCount
    )
      fail();
  }
  const latestActivity = Math.max(
    0,
    ...data.presentations.map((p) => p.presentedAt),
    ...data.reviews.map((r) => r.answeredAt),
  );
  if (latestActivity > (setting(data.meta, "lastObservedAt") ?? 0)) fail();
  if (
    data.presentations.some(
      (p) =>
        p.status === "answered" &&
        !data.reviews.some((r) => r.presentationId === p.id),
    )
  )
    fail();
  return data;
}
export async function importProgress(db, data, catalog) {
  validateBackup(data);
  // Validate catalog compatibility before replacing anything.
  for (const c of data.cards) {
    const item = catalog.items.find((i) => i.id === c.wordId);
    if (
      item &&
      (item.contentRevision < c.contentRevision ||
        (item.contentRevision === c.contentRevision &&
          JSON.stringify(item.acceptedArticles) !==
            JSON.stringify(c.acceptedArticles)))
    )
      throw new Error("Backup vocabulary is incompatible with this app.");
  }
  await transaction(db, "readwrite", async (s) => {
    for (const name of STORES) {
      s[name].clear();
      for (const row of data[name]) s[name].put(row);
    }
    await reconcileStores(s, catalog);
  });
}
