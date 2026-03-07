#!/usr/bin/env node

/**
 * Script para probar las rutas de API
 * Ejecutar con: node test-api-routes.js
 */

const API_BASE = 'https://galaxia-sw.vercel.app/api'; // Cambia esto por tu URL de Vercel

console.log('🧪 Probando rutas de API...');
console.log('API_BASE:', API_BASE);
console.log('========================================');

// Función para hacer requests de prueba
async function testEndpoint(endpoint, method = 'GET', body = null) {
  const url = `${API_BASE}${endpoint}`;
  console.log(`\n🔍 Probando ${method} ${endpoint}`);

  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.text();

    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Headers:`, Object.fromEntries(response.headers.entries()));

    try {
      const jsonData = JSON.parse(data);
      console.log(`Response:`, jsonData);
    } catch (e) {
      console.log(`Response (raw):`, data.substring(0, 200) + (data.length > 200 ? '...' : ''));
    }

    return { status: response.status, data };

  } catch (error) {
    console.error(`❌ Error:`, error.message);
    return { error: error.message };
  }
}

// Probar endpoints
async function runTests() {
  // Health check
  await testEndpoint('/health');

  // Test database
  await testEndpoint('/test-db');

  // Intentar login con datos de prueba (debería fallar pero mostrar si la ruta funciona)
  await testEndpoint('/auth/login', 'POST', {
    username: 'testuser',
    pin: '1234'
  });

  // Intentar registro con datos de prueba
  await testEndpoint('/auth/register', 'POST', {
    username: 'testuser_' + Date.now(),
    pin: '1234'
  });

  console.log('\n✅ Pruebas completadas');
  console.log('\n📝 Si ves errores de CORS, el problema está en la configuración del servidor');
  console.log('📝 Si ves errores 404, el problema está en las rutas de Vercel');
  console.log('📝 Si ves errores 500, el problema está en el código del servidor');
}

runTests().catch(console.error);
