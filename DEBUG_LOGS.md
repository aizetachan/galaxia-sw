# Logs de Debugging Agregados

## Problema

Necesitamos entender por qué el frontend muestra "Server: FAIL" cuando el backend de Vercel no reporta problemas.

## Logs Agregados

### 1. Health Check Detallado (`web/api.js` - `probeHealth`)

```javascript
console.log('[probeHealth] Starting health check...');
console.log('[probeHealth] URL:', '/api/health');
console.log('[probeHealth] Current location:', window.location.href);
console.log('[probeHealth] User agent:', navigator.userAgent);
console.log('[probeHealth] Making fetch request...');
console.log('[probeHealth] Response received:');
console.log('[probeHealth] Status:', r.status, r.statusText);
console.log('[probeHealth] Headers:', Object.fromEntries(r.headers.entries()));
console.log('[probeHealth] OK:', r.ok);
console.log('[probeHealth] Content-Type:', ct);
console.log('[probeHealth] Response text:', txt);
console.log('[probeHealth] Parsed JSON:', j);
```

### 2. Server Status Detallado (`web/api.js` - `setServerStatus`)

```javascript
console.log('[setServerStatus] Called with:', { ok, msg });
console.log('[setServerStatus] Element found:', !!el);
console.log('[setServerStatus] DM mode:', mode);
console.log('[setServerStatus] Setting label:', label);
console.log('[setServerStatus] Setting classes - ok:', !!ok, 'bad:', !ok);
console.log('[setServerStatus] Element classes after:', el.className);
console.log('[setServerStatus] Element text after:', el.textContent);
```

### 3. Boot Process Detallado (`web/main.js` - `boot`)

```javascript
console.log('[BOOT] ===== BOOT START =====');
console.log('[BOOT] Current URL:', window.location.href);
console.log('[BOOT] API_BASE:', API_BASE);
console.log('[BOOT] Health check completed');
console.log('[BOOT] Health check result:', health);
console.log('[BOOT] Health check ok:', health.ok);
console.log('[BOOT] Health check reason:', health.reason);
console.log('[BOOT] Setting server status:', { ok: health.ok, message: statusMessage });
console.log('[BOOT] Server status set, continuing with auth...');
```

### 4. Auth Process Detallado (`web/main.js` - `doAuth`)

```javascript
console.log('[AUTH] ===== doAuth START =====');
console.log('[AUTH] Kind:', kind);
console.log('[AUTH] UI.authLoading:', UI.authLoading);
console.log('[AUTH] Username:', username);
console.log('[AUTH] PIN:', pin);
console.log('[AUTH] PIN regex test:', /^\d{4}$/.test(pin));
console.log('[AUTH] Setting auth loading to true');
```

## Información que Obtendremos

Con estos logs podremos identificar:

1. **Health Check**:
   - Si la petición se hace correctamente
   - Qué respuesta recibe del servidor
   - Si hay errores de red, timeout, o parsing
   - El contenido exacto de la respuesta

2. **Server Status**:
   - Si el elemento DOM existe
   - Qué valores se están pasando
   - Cómo se actualiza la UI

3. **Boot Process**:
   - El flujo completo de inicialización
   - Dónde exactamente falla el health check
   - Qué valores se están procesando

4. **Auth Process**:
   - Si la validación de entrada funciona
   - El estado de loading
   - El flujo de autenticación

## Próximos Pasos

1. **Hacer commit y push**:
   ```bash
   git add .
   git commit -m "Add detailed debugging logs for health check and auth"
   git push
   ```

2. **Redesplegar en Vercel**

3. **Abrir la consola del navegador** y revisar los logs detallados

4. **Identificar el problema exacto** basado en los logs

## Archivos Modificados

- `web/api.js` - Logs detallados en `probeHealth` y `setServerStatus`
- `web/main.js` - Logs detallados en `boot` y `doAuth`