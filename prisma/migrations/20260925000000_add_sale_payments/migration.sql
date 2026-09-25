CREATE TABLE IF NOT EXISTS "sale_payments" (
  "id"         UUID          NOT NULL DEFAULT uuid_generate_v4(),
  "sale_id"    UUID          NOT NULL,
  "method"     TEXT          NOT NULL,
  "amount"     DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(6)           DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_sale_id_fkey') THEN
    ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
