# Solución de Errores de Frontend en Vercel

## Problemas Identificados

1. **Error 404 en frontend**: Pantalla en blanco, no se ve nada
2. **Error de Output Directory**: "No Output Directory named 'public' found"

## Soluciones Implementadas

### 1. Configuración de Vercel (`vercel.json`)

**Agregado**:
```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
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

### 2. Meta Tag en HTML (`web/index.html`)

**Antes**:
```html
<meta name="api_base" content="https://galaxia-sw.vercel.app/api">
```

**Después**:
```html
<meta name="api_base" content="/api">
```

### 3. Verificación de Build

✅ **Build funciona**: `npm run build` genera `dist/` correctamente
✅ **Archivos generados**: `index.html`, `assets/`, `service-worker.js`
✅ **Meta tag corregido**: Usa ruta relativa `/api`

## Configuración en Vercel UI

En la interfaz de Vercel, configura:

- **Root Directory**: (vacío)
- **Framework Preset**: "Other"
- **Install Command**: `npm install`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

## Verificación

1. **Build local**: `npm run build` ✅
2. **Directorio dist**: Se crea con todos los archivos ✅
3. **Meta tag**: Usa ruta relativa `/api` ✅
4. **Vercel config**: Tiene `outputDirectory: "dist"` ✅

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Verificar que:
   - El frontend se vea correctamente
   - El backend responda en `/api/health`
   - No haya errores 404

## Archivos Modificados

- `vercel.json` - Agregado buildCommand y outputDirectory
- `web/index.html` - Corregido meta tag a ruta relativa
- `DEPLOYMENT.md` - Actualizada guía de troubleshooting
