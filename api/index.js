// Adaptador Vercel para Express - Versión simplificada
import serverless from 'serverless-http';

// Importar la app de forma lazy para evitar timeouts en cold start
let app = null;

async function getApp() {
  if (!app) {
    console.log('[API] Loading app...');
    const { default: appModule } = await import('../server/index.js');
    app = appModule;
    console.log('[API] App loaded');
  }
  return app;
}

export default async function handler(req, res) {
  console.log('[API] Handler called for:', req.method, req.url);
  try {
    const appInstance = await getApp();
    return serverless(appInstance)(req, res);
  } catch (error) {
    console.error('[API] Error in handler:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
