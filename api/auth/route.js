// Función auth mínima
const handler = (event) => {
  if (event.path && event.path.includes('/register')) {
    return {
      statusCode: 200,
      body: '{"ok":true,"user":{"id":"1","username":"test"}}'
    };
  }

  if (event.path && event.path.includes('/login')) {
    return {
      statusCode: 200,
      body: '{"ok":true,"user":{"id":"1","username":"test"}}'
    };
  }

  return {
    statusCode: 404,
    body: '{"ok":false,"error":"Not found"}'
  };
};

module.exports = handler;
