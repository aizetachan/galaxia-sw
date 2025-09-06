# GALACTIC (galaxia-sw)

Mundo compartido estilo Star Wars — **Vanilla Web (HTML/CSS/JS)** + **API Node/Express**.  
Front simple y estático en `/web`, backend en `/server`. Soporta modo “solo IA” (sin BD) y modo **mundo vivo** con **PostgreSQL**.

---

## Índice

- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Puesta en marcha (local)](#puesta-en-marcha-local)
  - [1) Backend](#1-backend)
  - [2) Frontend](#2-frontend)
- [Variables de entorno (`/server/.env`)](#variables-de-entorno-serverenv)
- [Cómo detecta el cliente la API](#cómo-detecta-el-cliente-la-api)
- [Flujo de usuario](#flujo-de-usuario)
  - [Comandos rápidos](#comandos-rápidos)
- [Protocolo del Máster (etiquetas)](#protocolo-del-máster-etiquetas)
  - [Confirmaciones (onboarding)](#confirmaciones-onboarding)
  - [Tiradas de dados](#tiradas-de-dados)
- [Endpoints principales](#endpoints-principales)
- [Estilo y personalización del front](#estilo-y-personalización-del-front)
- [Despliegue](#despliegue)
- [Troubleshooting](#troubleshooting)
- [Roadmap corto](#roadmap-corto)
- [Créditos](#créditos)

---

## Estructura del proyecto

```
/web
  ├─ index.html         # UI base (landing + login + chat + CTAs)
  ├─ app.js             # Lógica de cliente (onboarding, chat, tiradas, confirmaciones)
  └─ styles.css         # Estilos (tokens + layout + modo invitado + vídeo de fondo)

/server
  ├─ index.js           # Express app, CORS, rutas /api/*
  ├─ api/index.js       # Adaptador para Vercel (export default app)
  ├─ auth.js            # Registro/login por username + PIN (con fallback en memoria)
  ├─ dm.js              # “Máster” (IA). Construye prompts y responde /api/dm/respond
  ├─ world/             # Mundo vivo (personajes, eventos, estado…) [requiere Postgres]
  ├─ chat.js            # Historial del chat (si hay BD)
  ├─ db.js              # Conexión a Postgres (Neon). Fallback: sin BD.
  ├─ openai.js          # Ping a OpenAI (comprobación de credenciales)
  ├─ prompts/           # Textos del Máster + reglas de juego/dados (editable)
  │    ├─ prompt-master.md
  │    ├─ game-rules.md
  │    └─ dice-rules.md
  ├─ data/              # (solo dev) JSONs locales
  ├─ .env.example
  └─ package.json
```

---

## Requisitos

- **Node 18+**
- (Opcional) **PostgreSQL** (ideal: Neon Serverless)
- **OPENAI_API_KEY** para el Máster (SDK oficial)

> Sin BD puedes probar el onboarding y jugar: el Máster funciona; se desactiva lo que requiere persistencia de mundo. Con BD se habilitan personajes, timeline, eventos, etc.

---

## Puesta en marcha (local)

### 1) Backend

```bash
cd server
cp .env.example .env
# Edita .env:
# - PORT=3001
# - ALLOWED_ORIGIN=http://localhost:3000
# - OPENAI_API_KEY=tu_clave
# - DATABASE_URL=postgres://...   # si usas BD
npm i
npm run dev
```

### 2) Frontend

Sirve la carpeta `/web` con un servidor estático (ejemplos):

```bash
# Opción A: http-server
npx http-server web -p 3000 -c-1

# Opción B: serve
npx serve web -l 3000
```

Abre:

```
http://localhost:3000/?api=http://localhost:3001/api
```

> **CORS**: en `.env` del backend, pon `ALLOWED_ORIGIN=http://localhost:3000`. Puedes incluir varios orígenes separados por coma.

---

## Variables de entorno (`/server/.env`)

- `PORT` — puerto del backend (por defecto `3001`)
- `ALLOWED_ORIGIN` — lista de orígenes permitidos para CORS, separados por comas
- `OPENAI_API_KEY` — clave de OpenAI (requerido para el Máster)
- `OPENAI_PROJECT` — *(opcional)* id de proyecto en OpenAI
- `DATABASE_URL` — URL Postgres (Neon recomendado). Si no está:
  - **auth** y **sesiones** usan memoria
  - el Máster funciona, pero **/world** devolverá errores o se no-op donde corresponda
- `LLM_MODEL` — *(opcional)* fuerza el modelo LLM del Máster (alias: `OPENAI_MODEL`).
  Si no se define, el servidor usa `gpt-5-mini`.

> En `server/openai.js` hay un **ping** que ayuda a validar credenciales.

---

## Cómo detecta el cliente la API

`/web/app.js` intenta en este orden:

1. Query `?api=...`  
2. `window.API_BASE`  
3. `location.origin + "/api"`  
4. `<meta name="api-base" content="...">`  
5. valor por defecto  
6. caché en `localStorage` (`sw:api_base`)

El cliente usa `GET /api/health` para probar cada candidato.

---

## Flujo de usuario

- **Login/registro** con `username` (a-z, 0-9, `_`, 3–24) + **PIN (4 dígitos)**.
- **Invitado**: si no hay sesión, el Máster da info y guía hasta crear usuario.  
- **Onboarding** del personaje por **fases**:
  1. `name` → pide nombre
  2. `build` → sugiere **especie + rol** (2–3 propuestas)
  3. `done` → empieza la aventura

### Comandos rápidos

- `/resumen` — muestra un resumen corto de la sesión anterior
- `/publico` / `/privado` — alterna visibilidad del perfil
- `/restart` — limpia estado local (msgs/char/step)

---

## Protocolo del Máster (etiquetas)

El Máster (IA) **no** pide al jugador escribir etiquetas; solo las **emite él**. El cliente las procesa.

### Confirmaciones (onboarding)

- Confirmar **nombre**:

```
<<CONFIRM NAME="TuNombre">>
```

- Confirmar **especie + rol**:

```
<<CONFIRM SPECIES="Twi'lek" ROLE="Contrabandista">>
```

- El cliente responde internamente:

```
<<CONFIRM_ACK TYPE="name|build" DECISION="yes|no">>
```

**Reglas**

- La etiqueta va **en una línea propia** y como **última línea** del mensaje del Máster.
- Si el jugador dice **NO**, el Máster propone nuevas opciones y vuelve a emitir la etiqueta.
- Al confirmar:
  - `name` ⇒ pasa a `species/role` (fase `build`)
  - `build` ⇒ pasa a `done` y arranca la aventura

### Tiradas de dados

El Máster **solo** sugiere tirada si hay **incertidumbre, riesgo, oposición o impacto**.

```
<<ROLL SKILL="Carisma" REASON="Tratas de convencer al guardia">>
```

El cliente muestra CTA “Resolver tirada” y llama a `/api/roll` (demo) o resuelve según el flujo acordado.  
El Máster narra **éxito/fallo** y consecuencias de forma breve y clara.

> Las reglas de estilo y cuándo pedir tirada están en `server/prompts/dice-rules.md` y `prompt-master.md`.

---

## Endpoints principales

### Salud

- `GET /health` y `GET /api/health` — ping JSON

### Auth (`/api/auth/*`)

- `POST /api/auth/register` → `{ username, pin }` → `{ ok:true, token, user }`
- `POST /api/auth/login` → `{ username, pin }` → `{ ok:true, token, user }`
- `POST /api/auth/logout` → header `Authorization: Bearer <token>`

> Sin `DATABASE_URL`, usuarios y sesiones se guardan **en memoria** (útil para pruebas).

### Máster / IA (`/api/dm/*`)

- `POST /api/dm/respond`  
  **Ejemplo de cuerpo**:

```json
{
  "message": "texto del jugador",
  "history": [{ "role": "user", "content": "..." }],
  "stage": "name|build|done",
  "character_id": "opcional",
  "clientState": {}
}
```

  **Respuesta**

```json
{ "ok": true, "text": "salida del Máster" }
```

  (Puede incluir `<<CONFIRM ...>>` o `<<ROLL ...>>` al final).

- `GET /api/dm/resume` — resumen corto (si hay BD y datos).

### Chat (histórico, opcional)

- `GET /api/chat/history?limit=200` (autenticado) — últimos mensajes si hay BD.

### Mundo vivo (`/api/world/*` y `/api/characters/*`) — **requiere BD**

- `GET  /api/world/characters/me`
- `POST /api/world/characters`
- `GET  /api/world/context?character_id=...`
- `GET  /api/world/inbox?character_id=...`
- `POST /api/events/read`
- `GET  /api/characters/:id/state`
- `PATCH /api/characters/:id/state`
- `POST /api/rolls`
- `POST /api/events`
- `GET  /api/characters/:id/timeline`

> **Esquema BD**: crear tablas `users`, `sessions`, `characters`, `character_state (+ _history)`, `events (+ event_targets, event_reads)`, `faction_memberships`, `chat_messages`. Tomar como referencia las consultas en los módulos de `world/`, `auth.js` y `chat.js`.

---

## Estilo y personalización del front

- Vídeo de la tarjeta de invitado en `/web/assets/video/hero-home-720p.*`.  
  Clase del vídeo: `.guest__bg`.

**Ajustar opacidad del vídeo (ejemplo CSS):**

```css
/* Capa encima del vídeo sin tocar el asset */
.guest__bg {
  position: relative;
}
.guest__bg::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.35); /* sube/baja este valor */
  pointer-events: none;
}
```

- El chat **no hace scroll global**: solo el área del chat scrollea; en móvil se evita el zoom del input.
- El **estado de identidad** (usuario + personaje) se muestra en cabecera cuando hay sesión.

---

## Despliegue

- **Vercel**: `server/api/[...all].js` exporta la app para `/api`.
  - Sube `/web` como estático y sirve bajo el **mismo dominio** que el API o pasa `?api=` en la URL.
  - Configura **Environment Variables**: `OPENAI_API_KEY`, `DATABASE_URL`, `ALLOWED_ORIGIN`, `LLM_MODEL`, etc.
- **Estático**: `/web` puede ir a cualquier CDN. Si no comparte dominio con el backend, **usa `?api=`** y configura CORS.

---

## Troubleshooting

- **Server: FAIL** en la cabecera → el cliente no alcanza `/api/health`. Revisa `?api=` o CORS.
- **401/403** → falta token (`Authorization: Bearer ...`). Vuelve a loguear.
- **/world/** error sin BD → esperado. Añade `DATABASE_URL` o ignora esas funciones en modo demo.
- **El Máster no responde** → comprueba `OPENAI_API_KEY` y logs en `server/dm.js`.
- **CORS bloqueado** → ajusta `ALLOWED_ORIGIN` (varios orígenes separados por coma).

---

## Roadmap corto

- [ ] Migraciones SQL oficiales (Neon)
- [ ] Tiradas “server-autorizadas” con registro en `rolls` y consecuencias de estado
- [ ] Editor visual de prompts (backoffice) para `prompts/*.md`
- [ ] Modo multi-rooms/sesiones
- [ ] Persistencia de **resumen** y “capítulos” jugados

---

## Créditos

- Diseño y sistema de juego: equipo Galactic.  
- Código: web vanilla + Node/Express.  
- IA: OpenAI SDK (personalizable editando `prompts/*`).

