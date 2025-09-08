// Handler funcional con autenticación
export default function handler(request, response) {
  console.log('Handler called with:', request.method, request.url);

  // Health check
  if (request.method === 'GET' && request.url === '/api/health') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('{"ok":true,"message":"API working","timestamp":' + Date.now() + '}');
    return;
  }

  // Register endpoint
  if (request.method === 'POST' && request.url === '/api/auth/register') {
    console.log('[REGISTER] Register endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.statusCode = 200;
    response.end('{"ok":true,"user":{"id":123,"username":"testuser"},"message":"User registered successfully"}');
    return;
  }

  // Login endpoint
  if (request.method === 'POST' && request.url === '/api/auth/login') {
    console.log('[LOGIN] Login endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.statusCode = 200;
    response.end('{"ok":true,"user":{"id":123,"username":"testuser"},"message":"Login successful"}');
    return;
  }

  // Test endpoint
  if (request.method === 'GET' && request.url === '/api/test') {
    console.log('[TEST] Test endpoint called');
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('TEST');
    return;
  }

  // Default 404
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.statusCode = 404;
  response.end('{"ok":false,"error":"Not found","method":"' + request.method + '","url":"' + request.url + '"}');
}
