-- Consecutivo de factura por empresa
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "last_sale_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_number" INTEGER;

-- Backfill: numerar las ventas que aun no tienen consecutivo, continuando
-- desde el maximo ya asignado por empresa. Recalcular ROW_NUMBER sobre todas
-- las ventas chocaria con los numeros existentes al re-ejecutarse.
-- Las PENDING quedan sin numero: el consecutivo se asigna al cobrar.
WITH numbered AS (
    SELECT s.id,
           (SELECT COALESCE(MAX(s2."sale_number"), 0)
              FROM "sales" s2
             WHERE s2.company_id = s.company_id)
           + ROW_NUMBER() OVER (PARTITION BY s.company_id ORDER BY s.created_at, s.id) AS rn
      FROM "sales" s
     WHERE s.company_id IS NOT NULL
       AND s."sale_number" IS NULL
       AND s.status <> 'PENDING'
)
UPDATE "sales" s
SET "sale_number" = n.rn
FROM numbered n
WHERE s.id = n.id;

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
