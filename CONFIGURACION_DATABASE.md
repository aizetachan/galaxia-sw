# 🗄️ Configuración de Base de Datos PostgreSQL

## Estado Actual
✅ **Sistema funcionando con base de datos PostgreSQL obligatoria**

### 🚫 Modo Demo Eliminado
- ❌ **MODO DEMO COMPLETAMENTE ELIMINADO**
- ✅ **DATABASE_URL es OBLIGATORIA** para que funcione la aplicación
- ✅ **Sin fallbacks** - la aplicación requiere PostgreSQL para operar

### 🏠 Desarrollo Local
- ⚠️ **Requiere configuración manual** de DATABASE_URL
- ✅ **Funciona solo con PostgreSQL**
- ✅ **No hay modo demo disponible**

### 🚀 Producción Vercel
- ✅ **DATABASE_URL configurada** en variables de entorno
- ✅ **PostgreSQL conectado** automáticamente
- ✅ **Funcionalidad completa** disponible

## Arquitectura del Sistema

El sistema ahora requiere **PostgreSQL obligatorio**:

```
┌─────────────────┐    ┌──────────────────┐
│   Desarrollo    │    │   Producción     │
│   Local         │    │   Vercel         │
├─────────────────┤    ├──────────────────┤
│ DATABASE_URL    │    │ DATABASE_URL     │
│ → PostgreSQL    │    │ → PostgreSQL     │
│ ⚠️ Manual        │    │ ✅ Automático    │
└─────────────────┘    └──────────────────┘
```

## Verificación del Estado

### En Desarrollo Local:
```bash
curl http://localhost:3001/health
```
```json
{
  "ok": true,
  "message": "API working with database",
  "database": {
    "configured": true,
    "status": "connected",
    "url": "[CONFIGURED]"
  },
  "environment": "development"
}
```

### En Producción Vercel:
```bash
curl https://galaxia-sw-kepe.vercel.app/health
```
```json
{
  "ok": true,
  "message": "API working with database",
  "database": {
    "configured": true,
    "status": "connected",
    "url": "[CONFIGURED]"
  },
  "environment": "production"
}
```

## Configuración en Vercel (Ya Configurada)

✅ **La DATABASE_URL ya está configurada en Vercel** como variable de entorno.

### Para Cambiar/Actualizar la Base de Datos en Vercel:

1. **Ve al Dashboard de Vercel**
2. **Selecciona tu proyecto** "galaxia-sw"
3. **Ve a Settings → Environment Variables**
4. **Actualiza la variable** `DATABASE_URL` con tu nueva conexión

### Servicios PostgreSQL Compatibles

#### 🟢 Neon (Recomendado - Ya configurado)
- ✅ **Ya funciona** en Vercel
- ✅ **Connection pooling** automático
- ✅ **SSL obligatorio** (sslmode=require)

#### 🐘 PostgreSQL Local (Para desarrollo opcional)
```bash
# Solo si quieres desarrollo con BD local
brew install postgresql
brew services start postgresql
createdb galaxia_db

# Luego configura .env localmente (opcional)
echo "DATABASE_URL=postgresql://localhost:5432/galaxia_db" > .env
```

## Verificación de Correcciones Aplicadas

✅ **Problema 1**: Validación DATABASE_URL - ✅ Solucionado
- Sistema detecta automáticamente cuando DATABASE_URL no está configurada
- Fallback automático a modo demo
- Logging claro sobre el estado de conexión

✅ **Problema 2**: CORS preflight - ✅ Solucionado
- Headers CORS configurados correctamente
- Manejo OPTIONS automático
- Permite Authorization y Content-Type

✅ **Problema 3**: Onboarding flow - ✅ Solucionado
- No marca 'done' prematuramente
- Espera completar nombre/especie/rol

✅ **Problema 4**: GET /auth/me - ✅ Solucionado
- Devuelve 401 con tokens inválidos
- Mensajes de error específicos
- Validación completa de tokens

✅ **Problema 5**: Token duplication - ✅ Solucionado
- Función centralizada en `/server/auth.js`
- Eliminadas duplicaciones
- Imports actualizados correctamente

## Debugging y Logs

### 🚨 Problema Detectado: UI Rota

**Síntomas:**
- ✅ Usuarios se crean correctamente en BD
- ✅ Base de datos funciona
- ❌ Contenedor del chat aparece "roto" (más estrecho)
- ❌ Frontend no lee correctamente la información

**Posibles Causas:**
1. **Token inválido** en localStorage del navegador
2. **Problema de CORS** bloqueando requests
3. **Error en endpoint `/auth/me`** devolviendo datos incorrectos
4. **Problema en consulta de personajes** (`/world/characters/me`)

### 🔍 Logs de Debugging Añadidos

Se han añadido logs extensivos con prefijos específicos:

```
[DB] 📋 DEBUG: - Inicialización de base de datos
[REGISTER] 📋 DEBUG: - Registro de usuarios
[LOGIN] 📋 DEBUG: - Login de usuarios
[AUTH] 📋 DEBUG: - Validación de tokens (/auth/me)
[WORLD] 📋 DEBUG: - Consulta de personajes
[HEALTH] 📋 DEBUG: - Estado del sistema
```

### 📋 Scripts de Debugging

#### 1. Debugging en Producción
```bash
node debug-production.cjs
```

#### 2. Validaciones Locales
```bash
node test-validation.cjs
```

#### 3. Monitoreo de Logs en Vercel
1. Ve a https://vercel.com/dashboard
2. Selecciona proyecto `galaxia-sw`
3. Ve a **Functions** → `api/index.js`
4. **Revisa los Function Logs** durante el uso de la app

### 🧪 Pruebas Específicas

#### Probar Token Validation
```bash
# Obtener token
TOKEN=$(curl -s -X POST https://galaxia-sw-kepe.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","pin":"1234"}' | jq -r .token)

# Probar /auth/me
curl -s https://galaxia-sw-kepe.vercel.app/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

#### Probar Consulta de Personajes
```bash
curl -s https://galaxia-sw-kepe.vercel.app/api/world/characters/me \
  -H "Authorization: Bearer $TOKEN"
```

### 🔧 Solución del Problema de UI

Si la UI aparece rota, probablemente sea porque:

1. **El usuario no tiene personaje** → Debe hacer onboarding
2. **Token expirado/inválido** → Debe hacer login nuevamente
3. **Error en la consulta** → Revisar logs de Vercel

### 📊 Estado Actual

**✅ Base de Datos:** Funcionando correctamente
**✅ Usuarios:** Se crean correctamente
**✅ Autenticación:** Funciona correctamente
**⚠️ UI:** Problema detectado - requiere debugging con logs

---

## Comandos Útiles

```bash
# Ver estado actual
curl https://galaxia-sw-kepe.vercel.app/api/health

# Ejecutar debugging completo
node debug-production.cjs

# Ejecutar validaciones locales
node test-validation.cjs

# Probar registro/login
curl -X POST https://galaxia-sw-kepe.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","pin":"1234"}'
```
