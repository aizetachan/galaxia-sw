// server/world/index.js
import { Router } from 'express';
import charactersRouter from './characters.js';
import contextRouter from './context.js';
import storyRouter from './story.js';

const router = Router();

router.use('/', charactersRouter);
router.use('/', contextRouter);
router.use('/', storyRouter);

export default router;
