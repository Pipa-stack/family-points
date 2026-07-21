# ⭐ Family Points

App web (tipo hoja de cálculo) para repartir de forma justa el cuidado de los peques en casa.

Cuando uno de los dos se va a la calle o con amigos, el otro se queda cuidando y **gana puntos por cada hora**. Solo cuentan las horas dentro del horario válido (por defecto **06:00–22:00**).

**Cada familia crea su propio espacio** con un código (p. ej. `FAM-XY7K2Q`) y comparte el enlace: todos veréis y sumaréis los mismos puntos desde cualquier móvil.

## Cómo funciona

1. Entras en la web y pulsas **Crear familia nueva** → obtienes un código.
2. Compartes el enlace `…/f/FAM-XXXXXX` con tu pareja/familia.
3. Apuntáis **turnos**: fecha, quién se queda, hora de entrada y de salida.
4. La app calcula automáticamente las **horas válidas** y los **puntos**, y muestra el marcador. 👑

### Ejemplo
Papá sale a las 15:00 y vuelve a las 19:00 → Mamá se queda 4 h con los peques → **Mamá gana 4 puntos**.

## Cada familia crea sus reglas ⚙️

Todo se edita desde **Ajustes** (nada hardcodeado):
- Puntos por hora
- Horario válido (desde / hasta)
- Multiplicar puntos por número de peques cuidados (opcional)
- Miembros de la familia (añadir, renombrar, quitar)
- Peques

## Datos

- Se guardan **en la nube** (PostgreSQL) y se comparten con quien tenga el enlace de tu familia.
- La app se **sincroniza sola** entre dispositivos (cada pocos segundos).
- **Exportar / Importar** (`.json`) y **Exportar Excel** (`.csv`) para copias de seguridad.

## Tecnología

- **Frontend**: HTML + CSS + JavaScript puro (sin frameworks), en `public/`.
- **Backend**: Node.js + Express (`server.js`). API mínima bajo `/api/family`.
- **Base de datos**: PostgreSQL (vía `DATABASE_URL`). Sin `DATABASE_URL` usa memoria (solo para desarrollo local).

## Desarrollo local

```bash
npm install
npm start           # http://localhost:3000  (almacenamiento en memoria)
```

Con Postgres local:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/familypoints" npm start
```

## Despliegue en Railway

1. En [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → elige `Pipa-stack/family-points`.
2. En el proyecto, **+ New** → **Database** → **Add PostgreSQL**. Railway crea la variable `DATABASE_URL` y la app la usa automáticamente (crea la tabla sola al arrancar).
3. En el servicio de la app, pestaña **Settings** → **Networking** → **Generate Domain** para obtener la URL pública.
4. Listo. La app arranca con `npm start` y escucha en el puerto que indica Railway (`PORT`).

Variables de entorno:
- `DATABASE_URL` — la pone Railway al añadir PostgreSQL.
- `PGSSL` — opcional; ponla a `true` solo si conectas a un Postgres que exige SSL.

## Licencia

MIT
