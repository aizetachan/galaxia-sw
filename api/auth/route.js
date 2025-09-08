// Función auth ultra-simple
module.exports = (event) => {
  if (event.path?.includes('/register')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: '{"ok":true,"user":{"id":"1","username":"test"}}'
    };
  }

  if (event.path?.includes('/login')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: '{"ok":true,"user":{"id":"1","username":"test"}}'
    };
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: '{"ok":false,"error":"Not found"}'
  };
};
