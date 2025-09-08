#!/usr/bin/env node

/**
 * Script para probar la funcionalidad de base de datos en Vercel
 * Ejecutar después del despliegue para verificar que todo funciona
 */

const BASE_URL = 'https://galaxia-sw-kepe.vercel.app';

async function testEndpoint(endpoint, description) {
  console.log(`\n🔍 Probando: ${description}`);
  console.log(`URL: ${BASE_URL}${endpoint}`);

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const data = await response.json();

    console.log(`Status: ${response.status}`);
    console.log(`Respuesta:`, JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log(`✅ ${description}: OK`);
      return true;
    } else {
      console.log(`❌ ${description}: ERROR`);
      return false;
    }
  } catch (error) {
    console.log(`❌ ${description}: ERROR - ${error.message}`);
    return false;
  }
}

async function testDatabaseConnection() {
  console.log('\n🗄️  Probando conexión a base de datos...\n');

  const results = await Promise.all([
    testEndpoint('/api/health', 'Health Check'),
    testEndpoint('/api/test-db', 'Database Test'),
  ]);

  const successCount = results.filter(Boolean).length;
  console.log(`\n📊 Resultados: ${successCount}/${results.length} tests pasaron`);

  if (successCount === results.length) {
    console.log('🎉 ¡Todas las pruebas pasaron! La base de datos está conectada correctamente.');
  } else {
    console.log('⚠️  Algunas pruebas fallaron. Revisa la configuración de DATABASE_URL en Vercel.');
  }

  return successCount === results.length;
}

async function testUserFlow() {
  console.log('\n👤 Probando flujo de usuario...\n');

  // Prueba de registro
  console.log('🔍 Probando registro de usuario de prueba...');
  try {
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testuser_' + Date.now(),
        pin: '1234'
      })
    });

    const registerData = await registerResponse.json();
    console.log('Registro:', JSON.stringify(registerData, null, 2));

    if (registerResponse.ok && registerData.token) {
      console.log('✅ Registro exitoso');

      // Extraer token para pruebas posteriores
      const token = registerData.token;

      // Prueba de login
      console.log('\n🔍 Probando login...');
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registerData.user.username,
          pin: '1234'
        })
      });

      const loginData = await loginResponse.json();
      console.log('Login:', JSON.stringify(loginData, null, 2));

      if (loginResponse.ok) {
        console.log('✅ Login exitoso');

        // Prueba de obtener personaje
        console.log('\n🔍 Probando obtención de personaje...');
        const characterResponse = await fetch(`${BASE_URL}/api/world/characters/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const characterData = await characterResponse.json();
        console.log('Personaje:', JSON.stringify(characterData, null, 2));

        // Prueba de historial de chat
        console.log('\n🔍 Probando historial de chat...');
        const historyResponse = await fetch(`${BASE_URL}/api/chat/history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const historyData = await historyResponse.json();
        console.log('Historial:', JSON.stringify(historyData, null, 2));

        return true;
      }
    }

  } catch (error) {
    console.log('❌ Error en flujo de usuario:', error.message);
  }

  return false;
}

// Ejecutar pruebas
async function main() {
  console.log('🚀 Iniciando pruebas de Galaxia SW en Vercel...\n');

  const dbOk = await testDatabaseConnection();
  const userOk = await testUserFlow();

  console.log('\n' + '='.repeat(60));
  console.log('📋 RESUMEN FINAL:');
  console.log(`Base de datos: ${dbOk ? '✅' : '❌'}`);
  console.log(`Flujo de usuario: ${userOk ? '✅' : '❌'}`);

  if (dbOk && userOk) {
    console.log('\n🎉 ¡TODO FUNCIONANDO PERFECTAMENTE!');
    console.log('Tu aplicación está lista para usar con base de datos persistente.');
  } else {
    console.log('\n⚠️  Hay problemas que resolver:');
    if (!dbOk) console.log('  - Verifica DATABASE_URL en Vercel');
    if (!userOk) console.log('  - Revisa logs de Vercel para errores');
  }
  console.log('='.repeat(60));
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testDatabaseConnection, testUserFlow, testEndpoint };
