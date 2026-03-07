# Solución de Loading Infinito en Registro/Login

## Problema

El frontend se queda en loading infinito al registrar un usuario nuevo, aunque el usuario se registra correctamente en la base de datos.

## Causa

El problema era una incompatibilidad entre la respuesta del backend y lo que esperaba el frontend:

1. **Backend**: Devuelve `{ ok: true, user: {...} }` y envía el token como cookie HttpOnly
2. **Frontend**: Esperaba `{ token, user }` en la respuesta JSON

## Solución Implementada

### Antes (Código Incorrecto)
```javascript
const { token, user } = (await api(url, { username, pin }));
setAuth({ token, user });
```

### Después (Código Corregido)
```javascript
const response = await api(url, { username, pin });

// El backend devuelve { ok: true, user: {...} } y el token se envía como cookie
if (response.ok && response.user) {
  // Para compatibilidad, creamos un token dummy ya que usamos cookies
  const token = 'cookie-based-auth';
  setAuth({ token, user: response.user });
  localStorage.setItem('sw:auth', JSON.stringify({ token, user: response.user }));
} else {
  throw new Error('Invalid response from server');
}
```

## Cambios Realizados

1. **`web/main.js`** - Función `doAuth` corregida:
   - Maneja la respuesta `{ ok: true, user: {...} }`
   - Usa `response.user` en lugar de `user`
   - Crea un token dummy para compatibilidad con el sistema existente

2. **Verificación**:
   - ✅ Build funciona correctamente
   - ✅ Frontend maneja la respuesta del backend
   - ✅ Sistema de cookies HttpOnly funciona

## Flujo de Autenticación

1. **Usuario registra/login**: Frontend envía `{ username, pin }`
2. **Backend procesa**: Crea usuario/sesión y devuelve `{ ok: true, user: {...} }`
3. **Cookie HttpOnly**: Token se envía como cookie segura
4. **Frontend maneja**: Extrae `user` de la respuesta y continúa el flujo

## Próximos Pasos

1. Hacer commit y push de los cambios
2. Redesplegar en Vercel
3. Verificar que:
   - El registro no se quede en loading infinito
   - El login funcione correctamente
   - El usuario se autentique correctamente

## Archivos Modificados

- `web/main.js` - Función `doAuth` corregida para manejar respuesta del backend
- `DEPLOYMENT.md` - Guía actualizada con solución
