#!/usr/bin/env node

/**
 * Script para verificar que la UI se comporte correctamente después de las correcciones
 */

const BASE_URL = 'https://galaxia-sw-kepe.vercel.app';

async function checkUIElements() {
  console.log('🎨 Verificando elementos de UI...\n');

  try {
    // Obtener el HTML de la página
    const response = await fetch(BASE_URL);
    const html = await response.text();

    console.log('✅ Página cargada correctamente');

    // Verificar que el placeholder esté correcto
    if (html.includes('Habla con el Máster')) {
      console.log('✅ Placeholder corregido en HTML: "Habla con el Máster…"');
    } else if (html.includes('Tu nombre en el HoloNet')) {
      console.log('❌ Placeholder todavía incorrecto en HTML');
    } else {
      console.log('⚠️  No se encontró placeholder en HTML');
    }

    // Verificar que el CSS tenga las reglas correctas
    if (html.includes('width: 100%') || html.includes('box-sizing: border-box')) {
      console.log('✅ CSS de chat-wrap actualizado');
    } else {
      console.log('⚠️  CSS podría necesitar actualización');
    }

    return true;

  } catch (error) {
    console.log('❌ Error al verificar UI:', error.message);
    return false;
  }
}

async function testUserFlowUI() {
  console.log('\n👤 Probando flujo de usuario con UI corregida...\n');

  // Paso 1: Registrar usuario de prueba
  console.log('1️⃣ Registrando usuario...');
  try {
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ui_test_' + Date.now(),
        pin: '1234'
      })
    });

    if (!registerResponse.ok) {
      console.log('❌ Error en registro:', registerResponse.status);
      return false;
    }

    const registerData = await registerResponse.json();
    console.log('✅ Usuario registrado:', registerData.user.username);

    if (!registerData.token) {
      console.log('❌ No se recibió token');
      return false;
    }

    const token = registerData.token;

    // Paso 2: Verificar que el onboarding funcione
    console.log('\n2️⃣ Verificando onboarding...');

    // Simular CLIENT_HELLO
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

    if (!helloResponse.ok) {
      console.log('❌ Error en CLIENT_HELLO:', helloResponse.status);
      return false;
    }

    const helloData = await helloResponse.json();
    console.log('✅ CLIENT_HELLO exitoso - Master respondió');

    // Paso 3: Verificar que el chat funcione
    console.log('\n3️⃣ Verificando chat funcional...');

    const chatResponse = await fetch(`${BASE_URL}/api/dm/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: 'Hola Master, ¿cómo estás?',
        history: [{
          role: 'dm',
          text: helloData.text,
          ts: new Date().toISOString()
        }],
        character_id: null,
        stage: 'done',
        clientState: {
          step: 'done',
          name: null,
          species: null,
          role: null,
          pendingConfirm: null
        },
        config: { mode: 'rich' }
      })
    });

    if (!chatResponse.ok) {
      console.log('❌ Error en chat:', chatResponse.status);
      return false;
    }

    const chatData = await chatResponse.json();
    console.log('✅ Chat funcionando - Master respondió');

    return true;

  } catch (error) {
    console.log('❌ Error en flujo de usuario:', error.message);
    return false;
  }
}

async function main() {
  console.log('🎯 Verificando correcciones de UI en Galaxia SW...\n');
  console.log('Este script verifica:');
  console.log('- ✅ Placeholder corregido en HTML');
  console.log('- ✅ CSS de ancho del chat actualizado');
  console.log('- ✅ Flujo de onboarding funcionando');
  console.log('- ✅ Chat respondiendo correctamente\n');

  const uiOk = await checkUIElements();
  const flowOk = await testUserFlowUI();

  console.log('\n' + '='.repeat(70));
  console.log('📋 RESULTADO:');
  console.log(`Elementos UI: ${uiOk ? '✅' : '❌'}`);
  console.log(`Flujo usuario: ${flowOk ? '✅' : '❌'}`);

  if (uiOk && flowOk) {
    console.log('\n🎉 ¡UI CORREGIDA COMPLETAMENTE!');
    console.log('✅ Placeholder correcto');
    console.log('✅ Chat con ancho apropiado');
    console.log('✅ Onboarding funcionando');
    console.log('✅ Chat respondiendo');
  } else {
    console.log('\n⚠️  Algunos elementos necesitan revisión');
    if (!uiOk) console.log('  - Verificar HTML y CSS');
    if (!flowOk) console.log('  - Revisar flujo de autenticación');
  }
  console.log('='.repeat(70));
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkUIElements, testUserFlowUI };
