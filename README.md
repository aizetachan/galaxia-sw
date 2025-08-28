GALACTIC (galaxia-sw)

Mundo compartido estilo Star Wars — Vanilla Web (HTML/CSS/JS) + API Node/Express.
Front simple y estático en /web, backend en /server. Soporta modo “solo IA” (sin BD) y modo mundo vivo con PostgreSQL.

Estructura del proyecto
/web
  ├─ index.html         # UI base (landing + login + chat + CTAs)
  ├─ app.js             # Lógica de cliente (onboarding, chat, tiradas, confirmaciones)
  └─ styles.css         # Estilos (tokens + layout + modo invitado + vídeo de fondo)

/server
  ├─ index.js           # Express app, CORS, rutas /api/*
  ├─ api/index.js       # Adaptador para Vercel (export default app)
  ├─ auth.js            # Registro/login por username + PIN (con fallback en memoria)
  ├─ dm.js              # “Máster” (IA). Construye prompts y responde /api/dm/respond
  ├─ world.js           # Mundo vivo (personajes, eventos, estado…) [requiere Postgres]
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

Requisitos

Node 18+

(Opcional) PostgreSQL (ideal: Neon Serverless)

OPENAI_API_KEY para el Máster (usa SDK oficial)

Sin BD puedes probar el onboarding y jugar: el Máster funciona; se desactiva lo que requiere persistencia de mundo. Con BD se habilitan personajes, timeline, eventos, etc.

Puesta en marcha (local)
1) Backend
cd server
cp .env.example .env
# Edita .env
# - PORT=3001
# - ALLOWED_ORIGIN=http://localhost:3000 (o donde sirvas /web)
# - OPENAI_API_KEY=tu_clave
# - DATABASE_URL=postgres://... (si usas BD)
npm i
npm run dev         # levanta Express con --watch

2) Frontend

Sirve la carpeta /web con un servidor estático (ejemplos):

# Opción A: http-server
npx http-server web -p 3000 -c-1

# Opción B: serve
npx serve web -l 3000


Abre:

http://localhost:3000/?api=http://localhost:3001/api
(El cliente auto-detecta /api, pero con front/back en dominios distintos es más robusto pasar ?api=.)

CORS: en .env del backend, pon ALLOWED_ORIGIN=http://localhost:3000. Puedes incluir varios orígenes separados por coma.

Variables de entorno (/server/.env)

PORT: puerto del backend (por defecto 3001)

ALLOWED_ORIGIN: lista de orígenes permitidos para CORS, separada por comas

OPENAI_API_KEY: clave de OpenAI (requerido para el Máster)

OPENAI_PROJECT: (opcional) id de proyecto en OpenAI

DATABASE_URL: URL Postgres (Neon recomendado). Si no está presente:

auth y sesiones usan memoria

el Máster funciona, pero /world devolverá errores o se no-op donde corresponda

En /server/openai.js hay un ping que ayuda a validar credenciales.

Cómo detecta el cliente la API

/web/app.js intenta en este orden:

Query ?api=...

window.API_BASE

location.origin + "/api"

<meta name="api-base" content="...">

valor por defecto

caché en localStorage (sw:api_base)

Hay un /api/health que se usa para probar cada candidato.

Flujo de usuario

Login/registro con username (a-z, 0-9, _, 3–24) + PIN (4 dígitos).

Invitado: si no hay sesión, el Máster da info y guía hasta crear usuario.

Onboarding del personaje por fases:

name → pide nombre

build → sugiere especie + rol (2–3 propuestas)

done → empieza la aventura

El cliente intercepta etiquetas del Máster y muestra CTAs (confirmación / tiradas).

Comandos rápidos (desde el input del chat)

/resumen → muestra un resumen corto de la sesión anterior

/publico / /privado → alterna visibilidad del perfil

/restart → limpia estado local (msgs/char/step)

Protocolo del Máster (etiquetas)

El Máster (IA) no pide al jugador escribir etiquetas; solo las emite él. El cliente las procesa.

Confirmaciones (onboarding)

Confirmar nombre:

 <<CONFIRM NAME="TuNombre">>


Confirmar especie + rol:

<<CONFIRM SPECIES="Twi'lek" ROLE="Contrabandista">>


El cliente responde internamente con:

<<CONFIRM_ACK TYPE="name|build" DECISION="yes|no">>


Reglas:

La etiqueta va en una línea propia y como última línea del mensaje.

Si el jugador dice NO, el Máster propone nuevas opciones y vuelve a emitir la etiqueta.

Al confirmar:

name ⇒ pasa a species/role (fase build)

build ⇒ pasa a done y arranca la aventura

Tiradas de dados

