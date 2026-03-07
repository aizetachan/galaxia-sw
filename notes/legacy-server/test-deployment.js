#!/usr/bin/env node

// Script de prueba para verificar el despliegue
import { health, register, login, getMe } from './web/api/client.js';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3001';

async function testDeployment() {
  console.log('🧪 Probando despliegue...\n');
  
  try {
    // 1. Health check
    console.log('1️⃣ Probando health check...');
    const healthResult = await health();
    console.log('✅ Health check OK:', healthResult);
    
    // 2. Registro
    console.log('\n2️⃣ Probando registro...');
    const testUser = {
      username: `testuser${Date.now()}`,
      pin: '1234'
    };
    
    const registerResult = await register(testUser);
    console.log('✅ Registro OK:', registerResult);
    
    // 3. Login
    console.log('\n3️⃣ Probando login...');
    const loginResult = await login(testUser);
    console.log('✅ Login OK:', loginResult);
    
    // 4. Verificar sesión
    console.log('\n4️⃣ Probando verificación de sesión...');
    const meResult = await getMe();
    console.log('✅ Sesión OK:', meResult);
    
    console.log('\n🎉 ¡Todas las pruebas pasaron!');
    
  } catch (error) {
    console.error('❌ Error en las pruebas:', error.message);
    process.exit(1);
  }
}

// Solo ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  testDeployment();
}
