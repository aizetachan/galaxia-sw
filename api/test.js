// Función de prueba simple
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'API funcionando correctamente',
    timestamp: Date.now()
  });
};
