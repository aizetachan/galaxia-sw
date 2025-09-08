// Función auth con formato Express
module.exports = (req, res) => {
  const path = req.url;

  if (path.includes('/register')) {
    return res.status(200).json({
      ok: true,
      user: { id: '1', username: 'testuser' }
    });
  }

  if (path.includes('/login')) {
    return res.status(200).json({
      ok: true,
      user: { id: '1', username: 'testuser' }
    });
  }

  return res.status(404).json({
    ok: false,
    error: 'Not found'
  });
};
