#!/usr/bin/env node

/**
 * Script para debuggear problemas de registro desde el navegador
 * GALAXIA SW - Ejecutar en consola del navegador
 */

// Código para ejecutar en la consola del navegador
const debugCode = `
// DEBUG: Verificar estado inicial
console.log('=== DEBUG REGISTRO ===');
console.log('API_BASE:', window.API_BASE);
console.log('AUTH actual:', window.AUTH);
console.log('isLogged():', window.isLogged?.());

// DEBUG: Simular registro manual
async function debugRegister() {
  const username = 'debug_test_' + Date.now();
  const pin = '1234';

  console.log('Registrando usuario:', username, 'PIN:', pin);

  try {
    const response = await window.api('/auth/register', { username, pin });
    console.log('✅ Registro exitoso:', response);

    if (response.user && response.token) {
      console.log('✅ Usuario creado en BD:', response.user);
      console.log('✅ Token generado:', response.token.substring(0, 50) + '...');

      // Verificar que se guardó en localStorage
      const savedAuth = localStorage.getItem('sw:auth');
      console.log('✅ localStorage después del registro:', savedAuth);

      // Verificar que AUTH se actualizó
      console.log('✅ AUTH después del registro:', window.AUTH);
    }
  } catch (error) {
    console.error('❌ Error en registro:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error response:', error.response);
  }
}

// Ejecutar debug
debugRegister();
`;

// Guardar el código en un archivo para que el usuario pueda copiarlo
console.log('=== CÓDIGO PARA DEBUG EN NAVEGADOR ===');
console.log('Copia y pega esto en la consola del navegador (F12):');
console.log('');
console.log(debugCode);
console.log('');
console.log('=== FIN DEL CÓDIGO ===');
