// Guard against drift (decision 069): a field that saves a reference to a master record must offer "Add new …".
// For each source file and each master list it fetches (parties, items, warehouses, units, HSN/SAC, work centres,
// ledger accounts, projects), the file must also use the shared add-new field for that list: LookupSelect or
// CreateDialog with kind="…", or ItemPicker for items. Pages that only list or filter are allowed by name and kind
// in add-new-allow.json ("path#kind": "reason"). The build ends with this output empty.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const allow = JSON.parse(readFileSync(new URL('./add-new-allow.json', import.meta.url), 'utf8'));
const FETCH = {
  party: /api<Party\[\]>|['`"]\/parties\b/,
  item: /api<Item\[\]>|['`"]\/items\b/,
  warehouse: /api<Warehouse\[\]>|['`"]\/warehouses\b/,
  uom: /api<Uom\[\]>|['`"]\/uoms\b/,
  hsn: /api<HsnCode\[\]>|['`"]\/hsn-codes\b/,
  workCentre: /api<WorkCentre\[\]>|['`"]\/manufacturing\/work-centres\b/,
  account: /api<Account\[\]>|useAccounts\(|['`"]\/accounts\/accounts\b/,
  project: /api<Project\[\]>|['`"]\/services\/projects\b/,
};
const USES = (kind) => new RegExp(`kind[=:]\\s*[{]?\\s*['"]${kind}['"]` + (kind === 'item' ? '|<ItemPicker' : ''));
// The shared components themselves and the one place that defines each form.
const SKIP = new Set(['components/lookup-select.tsx', 'components/master-dialogs.tsx', 'components/item-picker.tsx']);

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(n)) files.push(p);
  }
})(root);

const bad = [];
for (const f of files) {
  const rel = relative(root, f);
  if (SKIP.has(rel)) continue;
  const src = readFileSync(f, 'utf8');
  for (const [kind, re] of Object.entries(FETCH)) {
    if (!re.test(src) || USES(kind).test(src) || `${rel}#${kind}` in allow) continue;
    bad.push(`${rel}  (${kind})`);
  }
}
if (bad.length) {
  console.log(`${bad.length} master list(s) fetched without the shared add-new field:`);
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
console.log('add-new guard: every reference list uses the shared field or is allowed by name');
