/**
 * Test script to verify both file upload and URL entry work for product creation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';

// Test data
const testProductBase = {
  name: 'Test Product',
  category: 'elektronika',
  description: 'This is a test product',
  price: 50000
};

/**
 * Test 1: Product with URL image only
 */
async function testURLOnlyProduct() {
  console.log('\n=== TEST 1: Product with URL image only ===');
  
  const product = {
    ...testProductBase,
    name: 'Test URL Product',
    imageUrl: 'https://via.placeholder.com/300x300?text=URL+Image'
  };

  try {
    const response = await makeRequest('POST', '/api/products', product);
    console.log('✓ Product created with URL:', response);
    return response;
  } catch (error) {
    console.error('✗ Failed:', error.message);
    return null;
  }
}

/**
 * Test 2: Product with file upload (simulated via path reference)
 * In real scenario, this would be multipart/form-data
 */
async function testFileUploadProduct() {
  console.log('\n=== TEST 2: Product with file upload (if file exists) ===');
  
  // Check if there's an existing image file we can reference
  const uploadsDir = path.join(__dirname, 'uploads');
  let existingFile = null;
  
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir).filter(f => 
      /\.(jpg|jpeg|png|webp|gif)$/i.test(f)
    );
    if (files.length > 0) {
      existingFile = files[0];
      console.log('Found existing file:', existingFile);
    }
  }

  if (existingFile) {
    const product = {
      ...testProductBase,
      name: 'Test File Product',
      images: [`/uploads/${existingFile}`]
    };

    try {
      const response = await makeRequest('POST', '/api/products', product);
      console.log('✓ Product created with file:', response);
      return response;
    } catch (error) {
      console.error('✗ Failed:', error.message);
      return null;
    }
  } else {
    console.log('⊘ No existing files to test with - skipping actual file upload test');
    console.log('   (File upload requires multipart/form-data which needs proper test framework)');
  }
}

/**
 * Test 3: Product with both URL and file
 */
async function testBothImagesProduct() {
  console.log('\n=== TEST 3: Product with both URL and file ===');
  
  const uploadsDir = path.join(__dirname, 'uploads');
  let existingFile = null;
  
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir).filter(f => 
      /\.(jpg|jpeg|png|webp|gif)$/i.test(f)
    );
    if (files.length > 0) {
      existingFile = files[0];
    }
  }

  const product = {
    ...testProductBase,
    name: 'Test Both Images Product',
    imageUrl: 'https://via.placeholder.com/300x300?text=URL+Image',
    ...(existingFile && { images: [`/uploads/${existingFile}`] })
  };

  try {
    const response = await makeRequest('POST', '/api/products', product);
    console.log('✓ Product created with both:', response);
    return response;
  } catch (error) {
    console.error('✗ Failed:', error.message);
    return null;
  }
}

/**
 * Test 4: Verify products appear in catalog
 */
async function testProductsListing() {
  console.log('\n=== TEST 4: Verify products in catalog ===');
  
  try {
    const response = await makeRequest('GET', '/api/products', null);
    console.log(`✓ Found ${response.length} products total`);
    
    // Show last 3 products
    console.log('\nRecent products:');
    response.slice(-3).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.images?.length || 0} images)`);
    });
    
    return response;
  } catch (error) {
    console.error('✗ Failed:', error.message);
    return null;
  }
}

/**
 * Make HTTP request
 */
function makeRequest(method, endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    
    let body = null;
    let contentType = 'application/json';
    
    if (data) {
      body = JSON.stringify(data);
    }

    const options = {
      method,
      headers: {
        'Content-Type': contentType,
        ...(global.authToken && { 'Authorization': `Bearer ${global.authToken}` }),
        ...(body && { 'Content-Length': Buffer.byteLength(body) })
      }
    };

    const req = http.request(url, options, (res) => {
      let responseData = '';

      res.on('data', chunk => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          } else {
            const parsed = responseData ? JSON.parse(responseData) : null;
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
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

/**
 * Login to get token
 */
async function login() {
  console.log('\n=== Logging in ===');
  
  const credentials = {
    username: process.env.ADMIN_USERNAME || 'Admin1',
    password: process.env.ADMIN_PASSWORD || 'Uzbekistan0000Azimjon0000'
  };

  try {
    const response = await makeRequest('POST', '/api/admin/login', credentials);
    if (response.token) {
      console.log('✓ Login successful, token obtained');
      return response.token;
    } else {
      throw new Error('No token in response');
    }
  } catch (error) {
    console.error('✗ Login failed:', error.message);
    process.exit(1);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('Starting product creation tests...');
  console.log(`Server: ${BASE_URL}`);
  
  try {
    const token = await login();
    
    // Store token in a way that makeRequest can use it
    global.authToken = token;
    
    await testURLOnlyProduct();
    await testFileUploadProduct();
    await testBothImagesProduct();
    await testProductsListing();
    
    console.log('\n=== All tests completed ===\n');
  } catch (error) {
    console.error('Test suite error:', error);
    process.exit(1);
  }
}

runTests();
