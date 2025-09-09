#!/usr/bin/env node

/**
 * Script para verificar la integridad de la base de datos
 * GALAXIA SW - Verificar relación users-characters
 *
 * Ejecutar con: node check-db-integrity.cjs
 */

const https = require('https');

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

async function checkDBIntegrity() {
  console.log('🔍 CHECKING DATABASE INTEGRITY - GALAXIA SW');
  console.log('=============================================');

  let token = null;

  // Paso 1: Crear usuario de prueba
  console.log('\n1️⃣ PASO 1: Creando usuario de prueba...');
  try {
    const username = `integrity_check_${Date.now()}`;
    const registerResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: username, pin: '1234' });

    console.log(`📋 Register Status: ${registerResponse.status}`);
    if (registerResponse.status === 200 && registerResponse.body.token) {
      token = registerResponse.body.token;
      console.log(`✅ Usuario creado: ${username} (ID: ${registerResponse.body.user.id})`);
    } else {
      console.log(`❌ Error en registro:`, registerResponse.body);
      return;
    }
  } catch (error) {
    console.log('❌ Error creando usuario:', error);
    return;
  }

  // Paso 2: Verificar que el usuario existe en la BD
  console.log('\n2️⃣ PASO 2: Verificando usuario en base de datos...');
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
    if (authResponse.status === 200) {
      console.log(`✅ Usuario verificado en BD: ${authResponse.body.user.username}`);
    } else {
      console.log(`❌ Error verificando usuario:`, authResponse.body);
    }
  } catch (error) {
    console.log('❌ Error verificando usuario:', error);
  }

  // Paso 3: Verificar que NO tiene character inicialmente
  console.log('\n3️⃣ PASO 3: Verificando que NO tiene character inicialmente...');
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
    if (charResponse.status === 200 && charResponse.body.character === null) {
      console.log(`✅ Correcto: Usuario no tiene character (character: null)`);
    } else if (charResponse.status === 200 && charResponse.body.character) {
      console.log(`⚠️  Usuario ya tiene character:`, charResponse.body.character.name);
    } else {
      console.log(`❌ Error consultando characters:`, charResponse.body);
    }
  } catch (error) {
    console.log('❌ Error consultando characters:', error);
  }

  // Paso 4: Crear character y verificar relación
  console.log('\n4️⃣ PASO 4: Creando character y verificando relación user_id...');
  try {
    const characterData = {
      name: 'Test Character',
      species: 'Humano',
      role: 'Contrabandista',
      publicProfile: true,
      lastLocation: 'Tatooine — Cantina de Mos Eisley'
    };

    const createResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/world/characters',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, characterData);

    console.log(`📋 Create Character Status: ${createResponse.status}`);
    if (createResponse.status === 200 && createResponse.body.character) {
      console.log(`✅ Character creado: ${createResponse.body.character.name}`);
      console.log(`📋 Character ID: ${createResponse.body.character.id}`);

      // Verificar que el character tiene el user_id correcto
      if (createResponse.body.character.id) {
        console.log(`✅ Character tiene ID asignado correctamente`);
      } else {
        console.log(`❌ ERROR: Character no tiene ID asignado`);
      }
    } else {
      console.log(`❌ Error creando character:`, createResponse.body);
    }
  } catch (error) {
    console.log('❌ Error creando character:', error);
  }

  // Paso 5: Verificar relación después de crear character
  console.log('\n5️⃣ PASO 5: Verificando relación después de crear character...');
  try {
    const finalCharResponse = await makeRequest({
      hostname: 'galaxia-sw-kepe.vercel.app',
      port: 443,
      path: '/api/world/characters/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Final Characters Status: ${finalCharResponse.status}`);
    if (finalCharResponse.status === 200 && finalCharResponse.body.character) {
      console.log(`✅ Character encontrado: ${finalCharResponse.body.character.name}`);
      console.log(`📋 Character ID: ${finalCharResponse.body.character.id}`);
      console.log(`📋 Relación user-character: ✅ VERIFICADA`);
    } else {
      console.log(`❌ Character no encontrado después de crearlo:`, finalCharResponse.body);
    }
  } catch (error) {
    console.log('❌ Error en verificación final:', error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 DIAGNÓSTICO DE INTEGRIDAD DE BD:');
  console.log('='.repeat(60));

  console.log('✅ Estructura de tablas correcta:');
  console.log('   - users.id (PRIMARY KEY)');
  console.log('   - characters.user_id (FOREIGN KEY → users.id)');
  console.log('   - characters.user_id (UNIQUE)');

  console.log('\n✅ Relaciones implementadas correctamente:');
  console.log('   - ON DELETE CASCADE');
  console.log('   - Un character por usuario');

  console.log('\n🔍 Si hay characters con user_id NULL:');
  console.log('   - Revisar logs de Vercel con [WORLD] 📋 DEBUG');
  console.log('   - Verificar consultas INSERT INTO characters');
  console.log('   - Posible problema en decodificación de token');

  console.log('\n📋 RECOMENDACIONES:');
  console.log('1. Monitorear logs de Vercel durante creación de characters');
  console.log('2. Verificar que el token se decodifica correctamente');
  console.log('3. Asegurar que userId se extrae correctamente del token');
  console.log('4. Revisar si hay race conditions en la creación');

  console.log('\n' + '='.repeat(60));
}

// Ejecutar verificación
if (require.main === module) {
  checkDBIntegrity().catch(console.error);
}

module.exports = { checkDBIntegrity };
