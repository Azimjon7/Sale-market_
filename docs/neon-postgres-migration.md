# Dodola JSON → Neon PostgreSQL migration runbook

## Safety state

The application continues to use JSON because `STORAGE_BACKEND=json` is the default. The PostgreSQL schema, importer, session store, and transactional order/inventory repository are dormant until a separately approved cutover. The migration command performs a local, no-network dry run unless both `--apply` and the exact confirmation flag are provided and `ALLOW_POSTGRES_IMPORT=yes` is present in the server process environment.

Never put a Neon connection string in browser JavaScript, command history, source control, or logs. Configure it only in the server environment.

## Environment variables

- `DATABASE_URL`: server-side Neon connection string for the intended branch/database.
- `DATABASE_SSL_MODE`: `require` by default; `verify-full` when the runtime has a trusted CA chain; `disable` is only for an isolated local database.
- `DATABASE_POOL_MAX`: maximum pool size, default `10`.
- `DATABASE_CONNECT_TIMEOUT_MS`: connection timeout, default `10000`.
- `STORAGE_BACKEND`: keep `json` until cutover approval and final dual-read verification.
- `ALLOW_POSTGRES_IMPORT`: one-shot importer gate; default `no`.
- `ALLOW_POSTGRES_ROLLBACK`: one-shot rollback gate; default `no`.

The existing `JWT_SECRET`, `CUSTOMER_SESSION_SECRET`, admin credentials, Resend variables, and CSRF/session behavior remain separate from database configuration.

## Prepared workflow

1. Create a separate Neon test branch from the intended baseline. Do not use the `production` branch.
2. Set `DATABASE_URL` for that test branch in the server process only.
3. Run `npm run db:dry-run`. This reads JSON, verifies keys/references/inventory, calculates a source checksum, and makes no database connection.
4. For an explicitly approved test-branch import, set `ALLOW_POSTGRES_IMPORT=yes` only for the one process and run:
   `node scripts/postgres/migrate-json-to-postgres.js --apply --confirm=IMPORT_TO_CONFIGURED_DATABASE`
5. Run `npm run db:reconcile` against the same branch. Any mismatch blocks cutover.
6. Exercise login, sessions, product/SKU search, checkout idempotency, payment verification, stock reserve/commit/release, admin actions, guest tracking, and password-reset token use against the test branch.
7. Take a fresh JSON backup and a Neon branch restore point immediately before the separately approved production import.
8. Put writes into a short maintenance window, repeat dry-run and checksum comparison, import once, reconcile, then switch `STORAGE_BACKEND` only after explicit cutover approval.

The importer uses a deterministic run ID derived from the complete source checksum. Each row has its own checksum checkpoint. A retry skips matching completed rows and refuses a changed row. Existing target primary keys or unique values fail rather than being overwritten.

## Rollback

The preferred production rollback is restoring or resetting the Neon branch to its pre-import restore point, then returning `STORAGE_BACKEND=json`. The included rollback script is restricted to an otherwise dedicated migration branch. It refuses deletion if protected table counts indicate post-import records. It additionally requires a run ID, `--confirm=ROLLBACK_CONFIGURED_DATABASE`, and `ALLOW_POSTGRES_ROLLBACK=yes`.

Rollback cannot safely merge database writes made after cutover back into the old JSON files. Therefore production cutover requires a maintenance window or a separately implemented dual-write/outbox phase.

## Image storage blocker

PostgreSQL stores image paths and preserves each product's full legacy JSON, but it does not upload the image binaries. The current `uploads/` and `img/` files remain on local disk. Before production deployment, move them to durable object storage, preserve their paths or establish a URL mapping, verify all hashes, and configure backups. Database cutover alone does not make images durable.

## Historical references

Some historical order items refer to product IDs that no longer exist in the current catalog. The schema preserves the original ID in `order_items.source_product_id` and the complete item in `legacy_payload`; its optional foreign key is left null. Active inventory reservations must reference a current product and fail validation otherwise.
