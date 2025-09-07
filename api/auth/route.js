// Función serverless CommonJS para auth
function handler(event, context) {
  console.log('[AUTH] Function invoked');

  // Safe logging to avoid circular reference errors
  const safeEvent = {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    queryStringParameters: event.queryStringParameters,
    body: event.body
  };
  console.log('[AUTH] Event:', JSON.stringify(safeEvent, null, 2));
  
  try {
    const { httpMethod, path, body } = event;
    
    // Parse body if it exists
    let requestBody = {};
    if (body) {
      try {
        requestBody = JSON.parse(body);
      } catch (e) {
        console.log('[AUTH] Body parse error:', e);
      }
    }
    
    console.log('[AUTH] Method:', httpMethod);
    console.log('[AUTH] Path:', path);
    console.log('[AUTH] Body:', requestBody);
    
    // Handle different auth endpoints
    if (path === '/api/auth/register' && httpMethod === 'POST') {
      const { username, pin } = requestBody;
      
      if (!username || !pin) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            ok: false,
            error: 'Username and pin required'
          })
        };
      }
      
      // Simulate user creation
      const user = {
        id: Date.now().toString(),
        username,
        pin,
        created_at: new Date().toISOString()
      };
      
      console.log('[AUTH] User created:', user);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Set-Cookie': `auth_token=dummy_token_${user.id}; HttpOnly; Secure; SameSite=None; Max-Age=86400`
        },
        body: JSON.stringify({
          ok: true,
          user
        })
      };
    }
    
    if (path === '/api/auth/login' && httpMethod === 'POST') {
      const { username, pin } = requestBody;
      
      if (!username || !pin) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            ok: false,
            error: 'Username and pin required'
          })
        };
      }
      
      // Simulate user authentication
      const user = {
        id: Date.now().toString(),
        username,
        pin,
        created_at: new Date().toISOString()
      };
      
      console.log('[AUTH] User authenticated:', user);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Set-Cookie': `auth_token=dummy_token_${user.id}; HttpOnly; Secure; SameSite=None; Max-Age=86400`
        },
        body: JSON.stringify({
          ok: true,
          user
        })
      };
    }
    
    // Default response
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ok: false,
        error: 'Endpoint not found'
      })
    };
    
  } catch (error) {
    console.error('[AUTH] Error:', error);
    
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
}

module.exports = handler;
