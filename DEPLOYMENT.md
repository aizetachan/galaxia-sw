# Despliegue en Firebase (Hosting + Functions)

Esta app se entrega como **SPA estática** (build de `/web`) + **API en Firebase Functions** (`functions/index.js`). No hay servicios externos: todo vive en el proyecto `galaxian-dae59`.

---

## 1. Requisitos previos

- Firebase CLI (`npm install -g firebase-tools`)
- Acceso al proyecto (rol Editor / Deploy). Comprueba con `firebase projects:list`.
- Secrets configurados (ver sección de variables).
- Node 20.x para Functions.

---

## 2. Preparar el entorno

```bash
npm install              # dependencias del front
cd functions && npm install  # dependencias del backend
```

Si necesitas probar localmente, usa los emuladores:

```bash
firebase emulators:start --only functions,firestore
# en otra terminal
npm run dev
# navega a http://localhost:5173/?api=http://localhost:5001/<project>/us-central1/api
```

---

## 3. Variables / secrets

Configura los secretos una vez (se almacenan en el proyecto):

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set JWT_SECRET
firebase functions:secrets:set VERTEX_PROJECT
firebase functions:secrets:set VERTEX_LOCATION
firebase functions:secrets:set GEMINI_CHAT_MODEL
firebase functions:secrets:set GEMINI_IMAGE_MODEL
firebase functions:secrets:set FORCE_GEMINI_DM
```

Para inspeccionarlos: `firebase functions:secrets:list`. Para usarlos en local puedes exportarlos como variables o ejecutar `firebase functions:secrets:access`.

---

## 4. Compilar frontend

```bash
npm run build   # genera dist/
```

Firebase Hosting tomará `dist/` como carpeta pública (ver `firebase.json`).

---

## 5. Deploy

```bash
firebase deploy --only functions,hosting
```

Esto hace dos cosas:

1. Sube `dist/` a Hosting: `https://<project>.web.app`
2. Despliega la función `api` (Express + Gemini + Firestore) en la región definida (`europe-west1`).

Los rewrites relevantes están en `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "/api/**", "function": "api" },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

---

## 6. Pruebas post-deploy

```bash
curl https://<project>.web.app/api/health
# Registrar usuario
curl -X POST https://<project>.web.app/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testpilot","pin":"1234"}'
```

Entra en el front `https://<project>.web.app` y valida:

- Login → onboarding → Máster responde (Gemini)
- `/api/ai/test` (via UI) confirma modelo y ubicación
- `/api/chat/history` devuelve mensajes guardados

---

## 7. Rollback

Los despliegues se versionan por defecto. Para revertir:

```bash
firebase hosting:versions:list
firebase hosting:revert <versionId>
# o redeploy después de corregir
```

Para Functions puedes desplegar la versión anterior desde Cloud Console → Functions.

---

## 8. Usuarios de prueba

Puedes crear usuarios manualmente llamando a `/api/auth/register` o insertando documentos en Firestore (`users`, `usernames`). Recuerda que el PIN se guarda como hash SHA-256; no guardes texto plano fuera de desarrollo.

---

Con esto tienes todo el pipeline de Firebase listo. Cualquier ajuste (nuevos secretos, cambiar modelo Gemini, etc.) se maneja con CLI + Firestore, sin depender de servicios externos.
