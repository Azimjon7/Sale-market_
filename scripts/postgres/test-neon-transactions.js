'use strict';
const { Pool } = require('pg');
const { postgresConfig } = require('../../utils/postgres/config');
const { applySchema } = require('../../utils/postgres/schema');
const { PostgresOrderInventoryRepository } = require('../../utils/postgres/orderInventoryRepository');

async function run() {
  const schema = `dodola_tx_test_${Date.now().toString(36)}`;
  const baseConfig = postgresConfig(), adminPool = new Pool({ ...baseConfig, max: 1 });
  let testPool;
  const result = { schemaCreated: false, schemaRemoved: false, duplicateOrderPrevented: false, oversellPrevented: false, releaseIdempotent: false, commitIdempotent: false, restoreIdempotent: false };
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`); result.schemaCreated = true;
    testPool = new Pool({ ...baseConfig, options: `-c search_path=${schema}`, max: 6 });
    await applySchema(testPool);
    await testPool.query(`INSERT INTO products (id,sku,name,price,legacy_payload) VALUES ('fixture-product','DOD-900000','Izolyatsiyalangan test',1000,'{}')`);
    await testPool.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned) VALUES ('fixture-product',5,0,0,0)`);
    const repository = new PostgresOrderInventoryRepository(testPool);
    const order = token => ({ submissionToken: token, items: [{ productId: 'fixture-product', name: 'Test', qty: 1, price: 1000 }], name: 'Fixture', phone: '+998000000000', address: 'Fixture', subtotal: 1000, total: 1000, status: 'payment_pending', paymentStatus: 'pending', paymentType: 'naqd' });

    const duplicate = await Promise.all([repository.placeOrder(order('fixture-idempotency-token')), repository.placeOrder(order('fixture-idempotency-token'))]);
    result.duplicateOrderPrevented = duplicate.filter(item => item.created).length === 1 && duplicate.filter(item => !item.created).length === 1 && duplicate[0].orderId === duplicate[1].orderId;
    const duplicateOrderId = duplicate[0].orderId;
    const firstRelease = await repository.releaseReservation(duplicateOrderId, 'test', 'Fixture cleanup');
    const secondRelease = await repository.releaseReservation(duplicateOrderId, 'test', 'Fixture cleanup');
    result.releaseIdempotent = firstRelease.changed && !secondRelease.changed;

    const oversellInput = token => ({ ...order(token), items: [{ productId: 'fixture-product', name: 'Test', qty: 3, price: 1000 }], subtotal: 3000, total: 3000 });
    const oversell = await Promise.allSettled([repository.placeOrder(oversellInput('fixture-over-a')), repository.placeOrder(oversellInput('fixture-over-b'))]);
    const successful = oversell.filter(item => item.status === 'fulfilled');
    const rejected = oversell.filter(item => item.status === 'rejected');
    const stockAfterOversell = (await testPool.query("SELECT available,reserved FROM inventory_levels WHERE product_id='fixture-product'")).rows[0];
    result.oversellPrevented = successful.length === 1 && rejected.length === 1 && Number(stockAfterOversell.available) === 2 && Number(stockAfterOversell.reserved) === 3;
    await repository.releaseReservation(successful[0].value.orderId, 'test', 'Fixture cleanup');

    const committed = await repository.placeOrder({ ...order('fixture-commit-token'), items: [{ productId: 'fixture-product', name: 'Test', qty: 2, price: 1000 }], subtotal: 2000, total: 2000 });
    const firstCommit = await repository.commitReservation(committed.orderId, 'test');
    const secondCommit = await repository.commitReservation(committed.orderId, 'test');
    result.commitIdempotent = firstCommit.changed && !secondCommit.changed;
    const firstRestore = await repository.releaseReservation(committed.orderId, 'test', 'Fixture cleanup');
    const secondRestore = await repository.releaseReservation(committed.orderId, 'test', 'Fixture cleanup');
    result.restoreIdempotent = firstRestore.changed && !secondRestore.changed;
    const finalStock = (await testPool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='fixture-product'")).rows[0];
    result.finalFixtureBalanceRestored = Number(finalStock.available) === 5 && Number(finalStock.reserved) === 0 && Number(finalStock.sold) === 0;
    result.ok = Object.entries(result).filter(([key]) => !['schemaCreated','schemaRemoved'].includes(key)).every(([, value]) => value === true);
  } finally {
    if (testPool) await testPool.end();
    if (result.schemaCreated) { await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); result.schemaRemoved = true; }
    await adminPool.end();
  }
  result.ok = result.ok && result.schemaCreated && result.schemaRemoved;
  return result;
}

if (require.main === module) run().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.ok ? 0 : 1; })
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'TRANSACTION_TEST_FAILED', message: error.message })}\n`); process.exitCode = 1; });
module.exports = { run };
