/**
 * Test script to verify POST /api/products endpoint with inventoryMode support
 * Using Node.js built-in http module only - no external dependencies
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Create multipart form data manually
 */
function createFormData(fields) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2);
  const image = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd0, 0xff, 0xd9
  ]);

  let body = '';
  
  // Add fields
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      body += `${value}\r\n`;
    }
  });

  // Add image
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n`;
  body += `Content-Type: image/jpeg\r\n\r\n`;

  const bodyBuffer = Buffer.from(body, 'utf8');
  const endBoundary = `\r\n--${boundary}--\r\n`;

  return {
    boundary,
    body: Buffer.concat([bodyBuffer, image, Buffer.from(endBoundary)])
  };
}

async function makeRequest(method, endpoint, fields, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    
    let body = null;
    let headers = {
      ...(token && { 'Authorization': `Bearer ${token}` })
    };

    if (method === 'POST' && fields) {
      const formData = createFormData(fields);
      body = formData.body;
      headers['Content-Type'] = `multipart/form-data; boundary=${formData.boundary}`;
      headers['Content-Length'] = body.length;
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname + url.search,
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function runTests() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║  POST /api/products - Inventory Mode Tests                 ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝\n', 'blue');

  let token = null;
  let testsPassed = 0;
  let testsFailed = 0;

  // Step 1: Login
  log('Step 1: Authenticating...', 'yellow');
  try {
    const loginResp = await makeRequest('POST', '/api/admin/login', {
      username: process.env.ADMIN_USERNAME || 'Admin1',
      password: process.env.ADMIN_PASSWORD || 'Uzbekistan0000Azimjon0000'
    });
    
    if (loginResp.status === 200 && loginResp.body.token) {
      token = loginResp.body.token;
      log('✓ Authentication successful\n', 'green');
    } else {
      log('✗ Authentication failed', 'red');
      process.exit(1);
    }
  } catch (err) {
    log(`✗ Authentication error: ${err.message}`, 'red');
    process.exit(1);
  }

  // Test 1: Default inventoryMode
  log('Test 1: Create product with default inventoryMode="standard"', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'Default Mode Product',
      category: 'Electronics',
      desc: 'Testing default inventory mode',
      price: 100000,
      stock: 50
    }, token);

    if (resp.status === 200 && resp.body.product._inventoryMode === 'standard') {
      log('✓ PASS: Default mode is "standard"', 'green');
      log(`  - _acceptsMTO: ${resp.body.product._acceptsMTO}`, 'green');
      log(`  - _productionDays: ${resp.body.product._productionDays}`, 'green');
      log(`  - _buyo_id: ${resp.body.product._buyo_id}\n`, 'green');
      testsPassed++;
    } else {
      log(`✗ FAIL: Expected inventoryMode="standard", got: ${resp.body.product?._inventoryMode}`, 'red');
      log(`  Status: ${resp.status}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Test 2: Explicit inventoryMode=made-to-order
  log('Test 2: Create product with inventoryMode="made-to-order"', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'MTO Product',
      category: 'Custom',
      desc: 'Testing made-to-order mode',
      price: 150000,
      stock: 0,
      inventoryMode: 'made-to-order',
      _acceptsMTO: 'true',
      _productionDays: 21,
      _buyo_id: 'buyo_test123'
    }, token);

    if (resp.status === 200 && resp.body.product._inventoryMode === 'made-to-order') {
      log('✓ PASS: Mode is "made-to-order"', 'green');
      log(`  - _acceptsMTO: ${resp.body.product._acceptsMTO}`, 'green');
      log(`  - _productionDays: ${resp.body.product._productionDays}`, 'green');
      log(`  - _buyo_id: ${resp.body.product._buyo_id}\n`, 'green');
      testsPassed++;
    } else {
      log(`✗ FAIL: Expected inventoryMode="made-to-order", got: ${resp.body.product?._inventoryMode}`, 'red');
      log(`  Status: ${resp.status}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Test 3: Invalid inventoryMode
  log('Test 3: Reject invalid inventoryMode', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'Invalid Mode Product',
      category: 'Test',
      desc: 'Testing invalid mode',
      price: 100000,
      stock: 50,
      inventoryMode: 'invalid-mode'
    }, token);

    if (resp.status === 400 && resp.body.success === false) {
      log('✓ PASS: Invalid mode rejected with 400 error', 'green');
      log(`  - Error: ${resp.body.message}`, 'green');
      log(`  - Details: ${JSON.stringify(resp.body.details)}\n`, 'green');
      testsPassed++;
    } else {
      log(`✗ FAIL: Expected 400 error, got: ${resp.status}`, 'red');
      log(`  Response: ${JSON.stringify(resp.body)}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Test 4: Invalid fuzzy mode like "mto"
  log('Test 4: Reject fuzzy invalid mode "mto"', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'Fuzzy Mode Product',
      category: 'Test',
      desc: 'Testing fuzzy mode',
      price: 100000,
      stock: 50,
      inventoryMode: 'mto'
    }, token);

    if (resp.status === 400 && resp.body.success === false) {
      log('✓ PASS: Fuzzy mode "mto" rejected with 400 error', 'green');
      log(`  - Error: ${resp.body.message}\n`, 'green');
      testsPassed++;
    } else {
      log(`✗ FAIL: Expected 400 error, got: ${resp.status}`, 'red');
      log(`  Response: ${JSON.stringify(resp.body)}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Test 5: Custom _productionDays
  log('Test 5: Custom _productionDays value', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'Custom Production Days',
      category: 'Test',
      desc: 'Testing custom production days',
      price: 100000,
      stock: 0,
      inventoryMode: 'made-to-order',
      _productionDays: 28
    }, token);

    if (resp.status === 200 && resp.body.product._productionDays === 28) {
      log('✓ PASS: Custom _productionDays=28 accepted', 'green');
      log(`  - Value stored: ${resp.body.product._productionDays}\n`, 'green');
      testsPassed++;
    } else {
      log(`✗ FAIL: Expected _productionDays=28, got: ${resp.body.product?._productionDays}`, 'red');
      log(`  Status: ${resp.status}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Test 6: All fields in response
  log('Test 6: All new fields present in response', 'yellow');
  try {
    const resp = await makeRequest('POST', '/api/products', {
      name: 'Complete Product',
      category: 'Test',
      desc: 'Testing all fields',
      price: 100000,
      stock: 50,
      inventoryMode: 'made-to-order',
      _acceptsMTO: 'true',
      _productionDays: 14,
      _buyo_id: 'buyo_complete'
    }, token);

    if (resp.status === 200) {
      const product = resp.body.product;
      const hasAllFields = product._inventoryMode && product._acceptsMTO !== undefined && 
                           product._productionDays && product._buyo_id;
      
      if (hasAllFields) {
        log('✓ PASS: All new fields present in response', 'green');
        log(`  - _inventoryMode: ${product._inventoryMode}`, 'green');
        log(`  - _acceptsMTO: ${product._acceptsMTO}`, 'green');
        log(`  - _productionDays: ${product._productionDays}`, 'green');
        log(`  - _buyo_id: ${product._buyo_id}\n`, 'green');
        testsPassed++;
      } else {
        log('✗ FAIL: Missing new fields in response', 'red');
        log(`  Response: ${JSON.stringify(product)}\n`, 'red');
        testsFailed++;
      }
    } else {
      log(`✗ FAIL: Status ${resp.status}`, 'red');
      log(`  Response: ${JSON.stringify(resp.body)}\n`, 'red');
      testsFailed++;
    }
  } catch (err) {
    log(`✗ FAIL: ${err.message}\n`, 'red');
    testsFailed++;
  }

  // Summary
  log('╔════════════════════════════════════════════════════════════╗', 'blue');
  log(`║  Test Results: ${testsPassed} passed, ${testsFailed} failed                        ║`, 'blue');
  log('╚════════════════════════════════════════════════════════════╝\n', 'blue');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  log(`Fatal error: ${err.message}`, 'red');
  process.exit(1);
});
