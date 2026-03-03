#!/usr/bin/env node

/**
 * Script de validación para verificar todas las correcciones aplicadas
 * Ejecutar con: node test-validation.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';
let testResults = [];
let testCount = 0;

// Función para hacer peticiones HTTP
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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
  testCount++;
  console.log(`\n🧪 Test ${testCount}: ${name}`);

  try {
    const result = await testFn();
    testResults.push({ name, status: 'PASS', result });
    console.log(`✅ PASS: ${result}`);
  } catch (error) {
    testResults.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ FAIL: ${error.message}`);
  }
}

// Tests de validación
async function runAllTests() {
  console.log('🚀 Iniciando validación de correcciones aplicadas...\n');

  // Test 1: Verificar estado de la base de datos
  await runTest('Estado de base de datos (demo mode)', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/health',
      method: 'GET'
    });

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error('Health check failed');

    const dbConfigured = response.body.dbUrl;
    const dbConnected = response.body.db;

    if (dbConfigured && dbConnected) {
      return 'Base de datos PostgreSQL conectada correctamente';
    } else if (!dbConfigured && !dbConnected) {
      return 'Modo demo activado correctamente (sin DATABASE_URL)';
    } else {
      return 'Estado de base de datos verificado';
    }
  });

  // Test 2: Verificar registro en modo demo
  await runTest('Registro de usuario (modo demo)', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'test_validation', pin: '1234' });

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error(response.body.message || 'Registration failed');

    if (response.body.message.includes('modo demo')) {
      return 'Registro en modo demo funciona correctamente';
    } else {
      return 'Registro funciona correctamente';
    }
  });

  // Test 3: Verificar login
  let authToken = null;
  await runTest('Login de usuario', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'test_validation', pin: '1234' });

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error(response.body.message || 'Login failed');
    if (!response.body.token) throw new Error('No token received');

    authToken = response.body.token;
    return 'Login funciona correctamente';
  });

  // Test 4: Verificar endpoint /auth/me con token válido
  await runTest('Validación de token válido (/auth/me)', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error(response.body.message || 'Auth check failed');
    if (!response.body.user) throw new Error('No user data received');

    return 'Validación de token válido funciona correctamente';
  });

  // Test 5: Verificar endpoint /auth/me con token inválido
  await runTest('Validación de token inválido (/auth/me)', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/me',
      method: 'GET',
      headers: { 'Authorization': 'Bearer invalid_token_here' }
    });

    if (response.status !== 401) throw new Error(`Expected 401, got ${response.status}`);
    if (response.body.ok !== false) throw new Error('Should return ok: false');
    if (response.body.error !== 'UNAUTHORIZED') throw new Error('Should return UNAUTHORIZED error');

    return 'Validación de token inválido devuelve 401 correctamente';
  });

  // Test 6: Verificar CORS preflight (OPTIONS)
  await runTest('CORS preflight (OPTIONS)', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/login',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    if (response.status !== 204) throw new Error(`Expected 204, got ${response.status}`);

    const corsHeaders = response.headers;
    if (!corsHeaders['access-control-allow-origin']) throw new Error('Missing CORS origin header');
    if (!corsHeaders['access-control-allow-methods']) throw new Error('Missing CORS methods header');
    if (!corsHeaders['access-control-allow-headers']) throw new Error('Missing CORS headers header');

    return 'CORS preflight funciona correctamente';
  });

  // Test 7: Verificar endpoints básicos
  await runTest('Endpoint de test básico', async () => {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/test',
      method: 'GET'
    });

    if (response.status !== 200) throw new Error(`Status code: ${response.status}`);
    if (!response.body.ok) throw new Error('Test endpoint failed');

    return 'Endpoint de test funciona correctamente';
  });

  // Resumen de resultados
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE VALIDACIÓN');
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
  console.log(`Total: ${testCount} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n🎉 ¡Todas las validaciones pasaron exitosamente!');
    console.log('✅ Las correcciones aplicadas funcionan correctamente.');
  } else {
    console.log('\n⚠️  Algunas validaciones fallaron. Revisa los errores arriba.');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
}

// Ejecutar todas las pruebas
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { runAllTests };
