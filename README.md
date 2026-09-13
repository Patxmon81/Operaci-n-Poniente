# Operación Poniente

Juego de estrategia en tiempo real 2D con vista cenital, en HTML5 + CSS +
JavaScript *vanilla*. Sin frameworks, sin dependencias y sin herramientas de
compilación: basta con abrir `index.html` en el navegador.

> **España, 2026.** El jugador dirige el **Mando de Emergencia Territorial**
> frente al **Consorcio Poniente**, una organización paramilitar transnacional
> ficticia con bases en la costa norte de África y células infiltradas en varias
> ciudades españolas.
>
> Ambientación de ficción. Los enclaves del Consorcio (Puerto Tazlán, Bahía
> Ámbar, Fuerte Zaidar) son topónimos inventados y no corresponden a ninguna
> localidad real.

---

## Estado: Fase 1 — Motor base

Esta entrega cubre **únicamente** los cimientos del motor:

| | |
|---|---|
| **1. Mapa base** | Silueta estilizada de la Península Ibérica, el Estrecho de Gibraltar, el archipiélago balear y la costa norteafricana, con nodos de ciudad marcados y rotulados. |
| **2. Cámara** | Desplazamiento por arrastre y zoom con la rueda, anclado al punto bajo el cursor. |
| **3. Unidades** | Tres unidades de ejemplo: selección por clic y por caja de arrastre, movimiento con clic derecho y *pathfinding* que evita el mar. |
| **4. Estructura** | `index.html`, `style.css`, `js/map.js`, `js/units.js`, `js/main.js`. |

**Fuera de alcance por ahora** (fases posteriores): recursos, construcción,
inteligencia artificial y niebla de guerra.

---

## Cómo ejecutarlo

Abrir `index.html` directamente en el navegador. Todos los scripts son clásicos
(sin módulos ES), así que funciona también sobre `file://`, sin servidor.

Si se prefiere servirlo:

```sh
python3 -m http.server 8080
# → http://localhost:8080
```

---

## Controles

| Entrada | Acción |
|---|---|
| Clic izquierdo | Seleccionar unidad |
| Arrastrar con el izquierdo | Caja de selección |
| Mayús + clic / arrastre | Añadir a la selección |
| **Clic derecho** | Ordenar movimiento |
| **Botón central + arrastrar** | Desplazar el mapa |
| **Espacio (o Ctrl) + arrastrar izquierdo** | Desplazar el mapa |
| **Rueda del ratón** | Zoom sobre el cursor |
| `W` `A` `S` `D` / flechas | Desplazar el mapa |
| `Q` / `E` | Alejar / acercar |
| `X` | Alto |
| `Esc` | Anular la selección |
| `Ctrl` + `A` | Seleccionar todas las unidades |
| `1` `2` `3` | Seleccionar una unidad concreta |
| `G` | Mostrar la malla de navegación |
| `F` | Centrar la cámara en el CG de Madrid |
| `H` | Ocultar la interfaz |

En pantallas táctiles: un dedo desplaza el mapa, dos dedos hacen zoom.

> El botón izquierdo queda reservado a la selección, como es habitual en el
> género, así que el arrastre de cámara se hace con el botón central o con
> Espacio pulsado.

---

## Arquitectura

Tres scripts clásicos que cuelgan de un único espacio de nombres global, `OP`,
cargados en orden por `index.html`.

### `js/map.js` → `OP.Map`

- **Proyección.** Equirectangular simple calibrada para que 1 unidad de mundo
  ≈ 0,93 km a la latitud media del teatro (90 u/grado de longitud, 120 u/grado
  de latitud). La geografía se declara en `[lon, lat]` legibles y se proyecta una
  sola vez al cargar.
- **Masas de tierra.** Polígonos estilizados (Iberia, Francia, norte de África,
  Mallorca, Menorca, Ibiza) con su *bounding box* precalculada. `landmassAt()`
  resuelve el terreno por lanzamiento de rayo, descartando antes por AABB.
  Francia se marca `navigable: false`: es tierra, pero fuera del área de
  operaciones.
- **Malla de navegación.** Rejilla regular de 8 unidades (190 × 210 celdas). Una
  celda es transitable si su centro cae en terreno navegable **y** ninguna de sus
  ocho vecinas está bloqueada. Ese margen de una celda mantiene a las unidades
  separadas de la línea de costa.
- **Pathfinding.** A\* con heurística octil, montículo binario sobre arrays
  tipados y marcas de generación (`stamp`) para no limpiar los arrays entre
  búsquedas. Prohíbe cortar esquinas en diagonal. La ruta se suaviza después por
  *string pulling*: se elimina todo punto intermedio con visión directa
  transitable. Un destino sobre el mar se reubica en la costa transitable más
  cercana, hasta un máximo de 14 celdas (~130 km); más allá, la orden se rechaza.
- **Dibujado.** Mar con degradado, halo batimétrico, relleno y línea de costa,
  fronteras a trazos, retícula geográfica, corredores logísticos, nodos de ciudad
  y rótulos. Los glifos van en espacio mundo; los textos, en espacio pantalla, a
  tamaño constante.

### `js/units.js` → `OP.Units`

- `Unit`: posición, radio y velocidad en unidades de mundo; rumbo con giro
  progresivo; ruta como lista de waypoints pendientes.
- `UnitManager`: selección (por clic, por rectángulo, aditiva), órdenes de
  movimiento, simulación y dibujado.
- Las órdenes de grupo reparten **huecos de formación** en anillos concéntricos
  alrededor del destino y asignan a cada unidad el más cercano, priorizando a las
  que ya están más cerca; así un grupo no se apila en un punto.
- `resolveOverlaps()` separa los cuerpos que se solapan, pero **descarta** todo
  empuje que llevaría a una unidad al agua: la malla sigue siendo la autoridad.
- Los símbolos son de tipo OTAN y se dibujan a tamaño constante en pantalla
  (lectura de mapa operativo); se encogen algo al alejar la cámara y pierden el
  distintivo en vista de teatro.

### `js/main.js` → `OP.Game`

- `Camera`: centro en unidades de mundo más factor de zoom. Convierte entre
  pantalla y mundo, aplica la transformación al contexto (incluido el
  `devicePixelRatio`), acota el encuadre al mundo y hace zoom manteniendo fijo el
  punto bajo el cursor. El zoom mínimo se recalcula en cada redimensionado para
  que nunca se pueda alejar más allá del teatro completo.
- Entrada de ratón, teclado y táctil; bucle con `requestAnimationFrame` y `dt`
  acotado a 50 ms.
- HUD en DOM (no en el lienzo), con `pointer-events: none` para que el lienzo
  reciba toda la entrada. El panel de selección se redibuja sólo cuando cambia su
  firma de contenido.

`OP.Game` queda expuesto en la consola (`camera`, `units`, `notify`,
`toggleNavGrid`) para depurar.

---

## Notas de diseño

- **Ceuta, Melilla y Baleares no son alcanzables por tierra**, y así debe ser: el
  pathfinding es terrestre y el Estrecho es agua. Ordenar un movimiento hasta
  allí devuelve «sin ruta terrestre». El transporte naval y aéreo corresponde a
  fases posteriores.
- El coste de un `findPath` sobre este mapa se mide en 1–6 ms, así que la fase
  siguiente puede recalcular rutas sin presupuesto especial.
- Toda la geografía vive en `LANDMASSES`, `CITIES`, `BORDERS` y `ROUTES` dentro
  de `map.js`: añadir un nodo o retocar una costa es editar coordenadas
  `[lon, lat]`, sin tocar el motor.
