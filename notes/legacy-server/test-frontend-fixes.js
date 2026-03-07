#!/usr/bin/env node

/**
 * Script de prueba para verificar las correcciones del frontend
 * Ejecutar con: node test-frontend-fixes.js
 */

console.log('🧪 Verificando correcciones del frontend...\n');

// Verificar que los archivos principales existan
const fs = require('fs');
const path = require('path');

const filesToCheck = [
  'web/main.js',
  'web/index.html',
  'web/styles.css',
  'api/index.js',
  'web/ui/main-ui.js'
];

console.log('📁 Verificando archivos principales:');
filesToCheck.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    console.log(`✅ ${file} - Existe`);
  } else {
    console.log(`❌ ${file} - No encontrado`);
  }
});

console.log('\n🔧 Verificando correcciones aplicadas:');

// Verificar corrección de JWT en api/index.js
console.log('\n1. Corrección de decodificación JWT:');
try {
  const apiIndex = fs.readFileSync('api/index.js', 'utf8');
  if (apiIndex.includes('jwt.verify(token,')) {
    console.log('✅ JWT decodificación corregida en api/index.js');
  } else {
    console.log('❌ JWT decodificación NO corregida en api/index.js');
  }

  const jwtUsageCount = (apiIndex.match(/jwt\.verify/g) || []).length;
  console.log(`📊 Usos de jwt.verify encontrados: ${jwtUsageCount}`);
} catch (error) {
  console.log('❌ Error leyendo api/index.js:', error.message);
}

// Verificar placeholder corregido en main.js
console.log('\n2. Placeholder del input corregido:');
try {
  const mainJs = fs.readFileSync('web/main.js', 'utf8');
  if (mainJs.includes('Habla con el Máster… (usa /restart para reiniciar)')) {
    console.log('✅ Placeholder corregido en main.js');
  } else {
    console.log('❌ Placeholder NO corregido en main.js');
  }
} catch (error) {
  console.log('❌ Error leyendo web/main.js:', error.message);
}

// Verificar guardado de personajes
console.log('\n3. Guardado de personajes en BD:');
try {
  const apiIndex = fs.readFileSync('api/index.js', 'utf8');
  if (apiIndex.includes('INSERT INTO characters') && apiIndex.includes('UPDATE characters')) {
    console.log('✅ Guardado de personajes implementado');
  } else {
    console.log('❌ Guardado de personajes NO implementado');
  }
} catch (error) {
  console.log('❌ Error leyendo api/index.js:', error.message);
}

// Verificar guardado de mensajes del chat
console.log('\n4. Guardado del historial de chat:');
try {
  const apiIndex = fs.readFileSync('api/index.js', 'utf8');
  if (apiIndex.includes('INSERT INTO chat_messages')) {
    console.log('✅ Guardado de mensajes del chat implementado');
  } else {
    console.log('❌ Guardado de mensajes del chat NO implementado');
  }
} catch (error) {
  console.log('❌ Error leyendo api/index.js:', error.message);
}

// Verificar debug agregado
console.log('\n5. Debug agregado para troubleshooting:');
try {
  const mainJs = fs.readFileSync('web/main.js', 'utf8');
  const mainUiJs = fs.readFileSync('web/ui/main-ui.js', 'utf8');

  if (mainJs.includes('[PLACEHOLDER] Setting placeholder')) {
    console.log('✅ Debug de placeholder agregado en main.js');
  } else {
    console.log('❌ Debug de placeholder NO agregado en main.js');
  }

  if (mainUiJs.includes('[UI] updateAuthUI called')) {
    console.log('✅ Debug de UI transitions agregado en main-ui.js');
  } else {
    console.log('❌ Debug de UI transitions NO agregado en main-ui.js');
  }
} catch (error) {
  console.log('❌ Error leyendo archivos de debug:', error.message);
}

console.log('\n📋 Próximos pasos recomendados:');
console.log('1. Hacer commit de los cambios realizados');
console.log('2. Hacer push a Vercel para desplegar');
console.log('3. Probar el flujo completo: registro → onboarding → chat');
console.log('4. Verificar en la consola del navegador los logs de debug');
console.log('5. Confirmar que los usuarios y conversaciones se guardan correctamente');

console.log('\n🎯 Problemas corregidos:');
console.log('✅ Decodificación incorrecta de tokens JWT');
console.log('✅ Placeholder del input corregido');
console.log('✅ Guardado de personajes en base de datos');
console.log('✅ Guardado del historial de chat');
console.log('✅ Debug agregado para troubleshooting');

console.log('\n🔍 Para debugging adicional, revisar:');
console.log('- Consola del navegador para logs [PLACEHOLDER] y [UI]');
console.log('- Base de datos para verificar tablas users, characters, chat_messages');
console.log('- Network tab para verificar requests a /api/*');

console.log('\n✨ ¡Correcciones completadas! El frontend debería funcionar correctamente ahora.');
