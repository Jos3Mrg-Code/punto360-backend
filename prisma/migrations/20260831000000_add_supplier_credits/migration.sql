-- Saldo a favor por proveedor (ledger)
CREATE TABLE IF NOT EXISTS "supplier_credits" (
    "id"             UUID          NOT NULL DEFAULT uuid_generate_v4(),
    "company_id"     UUID          NOT NULL,
    "supplier_id"    UUID          NOT NULL,
    "branch_id"      UUID,
    "user_id"        UUID,
    "type"           TEXT          NOT NULL,
    "amount"         DECIMAL(12,2) NOT NULL,
    "reason"         TEXT          NOT NULL,
    "reference_id"   UUID,
    "reference_type" TEXT,
    "created_at"     TIMESTAMP(6)           DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supplier_credits_supplier_id_idx" ON "supplier_credits"("supplier_id");

ALTER TABLE "supplier_credits"
    ADD CONSTRAINT "supplier_credits_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
    NOT VALID;
