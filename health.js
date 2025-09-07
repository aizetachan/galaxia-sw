// Función serverless ultra-simple
export default function handler() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: '{"ok":true,"message":"Health OK"}'
  };
}
