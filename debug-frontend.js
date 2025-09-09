#!/usr/bin/env node

/**
 * Script de diagnóstico para el frontend
 * Ejecutar en la consola del navegador
 */

console.log('🔍 Diagnóstico del Frontend - Galaxia SW');
console.log('==========================================');

// Verificar elementos DOM
console.log('\n📋 1. Elementos DOM:');
const elements = [
  'guest-card',
  'main-viewport',
  'input',
  'send',
  'server-status',
  'identity-bar'
];

elements.forEach(id => {
  const el = document.getElementById(id);
  console.log(`${id}: ${el ? '✅ Encontrado' : '❌ NO encontrado'}`);
  if (el && id === 'input') {
    console.log(`  - Placeholder actual: "${el.placeholder}"`);
    console.log(`  - Value: "${el.value}"`);
  }
  if (el && id === 'guest-card') {
    console.log(`  - Hidden: ${el.hidden}`);
    console.log(`  - Display: ${el.style.display}`);
    console.log(`  - Classes: ${el.className}`);
  }
});

// Verificar estado de autenticación
console.log('\n🔐 2. Estado de autenticación:');
try {
  const auth = JSON.parse(localStorage.getItem('sw:auth') || 'null');
  console.log('Auth en localStorage:', auth);
  console.log('Token presente:', !!(auth?.token));
  console.log('User presente:', !!(auth?.user));
  console.log('User ID:', auth?.user?.id || 'N/A');
} catch (e) {
  console.log('Error leyendo auth:', e.message);
}

// Verificar estado del onboarding
console.log('\n🎭 3. Estado del onboarding:');
try {
  const step = localStorage.getItem('sw:guest:step') || localStorage.getItem('sw:auth') ? localStorage.getItem(`sw:${JSON.parse(localStorage.getItem('sw:auth')).user.id}:step`) : null;
  const character = localStorage.getItem('sw:guest:char') || localStorage.getItem('sw:auth') ? localStorage.getItem(`sw:${JSON.parse(localStorage.getItem('sw:auth')).user.id}:char`) : null;

  console.log('Step actual:', step || 'N/A');
  console.log('Character presente:', !!character);
  if (character) {
    const charData = JSON.parse(character);
    console.log('Character name:', charData.name);
    console.log('Character species:', charData.species);
    console.log('Character role:', charData.role);
  }
} catch (e) {
  console.log('Error leyendo onboarding state:', e.message);
}

// Verificar clases del body
console.log('\n🎨 4. Clases del body:');
console.log('Body classes:', document.body.className);
console.log('is-guest:', document.body.classList.contains('is-guest'));
console.log('is-logged:', document.body.classList.contains('is-logged'));

// Verificar funciones globales
console.log('\n⚙️ 5. Funciones globales:');
console.log('window.render:', typeof window.render);
console.log('window.updatePlaceholder:', typeof window.updatePlaceholder);
console.log('window.isLogged:', typeof window.isLogged);

// Verificar API_BASE
console.log('\n🌐 6. Configuración API:');
console.log('API_BASE:', window.API_BASE || 'N/A');

// Probar health check
console.log('\n🏥 7. Health check:');
if (window.probeHealth) {
  window.probeHealth().then(result => {
    console.log('Health check result:', result);
  }).catch(error => {
    console.log('Health check error:', error);
  });
} else {
  console.log('probeHealth function not available');
}

// Verificar mensajes
console.log('\n💬 8. Mensajes:');
try {
  const auth = JSON.parse(localStorage.getItem('sw:auth') || 'null');
  const msgKey = auth?.user?.id ? `sw:${auth.user.id}:msgs` : 'sw:guest:msgs';
  const messages = JSON.parse(localStorage.getItem(msgKey) || '[]');
  console.log('Mensajes encontrados:', messages.length);
  if (messages.length > 0) {
    console.log('Último mensaje:', messages[messages.length - 1]);
  }
} catch (e) {
  console.log('Error leyendo mensajes:', e.message);
}

console.log('\n📝 Instrucciones para debugging:');
console.log('1. Ejecuta este script en la consola del navegador');
console.log('2. Compara los resultados con lo esperado');
console.log('3. Revisa los logs de la consola para errores');
console.log('4. Verifica que el placeholder del input se actualice correctamente');
console.log('5. Confirma que la guest card se oculte después del login');

console.log('\n🎯 Problemas comunes a verificar:');
console.log('- Step no se configura correctamente después del login');
console.log('- Placeholder no se actualiza cuando cambia el step');
console.log('- Token no se pasa correctamente a las llamadas API');
console.log('- Funciones globales no están disponibles');
console.log('- Elementos DOM no se encuentran');
