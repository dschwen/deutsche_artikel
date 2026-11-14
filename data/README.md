# Vocabulary catalog

`catalog.json` is the application's source of truth. `daten.tsv` remains the
original imported source. Do not rerun the one-time generator or derive IDs from
row positions: edit catalog items while preserving their UUIDs.

The import removes two conflicting duplicate rows (`der Start` with translation
“star, starling”, and `der Bestandteil` with “continuation, stock, supply”), retaining
the first valid entry for each. Supplied multiple articles remain accepted and
are displayed in feedback,
including regional `die/das E-Mail`. Plural entries such as `die Leute` remain
article-selection exercises. This is a targeted correction of the import, not a
claim that all 1,779 source translations have undergone a linguistic audit.

Bump `contentRevision` when the tested meaning or accepted articles change.
Spelling and translation clarification can preserve the revision when the tested
fact is unchanged. Removed words should remain in the catalog with `active:false`.
IDs must never be reused. History is retained when a revised fact restarts learning.

Variant references: [Duden: Teil](https://www.duden.de/rechtschreibung/Teil)
and [PONS: Grad](https://de.pons.com/%C3%BCbersetzung/deutsche-rechtschreibung/Grad).
The short English glosses allow either listed article; a future sense-specific
exercise should provide additional context rather than reject a valid variant.
