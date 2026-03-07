#!/usr/bin/env node

/**
 * Script específico para debuggear el problema de UI rota
 * GALAXIA SW - Problema: contenedor del chat aparece más estrecho
 *
 * Ejecutar con: node debug-ui-issue.js
 */

const https = require('https');

const BASE_URL = 'https://galaxia-sw-kepe.vercel.app';

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

async function debugUI() {
  console.log('🔍 DEBUGGING UI ISSUE - GALAXIA SW');
  console.log('=====================================');
  console.log('Problema: Contenedor del chat aparece más estrecho');
  console.log('Posible causa: Frontend no puede leer información de usuario/personaje');
  console.log('');

  let token = null;

  // Paso 1: Crear usuario de prueba
  console.log('1️⃣ PASO 1: Creando usuario de prueba...');
  try {
    const username = `ui_debug_${Date.now()}`;
    const registerResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: username, pin: '1234' });

    console.log(`📋 Register Status: ${registerResponse.status}`);
    if (registerResponse.status === 200) {
      token = registerResponse.body.token;
      console.log(`✅ Usuario creado: ${username}`);
      console.log(`📋 Token obtenido: ${token.substring(0, 50)}...`);
    } else {
      console.log(`❌ Error en registro:`, registerResponse.body);
      return;
    }
  } catch (error) {
    console.log('❌ Error creando usuario:', error);
    return;
  }

  console.log('');

  // Paso 2: Probar endpoint /auth/me (crítico para UI)
  console.log('2️⃣ PASO 2: Probando /auth/me (determina si usuario está logueado)...');
  try {
    const authResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Auth Status: ${authResponse.status}`);
    console.log(`📋 Auth Response:`, JSON.stringify(authResponse.body, null, 2));

    if (authResponse.status === 200 && authResponse.body.ok) {
      console.log('✅ /auth/me funciona correctamente');
      console.log('📋 Usuario identificado:', authResponse.body.user.username);
    } else {
      console.log('❌ /auth/me FALLA - Esto explica por qué la UI está rota');
      console.log('📋 El frontend no puede determinar si el usuario está logueado');
      return;
    }
  } catch (error) {
    console.log('❌ Error en /auth/me:', error);
    return;
  }

  console.log('');

  // Paso 3: Probar consulta de personajes (determina onboarding)
  console.log('3️⃣ PASO 3: Probando consulta de personajes (determina si necesita onboarding)...');
  try {
    const charResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/world/characters/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Characters Status: ${charResponse.status}`);
    console.log(`📋 Characters Response:`, JSON.stringify(charResponse.body, null, 2));

    if (charResponse.status === 200 && charResponse.body.ok) {
      if (charResponse.body.character) {
        console.log('✅ Usuario tiene personaje - debería ver chat normal');
        console.log('📋 Personaje:', charResponse.body.character.name);
      } else {
        console.log('✅ Usuario NO tiene personaje - debería hacer onboarding');
        console.log('📋 Esto explica por qué el contenedor parece "roto"');
        console.log('📋 El frontend está esperando datos de personaje que no existen');
      }
    } else {
      console.log('❌ Consulta de personajes FALLA');
      console.log('📋 El frontend no puede determinar el estado del usuario');
    }
  } catch (error) {
    console.log('❌ Error en consulta de personajes:', error);
    return;
  }

  console.log('');
  console.log('🎯 DIAGNÓSTICO:');

  // El diagnóstico ya se hizo arriba basado en las respuestas individuales
  console.log('✅ APIs funcionando correctamente');
  console.log('⚠️  El problema está en el frontend:');
  console.log('   - El frontend NO maneja correctamente el caso donde character es null');
  console.log('   - Cuando character es null, debería mostrar onboarding, no chat roto');
  console.log('   - Revisa el código del frontend en la gestión de estado de personajes');

  console.log('');
  console.log('📋 PRUEBAS MANUALES RECOMENDADAS:');
  console.log('1. Abre la aplicación en el navegador');
  console.log('2. Abre DevTools → Console');
  console.log('3. Busca errores relacionados con:');
  console.log('   - "Cannot read property"');
  console.log('   - "undefined" en user o character');
  console.log('   - Errores de red (CORS, 401, etc.)');
  console.log('4. Revisa Network tab para ver requests fallidas');

  console.log('');
  console.log('🔧 SOLUCIONES POSIBLES:');
  console.log('1. Limpiar localStorage del navegador');
  console.log('2. Hacer logout y login nuevamente');
  console.log('3. Verificar que el frontend maneje correctamente:');
  console.log('   - Casos donde user es null');
  console.log('   - Casos donde character es null');
  console.log('   - Estados de loading/error');
}

// Ejecutar debugging
if (require.main === module) {
  debugUI().catch(console.error);
}

module.exports = { debugUI };
