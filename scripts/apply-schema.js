"use strict";

/**
 * Aplica cambios de schema directamente con SQL crudo usando el PrismaClient.
 * No requiere shadow database ni historial de migraciones.
 * Todas las sentencias usan IF NOT EXISTS — es seguro correr múltiples veces.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const sql = (s) => prisma.$executeRawUnsafe(s);

  console.log("[schema] Aplicando cambios de base de datos...");

  // products.has_variants
  await sql(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "has_variants" BOOLEAN NOT NULL DEFAULT false`);

  // product_attributes
  await sql(`
    CREATE TABLE IF NOT EXISTS "product_attributes" (
      "id"         UUID    NOT NULL DEFAULT uuid_generate_v4(),
      "product_id" UUID    NOT NULL,
      "name"       TEXT    NOT NULL,
      "position"   INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
    )
  `);

  // attribute_values
  await sql(`
    CREATE TABLE IF NOT EXISTS "attribute_values" (
      "id"           UUID    NOT NULL DEFAULT uuid_generate_v4(),
      "attribute_id" UUID    NOT NULL,
      "value"        TEXT    NOT NULL,
      "position"     INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "attribute_values_pkey" PRIMARY KEY ("id")
    )
  `);

  // product_variants
  await sql(`
    CREATE TABLE IF NOT EXISTS "product_variants" (
      "id"         UUID          NOT NULL DEFAULT uuid_generate_v4(),
      "product_id" UUID          NOT NULL,
      "sku"        TEXT          NOT NULL,
      "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "sale_price" DECIMAL(12,2) NOT NULL,
      "is_default" BOOLEAN       NOT NULL DEFAULT false,
      "is_active"  BOOLEAN       NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(6)           DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_product_id_sku_key" ON "product_variants"("product_id","sku")`);

  // variant_attribute_values
  await sql(`
    CREATE TABLE IF NOT EXISTS "variant_attribute_values" (
      "variant_id"         UUID NOT NULL,
      "attribute_value_id" UUID NOT NULL,
      CONSTRAINT "variant_attribute_values_pkey" PRIMARY KEY ("variant_id","attribute_value_id")
    )
  `);

  // variant_stock
  await sql(`
    CREATE TABLE IF NOT EXISTS "variant_stock" (
      "id"         UUID          NOT NULL DEFAULT uuid_generate_v4(),
      "variant_id" UUID          NOT NULL,
      "branch_id"  UUID          NOT NULL,
      "quantity"   DECIMAL(12,3) NOT NULL DEFAULT 0,
      "updated_at" TIMESTAMP(6)           DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "variant_stock_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "variant_stock_variant_id_branch_id_key" ON "variant_stock"("variant_id","branch_id")`);

  // sale_items.variant_id
  await sql(`ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "variant_id" UUID`);

  // barcode en productos y variantes
  await sql(`ALTER TABLE "products"         ADD COLUMN IF NOT EXISTS "barcode" TEXT`);
  await sql(`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "barcode" TEXT`);

  // paid_at en ventas (momento real del cobro, para cierres de caja correctos)
  await sql(`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(6)`);

  // Foreign keys — idempotentes via DO/IF NOT EXISTS en pg_constraint
  const fk = async (constraint, stmt) => {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
          ${stmt};
        END IF;
      END $$
    `);
  };

  await fk("product_attributes_product_id_fkey",          `ALTER TABLE "product_attributes"      ADD CONSTRAINT "product_attributes_product_id_fkey"          FOREIGN KEY ("product_id")         REFERENCES "products"("id")          ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("attribute_values_attribute_id_fkey",          `ALTER TABLE "attribute_values"         ADD CONSTRAINT "attribute_values_attribute_id_fkey"          FOREIGN KEY ("attribute_id")       REFERENCES "product_attributes"("id") ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("product_variants_product_id_fkey",            `ALTER TABLE "product_variants"         ADD CONSTRAINT "product_variants_product_id_fkey"            FOREIGN KEY ("product_id")         REFERENCES "products"("id")          ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("variant_attribute_values_variant_id_fkey",    `ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variant_id_fkey"    FOREIGN KEY ("variant_id")         REFERENCES "product_variants"("id")  ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("variant_attribute_values_attr_value_id_fkey", `ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attr_value_id_fkey" FOREIGN KEY ("attribute_value_id") REFERENCES "attribute_values"("id")  ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("variant_stock_variant_id_fkey",               `ALTER TABLE "variant_stock"            ADD CONSTRAINT "variant_stock_variant_id_fkey"               FOREIGN KEY ("variant_id")         REFERENCES "product_variants"("id")  ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("variant_stock_branch_id_fkey",                `ALTER TABLE "variant_stock"            ADD CONSTRAINT "variant_stock_branch_id_fkey"                FOREIGN KEY ("branch_id")          REFERENCES "branches"("id")          ON DELETE CASCADE  ON UPDATE NO ACTION`);
  await fk("sale_items_variant_id_fkey",                  `ALTER TABLE "sale_items"               ADD CONSTRAINT "sale_items_variant_id_fkey"                  FOREIGN KEY ("variant_id")         REFERENCES "product_variants"("id")  ON DELETE SET NULL ON UPDATE NO ACTION`);

  // api_keys
  await sql(`
    CREATE TABLE IF NOT EXISTS "api_keys" (
      "id"         UUID    NOT NULL DEFAULT uuid_generate_v4(),
      "company_id" UUID    NOT NULL,
      "key"        TEXT    NOT NULL,
      "name"       TEXT    NOT NULL,
      "is_active"  BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_key" ON "api_keys"("key")`);
  await fk("api_keys_company_id_fkey", `ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

  // purchases: columnas faltantes (paid_amount, status, due_date)
  await sql(`ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(12,2) DEFAULT 0`);
  await sql(`ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'PAID'`);
  await sql(`ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(6)`);

  // purchase_payments
  await sql(`
    CREATE TABLE IF NOT EXISTS "purchase_payments" (
      "id"             UUID          NOT NULL DEFAULT uuid_generate_v4(),
      "purchase_id"    UUID,
      "user_id"        UUID,
      "amount"         DECIMAL(12,2),
      "payment_method" TEXT,
      "notes"          TEXT,
      "created_at"     TIMESTAMP(6)           DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
    )
  `);
  await fk("purchase_payments_purchase_id_fkey", `ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  await fk("purchase_payments_user_id_fkey",     `ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_user_id_fkey"     FOREIGN KEY ("user_id")     REFERENCES "users"("id")     ON DELETE NO ACTION ON UPDATE NO ACTION`);

  // purchase_items: registrar la variante comprada
  await sql(`ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "variant_id" UUID`);
  await fk("purchase_items_variant_id_fkey", `ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

  // permiso purchases.edit (editar / anular compras) — asignado a roles ADMIN / SUPERADMIN
  await sql(`INSERT INTO "permissions" ("id", "key", "name") VALUES (uuid_generate_v4(), 'purchases.edit', 'Editar / Anular Compras') ON CONFLICT ("key") DO NOTHING`);
  await sql(`
    INSERT INTO "role_permissions" ("role_id", "permission_id")
    SELECT r."id", p."id"
    FROM "roles" r
    CROSS JOIN "permissions" p
    WHERE UPPER(r."name") IN ('ADMIN', 'SUPERADMIN') AND p."key" = 'purchases.edit'
    ON CONFLICT DO NOTHING
  `);

  // subscriptions: columnas de plan y wompi
  await sql(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'TRIAL'`);
  await sql(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "wompi_transaction_id" TEXT`);
  await sql(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "wompi_reference" TEXT`);

  // companies: email_verified y trial_used
  await sql(`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false`);
  await sql(`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "trial_used" BOOLEAN NOT NULL DEFAULT false`);

  // email_verifications
  await sql(`
    CREATE TABLE IF NOT EXISTS "email_verifications" (
      "id"          UUID         NOT NULL DEFAULT uuid_generate_v4(),
      "email"       TEXT         NOT NULL,
      "token"       TEXT         NOT NULL,
      "expires_at"  TIMESTAMP(6) NOT NULL,
      "verified_at" TIMESTAMP(6),
      "created_at"  TIMESTAMP(6)          DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "email_verifications_token_key" ON "email_verifications"("token")`);

  // password_resets
  await sql(`
    CREATE TABLE IF NOT EXISTS "password_resets" (
      "id"         UUID         NOT NULL DEFAULT uuid_generate_v4(),
      "email"      TEXT         NOT NULL,
      "token"      TEXT         NOT NULL,
      "expires_at" TIMESTAMP(6) NOT NULL,
      "used_at"    TIMESTAMP(6),
      "created_at" TIMESTAMP(6)          DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "password_resets_token_key" ON "password_resets"("token")`);

  // Consecutivo de factura por empresa
  await sql(`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "last_sale_number" INTEGER NOT NULL DEFAULT 0`);
  await sql(`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_number" INTEGER`);

  // Numerar las ventas existentes que aun no tienen consecutivo.
  // Continua desde el maximo ya asignado por empresa: recalcular ROW_NUMBER
  // sobre todas las ventas chocaria con los numeros existentes.
  // Las PENDING quedan sin numero: el consecutivo se asigna al cobrar.
  await sql(`
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
    WHERE s.id = n.id`);

  // Sincronizar el contador de cada empresa con el último número asignado
  await sql(`
    UPDATE "companies" c
    SET "last_sale_number" = COALESCE(
      (SELECT MAX(s."sale_number") FROM "sales" s WHERE s.company_id = c.id),
      0
    )
  `);

  await sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS "sales_company_id_sale_number_key"
      ON "sales" ("company_id", "sale_number")
      WHERE "sale_number" IS NOT NULL
  `);

  // Publicacion selectiva: que productos ve una tienda web externa.
  // Default false: publicar el catalogo entero debe ser un acto explicito.
  await sql(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT false`);
  await sql(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(6)`);
  await sql(`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT true`);

  // publish_mode protege a las integraciones ya existentes: las keys actuales
  // quedan en ALL y siguen viendo todo el catalogo. Las nuevas nacen en SELECTED.
  await sql(`ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "publish_mode" TEXT NOT NULL DEFAULT 'ALL'`);

  await sql(`CREATE INDEX IF NOT EXISTS "products_company_published_idx" ON "products"("company_id", "is_published")`);

  // Cola de sincronizacion con Shopify.
  // Shopify limita a ~2 req/s y un producto de 18 variantes son 19 llamadas,
  // asi que publicar no puede correr dentro del request: se encola y un worker
  // lo procesa en segundo plano con reintentos.
  await sql(`
    CREATE TABLE IF NOT EXISTS "shopify_sync_queue" (
      "id"            UUID         NOT NULL DEFAULT uuid_generate_v4(),
      "company_id"    UUID         NOT NULL,
      "product_id"    UUID         NOT NULL,
      "action"        TEXT         NOT NULL,
      "status"        TEXT         NOT NULL DEFAULT 'PENDING',
      "attempts"      INTEGER      NOT NULL DEFAULT 0,
      "last_error"    TEXT,
      "next_retry_at" TIMESTAMP(6),
      "created_at"    TIMESTAMP(6)          DEFAULT CURRENT_TIMESTAMP,
      "updated_at"    TIMESTAMP(6)          DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "shopify_sync_queue_pkey" PRIMARY KEY ("id")
    )
  `);
  await sql(`CREATE INDEX IF NOT EXISTS "shopify_sync_queue_pending_idx" ON "shopify_sync_queue"("status", "next_retry_at")`);
  // Un producto no necesita dos tareas pendientes de lo mismo encoladas a la vez
  await sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS "shopify_sync_queue_pending_uniq"
      ON "shopify_sync_queue"("product_id", "action")
      WHERE "status" = 'PENDING'
  `);
  await fk("shopify_sync_queue_company_id_fkey", `ALTER TABLE "shopify_sync_queue" ADD CONSTRAINT "shopify_sync_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  await fk("shopify_sync_queue_product_id_fkey", `ALTER TABLE "shopify_sync_queue" ADD CONSTRAINT "shopify_sync_queue_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

  // Marcar como verificadas las empresas legacy (sin suscripción TRIAL) para que no queden bloqueadas
  await prisma.$executeRawUnsafe(`
    UPDATE "companies"
    SET "email_verified" = true
    WHERE "email_verified" = false
      AND "id" NOT IN (
        SELECT "company_id" FROM "subscriptions" WHERE "status" = 'TRIAL'
      )
  `);

  console.log("[schema] ✓ Base de datos actualizada correctamente.");
}

run()
  .catch((e) => { console.error("[schema] ERROR:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
