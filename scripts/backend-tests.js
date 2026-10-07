(async function(){
  try{
    const base = 'http://localhost:5003';
    const out = (msg,data)=>console.log(JSON.stringify({msg,data},null,2));

    const pRes = await fetch(base + '/api/products');
    if(!pRes.ok){ out('products_failed',{status:pRes.status}); process.exit(1);} 
    const products = await pRes.json();
    out('products_ok',{count: Array.isArray(products)?products.length:0});
    const first = (products||[])[0];
    if(!first){ out('no_products','skip other tests'); process.exit(0);} 

    // promocode apply
    const promoRes = await fetch(base + '/api/promocodes/apply', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code:'SALE10', subtotal:100000})});
    const promoData = await promoRes.text();
    out('promocode_apply',{status:promoRes.status, body: promoData});

    // post review
    const reviewPayload = { productId: String(first.id), name: 'Test User', rating: 5, review: 'Autotest review' };
    const revRes = await fetch(base + '/api/reviews', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(reviewPayload)});
    const revData = await revRes.text();
    out('post_review',{status: revRes.status, body: revData});

    // place order (naqd)
    const orderPayload = {
      name: 'Test Buyer', phone: '901234567', address: 'Toshkent', items: [{ productId: String(first.id), qty: 1 }], subtotal: first.price || 10000, total: first.price || 10000
    };
    const ordRes = await fetch(base + '/api/orders', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(orderPayload)});
    const ordData = await ordRes.text();
    out('post_order',{status: ordRes.status, body: ordData});

    console.log('\nALL TESTS DONE');
  }catch(err){ console.error('ERROR', err.stack||err); process.exit(1);} 
})();
