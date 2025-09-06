# Solución de Error de Archivos Estáticos en Vercel

## Problema

Error en consola del navegador:
```
Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.
```

## Causa

Las rutas en `vercel.json` estaban capturando TODAS las peticiones, incluyendo los archivos estáticos (CSS, JS, imágenes). Esto causaba que:

1. El navegador solicitara `/assets/index-DUV_aOn1.js`
2. Vercel devolviera `index.html` en lugar del archivo JavaScript
3. El navegador no pudiera cargar los estilos ni el JavaScript

## Solución Implementada

### Antes (Configuración Incorrecta)
```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.js" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

### Después (Configuración Correcta)
```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.js" },
    { "src": "/assets/(.*)", "dest": "/assets/$1" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

## Explicación

1. **API Routes**: `/api/(.*)` → Función serverless
2. **Static Assets**: `/assets/(.*)` → Archivos estáticos (CSS, JS, imágenes)
3. **SPA Fallback**: `/(.*)` → `index.html` para rutas del frontend

## Orden Importante

Las rutas se evalúan en orden, por eso es crucial que:
1. API routes vayan primero
2. Static assets vayan segundo
3. SPA fallback vaya último

## Verificación

✅ **Build local**: `npm run build` funciona correctamente
✅ **Archivos estáticos**: Se generan en `dist/assets/`
✅ **HTML**: Tiene referencias correctas a `/assets/`
✅ **Rutas**: Configuradas en orden correcto

## Archivos Generados

```
dist/
├── index.html
├── assets/
│   ├── index-CB817_Du.css
│   └── index-DUV_aOn1.js
└── service-worker.js
```

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Verificar que:
   - El frontend se vea con estilos
   - No haya errores en la consola
   - El JavaScript se cargue correctamente

## Archivos Modificados

- `vercel.json` - Agregada ruta para assets estáticos
- `DEPLOYMENT.md` - Actualizada guía de troubleshooting
