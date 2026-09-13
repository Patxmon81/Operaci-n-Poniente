# Operación Poniente

Juego de estrategia en tiempo real **isométrico**, en HTML5 + CSS + JavaScript
*vanilla*. Sin frameworks, sin dependencias, sin herramientas de compilación y
**sin un solo archivo de imagen**: todo el arte se dibuja por código al arrancar.

> **España, 2026.** El jugador dirige el **Mando de Emergencia Territorial**
> frente al **Consorcio Poniente**, una organización paramilitar transnacional
> ficticia. El escenario es la **Vega del Jarama**, 128×128 casillas al noreste
> de Madrid: un río que parte el sector en dos con un único vado, la base del MET
> en la margen oriental y un puesto avanzado del Consorcio en la occidental.

Se abre `index.html` en el navegador. Funciona sobre `file://`, sin servidor.

---

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Mapa estratégico de la Península Ibérica | aparcada en `campaign/` |
| 2 | Motor isométrico: terreno, vegetación, edificios y unidades animadas | hecha |
| **3** | **Economía: recolección, acarreo, construcción y adiestramiento** | **actual** |
| 4 | Combate, IA y niebla de guerra | pendiente |

**Fuera de alcance por ahora:** combate, inteligencia artificial y niebla de
guerra. El Consorcio existe como decorado; todavía no hace nada.

---

## El bucle de juego

Tres recursos, tomados del bucle clásico del género pero traducidos a la
ambientación:

| Recurso | De dónde sale |
|---|---|
| **Víveres** | Almendros y frutales, y las huertas que se construyen |
| **Madera** | Pinares y olivares |
| **Metal** | Montones de chatarra: carrocerías y vigas |

El **zapador** es el aldeano. Se le manda con clic derecho sobre un árbol, un
frutal, una chatarrería o una obra. Recolecta hasta llenar la carga (12
unidades), la acarrea al punto de descarga más cercano, la deja y vuelve. Cuando
un árbol se agota deja un tocón y libera la casilla.

Se construye desde el panel inferior o con las teclas indicadas en cada botón.
Al elegir un edificio aparece la huella fantasma bajo el cursor —verde si cabe y
hay recursos, roja si no—; el clic izquierdo abre la obra y los zapadores
seleccionados van a levantarla. Varios zapadores en la misma obra la terminan
proporcionalmente antes.

| Edificio | Coste | Para qué |
|---|---|---|
| Alojamiento | 60 madera | +5 de límite de personal |
| Depósito | 100 madera | Punto de descarga avanzado |
| Huerta | 70 madera | Víveres renovables mientras quede cosecha |
| Almacén | 120 madera · 30 metal | Punto de descarga |
| Barracón | 160 madera · 40 metal | Adiestra fusileros y exploradores |
| Torre de vigilancia | 50 madera · 80 metal | Puesto elevado |

Al seleccionar un edificio propio con capacidad de instrucción se abre su panel:
el Centro de Mando adiestra zapadores; el barracón, fusileros y exploradores. La
cola se ve en el propio panel y como barra sobre el edificio.

---

## Controles

| Entrada | Acción |
|---|---|
| Clic izquierdo | Seleccionar unidad o edificio |
| Arrastrar con el izquierdo | Encuadre de selección |
| Mayús + clic | Añadir a la selección |
| **Clic derecho** | Marchar, recolectar o construir, según lo que haya debajo |
| **Botón central + arrastrar** | Mover la cámara |
| **Espacio (o Ctrl) + arrastrar** | Mover la cámara |
| **Rueda** | Zoom sobre el cursor |
| Clic en el minimapa | Saltar a ese punto del sector |
| `W` `A` `S` `D` / flechas | Mover la cámara |
| `Q` / `E` | Alejar / acercar |
| `C` `V` `U` `N` `B` `T` | Abrir la colocación de cada edificio |
| `.` | Seleccionar los zapadores sin tajo |
| `1` `2` `3` | Seleccionar por tipo, o adiestrar si hay un edificio seleccionado |
| `X` | Alto |
| `Esc` | Cancelar la colocación, o anular la selección |
| `F` | Centrar en la base |
| `H` | Ocultar la interfaz |

