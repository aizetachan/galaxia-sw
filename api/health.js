// Función serverless independiente para health check
exports.handler = async (event, context) => {
  console.log('[HEALTH] Function invoked');
  console.log('[HEALTH] Event:', JSON.stringify(event, null, 2));
  
  try {
    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        message: 'Health check successful'
      })
    };
    
    console.log('[HEALTH] Response:', response);
    return response;
    
  } catch (error) {
    console.error('[HEALTH] Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ok: false,
        error: error.message
      })
    };
  }
};
