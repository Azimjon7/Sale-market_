BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_uq ON categories (lower(name));

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  ADD COLUMN IF NOT EXISTS redeemed_count integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id bigserial PRIMARY KEY,
  promo_code text NOT NULL REFERENCES promo_codes(code) ON DELETE RESTRICT,
  order_id text NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  discount_amount numeric(14,2) NOT NULL CHECK (discount_amount >= 0),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON promo_redemptions (promo_code, redeemed_at DESC);

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source_product_id text,
  ADD COLUMN IF NOT EXISTS customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE reviews SET source_product_id=coalesce(source_product_id,product_id,legacy_payload->>'productId') WHERE source_product_id IS NULL;
ALTER TABLE reviews ALTER COLUMN source_product_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_customer_idx ON reviews (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

COMMIT;
