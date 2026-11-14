export function validateCatalog(catalog) {
  if (
    catalog?.version !== 1 ||
    !Array.isArray(catalog.items) ||
    !catalog.items.length
  )
    throw new Error("Unsupported or empty vocabulary catalog.");
  const ids = new Set();
  for (const item of catalog.items) {
    if (
      typeof item.id !== "string" ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.noun !== "string" ||
      !item.noun.trim() ||
      typeof item.english !== "string" ||
      !Number.isInteger(item.order) ||
      !Number.isInteger(item.contentRevision) ||
      item.contentRevision < 1 ||
      typeof item.active !== "boolean" ||
      !Array.isArray(item.acceptedArticles) ||
      !item.acceptedArticles.length ||
      new Set(item.acceptedArticles).size !== item.acceptedArticles.length ||
      item.acceptedArticles.some((a) => !["der", "die", "das"].includes(a))
    )
      throw new Error(`Invalid or duplicate vocabulary item: ${item.id}`);
    ids.add(item.id);
  }
  return catalog;
}
export async function loadCatalog() {
  const response = await fetch("./data/catalog.json");
  if (!response.ok)
    throw new Error(`Vocabulary could not load (${response.status}).`);
  return validateCatalog(await response.json());
}
