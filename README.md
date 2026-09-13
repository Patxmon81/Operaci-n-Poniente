# Operación Poniente

Juego de estrategia en tiempo real **isométrico**, en HTML5 + CSS + JavaScript
*vanilla*. Sin frameworks, sin dependencias, sin herramientas de compilación y
**sin un solo archivo de imagen**: todo el arte se dibuja por código al arrancar.

> **España, 2026.** El jugador dirige el **Mando de Emergencia Territorial**
> frente al **Consorcio Poniente**, una organización paramilitar transnacional
> ficticia. El escenario actual es la **Vega del Jarama**, al noreste de Madrid:
> un río que parte el sector en dos, una base del MET en la margen oriental y un
> puesto avanzado del Consorcio en la occidental, unidos por un único vado.

Se abre `index.html` en el navegador. Funciona sobre `file://`, sin servidor.

---

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Mapa estratégico de la Península Ibérica, cámara, unidades y pathfinding | aparcada en `campaign/` |
| **2** | **Motor isométrico: terreno, vegetación, edificios y unidades animadas** | **actual** |
| 3 | Aldeanos, recursos y construcción | pendiente |
| 4 | Combate, IA y niebla de guerra | pendiente |

La Fase 1 construyó un mapa de operaciones de toda España; al ver que lo buscado
era un RTS táctico al estilo Age of Empires, el proyecto pivotó a isométrico. El
mapa peninsular queda en `campaign/map.js`, sin cargar, para volver como pantalla
de campaña cuando haya varios escenarios que enlazar.

**Fuera de alcance por ahora:** recursos, construcción, combate, IA y niebla de
guerra.

---

## Controles

| Entrada | Acción |
|---|---|
| Clic izquierdo | Seleccionar unidad |
| Arrastrar con el izquierdo | Encuadre de selección |
| Mayús + clic | Añadir a la selección |
| **Clic derecho** | Ordenar marcha |
| **Botón central + arrastrar** | Mover la cámara |
| **Espacio (o Ctrl) + arrastrar** | Mover la cámara |
| **Rueda** | Zoom sobre el cursor |
| Clic en el minimapa | Saltar a ese punto del sector |
| `W` `A` `S` `D` / flechas | Mover la cámara |
| `Q` / `E` | Alejar / acercar |
| `1` `2` `3` | Seleccionar todos los fusileros / exploradores / zapadores |
| `X` | Alto |
| `Esc` | Anular la selección |
| `Ctrl` + `A` | Seleccionar todas las unidades |
| `F` | Centrar en la base |
| `H` | Ocultar la interfaz |

En pantallas táctiles: un dedo mueve la cámara, dos dedos hacen zoom.

---

## Arquitectura

Cinco scripts clásicos que cuelgan del espacio de nombres global `OP`, cargados
en orden por `index.html`.

### `js/iso.js` → `OP.Iso`

Proyección dimétrica 2:1 (rombos de 64×32) y cámara. Convierte entre rejilla,
píxeles de mundo y pantalla; el zoom mantiene fijo el punto bajo el cursor y el
encuadre queda acotado al sector.

### `js/art.js` → `OP.Art`

La fábrica de sprites. No hay archivos de imagen: al arrancar se dibujan y se
cachean en mapas de bits fuera de pantalla (~125 ms).

- **Terreno.** Seis tipos con paleta de meseta castellana en verano (pasto,
  rastrojo, tierra, arena, agua, monte bajo), cuatro variantes de cada uno, con
  manchas, grano y briznas.
- **Transiciones.** Cada tipo tiene cuatro *flecos* direccionales que se pintan
  sobre el tile vecino de menor prioridad, más un juego de **orillas** con bajío
  y espuma para el borde del agua. Sin eso, la costa es un escalón de rombos y se
  ve la rejilla.
- **Capa de nubes.** Una textura de manchas suaves que se repite sin costura,
  aplicada al terreno en coordenadas de mundo con `source-atop`. Es lo que rompe
  de verdad la cuadrícula: introduce variación de luz a una escala mucho mayor
  que el tile.
- **Vegetación y enseres.** Pinos, olivos, matorral, roca caliza, cajas, bidones
  y parapetos de sacos terreros.
- **Edificios.** Cajas isométricas levantadas sobre una huella de w×h tiles: se
  dibujan las dos caras que concurren en la esquina frontal, con cubierta plana o
  a dos aguas, puerta, ventanas, mástil y franja del color de facción.
- **Unidades.** Un esqueleto sencillo en coordenadas de modelo se posa, se gira
  sobre el eje vertical y se proyecta; las extremidades son cápsulas con contorno
  **ordenadas por profundidad**, de modo que el brazo y la pierna del fondo
  quedan detrás. De ahí salen atlas de 8 direcciones × 9 fotogramas por tipo y
  facción.

### `js/world.js` → `OP.World`

Escenario de 80×80 tiles, generado con ruido de valor: cauce serpenteante,
humedad que reparte pasto y rastrojo, caminos de tierra, explanadas de base,
pinares, un olivar en hileras y el vado. El terreno se hornea por **sectores de
16×16 tiles** y en cada fotograma sólo se vuelcan los visibles. Incluye el
pathfinding A\* con heurística octil sobre arrays tipados y suavizado por
*string pulling*, y el minimapa.

### `js/units.js` → `OP.Units`

Estado, selección (clic, encuadre, aditiva), órdenes con huecos de formación en
anillos y separación de cuerpos que nunca empuja a una unidad a un tile
bloqueado. La fase del ciclo de marcha avanza **con la distancia recorrida, no
con el reloj**, así que los pies no patinan.

### `js/main.js` → `OP.Game`

Cámara, entrada de ratón/teclado/táctil, bucle, HUD y minimapa. El dibujado va
por capas: terreno → brillos del agua → casilla bajo el cursor → rutas → **todas
las entidades ordenadas por profundidad** (algoritmo del pintor) → encuadre de
selección.

---

## Notas de diseño

- **El arte es procedimental por necesidad y por criterio.** Age of Empires II
  consigue su aspecto con decenas de gigabytes de sprites prerrenderizados desde
  modelos 3D. Sin assets, el objetivo no es imitar ese arte sino su
  *presentación*: perspectiva isométrica, simbología legible a tamaño pequeño y
  un paisaje con carácter propio.
- **La ambientación manda sobre la referencia.** Es España en 2026, así que los
  soldados llevan equipo moderno y las construcciones son de base militar. Lo que
  se toma prestado de AoE es la cámara y el lenguaje visual, no la Edad Media.
- **El terreno es llano.** Los desniveles obligan a dibujar cada tile como un
  cuadrilátero con cuatro alturas de esquina más los taludes; es un salto grande
  de complejidad y queda para una fase posterior.
- **El vado es el único paso del río.** Ordenar marcha a la otra orilla por
  cualquier otro punto devuelve «sin ruta terrestre», y es lo correcto: da una
  posición que defender cuando exista el combate.
