# Solución de FUNCTION_INVOCATION_TIMEOUT

## Problema Identificado

El error `FUNCTION_INVOCATION_TIMEOUT` indica que la función serverless en Vercel está tardando demasiado en ejecutarse y se agota el tiempo límite.

**Síntomas**:
- Health check falla con timeout
- Registro/login falla con timeout
- Frontend muestra "Server: FAIL"
- Logs muestran `Request timeout - server took too long to respond`

## Causa

La función serverless tardaba demasiado en inicializarse debido a:
1. **Función async**: `createApp()` era async y cargaba dependencias pesadas
2. **Import dinámico**: `await import('morgan')` y `await import('cookie-parser')`
3. **Cold start**: Vercel tiene límites de tiempo para la inicialización

## Solución Implementada

### 1. Adaptador API Simplificado (`api/index.js`)

**Antes**:
```javascript
import app from '../server/index.js';
export default serverless(app);
```

**Después**:
```javascript
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
```

### 2. Función createApp() Síncrona (`server/app.js`)

**Antes**:
```javascript
export async function createApp() {
  // ...
  const m = await import('morgan');
  const cp = await import('cookie-parser');
  // ...
}
```

**Después**:
```javascript
export function createApp() {
  // ...
  try {
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
  } catch (e) {
    console.warn('[BOOT] cookie-parser not available:', e?.message);
  }
  // ...
}
```

### 3. Server Index Simplificado (`server/index.js`)

**Antes**:
```javascript
const app = await createApp();
```

**Después**:
```javascript
const app = createApp();
```

## Beneficios

1. **Cold start más rápido**: La función se inicializa más rápido
2. **Lazy loading**: La app se carga solo cuando se necesita
3. **Mejor manejo de errores**: Logs detallados para debugging
4. **Compatibilidad**: Mantiene toda la funcionalidad existente

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Probar endpoints:
   ```bash
   curl https://galaxia-sw-kepe.vercel.app/api/health
   curl -X POST https://galaxia-sw-kepe.vercel.app/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"username":"testuser","pin":"1234"}'
   ```
4. Verificar que no hay más timeouts

## Archivos Modificados

- `api/index.js` - Adaptador con lazy loading
- `server/app.js` - Función síncrona sin imports dinámicos
- `server/index.js` - Sin await en createApp()
