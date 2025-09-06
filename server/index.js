// server/index.js - Exporta la app ya configurada, sin listen()
import { createApp } from './app.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Exporta la app ya configurada, sin listen()
const app = await createApp();

// Para desarrollo local standalone (opcional):
if (process.env.NODE_ENV !== 'production' && process.argv.includes('--serve')) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`[BOOT] listening on port ${PORT}`);
  });
}

export default app;
