// Script para probar que las rutas API funcionen correctamente después de la limpieza
import http from 'http';
import https from 'https';

const BASE_URL = 'http://localhost:3001'; // Usando el puerto correcto del servidor
const IS_LOCALHOST = BASE_URL.includes('localhost');

function testEndpoint(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${endpoint}`;
    console.log(`\n🧪 Probando ${method} ${url}`);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(data));
    }

    const client = IS_LOCALHOST ? http : https;
    const req = client.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };

          console.log(`✅ Status: ${response.status}`);
          console.log(`📄 Response:`, response.body);

          resolve(response);
        } catch (error) {
          console.log(`❌ Error parsing response:`, error.message);
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`❌ Error: ${error.message}`);
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🚀 Iniciando pruebas de API después de la limpieza...\n');

  try {
    // Test 1: Health check
    console.log('='.repeat(50));
    console.log('TEST 1: Health Check');
    await testEndpoint('/api/health');

    // Test 2: Auth register
    console.log('='.repeat(50));
    console.log('TEST 2: Auth Register');
    await testEndpoint('/api/auth/register', 'POST', {
      username: 'testuser',
      pin: '1234'
    });

    // Test 3: Auth login
    console.log('='.repeat(50));
    console.log('TEST 3: Auth Login');
    await testEndpoint('/api/auth/login', 'POST', {
      username: 'testuser',
      pin: '1234'
    });

    // Test 4: Ruta inexistente (debería ir al catch-all)
    console.log('='.repeat(50));
    console.log('TEST 4: Ruta Inexistente (Catch-all)');
    await testEndpoint('/api/nonexistent');

    console.log('\n🎉 Todas las pruebas completadas!');
    console.log('Si los tests pasan sin errores 500, el problema está resuelto.');

  } catch (error) {
    console.log('\n💥 Error ejecutando pruebas:', error.message);
  }
}

// Ejecutar pruebas si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { testEndpoint, runTests };
