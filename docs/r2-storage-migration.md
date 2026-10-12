# Dodola R2 storage migration

The application continues to use local files unless `FILE_STORAGE_BACKEND=r2` is set in the server environment. `STORAGE_BACKEND` still controls business data and remains independent.

## Bucket separation

- `R2_BUCKET_NAME` is the public product/static asset bucket. Attach `R2_PUBLIC_BASE_URL` as its custom delivery domain.
- `R2_PRIVATE_BUCKET_NAME` is private. Do not attach a public domain or enable public access. Payment proofs are read only through the authenticated admin receipt route.
- Use an R2 API token limited to Object Read & Write on these buckets. Keep all credentials server-side.

## Safe workflow

1. Create both buckets and the restricted R2 API token.
2. Configure the variables listed in `.env.example` in a non-production test environment.
3. Generate a fresh inventory with `npm run storage:inventory`.
4. Review the no-network plan with `npm run storage:r2:dry-run`.
5. After explicit upload approval, run the apply command in the same trusted server environment:

   ```powershell
   $env:R2_MIGRATION_APPROVED='yes'
   node scripts/storage/migrate-images-to-r2.js --apply --confirm=UPLOAD_DODOLA_IMAGES_TO_R2
   ```

The apply command uploads known public product/static images and known private payment proofs. It excludes sidecars and unreferenced uploads. It never deletes local files. Each object receives SHA-256 metadata, is checked after upload, and is recorded in `.local-storage-migrations/r2-migration-state.json`. Re-running the same command skips exact matches and stops on a conflicting key.

## Cutover and rollback

Do not set `FILE_STORAGE_BACKEND=r2` until reconciliation and browser checks pass. Cutover only changes this variable and restarts the application; it does not rewrite product image references.

Rollback sets `FILE_STORAGE_BACKEND=local` and restarts the application. Local files remain the source for rollback because migration never deletes them. R2 cleanup is a separate, approval-gated operation and is intentionally not included in the migration script.

The BUYO `gallery-manifest.json` and `README.txt` files are rebuildable local sidecars. They are inventoried but not uploaded. Unreferenced images remain local for manual review and are not deleted.
