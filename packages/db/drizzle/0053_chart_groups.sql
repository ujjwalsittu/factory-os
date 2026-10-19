-- Decision 071: bring every existing chart to the standard Tally group tree. Data only: no entry, mapping or
-- ledger id changes, and groups or ledgers people created or moved are left alone.

-- 1. The asset-side "Duties & Taxes" group becomes "Input tax credits" (same row, same id), before any insert can
--    take that key.
UPDATE "account_group" g SET "key" = 'Input tax credits:asset', "name" = 'Input tax credits'
WHERE g."key" = 'Duties & Taxes:asset'
  AND NOT EXISTS (SELECT 1 FROM "account_group" o WHERE o."entity_id" = g."entity_id" AND o."key" = 'Input tax credits:asset');
--> statement-breakpoint
-- Where an entity already had "Input tax credits", the old group's ledgers and sub-groups join it; the empty old
-- group stays.
UPDATE "gl_account" a SET "group_id" = n."id"
FROM "account_group" d, "account_group" n
WHERE a."group_id" = d."id" AND d."key" = 'Duties & Taxes:asset'
  AND n."entity_id" = d."entity_id" AND n."key" = 'Input tax credits:asset';
--> statement-breakpoint
UPDATE "account_group" c SET "parent_id" = n."id"
FROM "account_group" d, "account_group" n
WHERE c."parent_id" = d."id" AND d."key" = 'Duties & Taxes:asset'
  AND n."entity_id" = d."entity_id" AND n."key" = 'Input tax credits:asset';
--> statement-breakpoint

-- 2. Add the missing standard groups for every entity that already has a chart.
INSERT INTO "account_group" ("tenant_id", "entity_id", "key", "name", "root")
SELECT e."tenant_id", e."entity_id", s.name || ':' || s.root, s.name, s.root
FROM (SELECT DISTINCT "tenant_id", "entity_id" FROM "account_group") e
CROSS JOIN (VALUES
  ('Capital Account', 'equity'), ('Reserves & Surplus', 'equity'),
  ('Loans (Liability)', 'liability'), ('Bank OD A/c', 'liability'), ('Secured Loans', 'liability'),
  ('Unsecured Loans', 'liability'), ('Current Liabilities', 'liability'), ('Duties & Taxes', 'liability'),
  ('Provisions', 'liability'), ('Sundry Creditors', 'liability'), ('Suspense A/c', 'liability'),
  ('Fixed Assets', 'asset'), ('Investments', 'asset'), ('Current Assets', 'asset'), ('Bank Accounts', 'asset'),
  ('Cash-in-Hand', 'asset'), ('Deposits (Asset)', 'asset'), ('Loans & Advances (Asset)', 'asset'),
  ('Stock-in-Hand', 'asset'), ('Sundry Debtors', 'asset'), ('Input tax credits', 'asset'),
  ('Sales Accounts', 'income'), ('Direct Incomes', 'income'), ('Indirect Incomes', 'income'),
  ('Purchase Accounts', 'expense'), ('Direct Expenses', 'expense'), ('Indirect Expenses', 'expense')
) AS s(name, root)
ON CONFLICT ("entity_id", "key") DO NOTHING;
--> statement-breakpoint

-- 3. Standard sub-groups that have no parent yet get their standard parent.
UPDATE "account_group" g SET "parent_id" = p."id"
FROM (VALUES
  ('Reserves & Surplus', 'Capital Account', 'equity'),
  ('Bank OD A/c', 'Loans (Liability)', 'liability'), ('Secured Loans', 'Loans (Liability)', 'liability'),
  ('Unsecured Loans', 'Loans (Liability)', 'liability'),
  ('Duties & Taxes', 'Current Liabilities', 'liability'), ('Provisions', 'Current Liabilities', 'liability'),
  ('Sundry Creditors', 'Current Liabilities', 'liability'),
  ('Bank Accounts', 'Current Assets', 'asset'), ('Cash-in-Hand', 'Current Assets', 'asset'),
  ('Deposits (Asset)', 'Current Assets', 'asset'), ('Loans & Advances (Asset)', 'Current Assets', 'asset'),
  ('Stock-in-Hand', 'Current Assets', 'asset'), ('Sundry Debtors', 'Current Assets', 'asset'),
  ('Input tax credits', 'Current Assets', 'asset')
) AS s(name, parent, root), "account_group" p
WHERE g."key" = s.name || ':' || s.root AND g."parent_id" IS NULL
  AND p."entity_id" = g."entity_id" AND p."key" = s.parent || ':' || s.root;
--> statement-breakpoint

-- 4. Default ledgers move to their standard group, only while still in the group they were seeded into.
UPDATE "gl_account" a SET "group_id" = t."id"
FROM (VALUES
  ('pending_cgst', 'Current Assets:asset', 'Input tax credits:asset'),
  ('pending_sgst', 'Current Assets:asset', 'Input tax credits:asset'),
  ('pending_igst', 'Current Assets:asset', 'Input tax credits:asset'),
  ('pending_cess', 'Current Assets:asset', 'Input tax credits:asset'),
  ('tds_receivable', 'Current Assets:asset', 'Loans & Advances (Asset):asset'),
  ('tcs_recoverable', 'Current Assets:asset', 'Loans & Advances (Asset):asset'),
  ('purchases', 'Direct Expenses:expense', 'Purchase Accounts:expense')
) AS m(role, from_key, to_key), "account_group" f, "account_group" t
WHERE a."role" = m.role
  AND f."id" = a."group_id" AND f."key" = m.from_key
  AND t."entity_id" = a."entity_id" AND t."key" = m.to_key;
