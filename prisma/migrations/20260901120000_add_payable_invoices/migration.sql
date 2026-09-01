-- Facturas por pagar históricas (no afectan inventario)
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "affects_inventory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "invoice_number" TEXT;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "invoice_date" TIMESTAMP(6);
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "description" TEXT;

ALTER TABLE "purchase_payments" ADD COLUMN IF NOT EXISTS "is_historical" BOOLEAN NOT NULL DEFAULT false;
