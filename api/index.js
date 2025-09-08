// Configuración simple de base de datos
let pool = null;
const demoUsers = new Map();

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('[DB] Database configured');
  } catch (error) {
    console.error('[DB] Database setup error:', error.message);
  }
} else {
  console.log('[DB] No DATABASE_URL - using demo mode');
}

export default function handler(request, response) {
  console.log('Handler called with:', request.method, request.url);
  console.log('Full URL:', request.url);
  console.log('Pathname:', request.url ? request.url.split('?')[0] : 'none');

  const path = request.url ? request.url.split('?')[0] : '';

  // Health check - probar diferentes formatos
  if (request.method === 'GET' && (path === '/api/health' || path === '/health')) {
    console.log('[HEALTH] Health endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      message: 'API working',
      timestamp: Date.now(),
      database: !!process.env.DATABASE_URL
    }));
    return;
  }

  // Database test endpoint
  if (request.method === 'GET' && path === '/api/test-db') {
    console.log('[TEST-DB] Database test called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');

    if (pool) {
      response.statusCode = 200;
      response.end('{"ok":true,"message":"Database configured","mode":"database"}');
    } else {
      response.statusCode = 200;
      response.end('{"ok":true,"message":"Demo mode","mode":"demo"}');
    }
    return;
  }

  // Register endpoint simple
  if (request.method === 'POST' && (path === '/api/auth/register' || path === '/auth/register')) {
    console.log('[REGISTER] Register endpoint called');

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Simplemente devolver una respuesta fija por ahora
    response.statusCode = 200;
    response.end('{"ok":true,"user":{"id":12345,"username":"miusuario"},"message":"User registered successfully"}');
    return;
  }

  // Login endpoint simple
  if (request.method === 'POST' && (path === '/api/auth/login' || path === '/auth/login')) {
    console.log('[LOGIN] Login endpoint called');

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Simplemente devolver una respuesta fija por ahora
    response.statusCode = 200;
    response.end('{"ok":true,"user":{"id":12345,"username":"miusuario"},"message":"Login successful"}');
    return;
  }

  // World endpoints
  if (request.method === 'GET' && (path === '/api/world/characters/me' || path === '/world/characters/me')) {
    console.log('[WORLD] Characters/me endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('{"ok":true,"characters":[],"message":"No characters found"}');
    return;
  }

  // DM/Master endpoints
  if (request.method === 'POST' && (path === '/api/dm/respond' || path === '/dm/respond')) {
    console.log('[DM] Respond endpoint called');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.statusCode = 200;
    response.end('{"ok":true,"text":"¡Hola! Soy el Máster de la Galaxia. ¿Estás listo para tu aventura?","stage":"name"}');
    return;
  }

  // Test endpoint
  if (request.method === 'GET' && (path === '/api/test' || path === '/test')) {
    console.log('[TEST] Test endpoint called');
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('TEST');
    return;
  }

  // Default 404
  console.log('[DEFAULT] Route not found for method:', request.method, 'path:', path);
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.statusCode = 404;
  response.end('{"ok":false,"error":"Not found","method":"' + request.method + '","path":"' + path + '","fullUrl":"' + request.url + '"}');
}
