# ⭐ Family Points

App web sencilla (tipo hoja de cálculo) para repartir de forma justa el cuidado de los peques en casa.

Cuando uno de los dos se va a la calle o con amigos, el otro se queda cuidando y **gana puntos por cada hora**. Solo cuentan las horas dentro del horario válido (por defecto **06:00–22:00**).

## Cómo funciona

- Apuntas un **turno**: fecha, quién se queda, hora de entrada y de salida.
- La app calcula automáticamente las **horas válidas** (recortadas al horario permitido) y los **puntos**.
- El **marcador** de arriba muestra quién va ganando. 👑

### Ejemplo
Papá sale a las 15:00 y vuelve a las 19:00 → Mamá se queda 4 h con los peques → **Mamá gana 4 puntos**.

## Nada hardcodeado ⚙️

Todo se edita desde **Ajustes**:
- Puntos por hora
- Horario válido (desde / hasta)
- Multiplicar puntos por número de peques cuidados (opcional)
- Miembros de la familia (añadir, renombrar, quitar)
- Peques

## Datos

- Se guardan **en tu navegador** (localStorage). No hay servidor ni cuentas.
- **Exportar / Importar** (`.json`) para pasar los datos entre móviles.
- **Exportar Excel** (`.csv`) para abrirlo en Excel/Google Sheets.

## Uso

Ábrela en el móvil o el PC. Está publicada con **GitHub Pages**:

> https://pipa-stack.github.io/family-points/

O clona y abre `index.html` directamente:

```bash
git clone https://github.com/Pipa-stack/family-points.git
cd family-points
# abre index.html en el navegador (doble clic)
```

## Tecnología

HTML + CSS + JavaScript puro. Sin dependencias ni compilación. Funciona offline.
