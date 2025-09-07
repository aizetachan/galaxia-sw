// Función auth ultra-simple
module.exports = (event, context) => {
  const method = event.httpMethod;
  const path = event.path;

  if (method === 'POST' && path.includes('/register')) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ok: true,
        user: { id: '1', username: 'test' }
      })
    };
  }

  if (method === 'POST' && path.includes('/login')) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ok: true,
        user: { id: '1', username: 'test' }
      })
    };
  }

  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ ok: false, error: 'Not found' })
  };
};
