-- Consecutivo de factura por empresa
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "last_sale_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_number" INTEGER;

-- Backfill: numerar las ventas existentes de cada empresa en orden cronológico
WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at, id) AS rn
    FROM "sales"
    WHERE company_id IS NOT NULL
)
UPDATE "sales" s
SET "sale_number" = n.rn
FROM numbered n
WHERE s.id = n.id AND s."sale_number" IS NULL;

-- Sincronizar el contador de cada empresa con el último número asignado
UPDATE "companies" c
SET "last_sale_number" = COALESCE(
    (SELECT MAX(s."sale_number") FROM "sales" s WHERE s.company_id = c.id),
    0
);

-- Un consecutivo no se repite dentro de la misma empresa
CREATE UNIQUE INDEX IF NOT EXISTS "sales_company_id_sale_number_key"
    ON "sales" ("company_id", "sale_number")
    WHERE "sale_number" IS NOT NULL;
