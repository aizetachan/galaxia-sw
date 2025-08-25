// Enruta cualquier /api/* a tu app de Express
import app from './index.js';
export default (req, res) => app(req, res);
