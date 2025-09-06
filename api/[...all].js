// Enruta cualquier /api/* a tu app de Express
import app from '../server/index.js';
export default (req, res) => app(req, res);
