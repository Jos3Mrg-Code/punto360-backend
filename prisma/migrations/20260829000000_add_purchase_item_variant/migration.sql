-- Registrar la variante comprada en cada línea de compra
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "variant_id" UUID;

ALTER TABLE "purchase_items"
    ADD CONSTRAINT "purchase_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
    NOT VALID;

-- Permiso para editar / anular compras (solo ADMIN por defecto)
INSERT INTO "permissions" ("id", "key", "name")
VALUES (uuid_generate_v4(), 'purchases.edit', 'Editar / Anular Compras')
ON CONFLICT ("key") DO NOTHING;

-- Asignar el nuevo permiso a todos los roles llamados ADMIN
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE UPPER(r."name") IN ('ADMIN', 'SUPERADMIN') AND p."key" = 'purchases.edit'
ON CONFLICT DO NOTHING;
