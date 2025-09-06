# Solución de Errores de Vercel

## Problemas Identificados

1. **Error de Runtime**: "Function Runtimes must have a valid version"
2. **Error de Output Directory**: "No Output Directory named 'public' found"

## Soluciones Implementadas

### 1. Configuración de Vercel (`vercel.json`)

**Antes**:
```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": {
    "api/**/*.js": { "runtime": "nodejs20.x" }
  },
  "rewrites": [...]
}
```

**Después**:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.js" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

### 2. Adaptador API (`api/index.js`)

**Antes**:
```javascript
export default function handler(req, res) {
  return app(req, res);
}
```

**Después**:
```javascript
import serverless from 'serverless-http';
import app from '../server/index.js';

export default serverless(app);
```

### 3. Dependencias API (`api/package.json`)

Creado nuevo archivo:
```json
{
  "name": "galaxia-sw-api",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "serverless-http": "^3.2.0"
  }
}
```

## Configuración en Vercel

En la interfaz de Vercel, configura manualmente:

- **Root Directory**: (vacío)
- **Framework Preset**: "Other"
- **Install Command**: `npm install`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

## Verificación

1. **Build local**: `npm run build` ✅
2. **Directorio dist**: Se crea correctamente ✅
3. **Dependencias**: Todas instaladas ✅

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Verificar que ambos errores desaparezcan
4. Probar endpoints: `/api/health`, `/api/auth/register`, etc.
