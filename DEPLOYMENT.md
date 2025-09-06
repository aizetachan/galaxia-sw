# Guía de Despliegue en Vercel

## Configuración del Proyecto

Tu proyecto ya está configurado como un monorepo con:
- **Frontend**: `web/` (Vite + SPA)
- **Backend**: `server/` (Express + API)
- **Adaptador Vercel**: `api/index.js`

## Configuración en Vercel

### 1. Crear Proyecto en Vercel

1. Ve a [vercel.com](https://vercel.com) y conecta tu repositorio
2. **Root Directory**: Deja vacío (raíz del repo)
3. **Framework Preset**: "Other"
4. **Install Command**: `npm install`
5. **Build Command**: `npm run build`
6. **Output Directory**: `dist`

**Importante**: 
- El `vercel.json` está configurado correctamente con `@vercel/static-build`
- Configura estos valores manualmente en la interfaz de Vercel también
- Asegúrate de que el meta tag en `web/index.html` tenga `content="/api"` (no URL absoluta)

### 2. Variables de Entorno

En Project Settings → Environment Variables, añade:

```
DATABASE_URL=postgresql://user:pass@host:port/db?sslmode=require
OPENAI_API_KEY=sk-...
JWT_SECRET=tu-secreto-jwt
INTERNAL_TOKEN=token-interno-opcional
NODE_ENV=production
```

### 3. Dominio

Vercel te dará automáticamente:
- **Preview**: `https://tu-proyecto-git-branch.vercel.app`
- **Production**: `https://tu-proyecto.vercel.app`

## Verificación del Despliegue

### 1. Health Check
```bash
curl https://tu-proyecto.vercel.app/api/health
```
Debería devolver: `{"ok": true, "ts": 1234567890, ...}`

### 2. Registro de Usuario
```bash
curl -X POST https://tu-proyecto.vercel.app/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","pin":"1234"}'
```

### 3. Login
```bash
curl -i -X POST https://tu-proyecto.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","pin":"1234"}'
```

Debería devolver `Set-Cookie: sid=...; Path=/; HttpOnly; Secure`

### 4. Verificar Sesión
```bash
curl -H 'Cookie: sid=tu-token-aqui' \
  https://tu-proyecto.vercel.app/api/auth/me
```

## Desarrollo Local

### Opción 1: Desarrollo Separado
```bash
# Terminal 1: Frontend
npm run dev:web

# Terminal 2: Backend
npm run dev:server
```

### Opción 2: Con Vercel CLI
```bash
npm install -g vercel
vercel dev
```

## Estructura Final

```
galaxia-sw/
├── api/
│   └── index.js          # Adaptador Vercel
├── server/
│   ├── app.js            # Configuración Express
│   ├── index.js          # Exporta app sin listen
│   └── ...
├── web/
│   ├── api/
│   │   └── client.js     # Cliente API unificado
│   └── ...
├── dist/                 # Build del frontend
├── vercel.json          # Configuración Vercel
└── package.json         # Workspaces config
```

## Características Implementadas

✅ **Monodominio**: Frontend y API en el mismo dominio  
✅ **Sin CORS**: No hay problemas de CORS  
✅ **Cookies HttpOnly**: Autenticación segura  
✅ **SPA Routing**: Rutas del frontend funcionan al refrescar  
✅ **Serverless**: Backend como función serverless  
✅ **Estáticos**: Frontend servido como archivos estáticos  

## Troubleshooting

### Error: "No Output Directory named 'dist' found"
**Solución**: 
1. El `vercel.json` está configurado correctamente con `@vercel/static-build`
2. En la configuración de Vercel, asegúrate de que:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Verifica que el build funcione localmente: `npm run build`
4. Asegúrate de que el directorio `dist/` se cree después del build
5. El `vercel.json` usa `@vercel/static-build` con `"distDir": "dist"`

### Error 404 en el frontend (pantalla en blanco)
**Solución**:
1. Verifica que el meta tag en `web/index.html` tenga `content="/api"` (no URL absoluta)
2. Asegúrate de que el build genere el archivo `dist/index.html`
3. Verifica que las rutas en `vercel.json` estén correctas
4. Revisa la consola del navegador para errores de JavaScript

### Error: "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html'"
**Solución**:
1. El problema es que las rutas en `vercel.json` están capturando los archivos estáticos
2. Asegúrate de que `vercel.json` tenga la ruta para assets:
   ```json
   { "src": "/assets/(.*)", "dest": "/assets/$1" }
   ```
3. Verifica que el build genere los archivos en `dist/assets/`
4. Las rutas deben estar en este orden: API → Assets → SPA fallback

### Error: "Function Runtimes must have a valid version"
**Solución**: 
1. El `vercel.json` está configurado correctamente con `@vercel/node`
2. Asegúrate de que `api/package.json` existe y tiene las dependencias necesarias
3. Verifica que `serverless-http` esté instalado

### Error: "SyntaxError: Unexpected reserved word"
**Solución**:
1. El problema es que se usa `await` en una función que no es `async`
2. Asegúrate de que `createApp()` sea una función `async`
3. Verifica que `server/index.js` use `await createApp()`
4. Instala `cookie-parser` en el servidor: `npm install cookie-parser`

### Loading infinito en registro/login
**Solución**:
1. El problema es que el frontend espera `{ token, user }` pero el backend devuelve `{ ok: true, user: {...} }`
2. El token se envía como cookie HttpOnly, no en la respuesta JSON
3. Corregir la función `doAuth` en `web/main.js` para manejar la respuesta correctamente
4. Usar `response.user` en lugar de `user` en el código

### Error 404 en rutas del SPA
- Verifica que `vercel.json` tenga el rewrite a `/index.html`

### CORS errors
- Asegúrate de usar rutas relativas: `fetch('/api/...')`
- No uses URLs absolutas en el frontend

### Cookies no funcionan
- Verifica que uses `credentials: 'include'` en fetch
- En local, usa `secure: false` en las cookies

### Build falla
- Verifica que `npm run build` funcione localmente
- Revisa que todas las dependencias estén en `package.json`
- Si hay errores de importación, verifica que `API_BASE` y `joinUrl` estén exportados en `web/api.js`
