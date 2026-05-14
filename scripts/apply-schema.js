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

  console.log("[schema] ✓ Base de datos actualizada correctamente.");
}

run()
  .catch((e) => { console.error("[schema] ERROR:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
