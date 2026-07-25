-- Agregar columnas faltantes a purchases
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'PAID';
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(6);

-- Crear tabla purchase_payments
CREATE TABLE IF NOT EXISTS "purchase_payments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "purchase_id" UUID,
    "user_id" UUID,
    "amount" DECIMAL(12,2),
    "payment_method" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "purchase_payments"
    ADD CONSTRAINT "purchase_payments_purchase_id_fkey"
    FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
    NOT VALID;

ALTER TABLE "purchase_payments"
    ADD CONSTRAINT "purchase_payments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
    NOT VALID;
