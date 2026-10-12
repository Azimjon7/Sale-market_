BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id text PRIMARY KEY,
  source_checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),
  source_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text
);

CREATE TABLE IF NOT EXISTS migration_checkpoints (
  run_id text NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  source_key text NOT NULL,
  source_checksum text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, entity_type, source_key)
);

CREATE SEQUENCE IF NOT EXISTS product_sku_sequence START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public_order_sequence START WITH 1001;

CREATE TABLE IF NOT EXISTS app_counters (
  name text PRIMARY KEY,
  next_value bigint NOT NULL CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  sku text NOT NULL UNIQUE CHECK (sku ~ '^DOD-[0-9]{4,}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  old_price numeric(14,2) CHECK (old_price IS NULL OR old_price >= 0),
  inventory_mode text NOT NULL DEFAULT 'standard',
  accepts_mto boolean NOT NULL DEFAULT false,
  production_days integer CHECK (production_days IS NULL OR production_days >= 0),
  primary_image text,
  image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  legacy_payload jsonb NOT NULL,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS product_variants (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_type text NOT NULL CHECK (variant_type IN ('color', 'size')),
  value text NOT NULL,
  source_index integer NOT NULL CHECK (source_index >= 0),
  legacy_payload jsonb,
  UNIQUE (product_id, variant_type, source_index)
);

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL UNIQUE,
  email text NOT NULL,
  password_hash text NOT NULL,
  phone_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
  legacy_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_uq ON customers (lower(email));

CREATE TABLE IF NOT EXISTS customer_addresses (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  source_index integer NOT NULL CHECK (source_index >= 0),
  legacy_payload jsonb NOT NULL,
  UNIQUE (customer_id, source_index)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_type text NOT NULL CHECK (token_type IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL,
  legacy_payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_lookup_idx ON auth_tokens (token_type, token_hash) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_sessions (
  sid text PRIMARY KEY,
  session_payload jsonb NOT NULL,
  customer_id text REFERENCES customers(id) ON DELETE CASCADE,
  session_version integer,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_sessions_expires_idx ON customer_sessions (expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  public_order_number text NOT NULL UNIQUE CHECK (public_order_number ~ '^DOD-ORD-[0-9]{4,}$'),
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  submission_token text UNIQUE,
  guest_tracking_token_hash text UNIQUE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  delivery_address text NOT NULL,
  customer_note text NOT NULL DEFAULT '',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  promo_code text,
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  status text NOT NULL CHECK (status IN ('pending_confirmation','confirmed','payment_pending','production','shipped','delivered','rejected','cancelled')),
  payment_status text NOT NULL CHECK (payment_status IN ('pending','collected','failed')),
  payment_type text,
  payment_screenshot text,
  payment_collected_at timestamptz,
  payment_deadline timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  stock_committed boolean NOT NULL DEFAULT false,
  stock_restored boolean NOT NULL DEFAULT false,
  legacy_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, payment_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  source_product_id text,
  source_index integer NOT NULL CHECK (source_index >= 0),
  sku text,
  product_name text NOT NULL,
  color text,
  size text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  inventory_mode text,
  legacy_payload jsonb NOT NULL,
  UNIQUE (order_id, source_index)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_index integer NOT NULL CHECK (source_index >= 0),
  status text NOT NULL,
  changed_by text NOT NULL,
  reason text,
  metadata jsonb,
  changed_at timestamptz NOT NULL,
  UNIQUE (order_id, source_index)
);

CREATE TABLE IF NOT EXISTS order_payments (
  order_id text PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  method text,
  status text NOT NULL CHECK (status IN ('pending','collected','failed')),
  provider_verified boolean NOT NULL DEFAULT false,
  provider_reference text,
  collected_at timestamptz,
  legacy_payload jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS order_payments_provider_reference_uq ON order_payments (provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_levels (
  product_id text PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
  available integer NOT NULL CHECK (available >= 0),
  reserved integer NOT NULL CHECK (reserved >= 0),
  sold integer NOT NULL CHECK (sold >= 0),
  returned integer NOT NULL CHECK (returned >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  inventory_version integer NOT NULL DEFAULT 1 CHECK (inventory_version > 0),
  initialized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  source_product_id text NOT NULL,
  source_index integer NOT NULL CHECK (source_index >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  state text NOT NULL CHECK (state IN ('reserved','committed','restored','released')),
  inventory_version integer NOT NULL DEFAULT 1,
  reserved_at timestamptz NOT NULL,
  committed_at timestamptz,
  restored_at timestamptz,
  legacy_payload jsonb NOT NULL,
  UNIQUE (order_id, source_index)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  order_id text REFERENCES orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  quantity_change integer NOT NULL,
  old_balance integer NOT NULL CHECK (old_balance >= 0),
  new_balance integer NOT NULL CHECK (new_balance >= 0),
  reason text,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL,
  legacy_payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements (product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id bigserial PRIMARY KEY,
  source_index integer NOT NULL UNIQUE,
  name text NOT NULL,
  legacy_payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_codes (
  code text PRIMARY KEY,
  discount_percent numeric(6,2) NOT NULL CHECK (discount_percent >= 0),
  created_at timestamptz,
  legacy_payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  customer_name text,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  created_at timestamptz,
  legacy_payload jsonb NOT NULL
);

COMMIT;
