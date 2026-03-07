# Solución API Mínima para FUNCTION_INVOCATION_TIMEOUT

## Problema

El error `FUNCTION_INVOCATION_TIMEOUT` persistía porque la función serverless tardaba demasiado en cargar todas las dependencias del servidor completo.

## Solución Implementada

### API Mínima (`api/index.js`)

He creado una versión mínima de la API que incluye solo lo esencial:

1. **Express básico** - Sin dependencias pesadas
2. **Health check simple** - `/api/health`
3. **Auth endpoints básicos** - `/api/auth/register` y `/api/auth/login`
4. **Middleware de autenticación** - Verificación de cookies
5. **Logs detallados** - Para debugging

### Características

- **Sin base de datos** - Por ahora simula la creación de usuarios
- **Cookies HttpOnly** - Autenticación segura
- **Logs detallados** - Para identificar problemas
- **Manejo de errores** - Respuestas consistentes

### Endpoints Disponibles

```javascript
// Health check
GET /api/health
// Respuesta: { ok: true, timestamp: "..." }

// Registro
POST /api/auth/register
// Body: { username: "test", pin: "1234" }
// Respuesta: { ok: true, user: {...} }

// Login
POST /api/auth/login
// Body: { username: "test", pin: "1234" }
// Respuesta: { ok: true, user: {...} }

// Usuario (protegido)
GET /api/user
// Respuesta: { ok: true, user: {...} }
```

### Dependencias Mínimas

```json
{
  "dependencies": {
    "serverless-http": "^3.2.0",
    "express": "^4.18.2",
    "cookie-parser": "^1.4.6"
  }
}
```

## Beneficios

1. **Cold start rápido** - Sin dependencias pesadas
2. **Funcionalidad básica** - Auth y health check funcionan
3. **Logs detallados** - Fácil debugging
4. **Escalable** - Se puede agregar funcionalidad gradualmente

## Próximos Pasos

1. **Hacer commit y push**:
   ```bash
   git add .
   git commit -m "Implement minimal API to fix FUNCTION_INVOCATION_TIMEOUT"
   git push
   ```

2. **Redesplegar en Vercel**

3. **Probar endpoints**:
   ```bash
   # Health check
   curl https://galaxia-sw-kepe.vercel.app/api/health
   
   # Registro
   curl -X POST https://galaxia-sw-kepe.vercel.app/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"username":"testuser","pin":"1234"}'
   ```

4. **Verificar en el navegador**:
   - Status debería cambiar a "Server: OK"
   - Registro debería funcionar sin timeout
   - Logs detallados en la consola

## Migración Gradual

Una vez que esta versión mínima funcione, podemos:

1. **Agregar base de datos** - Conectar a Neon
2. **Agregar más endpoints** - Chat, world, etc.
3. **Optimizar** - Cargar dependencias de forma lazy

## Archivos Modificados

- `api/index.js` - API mínima completa
- `api/package.json` - Dependencias mínimas
