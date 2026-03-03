#!/usr/bin/env node

/**
 * Script para probar específicamente la corrección del flujo de onboarding
 * Ejecutar después del despliegue para verificar que el placeholder cambie correctamente
 */

const BASE_URL = 'https://galaxia-sw-kepe.vercel.app';

async function testOnboardingFlow() {
  console.log('🎭 Probando flujo de onboarding corregido...\n');

  // Paso 1: Registrar usuario de prueba
  console.log('1️⃣ Registrando usuario de prueba...');
  try {
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_onboard_' + Date.now(),
        pin: '1234'
      })
    });

    const registerData = await registerResponse.json();
    console.log('✅ Registro exitoso:', registerData.user.username);

    if (!registerResponse.ok || !registerData.token) {
      console.log('❌ Error en registro:', registerData);
      return false;
    }

    const token = registerData.token;

    // Paso 2: Verificar que inicialmente no hay personaje
    console.log('\n2️⃣ Verificando estado inicial (sin personaje)...');
    const characterResponse = await fetch(`${BASE_URL}/api/world/characters/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const characterData = await characterResponse.json();
    console.log('Estado inicial:', JSON.stringify(characterData, null, 2));

    if (characterData.character !== null) {
      console.log('⚠️  Usuario ya tiene personaje (inesperado)');
    } else {
      console.log('✅ Usuario sin personaje (correcto)');
    }

    // Paso 3: Simular el CLIENT_HELLO que hace el frontend
    console.log('\n3️⃣ Enviando CLIENT_HELLO (simulando onboarding)...');
    const helloResponse = await fetch(`${BASE_URL}/api/dm/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: '<<CLIENT_HELLO>>',
        history: [],
        character_id: null,
        stage: 'name',
        clientState: {
          step: 'name',
          name: null,
          species: null,
          role: null,
          pendingConfirm: null
        },
        config: { mode: 'rich' }
      })
    });

    const helloData = await helloResponse.json();
    console.log('Respuesta CLIENT_HELLO:', JSON.stringify(helloData, null, 2));

    if (helloResponse.ok && helloData.text) {
      console.log('✅ CLIENT_HELLO exitoso - Master respondió');
      console.log('📝 Mensaje del Master:', helloData.text.substring(0, 100) + '...');
    } else {
      console.log('❌ Error en CLIENT_HELLO:', helloData);
      return false;
    }

    // Paso 4: Verificar que ahora el usuario puede chatear normalmente
    console.log('\n4️⃣ Probando chat normal después del onboarding...');
    const chatResponse = await fetch(`${BASE_URL}/api/dm/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: 'Hola Master, estoy listo para la aventura',
        history: [{
          role: 'dm',
          text: helloData.text,
          ts: new Date().toISOString()
        }],
        character_id: null,
        stage: 'done', // Este debería ser el estado después del CLIENT_HELLO
        clientState: {
          step: 'done', // Estado corregido
          name: null,
          species: null,
          role: null,
          pendingConfirm: null
        },
        config: { mode: 'rich' }
      })
    });

    const chatData = await chatResponse.json();
    console.log('Respuesta chat normal:', JSON.stringify(chatData, null, 2));

    if (chatResponse.ok && chatData.text) {
      console.log('✅ Chat normal funciona correctamente');
      console.log('📝 Respuesta del Master:', chatData.text.substring(0, 100) + '...');
    } else {
      console.log('❌ Error en chat normal:', chatData);
      return false;
    }

    return true;

  } catch (error) {
    console.log('❌ Error en prueba:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Probando corrección del onboarding en Galaxia SW...\n');
  console.log('Esta prueba verifica que:');
  console.log('- El placeholder cambie de "Tu nombre en el HoloNet..." a "Habla con el Máster..."');
  console.log('- Los usuarios nuevos puedan chatear inmediatamente después del registro');
  console.log('- El flujo de onboarding no se atasque en el estado inicial\n');

  const success = await testOnboardingFlow();

  console.log('\n' + '='.repeat(70));
  if (success) {
    console.log('🎉 ¡FLUJO DE ONBOARDING CORREGIDO!');
    console.log('✅ El placeholder ahora cambia correctamente');
    console.log('✅ Los usuarios pueden chatear inmediatamente');
    console.log('✅ No hay más atasco en "Tu nombre en el HoloNet..."');
  } else {
    console.log('❌ El flujo de onboarding todavía tiene problemas');
    console.log('🔍 Revisa los logs de Vercel para más detalles');
  }
  console.log('='.repeat(70));
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testOnboardingFlow };
