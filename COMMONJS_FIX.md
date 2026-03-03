# Corrección a CommonJS para Vercel

## Problema

La función serverless seguía dando `FUNCTION_INVOCATION_TIMEOUT` incluso con la API mínima. El problema era que estábamos usando **ES modules** (`import/export`) pero Vercel esperaba **CommonJS** (`require/module.exports`).

## Cambios Realizados

### 1. API Convertida a CommonJS (`api/index.js`)

**Antes (ES modules)**:
```javascript
import serverless from 'serverless-http';
import express from 'express';
import cookieParser from 'cookie-parser';

export default serverless(app);
```

**Después (CommonJS)**:
```javascript
const serverless = require('serverless-http');
const express = require('express');
const cookieParser = require('cookie-parser');

module.exports = serverless(app);
```

### 2. Package.json Actualizado (`api/package.json`)

**Antes**:
```json
{
  "type": "module",
  "dependencies": { ... }
}
```

**Después**:
```json
{
  "dependencies": { ... }
}
```

### 3. Vercel.json Simplificado

**Antes**:
```json
{
  "src": "api/**/*.js",
  "use": "@vercel/node"
}
```

**Después**:
```json
{
  "src": "api/index.js",
  "use": "@vercel/node"
}
```

## ¿Por qué CommonJS?

1. **Compatibilidad**: Vercel funciona mejor con CommonJS por defecto
2. **Menos problemas**: No hay conflictos de módulos
3. **Más estable**: Menos errores de inicialización
4. **Estándar**: Es el formato más común para serverless functions

## Próximos Pasos

1. **Hacer commit y push**:
   ```bash
   git add .
   git commit -m "Convert API to CommonJS to fix FUNCTION_INVOCATION_TIMEOUT"
   git push
   ```

2. **Redesplegar en Vercel**

3. **Probar endpoints**:
   ```bash
   curl https://galaxia-sw-kepe.vercel.app/api/health
   curl -X POST https://galaxia-sw-kepe.vercel.app/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"username":"testuser","pin":"1234"}'
   ```

## Archivos Modificados

- `api/index.js` - Convertido a CommonJS
- `api/package.json` - Removido "type": "module"
- `vercel.json` - Simplificado build path
