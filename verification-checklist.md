# ✅ Checklist de Verificación - Galaxia SW

## Después del despliegue, verifica:

### 🔍 1. Build de Vercel (sin warnings críticos)
- [ ] No hay warnings de ESM/CommonJS
- [ ] Build completa exitosamente
- [ ] Todas las dependencias se instalan correctamente

### 🌐 2. Funciones de API
- [ ] `GET /api/health` retorna `{"ok": true}`
- [ ] `GET /api/test-db` funciona correctamente
- [ ] Endpoints de auth responden (aunque fallen por validación)

### 🔐 3. Autenticación
- [ ] Registro de usuario funciona
- [ ] Login funciona y guarda token
- [ ] Usuario se mantiene logueado al recargar

### 💬 4. Interfaz de Chat
- [ ] Guest card aparece para usuarios no logueados
- [ ] Guest card se oculta después del login
- [ ] Placeholder del input muestra "Habla con el Máster…" cuando corresponde
- [ ] Chat se muestra correctamente

### 🎭 5. Onboarding
- [ ] Flujo de creación de personaje funciona
- [ ] Placeholder cambia correctamente en cada paso
- [ ] Personaje se guarda en BD
- [ ] Conversación se recupera al recargar

### 📊 6. Base de Datos
- [ ] Usuarios se guardan correctamente
- [ ] Personajes se guardan correctamente
- [ ] Mensajes del chat se guardan correctamente
- [ ] Datos persisten entre sesiones

## 🔧 Scripts de Diagnóstico

### Para verificar el frontend:
```javascript
// Copia y pega en la consola del navegador
console.log('🔍 Diagnóstico Frontend:');
console.log('API_BASE:', window.API_BASE);
console.log('isLogged:', window.isLogged ? window.isLogged() : 'N/A');
console.log('Placeholder:', document.getElementById('input')?.placeholder);
console.log('Guest card visible:', !document.getElementById('guest-card')?.hidden);
```

### Para verificar las APIs:
```bash
# Ejecuta en terminal local
node test-api-routes.js
```

### Para diagnóstico completo:
```javascript
// Copia el contenido de debug-frontend.js y pégalo en la consola
```

## 🚨 Si algo falla:

1. **Build falla**: Revisa logs de Vercel, especialmente warnings de dependencias
2. **API no responde**: Verifica configuración de rutas en Vercel
3. **Frontend no carga**: Revisa configuración de Vite y archivos estáticos
4. **Auth falla**: Verifica tokens JWT y configuración de BD
5. **Placeholder incorrecto**: Verifica que `updatePlaceholder()` se llame correctamente

## 📞 Próximos pasos si persisten problemas:

1. Compara los logs de Vercel con el build local
2. Verifica variables de entorno en Vercel (DATABASE_URL, JWT_SECRET)
3. Revisa configuración de dominio y SSL
4. Prueba con diferentes navegadores
5. Verifica que no haya conflictos de cache

---
**Última actualización**: $(date)
**Commit**: 6c633c9
