"""One-time catalog bootstrap. Future edits must preserve existing IDs."""
import json
import uuid
from pathlib import Path

output = Path('data/catalog.json')
if output.exists():
    raise SystemExit('Catalog already exists; edit it without regenerating IDs.')
items = []
for order, line in enumerate(Path('daten.tsv').read_text().splitlines()):
    if not line.strip():
        continue
    german, english = line.split('\t', 1)
    articles, noun = german.split(' ', 1)
    # Incorrect duplicate translations in the source: retain the valid first rows.
    if (noun, english) in [('Start', 'star, starling'), ('Bestandteil', 'continuation, stock, supply')]:
        continue
    items.append(dict(id=str(uuid.uuid4()), noun=noun, english=english,
                      acceptedArticles=articles.split('/'), order=order,
                      contentRevision=1, active=True))
output.write_text(json.dumps(dict(version=1, items=items), ensure_ascii=False, indent=2)+'\n')
