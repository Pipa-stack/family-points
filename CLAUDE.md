# Family Points — guía para Claude

App web para que una familia reparta puntos según quién cuida de los hijos. Cada familia tiene un espacio compartido con un código (`FAM-XXXXXXXX`) y un enlace.

## Arquitectura
- **Frontend**: HTML + CSS + JS vanilla (sin frameworks) en `public/` (`index.html`, `styles.css`, `app.js`).
- **Backend**: Node/Express en `server.js`. API bajo `/api/family`. Guardado por operación con transacción `SELECT ... FOR UPDATE` para que dos dispositivos no se pisen.
- **BD**: PostgreSQL vía `DATABASE_URL`. Sin ella, almacenamiento en memoria (solo desarrollo); en producción el arranque falla si falta.
- **Despliegue**: Railway (proyecto `endearing-spirit`, servicios `family-points` + `Postgres`). Producción: https://family-points-production-0530.up.railway.app · Repo: https://github.com/Pipa-stack/family-points

## Comandos
```bash
npm install
npm start                 # http://localhost:3000 (memoria si no hay DATABASE_URL)
node --check server.js && node --check public/app.js   # comprobación de sintaxis
```
Railway redespliega solo al hacer `git push origin main`.

## Consejo de supervisión (subagentes en `.claude/agents/`)
Invócalos para mantener la calidad. Son de solo lectura (no editan):
- **ui-ux-reviewer** — diseño, accesibilidad (contraste AA, focus, táctil ≥44px), responsive, la escena pixel-art, microcopys. Da nota /10.
- **security-auditor** — cabeceras/CSP, rate limiting, inyección SQL, saneado, modelo de acceso por código, `npm audit`.
- **qa-tester** — pruebas E2E con navegador headless y curl (flujos, cálculo de puntos, concurrencia, persistencia).
- **code-reviewer** — corrección y calidad de `server.js` y `public/app.js` (casos borde, concurrencia, consistencia cliente/servidor).

Ejecuta la revisión antes de cada despliegue importante: pásalos por el diff pendiente y aplica lo de prioridad alta.

## Definición de "10/10" (metas de calidad)
- Accesibilidad: contraste AA en todo el texto, `:focus-visible` en interactivos, labels/aria, objetivos táctiles ≥44px en móvil.
- Sin errores de consola en los flujos principales (verificar con `qa-tester`).
- Seguridad sin hallazgos Alta/Crítica; `npm audit` limpio.
- Responsive impecable en móvil y escritorio; modo claro y oscuro cuidados.
- Cálculo de puntos correcto en casos borde (nocturno, salida<entrada, multiplicador por peques).

## Convenciones
- El helper `el(tag, props)` de `app.js` pone las claves con guion (`data-label`, `aria-label`) como **atributo**; el resto como propiedad.
- Los assets se enlazan con ruta **absoluta** (`/app.js`, `/styles.css`) porque la ruta `/f/CODE` rompería las relativas.
- No hardcodear reglas: puntos/hora, horario, miembros y peques se editan en Ajustes.
- Confirmar acciones destructivas (importar, vaciar). Textos y UI en español.
