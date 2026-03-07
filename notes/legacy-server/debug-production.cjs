#!/usr/bin/env node

/**
 * Script de debugging para producción - GALAXIA SW
 * Ejecutar con: node debug-production.js
 *
 * Este script prueba todos los endpoints con logs detallados
 * para identificar problemas de sincronización y funcionamiento
 */

const https = require('https');

const BASE_URL = 'https://galaxia-sw-kepe.vercel.app';
let testResults = [];
let currentToken = null;

// Función para hacer peticiones HTTPS
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: jsonBody });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Función para ejecutar test
async function runTest(name, testFn) {
  console.log(`\n🧪 ${name}`);
  console.log('='.repeat(60));

  try {
    const result = await testFn();
    testResults.push({ name, status: 'PASS', result });
    console.log(`✅ PASS: ${result}`);
  } catch (error) {
    testResults.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ FAIL: ${error.message}`);
  }
}

// Tests de debugging
async function runAllTests() {
  console.log('🚀 DEBUGGING PRODUCTION - GALAXIA SW');
  console.log('====================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // Test 1: Health endpoint
  await runTest('1. HEALTH ENDPOINT', async () => {
    console.log('📋 Testing /api/health endpoint...');
    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/health',
      method: 'GET'
    });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error('Health check failed');

    return 'Health endpoint responding correctly';
  });

  // Test 2: Test DB endpoint
  await runTest('2. TEST DB ENDPOINT', async () => {
    console.log('📋 Testing /api/test-db endpoint...');
    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/test-db',
      method: 'GET'
    });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error('Test DB failed');

    return 'Database test endpoint working';
  });

  // Test 3: User registration
  await runTest('3. USER REGISTRATION', async () => {
    const username = `debug_${Date.now()}`;
    console.log(`📋 Testing user registration for: ${username}`);

    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: username, pin: '1234' });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error(response.body.message || 'Registration failed');
    if (!response.body.token) throw new Error('No token received');

    currentToken = response.body.token;
    console.log(`📋 Token received: ${currentToken.substring(0, 50)}...`);

    return `User ${username} registered successfully with ID: ${response.body.user.id}`;
  });

  // Test 4: User login
  await runTest('4. USER LOGIN', async () => {
    const username = `debug_${Date.now() - 1000}`; // Usar usuario del test anterior
    console.log(`📋 Testing user login for: ${username}`);

    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: username, pin: '1234' });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error(response.body.message || 'Login failed');
    if (!response.body.token) throw new Error('No token received');

    currentToken = response.body.token;
    console.log(`📋 Login token: ${currentToken.substring(0, 50)}...`);

    return `User ${username} logged in successfully`;
  });

  // Test 5: Auth me endpoint
  await runTest('5. AUTH ME ENDPOINT', async () => {
    console.log('📋 Testing /api/auth/me endpoint...');
    console.log(`📋 Using token: ${currentToken ? currentToken.substring(0, 50) + '...' : 'NO TOKEN'}`);

    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        'Authorization': currentToken ? `Bearer ${currentToken}` : '',
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) {
      console.log(`📋 ERROR: Expected 200, got ${response.status}`);
      console.log(`📋 This indicates token validation issues`);
      throw new Error(`Auth check failed with status ${response.status}`);
    }

    if (!response.body.ok) {
      console.log(`📋 ERROR: Response not ok:`, response.body);
      throw new Error(response.body.message || 'Auth check failed');
    }

    if (!response.body.user) {
      console.log(`📋 ERROR: No user data in response`);
      throw new Error('No user data received');
    }

    return `Auth successful for user: ${response.body.user.username} (ID: ${response.body.user.id})`;
  });

  // Test 6: Characters endpoint (sin personaje)
  await runTest('6. CHARACTERS ENDPOINT (sin personaje)', async () => {
    console.log('📋 Testing /api/world/characters/me endpoint...');
    console.log(`📋 Using token: ${currentToken ? currentToken.substring(0, 50) + '...' : 'NO TOKEN'}`);

    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/world/characters/me',
      method: 'GET',
      headers: {
        'Authorization': currentToken ? `Bearer ${currentToken}` : '',
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Response:`, JSON.stringify(response.body, null, 2));

    if (response.status !== 200) {
      console.log(`📋 ERROR: Expected 200, got ${response.status}`);
      throw new Error(`Characters endpoint failed with status ${response.status}`);
    }

    if (!response.body.ok) {
      console.log(`📋 ERROR: Response not ok:`, response.body);
      throw new Error(response.body.message || 'Characters check failed');
    }

    if (response.body.character !== null) {
      return `Character found: ${response.body.character.name}`;
    } else {
      return 'No character found (expected - user needs onboarding)';
    }
  });

  // Test 7: CORS preflight
  await runTest('7. CORS PREFLIGHT', async () => {
    console.log('📋 Testing CORS preflight OPTIONS...');

    const response = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/login',
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://galaxia-sw-kepe.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    console.log(`📋 Status: ${response.status}`);
    console.log(`📋 Headers:`, response.headers);

    if (response.status !== 204) {
      console.log(`📋 WARNING: Expected 204 for OPTIONS, got ${response.status}`);
      console.log(`📋 This indicates CORS preflight issues`);
    }

    const corsHeaders = response.headers;
    if (!corsHeaders['access-control-allow-origin']) {
      console.log(`📋 ERROR: Missing CORS origin header`);
      throw new Error('Missing CORS origin header');
    }

    return 'CORS preflight headers configured';
  });

  // Resumen de resultados
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE DEBUGGING');
  console.log('='.repeat(60));

  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;

  testResults.forEach((test, index) => {
    const icon = test.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} Test ${index + 1}: ${test.name}`);
    if (test.status === 'FAIL') {
      console.log(`   Error: ${test.error}`);
    }
  });

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${testResults.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n🎉 ¡Todas las pruebas pasaron exitosamente!');
    console.log('✅ Los logs detallados han sido añadidos y están funcionando.');
  } else {
    console.log('\n⚠️  Algunas pruebas fallaron.');
    console.log('📋 Los logs en Vercel mostrarán información detallada para debugging.');
    console.log('🔍 Revisa los Function Logs en el dashboard de Vercel.');
  }

  console.log('\n' + '='.repeat(60));
  console.log('📋 LOGS DISPONIBLES EN VERCEL:');
  console.log('1. Ve a https://vercel.com/dashboard');
  console.log('2. Selecciona tu proyecto galaxia-sw');
  console.log('3. Ve a Functions → function-name');
  console.log('4. Revisa los logs con prefijos: [DB], [REGISTER], [LOGIN], [AUTH], [WORLD]');
  console.log('='.repeat(60));
}

// Ejecutar todas las pruebas
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ Error ejecutando pruebas:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests };
