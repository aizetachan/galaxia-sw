// Handler mínimo para testing
export default function handler(request, response) {
  console.log('Handler called with:', request.method, request.url);

  // Solo health check por ahora
  if (request.method === 'GET' && request.url === '/api/health') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.end('{"ok":true,"message":"Working"}');
    return;
  }

  // Default 404
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.statusCode = 404;
  response.end('{"ok":false,"error":"Not found"}');
}
