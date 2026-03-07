# GALACTIC (galaxia-sw)

Mundo compartido estilo Star Wars — **Front vanilla (HTML/CSS/JS)** en `/web` + **API sobre Firebase Functions** en `/functions`. Toda la data (usuarios, personajes, historial) vive en **Firestore**, y el Máster IA se ejecuta con **Gemini** (Vertex AI o API key directa).

---

## Índice

- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Puesta en marcha (local)](#puesta-en-marcha-local)
  - [1) Frontend (Vite)](#1-frontend-vite)
  - [2) Backend (Firebase Emulators)](#2-backend-firebase-emulators)
- [Variables y secretos](#variables-y-secretos)
- [Cómo detecta el cliente la API](#cómo-detecta-el-cliente-la-api)
- [Flujo de usuario](#flujo-de-usuario)
  - [Comandos rápidos](#comandos-rápidos)
- [Protocolo del Máster (etiquetas)](#protocolo-del-máster-etiquetas)
  - [Confirmaciones (onboarding)](#confirmaciones-onboarding)
  - [Tiradas de dados](#tiradas-de-dados)
- [Endpoints principales](#endpoints-principales)
- [Estilo y personalización del front](#estilo-y-personalización-del-front)
- [Despliegue (Firebase Hosting + Functions)](#despliegue-firebase-hosting--functions)
- [Troubleshooting](#troubleshooting)
- [Roadmap corto](#roadmap-corto)
- [Créditos](#créditos)

---

## Estructura del proyecto

```
/web
  ├─ index.html        # UI base (landing + login + chat + CTAs)
  ├─ main.js           # Bootstrap de la app
  ├─ onboarding.js     # Flujo de alta (name/build)
  ├─ chat/             # Controladores del chat y tiradas
  ├─ state.js          # Preferencias locales (modo DM, flags)
  └─ styles.css        # Estilos (tokens, layout, modo invitado, etc.)

/functions
  ├─ index.js          # Express + Firebase Functions + rutas /api/*
  ├─ dm.js             # Reglas de onboarding/manual fallback
  ├─ guidance/         # Prompts para el Máster (markdown)
  ├─ package.json      # Dependencias (firebase-admin, vertex, etc.)
  └─ ...               # Helpers (persistencia, sanitizado, etc.)
```

> **Nota:** El backend anterior basado en `/server` + Vercel quedó descontinuado. Todo el runtime oficial es Firebase.

---

## Requisitos

- **Node 20.x** (igual que Functions). Localmente usamos 22.x pero la función se despliega con 20.
- **Firebase CLI** `npm install -g firebase-tools`
- **Proyecto Firebase** con Firestore y Functions habilitados (`galaxian-dae59`).
- **Gemini API Key** (Google AI Studio) **o** acceso Vertex AI en el mismo proyecto.

Firestore almacena:
- Colecciones `users`, `usernames`, `characters`, `messages` (se crean on-demand).

---

## Puesta en marcha (local)

### 1) Frontend (Vite)

```bash
npm install          # en la raíz (para /web)
npm run dev          # abre http://localhost:5173
```

Para que el front hable con el backend local, añade `?api=http://localhost:5001/PROJECT/us-central1/api` (ruta del emulator) o define `window.API_BASE` en consola.

### 2) Backend (Firebase Emulators)

```bash
cd functions
npm install
firebase emulators:start --only functions,firestore
```

En otra terminal puedes servir el front (`npm run dev`). El rewrite `?api=` debe apuntar al endpoint del emulator (`http://localhost:5001/<project>/us-central1/api`).

---

## Variables y secretos

Los valores sensibles se gestionan vía **Firebase Functions Secrets**:

```
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set JWT_SECRET
firebase functions:secrets:set VERTEX_PROJECT
firebase functions:secrets:set VERTEX_LOCATION
firebase functions:secrets:set GEMINI_CHAT_MODEL   # opcional
firebase functions:secrets:set GEMINI_IMAGE_MODEL  # opcional
firebase functions:secrets:set FORCE_GEMINI_DM     # usar "1" para forzar Gemini tras onboarding
```

Para desarrollo local puedes crear `.env.local` dentro de `functions/` o exportar las variables antes de arrancar el emulator (Firebase CLI carga automáticamente los secretos si ejecutas `firebase emulators:start --import` tras un `firebase functions:secrets:access`).

Variables relevantes:

- `GEMINI_API_KEY` **o** `GOOGLE_API_KEY` — clave directa de Gemini (Google AI Studio).
- `VERTEX_PROJECT` y `VERTEX_LOCATION` — solo si usas Vertex en lugar de API key.
- `GEMINI_CHAT_MODEL` — por defecto `gemini-3.1-pro-preview`.
- `GEMINI_IMAGE_MODEL` — por defecto `gemini-3.1-flash-image-preview`.
- `JWT_SECRET` — se usa para emitir/verificar los tokens firmados (guardados también como cookie HttpOnly).
- `FORCE_GEMINI_DM` — `1` fuerza al Máster a delegar en Gemini en la etapa `done`.

No hay `DATABASE_URL`: Firestore es la única fuente de verdad.

---

## Cómo detecta el cliente la API

`/web/api.js` prueba en este orden:

1. Query `?api=...`
2. `window.API_BASE`
3. `location.origin + "/api"`
4. `<meta name="api-base" content="...">`
5. Cache en `localStorage` (`sw:api_base`)

Cada candidato se valida contra `GET /api/health`.

---

## Flujo de usuario

- **Login/registro** con `username` (a-z, 0-9, `_`, 3–24) + **PIN (4 dígitos)**.
- **Invitado**: si no hay sesión, el Máster guía hasta crear usuario.
- **Onboarding** por fases: `name` → `build` → `done`.

### Comandos rápidos

- `/resumen` — resumen corto de la sesión anterior.
- `/publico` / `/privado` — alterna visibilidad del perfil.
- `/restart` — limpia estado local (msgs/char/step).

---

## Protocolo del Máster (etiquetas)

El Máster (IA) emite etiquetas que el cliente interpreta.

### Confirmaciones (onboarding)

```
<<CONFIRM NAME="TuNombre">>
<<CONFIRM SPECIES="Twi'lek" ROLE="Contrabandista">>
<<CONFIRM_ACK TYPE="name|build" DECISION="yes|no">>
```

### Tiradas de dados

```
<<ROLL SKILL="Carisma" REASON="Tratas de convencer al guardia">>
```

El cliente muestra CTA “Resolver tirada” y llama a `/api/roll`. El Máster narra el resultado en el siguiente turno.

> Las reglas completas están en `functions/guidance/*.md`.

---

## Endpoints principales

Todos viven bajo `/api/*` y los sirve `functions/index.js`.

### Salud

- `GET /api/health` — ping JSON.
- `GET /api/ai/config` — requiere token, devuelve config activa del Máster.

### Auth (`/api/auth/*`)

- `POST /api/auth/register` → `{ username, pin }` → `{ ok, token, user }`
- `POST /api/auth/login` → `{ username, pin }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Los usuarios se guardan en Firestore (`users`, `usernames`).

### Máster / IA (`/api/dm/*`)

- `POST /api/dm/respond` — entrada del jugador.
- `GET /api/dm/resume` — placeholder (se puede extender).

El middleware decide cuándo usar Gemini (modo `rich`) y persiste el historial en `users/<uid>/messages`.

### Mundo vivo / personajes

- `GET /api/world/characters/me`
- `POST /api/world/characters`
- `GET /api/chat/history`

Todos los datos se guardan en Firestore. Sin personaje previo, responde `{ character: null }`.

### Tiradas

- `POST /api/roll` → devuelve `{ roll, outcome }` (d20 simple, server-side).

---

## Estilo y personalización del front

- Vídeo del modo invitado en `/web/assets/video/hero-home-720p.*` (clase `.guest__bg`).
- Para ajustar opacidad, añade pseudo-elementos sobre `.guest__bg` (ver `styles.css`).
- El modo del Máster (`fast` vs `rich`) se guarda en `localStorage` (`sw:dm_mode`).
- `scene-image.js` soporta placeholders y fades para imágenes generadas (Gemini).

---

## Despliegue (Firebase Hosting + Functions)

1. **Instalar dependencias**
   ```bash
   npm install              # raíz
   cd functions && npm install
   ```
2. **Construir el frontend**
   ```bash
   npm run build            # genera dist/
   ```
3. **Configurar secretos** (si no existen):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   firebase functions:secrets:set JWT_SECRET
   # ... resto de variables
   ```
4. **Deploy**
   ```bash
   firebase deploy --only functions,hosting
   ```

El `firebase.json` ya contiene:

- `hosting.public = dist`
- Rewrite `source: "/api/**" → function: "api"`
- Fallback SPA `"**" → /index.html`

Tras el deploy, la app queda en `https://<project>.web.app` y el API bajo el mismo dominio (`/api`).

---

## Troubleshooting

- **Server: FAIL en la UI** → el front no alcanza `/api/health`. Revisa el rewrite o el parámetro `?api=`.
- **401/403** → no hay token válido. Vuelve a hacer login (las cookies son HttpOnly con SameSite=None).
- **El Máster responde plano/repetitivo** → comprueba que `FORCE_GEMINI_DM=1` y que `GEMINI_API_KEY` es válido (`POST /api/ai/test`).
- **Firestore reglas** → asegúrate de permitir lectura/escritura a las rutas usadas por las funciones (se ejecutan con privilegios de servidor).
- **Emulador** → usa `firebase emulators:start --project <id>` y apunta el front a `http://localhost:5001/<id>/us-central1/api`.

---

## Roadmap corto

- [ ] Editor visual para prompts (`functions/guidance`).
- [ ] Persistencia de timeline/resúmenes por personaje.
- [ ] Modo multi-sesión simultánea.
- [ ] UI para configurar tiradas y consecuencias desde el front.

---

## Documentación adicional
- Legacy Express/Vercel notes: `notes/legacy-server/`
- Plan de escalabilidad: `docs/SCALING_PLAN.md`

## Créditos


- Diseño + sistema de juego: equipo Galactic.
- Front: Vanilla + Vite.
- Backend: Firebase Functions + Firestore.
- IA: Gemini (Vertex AI / Google AI API) con prompts personalizables (`functions/guidance`).
