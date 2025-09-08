// Handler ultra-simple para debugging
module.exports = async (req, res) => {
  console.log('[SIMPLE] Request received:', req.method, req.url);

  // Health check
  if (req.method === 'GET' && req.url === '/api/health') {
    console.log('[HEALTH] Health endpoint called');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      message: 'Health check working',
      timestamp: Date.now()
    }));
    return;
  }

  // Register endpoint
  if (req.method === 'POST' && req.url === '/api/auth/register') {
    console.log('[REGISTER] Register endpoint called');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      user: { id: 123, username: 'testuser' },
      message: 'User registered successfully'
    }));
    return;
  }

  // Login endpoint
  if (req.method === 'POST' && req.url === '/api/auth/login') {
    console.log('[LOGIN] Login endpoint called');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      user: { id: 123, username: 'testuser' },
      message: 'Login successful'
    }));
    return;
  }

  // Test endpoint
  if (req.method === 'GET' && req.url === '/api/test') {
    console.log('[TEST] Test endpoint called');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end('TEST');
    return;
  }

  // Default response
  console.log('[DEFAULT] Route not found:', req.method, req.url);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.statusCode = 404;
  res.end(JSON.stringify({
    ok: false,
    error: 'Not found',
    method: req.method,
    url: req.url
  }));
};
