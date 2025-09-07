// Función serverless catch-all para rutas API no manejadas por funciones específicas
export default function handler(request, context) {
  console.log('[CATCH-ALL] Request received:', request.method, request.url);

  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Endpoint not found',
      message: 'Esta ruta API no está implementada aún'
    }),
    {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      }
    }
  );
}
