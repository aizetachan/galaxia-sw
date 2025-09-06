# Logs de Debug Agregados

## Problema

El registro y login se quedan en loading infinito, necesitamos logs detallados para diagnosticar el problema.

## Logs Agregados

### Frontend (`web/main.js`)

**En la función `doAuth`**:
```javascript
console.log('[AUTH] Starting', kind, 'for user:', username);
console.log('[AUTH] Calling API:', url, { username, pin });
console.log('[AUTH] API response:', response);
console.log('[AUTH] Success! User:', response.user);
console.log('[AUTH] Auth state set, user stored in localStorage');
console.error('[AUTH] Error in doAuth:', e);
console.error('[AUTH] Error details:', { message, data, response, stack });
console.log('[AUTH] Setting error message:', errorMessage);
console.log('[AUTH] Setting loading to false');
```

### Frontend (`web/api-client.js`)

**En la función `api`**:
```javascript
console.log('[API] POST request to:', url);
console.log('[API] Request body:', body);
console.log('[API] Request headers:', headers);
console.log('[API] Response status:', res.status, res.statusText);
console.log('[API] Response headers:', Object.fromEntries(res.headers.entries()));
console.log('[API] Response data:', data);
console.error('[API] Error response:', msg);
console.log('[API] Success, returning:', data.json ?? {});
```

### Backend (`server/app.js`)

**En `/auth/register`**:
```javascript
console.log('[AUTH/register] Request received');
console.log('[AUTH/register] Headers:', req.headers);
console.log('[AUTH/register] Body:', req.body);
console.log('[AUTH/register] Extracted username:', username, 'pin:', pin);
console.log('[AUTH/register] Calling register function...');
console.log('[AUTH/register] Register successful, calling login...');
console.log('[AUTH/register] Login successful, payload:', payload);
console.log('[AUTH/register] Ensuring character...');
console.log('[AUTH/register] Character ensured');
console.log('[AUTH/register] Setting cookie...');
console.log('[AUTH/register] Cookie set');
console.log('[AUTH/register] Sending response:', response);
```

**En `/auth/login`**:
```javascript
console.log('[AUTH/login] Request received');
console.log('[AUTH/login] Headers:', req.headers);
console.log('[AUTH/login] Body:', req.body);
console.log('[AUTH/login] Extracted username:', username, 'pin:', pin);
console.log('[AUTH/login] Calling login function...');
console.log('[AUTH/login] Login successful, result:', r);
console.log('[AUTH/login] Ensuring character...');
console.log('[AUTH/login] Character ensured');
console.log('[AUTH/login] Setting cookie...');
console.log('[AUTH/login] Cookie set');
console.log('[AUTH/login] Sending response:', response);
```

**En `requireAuth` middleware**:
```javascript
console.log('[AUTH/requireAuth] Request received');
console.log('[AUTH/requireAuth] Cookies:', req.cookies);
console.log('[AUTH/requireAuth] Headers:', req.headers);
console.log('[AUTH/requireAuth] cookieToken:', cookieToken ? '...' : 'none');
console.log('[AUTH/requireAuth] headerToken:', headerToken ? '...' : 'none');
console.log('[AUTH/requireAuth] final token:', token ? '...' : 'none');
console.log('[AUTH/requireAuth] Getting session for token...');
console.log('[AUTH/requireAuth] Session result:', session);
console.log('[AUTH/requireAuth] Auth set:', req.auth);
```

## Cómo Usar los Logs

### En el Navegador (Frontend)
1. Abrir DevTools (F12)
2. Ir a la pestaña "Console"
3. Intentar registrar/login
4. Revisar los logs que empiezan con `[AUTH]` y `[API]`

### En Vercel (Backend)
1. Ir al dashboard de Vercel
2. Seleccionar el proyecto
3. Ir a "Functions" → "View Function Logs"
4. Revisar los logs que empiezan con `[AUTH/register]`, `[AUTH/login]`, `[AUTH/requireAuth]`

## Qué Buscar

### Si el problema está en el Frontend:
- ¿Se ejecuta `[AUTH] Starting`?
- ¿Se ejecuta `[API] POST request to`?
- ¿Qué devuelve `[API] Response status`?
- ¿Qué devuelve `[API] Response data`?

### Si el problema está en el Backend:
- ¿Se ejecuta `[AUTH/register] Request received`?
- ¿Se ejecuta `[AUTH/register] Register successful`?
- ¿Se ejecuta `[AUTH/register] Sending response`?
- ¿Hay algún error en `[AUTH/register] Error occurred`?

### Si el problema está en las Cookies:
- ¿Se ejecuta `[AUTH/register] Cookie set`?
- ¿En `[AUTH/requireAuth]` aparece el cookieToken?

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Probar registro/login
4. Revisar logs en navegador y Vercel
5. Identificar dónde se detiene el flujo
