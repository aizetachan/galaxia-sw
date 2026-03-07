# Plan de Escalabilidad y Performance

## Objetivos
- Mantener el stack 100 % Firebase (Hosting + Functions + Firestore).
- Reducir tiempos de carga percibidos en el front (spinners, precarga de estado, lazy assets).
- Simplificar el código para facilitar contribuciones y nuevas features.

## Acciones completadas
- Consolidadas las dependencias en `functions/` (Gemini via Vertex/API Key).
- Front reorganizado para cargar sin flashes (`html.preload` + overlay de sincronización).
- Documentación y scripts legados movidos a `notes/legacy-server/`.

## Próximas tareas sugeridas
1. **Modularizar el front**: dividir `web/main.js` en módulos (`state`, `render`, `chat`, `ui/loading`).
2. **Tests E2E (Playwright o Cypress)** para onboarding y chat base.
3. **Telemetry básica**:
   - Cloud Logging estructurado (`functions.logger`) con campos `userId`/`stage`.
   - Métricas de latencia en Firestore (logs del máster).
4. **Service Worker ligero** para cachear assets y el video de la landing.
5. **CI**: workflow que ejecute `npm run build` + lint antes de desplegar.
6. **CLI utilitario** (`scripts/check-env.mjs`) para verificar que todos los secretos estén definidos antes del deploy.

## Indicadores
- Tiempo hasta primer mensaje mostrado (`TTFM-chat`).
- Latencia promedio de `/dm/respond` (Functions logs).
- Errores por sesión (token inválido, timeouts Gemini).

## Notas
- Mantener `notes/legacy-server/` sólo como referencia histórica; cualquier documento nuevo debe vivir en `docs/`.
- Cada cambio que afecte a escalabilidad debe actualizar este documento.
