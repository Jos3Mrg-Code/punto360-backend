CREATE TABLE IF NOT EXISTS "sku_counters" (
  "company_id"  UUID    NOT NULL,
  "branch_code" TEXT    NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "sku_counters_pkey" PRIMARY KEY ("company_id", "branch_code")
);

INSERT INTO "sku_counters" (company_id, branch_code, last_number)
SELECT
  p.company_id,
  regexp_replace(p.sku, '-([0-9]+)$', '') AS branch_code,
  MAX((regexp_match(p.sku, '-([0-9]+)$'))[1]::int) AS last_number
FROM "products" p
WHERE p.company_id IS NOT NULL
  AND p.sku ~ '-[0-9]+$'
GROUP BY p.company_id, regexp_replace(p.sku, '-([0-9]+)$', '')
ON CONFLICT (company_id, branch_code) DO UPDATE
SET last_number = GREATEST("sku_counters".last_number, EXCLUDED.last_number);