El Máster solo sugiere tirada si hay incertidumbre, riesgo, oposición o impacto.

Formato:

<<ROLL SKILL="Carisma" REASON="Tratas de convencer al guardia">>


El cliente muestra CTA “Resolver tirada” y llama a /api/roll (demo) o resuelve según el flujo acordado.

El Máster narra éxito/fallo y consecuencias de forma breve y clara.

Las reglas de estilo y cuándo pedir tirada están en /server/prompts/dice-rules.md y prompt-master.md. Puedes editarlas libremente para ajustar el tono del Máster.

Endpoints principales
Salud

GET /health y GET /api/health → ping JSON

Auth (/api/auth/*)

POST /api/auth/register → { username, pin } → devuelve { token, user }

POST /api/auth/login → { username, pin } → devuelve { token, user }

POST /api/auth/logout → header Authorization: Bearer <token>

Sin DATABASE_URL, usuarios y sesiones se guardan en memoria (útil para pruebas).

Máster / IA (/api/dm/*)

POST /api/dm/respond
Cuerpo flexible:

{
  "message": "texto del jugador",
  "history": [ { "role": "user|assistant", "content": "..." } ],
  "stage": "name|build|done",
  "character_id": "id del personaje (opcional)",
  "clientState": { ... }   // metadatos opcionales
}


Respuesta: { ok: true, text: "<salida del Máster>" }
(Puede incluir <<CONFIRM ...>> o <<ROLL ...>> al final).

GET /api/dm/resume
Resumen corto para reenganche (si hay BD y datos).

Chat (histórico, opcional)

GET /api/chat/history?limit=200 (autenticado)
Devuelve últimos mensajes si hay BD (chat_messages).

Mundo vivo (/api/world/* y /api/characters/*) — requiere BD

GET /api/world/characters/me → personaje del usuario

POST /api/world/characters → upsert de personaje (por usuario o invitado)

GET /api/world/context?character_id=... → contexto cercano (eventos, facción, actor)

GET /api/world/inbox?character_id=... → bandeja de eventos no leídos

POST /api/events/read → marca eventos como leídos

GET /api/characters/:id/state

PATCH/api/characters/:id/state → parches de estado (attrs, inventario, tags)

POST /api/rolls → registrar tirada en BD

POST /api/events → crear evento (actor, visibilidad, targets…)

GET /api/characters/:id/timeline → feed mergeado (actor, target, facción, cercanía)

Esquema BD: el repo no incluye migraciones. Las tablas utilizadas incluyen users, sessions, characters, character_state (+ _history), events (+ event_targets, event_reads), faction_memberships, chat_messages. Recomendado crear el esquema en Neon siguiendo los campos usados en las consultas de world.js, auth.js y chat.js.

Estilo y personalización del front

Vídeo de la tarjeta de invitado en /web/assets/video/hero-home-720p.*.
La clase del vídeo es .guest__bg (ver styles.css), puedes ajustar opacidad con una capa ::after o un filtro CSS.

El chat no hace scroll global: solo el área del chat scrollea; en móvil se evita el zoom del input.

El estado de identidad (usuario + personaje) se pinta arriba a la derecha cuando hay sesión.

Despliegue

Vercel: el adaptador server/api/index.js exporta la app para /api.

Sube /web como estático y asegúrate de servirlo bajo el mismo dominio que el API o pasa ?api= en la URL.

Configura las Environment Variables en el panel (OPENAI_API_KEY, DATABASE_URL, ALLOWED_ORIGIN, etc.).

Estático: /web puede ir a cualquier CDN. Si no comparte dominio con el backend, usa ?api= y configura CORS en el backend.

Troubleshooting

Server: FAIL en la cabecera → el cliente no puede alcanzar /api/health. Revisa ?api= o CORS.

401/403 al llamar a endpoints → falta token (Authorization: Bearer ...). Vuelve a loguear.

/world/ error sin BD → esperado. Añade DATABASE_URL o ignora esas funciones en modo demo.

El Máster no responde → comprueba OPENAI_API_KEY y logs de server/dm.js.

CORS bloqueado → ajusta ALLOWED_ORIGIN (pueden ser varios orígenes separados por coma).

Roadmap corto

 Migraciones SQL oficiales (Neon)

 Resolver tiradas “server-autorizadas” con registro en rolls y consecuencias de estado

 Editor visual de prompts (backoffice) para prompts/*.md

 Modo multi-rooms/sesiones

 Persistencia cliente ↔ servidor del resumen y “capítulos” jugados

Créditos

Diseño y sistema de juego: equipo Galactic.

Código: web vanilla + Node/Express.

IA: OpenAI SDK (personalizable via prompts/*).
