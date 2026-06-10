CREATE TABLE IF NOT EXISTS exchanges (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID,
  branch_id            UUID,
  user_id              UUID,
  returned_product_id  UUID,
  returned_variant_id  UUID,
  returned_quantity    DECIMAL(12,3) NOT NULL DEFAULT 1,
  returned_price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  new_product_id       UUID,
  new_variant_id       UUID,
  new_quantity         DECIMAL(12,3) NOT NULL DEFAULT 1,
  new_price            DECIMAL(12,2) NOT NULL DEFAULT 0,
  difference           DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method       TEXT,
  notes                TEXT,
  created_at           TIMESTAMP DEFAULT now()
);
