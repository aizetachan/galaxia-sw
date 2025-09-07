// Script para probar que las funciones serverless funcionan correctamente
import healthHandler from './api/health.js';
import authHandler from './api/auth.js';
import catchAllHandler from './api/[...all].js';

async function testFunction(name, handler, event, context = {}) {
  console.log(`\n🧪 Probando función: ${name}`);
  console.log('📨 Event:', JSON.stringify(event, null, 2));

  try {
    const result = await handler(event, context);
    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.log('❌ Error:', error.message);
    throw error;
  }
}

async function runTests() {
  console.log('🚀 Probando funciones serverless...\n');

  try {
    // Test Health Check
    await testFunction('Health Check', healthHandler, {
      httpMethod: 'GET',
      path: '/api/health'
    });

    // Test Auth Register
    await testFunction('Auth Register', authHandler, {
      httpMethod: 'POST',
      path: '/api/auth/register',
      body: JSON.stringify({
        username: 'testuser',
        pin: '1234'
      })
    });

    // Test Auth Login
    await testFunction('Auth Login', authHandler, {
      httpMethod: 'POST',
      path: '/api/auth/login',
      body: JSON.stringify({
        username: 'testuser',
        pin: '1234'
      })
    });

    // Test Catch-all
    await testFunction('Catch-all', catchAllHandler, {
      method: 'GET',
      url: 'https://example.com/api/nonexistent'
    });

    console.log('\n🎉 Todas las funciones funcionan correctamente!');
    console.log('Las funciones están listas para Vercel.');

  } catch (error) {
    console.log('\n💥 Error en las pruebas:', error.message);
  }
}

runTests();
