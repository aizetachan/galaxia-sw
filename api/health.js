// Función health mínima
const handler = () => {
  return {
    statusCode: 200,
    body: '{"ok":true}'
  };
};

module.exports = handler;
