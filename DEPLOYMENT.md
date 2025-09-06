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
5. **Build Command**: `npm run build` (o deja vacío, está en vercel.json)
6. **Output Directory**: `dist` (o deja vacío, está en vercel.json)

**Nota**: El `vercel.json` ya contiene la configuración de build, así que puedes dejar estos campos vacíos en la interfaz de Vercel.

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

### Error: "No Output Directory named 'public' found"
**Solución**: El `vercel.json` ya está configurado con `"outputDirectory": "dist"`. Si ves este error:
1. Verifica que el build funcione localmente: `npm run build`
2. Asegúrate de que el directorio `dist/` se cree después del build
3. En la configuración de Vercel, deja vacío el campo "Output Directory" (ya está en vercel.json)

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