En pantallas táctiles: un dedo mueve la cámara, dos dedos hacen zoom.

---

## Arquitectura

Seis scripts clásicos que cuelgan del espacio de nombres global `OP`, cargados en
orden por `index.html`.

### `js/iso.js` → `OP.Iso`

Proyección dimétrica 2:1 (rombos de 64×32) y cámara. Convierte entre rejilla,
píxeles de mundo y pantalla; el zoom mantiene fijo el punto bajo el cursor.

### `js/art.js` → `OP.Art`

La fábrica de sprites. No hay archivos de imagen: al arrancar se dibujan y se
cachean en mapas de bits fuera de pantalla (~130 ms).

- **Terreno.** Seis tipos con paleta de meseta castellana en verano, cuatro
  variantes de cada uno, con manchas, grano y briznas.
- **Transiciones.** Flecos direccionales sobre el tile vecino de menor prioridad,
  y orillas con bajío y espuma para el borde del agua.
- **Capa de nubes.** Manchas suaves que se repiten sin costura, aplicadas al
  terreno en coordenadas de mundo con `source-atop`. Es lo que rompe de verdad la
  cuadrícula de rombos.
- **Vegetación y recursos.** Pinos, olivos, almendros con fruto, matorral, roca,
  chatarra, cajas, bidones, parapetos de sacos y tocones.
- **Edificios.** Cajas isométricas sobre una huella de w×h casillas, con cubierta
  plana o a dos aguas. Más la huerta, que es plana y tiene cuatro estados de
  cosecha, y los andamios de obra.
- **Unidades.** Un esqueleto en coordenadas de modelo se posa, se gira sobre el
  eje vertical y se proyecta; las extremidades son cápsulas con contorno
  **ordenadas por profundidad**. De ahí salen atlas de 8 direcciones × 9
  fotogramas por tipo y facción.

### `js/economy.js` → `OP.Economy`

Almacén, población, catálogo de edificios y unidades, y colas de producción. El
tiempo de obra se mide en **segundos-zapador**, de modo que dos zapadores
levantan un edificio en la mitad de tiempo.

### `js/world.js` → `OP.World`

Sector de 128×128 generado con ruido de valor: cauce serpenteante, humedad que
reparte pasto y rastrojo, caminos, explanadas de base, pinares, olivares en
hileras, frutales, chatarrerías y el vado. Gestiona las entidades (props,
recursos, edificios y obras), la navegación A\* y el minimapa.

El terreno se hornea por **sectores de 16×16 casillas** con caché acotada y
desalojo del menos usado: 64 sectores no caben en memoria a la vez. En cada
fotograma se vuelca sólo el recorte visible de cada sector.

### `js/units.js` → `OP.Units`

Estado, selección, órdenes y la máquina de estados del oficio del zapador:
*ir → trabajar → acarrear → descargar*, con detección de bloqueo. La fase del
ciclo de marcha avanza **con la distancia recorrida, no con el reloj**, así que
los pies no patinan.

### `js/main.js` → `OP.Game`

Cámara, entrada, bucle, HUD, colocación de edificios y producción. El dibujado va
por capas: terreno → brillos del agua → huella bajo el cursor → rutas → **todas
las entidades ordenadas por profundidad** → barras de obra y producción →
encuadre de selección.

---

## Notas de diseño

- **El arte es procedimental por necesidad y por criterio.** Sin assets, el
  objetivo no es imitar los sprites prerrenderizados de un Age of Empires sino su
  *presentación*: perspectiva isométrica, simbología legible a tamaño pequeño y un
  paisaje con carácter propio.
- **La ambientación manda sobre la referencia.** Es España en 2026: equipo
  moderno, construcciones de base militar y chatarra en lugar de minas de oro.
- **El terreno es llano.** Los desniveles obligan a dibujar cada casilla como un
  cuadrilátero con cuatro alturas de esquina más los taludes; queda para después.
- **El vado es el único paso del río.** Una posición que defender cuando exista el
  combate.
- **Cuidado con `Math.round` en coordenadas de casilla.** Los puntos de ruta son
  centros de casilla (`x.5`), y redondear desplaza el destino una casilla entera.
  La casilla que contiene un punto es siempre su parte entera: `Math.floor`.
