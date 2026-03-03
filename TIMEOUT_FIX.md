# Solución de Timeout y Health Check

## Problemas Identificados

1. **Loading infinito**: Las llamadas API se quedan colgadas sin timeout
2. **Server: FAIL**: El health check no funciona correctamente
3. **Sin respuesta del servidor**: Las llamadas HTTP no devuelven respuesta

## Soluciones Implementadas

### 1. Health Check Corregido

**Antes**:
```javascript
const health = await probeHealth(API_BASE); // ❌ Error: función no acepta parámetros
```

**Después**:
```javascript
console.log('[BOOT] Starting health check...');
const health = await probeHealth(); // ✅ Correcto: sin parámetros
console.log('[BOOT] Health check result:', health);
```

### 2. Timeout en Llamadas API

**Agregado timeout de 30 segundos**:
```javascript
// Agregar timeout de 30 segundos
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000);

res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(body ?? {}),
  mode: 'cors',
  credentials: 'include',
  signal: controller.signal, // ✅ Timeout signal
});

clearTimeout(timeoutId);
```

### 3. Manejo de Errores de Timeout

```javascript
} catch (e) {
  console.error('[API] network error', e);
  if (e.name === 'AbortError') {
    throw new Error('Request timeout - server took too long to respond');
  }
  throw new Error('Network error while calling API');
}
```

## Archivos Modificados

- `web/main.js` - Health check corregido
- `web/api-client.js` - Timeout agregado a `api()` y `apiGet()`

## Qué Esperar Ahora

### Si el problema era timeout:
- Las llamadas se cancelarán después de 30 segundos
- Verás el error "Request timeout - server took too long to respond"
- El loading se detendrá

### Si el problema era health check:
- El status debería cambiar de "Server: FAIL" a "Server: OK"
- Verás logs de `[BOOT] Starting health check...` y `[BOOT] Health check result:`

### Si el problema persiste:
- Los logs detallados nos dirán exactamente dónde falla
- Podremos identificar si es problema de red, servidor, o configuración

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Probar registro/login
4. Revisar logs en consola del navegador
5. Verificar si el timeout funciona o si hay otro problema
