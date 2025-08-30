// server/world/index.js
import { Router } from 'express';
import charactersRouter from './characters.js';
import contextRouter from './context.js';

const router = Router();

router.use('/', charactersRouter);
router.use('/', contextRouter);

export default router;
