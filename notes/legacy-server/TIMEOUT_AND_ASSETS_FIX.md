# Corrección de Timeout y Assets

## Problemas Identificados

### 1. Health Check Timeout
**Problema**: El health check fallaba después de 4 segundos
- `[probeHealth] Timeout reached (4s), aborting request`
- `Error type: DOMException` con `AbortError`
- `[BOOT] Health check result: {ok: false, reason: 'timeout'}`

**Causa**: La función serverless en Vercel tarda más de 4 segundos en responder

### 2. Assets 404 Error
**Problema**: Video no encontrado
- `GET https://galaxia-sw-kepe.vercel.app/assets/video/hero-home-720p.webm 404 (Not Found)`

**Causa**: Vite no estaba configurado para copiar assets estáticos

## Soluciones Implementadas

### 1. Aumentar Timeout del Health Check

**Archivo**: `web/api.js`
**Cambio**: Timeout de 4s a 10s

```javascript
// Antes
const timer = setTimeout(() => {
  console.log('[probeHealth] Timeout reached (4s), aborting request');
  ctrl.abort();
}, 4000);

// Después
const timer = setTimeout(() => {
  console.log('[probeHealth] Timeout reached (10s), aborting request');
  ctrl.abort();
}, 10000);
```

### 2. Configurar Vite para Copiar Assets

**Archivo**: `vite.config.js`
**Cambio**: Agregar `publicDir: 'assets'`

```javascript
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  publicDir: 'assets', // Copiar assets estáticos
});
```

## Resultados

### Assets Copiados Correctamente
```
dist/
├── assets/
│   ├── index-CB817_Du.css
│   └── index-DueHk6si.js
├── audio/
├── fonts/
├── images/
├── posters/
├── video/
│   ├── hero-home-720p.mp4
│   └── hero-home-720p.webm
└── index.html
```

### Health Check con Más Tiempo
- Ahora tiene 10 segundos para responder
- Debería dar tiempo suficiente para que la función serverless se inicialice

## Próximos Pasos

1. **Hacer commit y push**:
   ```bash
   git add .
   git commit -m "Fix health check timeout and assets 404"
   git push
   ```

2. **Redesplegar en Vercel**

3. **Probar**:
   - El health check debería funcionar (más tiempo)
   - El video debería cargar correctamente
   - El status debería cambiar a "Server: OK"

## Archivos Modificados

- `web/api.js` - Timeout aumentado de 4s a 10s
- `vite.config.js` - Configuración para copiar assets estáticos
