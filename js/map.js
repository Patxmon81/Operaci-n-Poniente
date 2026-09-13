/* =============================================================================
 * OPERACIÓN PONIENTE — Fase 1 del motor
 * js/map.js
 *
 * Geografía del teatro de operaciones (Península Ibérica, Estrecho de Gibraltar
 * y costa norteafricana), malla de navegación terrestre, pathfinding A* y
 * dibujado del mapa base.
 *
 * Todas las coordenadas geográficas se declaran en [longitud, latitud] y se
 * proyectan a "unidades de mundo" mediante una equirectangular simple, calibrada
 * para que 1 unidad de mundo ≈ 0,93 km a la latitud media del teatro.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  /* ---------------------------------------------------------------------------
   * 1. PROYECCIÓN
   * ------------------------------------------------------------------------ */

  var PROJ = {
    lon0: -10,   // longitud de referencia
    lat0: 44.5,  // latitud de referencia
    kx: 90,      // unidades de mundo por grado de longitud
    ky: 120,     // unidades de mundo por grado de latitud
    ox: 150,     // desplazamiento X
    oy: 100      // desplazamiento Y
  };

  function projX(lon) { return (lon - PROJ.lon0) * PROJ.kx + PROJ.ox; }
  function projY(lat) { return (PROJ.lat0 - lat) * PROJ.ky + PROJ.oy; }

  // Proyección inversa, para la lectura de coordenadas del HUD.
  function lonAt(x) { return (x - PROJ.ox) / PROJ.kx + PROJ.lon0; }
  function latAt(y) { return PROJ.lat0 - (y - PROJ.oy) / PROJ.ky; }

  /** Convierte un array de pares [lon, lat] en un array de puntos {x, y}. */
  function projectRing(coords) {
    var ring = new Array(coords.length);
    for (var i = 0; i < coords.length; i++) {
      ring[i] = { x: projX(coords[i][0]), y: projY(coords[i][1]) };
    }
    return ring;
  }

  /** Límites del mundo jugable, en unidades de mundo. */
  var WORLD = { minX: 0, minY: 0, maxX: 1520, maxY: 1680 };
  WORLD.width = WORLD.maxX - WORLD.minX;
  WORLD.height = WORLD.maxY - WORLD.minY;

  /* ---------------------------------------------------------------------------
   * 2. MASAS DE TIERRA
   *
   * Siluetas estilizadas: suficientes vértices para que la costa sea
   * reconocible, pocos para que el test punto-en-polígono sea barato.
   * `navigable: false` marca territorio fuera del área de operaciones.
   * ------------------------------------------------------------------------ */

  var LANDMASSES = [
    {
      id: 'iberia',
      name: 'Península Ibérica',
      shortName: 'Iberia',
      navigable: true,
      style: 'own',
      coords: [
        // --- Costa cantábrica, de Galicia a Irún (oeste → este) ---
        [-8.85, 43.35], [-8.00, 43.72], [-7.00, 43.60], [-6.00, 43.58],
        [-4.85, 43.42], [-3.80, 43.47], [-2.93, 43.40], [-1.95, 43.35],
        [-1.78, 43.38],
        // --- Pirineos (frontera con Francia), Irún → Cap de Creus ---
        [-0.75, 42.95], [0.30, 42.72], [1.45, 42.50], [2.35, 42.45],
        [3.17, 42.43],
        // --- Costa mediterránea, Cap de Creus → Tarifa ---
        [3.20, 41.95], [2.17, 41.33], [1.30, 41.10], [0.86, 40.75],
        [0.72, 40.60], [0.20, 40.05], [0.00, 39.72], [-0.33, 39.45], [0.00, 39.05],
        [0.19, 38.85], [-0.50, 38.32], [-0.70, 37.85], [-0.98, 37.58],
        [-1.62, 37.40], [-1.85, 36.95], [-2.19, 36.72], [-2.46, 36.83],
        [-3.45, 36.75], [-4.42, 36.70], [-5.00, 36.48], [-5.28, 36.28],
        [-5.61, 36.01],
        // --- Golfo de Cádiz y costa algarveña ---
        [-6.03, 36.18], [-6.30, 36.55], [-6.35, 36.85], [-6.95, 37.20], [-7.42, 37.18],
        [-8.00, 37.08], [-8.99, 37.02],
        // --- Fachada atlántica portuguesa, sur → norte ---
        [-8.80, 38.00], [-9.20, 38.42], [-9.50, 38.78], [-9.20, 39.35],
        [-8.85, 39.80], [-8.80, 40.15], [-8.78, 41.15], [-8.87, 41.88],
        [-8.80, 42.25], [-9.03, 42.55], [-9.27, 42.90], [-9.05, 43.20]
      ]
    },
    {
      id: 'francia',
      name: 'Francia',
      shortName: 'Francia',
      navigable: false,
      style: 'foreign',
      coords: [
        [-1.78, 43.38], [-1.55, 43.80], [-1.25, 44.50], [-1.20, 45.60],
        [5.80, 45.60], [5.80, 43.60], [4.60, 43.35], [3.30, 43.20],
        [3.17, 42.43], [2.35, 42.45], [1.45, 42.50], [0.30, 42.72],
        [-0.75, 42.95]
      ]
    },
    {
      id: 'africa',
      name: 'Costa Norteafricana',
      shortName: 'N. de África',
      navigable: true,
      style: 'hostile',
      coords: [
        // --- Fachada atlántica marroquí, sur → norte ---
        [-10.40, 29.50], [-9.80, 31.40], [-9.85, 32.40], [-9.30, 32.55], [-8.60, 33.25],
        [-7.60, 33.60], [-6.85, 34.05], [-6.55, 34.30], [-6.10, 35.20],
        [-5.80, 35.79],
        // --- Orilla sur del Estrecho de Gibraltar y costa mediterránea ---
        [-5.45, 35.92], [-5.32, 35.89], [-5.05, 35.62], [-4.35, 35.20],
        [-3.93, 35.25], [-3.30, 35.20], [-2.95, 35.32], [-2.60, 35.12],
        [-1.86, 35.10], [-1.20, 35.30], [-0.64, 35.72], [0.09, 35.93],
        [1.31, 36.52], [2.40, 36.60], [3.06, 36.78], [4.20, 36.90],
        [5.80, 37.05],
        // --- Cierre por el borde inferior del mapa ---
        [5.80, 29.50]
      ]
    },
    {
      id: 'mallorca',
      name: 'Mallorca',
      shortName: 'Mallorca',
      navigable: true,
      style: 'own',
      coords: [
        [2.35, 39.55], [2.75, 39.88], [3.15, 39.95], [3.45, 39.78],
        [3.35, 39.35], [2.95, 39.28], [2.55, 39.32]
      ]
    },
    {
      id: 'menorca',
      name: 'Menorca',
      shortName: 'Menorca',
      navigable: true,
      style: 'own',
      coords: [
        [3.80, 39.92], [4.10, 40.05], [4.30, 39.95], [4.10, 39.82],
        [3.85, 39.80]
      ]
    },
    {
      id: 'ibiza',
      name: 'Ibiza',
      shortName: 'Ibiza',
      navigable: true,
      style: 'own',
      coords: [
        [1.20, 39.10], [1.45, 39.12], [1.60, 38.92], [1.40, 38.65],
        [1.22, 38.80]
      ]
    }
  ];

  // Proyectar una sola vez y precalcular AABB para descartar rápido.
  LANDMASSES.forEach(function (mass) {
    mass.ring = projectRing(mass.coords);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < mass.ring.length; i++) {
      var p = mass.ring[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    mass.bounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  });

  /* ---------------------------------------------------------------------------
   * 3. FRONTERAS INTERIORES (sólo decorativas)
   * ------------------------------------------------------------------------ */

  var BORDERS = [
    {
      id: 'es-pt',
      name: 'Frontera hispano-portuguesa',
      coords: [
        [-8.87, 41.88], [-8.20, 42.10], [-7.90, 41.88], [-6.95, 41.95],
        [-6.55, 41.65], [-6.20, 41.58], [-6.80, 41.03], [-6.85, 40.27],
        [-6.80, 40.00], [-7.00, 39.67], [-7.55, 39.65], [-7.25, 38.95],
        [-7.00, 38.20], [-7.25, 37.80], [-7.42, 37.18]
      ]
    },
    {
      id: 'pirineos',
      name: 'Pirineos',
      coords: [
        [-1.78, 43.38], [-0.75, 42.95], [0.30, 42.72], [1.45, 42.50],
        [2.35, 42.45], [3.17, 42.43]
      ]
    }
  ];

  BORDERS.forEach(function (b) { b.ring = projectRing(b.coords); });

  /* ---------------------------------------------------------------------------
   * 4. NODOS DE CIUDAD
   *
   * `role`:
   *   'hq'      — Cuartel General del Mando de Emergencia Territorial
   *   'city'    — nodo urbano peninsular
   *   'plaza'   — plaza de soberanía en el norte de África
   *   'hostile' — enclave del Consorcio Poniente (topónimos ficticios)
   * ------------------------------------------------------------------------ */

  var CITIES = [
    { id: 'madrid',    name: 'Madrid',    lon: -3.70, lat: 40.42, role: 'hq',    label: 'CG · Mando de Emergencia Territorial', anchor: 'right' },
    { id: 'barcelona', name: 'Barcelona', lon:  2.17, lat: 41.39, role: 'city',  anchor: 'right' },
    { id: 'valencia',  name: 'Valencia',  lon: -0.38, lat: 39.47, role: 'city',  anchor: 'right' },
    { id: 'sevilla',   name: 'Sevilla',   lon: -5.99, lat: 37.39, role: 'city',  anchor: 'left'  },
    { id: 'bilbao',    name: 'Bilbao',    lon: -2.93, lat: 43.20, role: 'city',  anchor: 'left'  },
    { id: 'zaragoza',  name: 'Zaragoza',  lon: -0.88, lat: 41.65, role: 'city',  anchor: 'right' },
    { id: 'malaga',    name: 'Málaga',    lon: -4.42, lat: 36.78, role: 'city',  anchor: 'left'  },
    { id: 'alicante',  name: 'Alicante',  lon: -0.52, lat: 38.36, role: 'city',  anchor: 'right' },
    { id: 'ceuta',     name: 'Ceuta',     lon: -5.30, lat: 35.83, role: 'plaza', anchor: 'left'  },
    { id: 'melilla',   name: 'Melilla',   lon: -2.96, lat: 35.25, role: 'plaza', anchor: 'right' },

    // Enclaves ficticios del Consorcio Poniente. No existen: los topónimos son
    // inventados y no corresponden a ninguna localidad real.
    { id: 'tazlan',  name: 'Puerto Tazlán', lon: -4.60, lat: 35.05, role: 'hostile', anchor: 'left'  },
    { id: 'ambar',   name: 'Bahía Ámbar',   lon: -1.55, lat: 34.95, role: 'hostile', anchor: 'right' },
    { id: 'zaidar',  name: 'Fuerte Zaidar', lon:  0.60, lat: 35.50, role: 'hostile', anchor: 'right' }
  ];

  CITIES.forEach(function (c) { c.x = projX(c.lon); c.y = projY(c.lat); });

  var CITY_BY_ID = {};
  CITIES.forEach(function (c) { CITY_BY_ID[c.id] = c; });

  /** Corredores logísticos entre nodos. Decorativos en la Fase 1. */
  var ROUTES = [
    ['madrid', 'zaragoza'], ['zaragoza', 'barcelona'], ['zaragoza', 'bilbao'],
    ['madrid', 'bilbao'], ['madrid', 'valencia'], ['valencia', 'barcelona'],
    ['valencia', 'alicante'], ['madrid', 'sevilla'], ['sevilla', 'malaga'],
    ['malaga', 'alicante']
  ];

  /** Rótulos de referencia geográfica dibujados sobre el mar y el terreno. */
  var REGION_LABELS = [
    { text: 'OCÉANO ATLÁNTICO',        lon: -11.00, lat: 40.20, kind: 'sea',  size: 15, rotate: -90 },
    { text: 'MAR MEDITERRÁNEO',        lon:   2.70, lat: 38.00, kind: 'sea',  size: 15 },
    { text: 'MAR CANTÁBRICO',          lon:  -5.20, lat: 44.30, kind: 'sea',  size: 12 },
    { text: 'ESTRECHO DE GIBRALTAR',   lon:  -5.50, lat: 36.20, kind: 'strait', size: 9 },
    { text: 'ESPAÑA',                  lon:  -3.90, lat: 41.60, kind: 'land', size: 18 },
    { text: 'PORTUGAL',                lon:  -8.10, lat: 39.60, kind: 'land', size: 11 },
    { text: 'FRANCIA',                 lon:   0.60, lat: 44.20, kind: 'foreign', size: 12 },
    { text: 'COSTA DEL CONSORCIO',     lon:  -3.40, lat: 34.20, kind: 'enemy', size: 13 }
  ];

  REGION_LABELS.forEach(function (l) { l.x = projX(l.lon); l.y = projY(l.lat); });

  /* ---------------------------------------------------------------------------
   * 5. TEST DE TERRENO
   * ------------------------------------------------------------------------ */

  function pointInRing(px_, py_, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i].x, yi = ring[i].y;
      var xj = ring[j].x, yj = ring[j].y;
      if ((yi > py_) !== (yj > py_) &&
          px_ < (xj - xi) * (py_ - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Devuelve la masa de tierra que contiene el punto, o null si es mar. */
  function landmassAt(x, y) {
    for (var i = 0; i < LANDMASSES.length; i++) {
      var m = LANDMASSES[i], b = m.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (pointInRing(x, y, m.ring)) return m;
    }
    return null;
  }

  function isLand(x, y) { return landmassAt(x, y) !== null; }

  function isSea(x, y) { return landmassAt(x, y) === null; }

  /** Terreno transitable por unidades terrestres (tierra en área de operaciones). */
  function isTraversableTerrain(x, y) {
    var m = landmassAt(x, y);
    return m !== null && m.navigable;
  }

  /* ---------------------------------------------------------------------------
   * 6. MALLA DE NAVEGACIÓN
   *
   * Rejilla regular sobre el mundo. Una celda es transitable si su centro cae
   * en terreno navegable y ninguna de sus 8 vecinas es intransitable: ese
   * margen de una celda mantiene a las unidades separadas de la línea de costa
   * y evita que su radio sobresalga al mar.
   * ------------------------------------------------------------------------ */

  var CELL = 8;
  var COLS = Math.ceil(WORLD.width / CELL);
  var ROWS = Math.ceil(WORLD.height / CELL);
  var CELL_COUNT = COLS * ROWS;

  var terrain = new Uint8Array(CELL_COUNT); // 1 = terreno navegable
  var walkable = new Uint8Array(CELL_COUNT); // 1 = transitable (con margen)

  function cellIndex(col, row) { return row * COLS + col; }
  function colOf(x) { return Math.floor((x - WORLD.minX) / CELL); }
  function rowOf(y) { return Math.floor((y - WORLD.minY) / CELL); }
  function cellCenterX(col) { return WORLD.minX + col * CELL + CELL * 0.5; }
  function cellCenterY(row) { return WORLD.minY + row * CELL + CELL * 0.5; }
  function inGrid(col, row) { return col >= 0 && col < COLS && row >= 0 && row < ROWS; }

  function buildNavGrid() {
    var col, row, i;
    for (row = 0; row < ROWS; row++) {
      for (col = 0; col < COLS; col++) {
        terrain[cellIndex(col, row)] =
          isTraversableTerrain(cellCenterX(col), cellCenterY(row)) ? 1 : 0;
      }
    }
    // Erosión de una celda: margen costero.
    for (row = 0; row < ROWS; row++) {
      for (col = 0; col < COLS; col++) {
        i = cellIndex(col, row);
        if (!terrain[i]) { walkable[i] = 0; continue; }
        var open = 1;
        for (var dr = -1; dr <= 1 && open; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            if (dc === 0 && dr === 0) continue;
            var nc = col + dc, nr = row + dr;
            if (!inGrid(nc, nr) || !terrain[cellIndex(nc, nr)]) { open = 0; break; }
          }
        }
        walkable[i] = open;
      }
    }
  }

  function isWalkableCell(col, row) {
    return inGrid(col, row) && walkable[cellIndex(col, row)] === 1;
  }

  /** ¿Puede una unidad terrestre ocupar este punto del mundo? */
  function isWalkable(x, y) { return isWalkableCell(colOf(x), rowOf(y)); }

  /**
   * Busca la celda transitable más cercana a (col, row) por anillos crecientes.
   * Devuelve {col, row} o null si no hay ninguna dentro del radio máximo.
   */
  function nearestWalkableCell(col, row, maxRadius) {
    if (isWalkableCell(col, row)) return { col: col, row: row };
    var limit = maxRadius || 60;
    for (var r = 1; r <= limit; r++) {
      var best = null, bestD = Infinity;
      for (var dc = -r; dc <= r; dc++) {
        for (var dr = -r; dr <= r; dr++) {
          // sólo el perímetro del anillo
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
          var nc = col + dc, nr = row + dr;
          if (!isWalkableCell(nc, nr)) continue;
          var d = dc * dc + dr * dr;
          if (d < bestD) { bestD = d; best = { col: nc, row: nr }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Radio máximo, en celdas, al que se reubica un destino marcado sobre el mar.
   * Un clic junto a la costa se ajusta a tierra; uno en mar abierto se rechaza.
   */
  var SEA_SNAP_CELLS = 14;

  /** Punto transitable más cercano a una posición del mundo, o null. */
  function nearestWalkablePoint(x, y, maxRadius) {
    var c = nearestWalkableCell(colOf(x), rowOf(y), maxRadius);
    if (!c) return null;
    return { x: cellCenterX(c.col), y: cellCenterY(c.row) };
  }

  /* ---------------------------------------------------------------------------
   * 7. PATHFINDING A*
   * ------------------------------------------------------------------------ */

  // Montículo binario mínimo sobre índices de celda, ordenado por fScore.
  var heapData = new Int32Array(CELL_COUNT + 1);
  var heapSize = 0;
  var gScore = new Float32Array(CELL_COUNT);
  var fScore = new Float32Array(CELL_COUNT);
  var cameFrom = new Int32Array(CELL_COUNT);
  var visitStamp = new Int32Array(CELL_COUNT);
  var closedStamp = new Int32Array(CELL_COUNT);
  var stamp = 0;

  function heapClear() { heapSize = 0; }

  function heapPush(node) {
    var i = heapSize++;
    heapData[i] = node;
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (fScore[heapData[parent]] <= fScore[heapData[i]]) break;
      var t = heapData[parent]; heapData[parent] = heapData[i]; heapData[i] = t;
      i = parent;
    }
  }

  function heapPop() {
    var top = heapData[0];
    heapSize--;
    if (heapSize > 0) {
      heapData[0] = heapData[heapSize];
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, best = i;
        if (l < heapSize && fScore[heapData[l]] < fScore[heapData[best]]) best = l;
        if (r < heapSize && fScore[heapData[r]] < fScore[heapData[best]]) best = r;
        if (best === i) break;
        var t = heapData[best]; heapData[best] = heapData[i]; heapData[i] = t;
        i = best;
      }
    }
    return top;
  }

  var SQRT2 = Math.SQRT2;

  function octile(c1, r1, c2, r2) {
    var dx = Math.abs(c1 - c2), dy = Math.abs(r1 - r2);
    return (dx > dy) ? (dx - dy) + SQRT2 * dy : (dy - dx) + SQRT2 * dx;
  }

  var NEIGHBOURS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  /**
   * A* sobre la malla. Devuelve un array de celdas {col, row} desde el origen
   * hasta el destino (ambos incluidos), o null si no hay ruta terrestre.
   */
  function findCellPath(startCol, startRow, goalCol, goalRow) {
    if (!isWalkableCell(startCol, startRow) || !isWalkableCell(goalCol, goalRow)) {
      return null;
    }
    var startIdx = cellIndex(startCol, startRow);
    var goalIdx = cellIndex(goalCol, goalRow);
    if (startIdx === goalIdx) return [{ col: startCol, row: startRow }];

    stamp++;
    heapClear();
    gScore[startIdx] = 0;
    fScore[startIdx] = octile(startCol, startRow, goalCol, goalRow);
    cameFrom[startIdx] = -1;
    visitStamp[startIdx] = stamp;
    heapPush(startIdx);

    while (heapSize > 0) {
      var current = heapPop();
      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;

      if (current === goalIdx) return reconstructCells(startIdx, goalIdx);

      var cCol = current % COLS;
      var cRow = (current - cCol) / COLS;

      for (var n = 0; n < NEIGHBOURS.length; n++) {
        var dc = NEIGHBOURS[n][0], dr = NEIGHBOURS[n][1];
        var nc = cCol + dc, nr = cRow + dr;
        if (!isWalkableCell(nc, nr)) continue;
        // Prohibir cortar esquinas en diagonal.
        if (dc !== 0 && dr !== 0 &&
            (!isWalkableCell(cCol + dc, cRow) || !isWalkableCell(cCol, cRow + dr))) {
          continue;
        }
        var neighbour = cellIndex(nc, nr);
        if (closedStamp[neighbour] === stamp) continue;
        var step = (dc !== 0 && dr !== 0) ? SQRT2 : 1;
        var tentative = gScore[current] + step;
        if (visitStamp[neighbour] !== stamp || tentative < gScore[neighbour]) {
          visitStamp[neighbour] = stamp;
          gScore[neighbour] = tentative;
          fScore[neighbour] = tentative + octile(nc, nr, goalCol, goalRow);
          cameFrom[neighbour] = current;
          heapPush(neighbour);
        }
      }
    }
    return null;
  }

  function reconstructCells(startIdx, goalIdx) {
    var cells = [];
    var node = goalIdx;
    while (node !== -1) {
      var col = node % COLS;
      cells.push({ col: col, row: (node - col) / COLS });
      if (node === startIdx) break;
      node = cameFrom[node];
    }
    cells.reverse();
    return cells;
  }

  /**
   * ¿Hay línea recta transitable entre dos puntos del mundo?
   * Muestrea el segmento a pasos de media celda.
   */
  function hasLineOfWalk(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(dist / (CELL * 0.5));
    if (steps === 0) return isWalkable(ax, ay);
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      if (!isWalkable(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  /** Elimina waypoints redundantes cuando hay visión directa (string pulling). */
  function smoothPath(points) {
    if (points.length <= 2) return points.slice();
    var out = [points[0]];
    var anchor = 0;
    for (var i = 2; i < points.length; i++) {
      if (!hasLineOfWalk(points[anchor].x, points[anchor].y, points[i].x, points[i].y)) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /**
   * Ruta terrestre entre dos puntos del mundo, evitando el mar.
   *
   * @returns {{points: Array<{x,y}>, exact: boolean}|null}
   *   `points` excluye la posición de partida. `exact` es false cuando el
   *   destino pedido estaba en el mar o pegado a la costa y se ha reubicado.
   */
  function findPath(fromX, fromY, toX, toY) {
    var startCell = nearestWalkableCell(colOf(fromX), rowOf(fromY), 12);
    if (!startCell) return null;

    var goalRaw = { col: colOf(toX), row: rowOf(toY) };
    var goalCell = nearestWalkableCell(goalRaw.col, goalRaw.row, SEA_SNAP_CELLS);
    if (!goalCell) return null;
    var exact = (goalCell.col === goalRaw.col && goalCell.row === goalRaw.row);

    var cells = findCellPath(startCell.col, startCell.row, goalCell.col, goalCell.row);
    if (!cells) return null;

    var points = [{ x: fromX, y: fromY }];
    for (var i = 0; i < cells.length; i++) {
      points.push({ x: cellCenterX(cells[i].col), y: cellCenterY(cells[i].row) });
    }
    // Si el destino exacto es alcanzable, remátalo ahí en vez del centro de celda.
    if (exact && isWalkable(toX, toY)) points.push({ x: toX, y: toY });

    var smoothed = smoothPath(points);
    smoothed.shift(); // la posición actual no es un waypoint
    return { points: smoothed, exact: exact };
  }

  /* ---------------------------------------------------------------------------
   * 8. PALETA Y DIBUJADO
   * ------------------------------------------------------------------------ */

  var PALETTE = {
    seaDeep: '#060f1c',
    seaShallow: '#0d2036',
    seaGrid: 'rgba(140, 200, 235, 0.07)',
    coastGlow: 'rgba(96, 190, 226, 0.30)',
    landOwn: '#20302c',
    landOwnHi: '#2a3d36',
    landForeign: '#1b2129',
    landHostile: '#2e2320',
    coastline: 'rgba(150, 226, 255, 0.55)',
    coastlineForeign: 'rgba(150, 170, 190, 0.28)',
    coastlineHostile: 'rgba(255, 168, 120, 0.42)',
    border: 'rgba(150, 226, 255, 0.16)',
    route: 'rgba(120, 210, 190, 0.16)',
    city: '#7de3c4',
    cityHq: '#ffd166',
    cityPlaza: '#8fd4ff',
    cityHostile: '#ff7a5c',
    label: 'rgba(214, 236, 244, 0.92)',
    labelSea: 'rgba(126, 176, 205, 0.42)',
    labelEnemy: 'rgba(255, 150, 120, 0.5)',
    labelForeign: 'rgba(140, 156, 172, 0.45)',
    navFree: 'rgba(96, 226, 178, 0.12)',
    navMargin: 'rgba(255, 196, 96, 0.14)',
    navBlocked: 'rgba(255, 92, 92, 0.07)'
  };

  var seaGradient = null;

  function drawSea(ctx, camera) {
    var v = camera.visibleWorldBounds();
    if (!seaGradient || seaGradient.ctx !== ctx) {
      var g = ctx.createLinearGradient(0, WORLD.minY, 0, WORLD.maxY);
      g.addColorStop(0, PALETTE.seaDeep);
      g.addColorStop(0.45, PALETTE.seaShallow);
      g.addColorStop(1, PALETTE.seaDeep);
      seaGradient = { ctx: ctx, grad: g };
    }
    ctx.fillStyle = seaGradient.grad;
    ctx.fillRect(v.minX, v.minY, v.maxX - v.minX, v.maxY - v.minY);
  }

  function drawGraticule(ctx, camera) {
    var v = camera.visibleWorldBounds();
    var stepDeg = camera.zoom > 1.6 ? 1 : 2;
    ctx.save();
    ctx.strokeStyle = PALETTE.seaGrid;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    var lon, lat;
    for (lon = -12; lon <= 6; lon += stepDeg) {
      var gx = projX(lon);
      if (gx < v.minX || gx > v.maxX) continue;
      ctx.moveTo(gx, v.minY); ctx.lineTo(gx, v.maxY);
    }
    for (lat = 30; lat <= 46; lat += stepDeg) {
      var gy = projY(lat);
      if (gy < v.minY || gy > v.maxY) continue;
      ctx.moveTo(v.minX, gy); ctx.lineTo(v.maxX, gy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function tracePath(ctx, ring) {
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (var i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
  }

  function drawLand(ctx, camera) {
    var i, mass;

    // Halo batimétrico alrededor de toda la tierra.
    ctx.save();
    ctx.shadowColor = PALETTE.coastGlow;
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    for (i = 0; i < LANDMASSES.length; i++) {
      tracePath(ctx, LANDMASSES[i].ring);
      ctx.fill();
    }
    ctx.restore();

    // Relleno y línea de costa.
    for (i = 0; i < LANDMASSES.length; i++) {
      mass = LANDMASSES[i];
      tracePath(ctx, mass.ring);
      if (mass.style === 'foreign') {
        ctx.fillStyle = PALETTE.landForeign;
        ctx.strokeStyle = PALETTE.coastlineForeign;
      } else if (mass.style === 'hostile') {
        ctx.fillStyle = PALETTE.landHostile;
        ctx.strokeStyle = PALETTE.coastlineHostile;
      } else {
        ctx.fillStyle = PALETTE.landOwn;
        ctx.strokeStyle = PALETTE.coastline;
      }
      ctx.fill();
      ctx.lineWidth = 1.6 / camera.zoom;
      ctx.stroke();
    }

    // Fronteras interiores, a trazos.
    ctx.save();
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = 1.2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 5 / camera.zoom]);
    for (i = 0; i < BORDERS.length; i++) {
      var ring = BORDERS[i].ring;
      ctx.beginPath();
      ctx.moveTo(ring[0].x, ring[0].y);
      for (var j = 1; j < ring.length; j++) ctx.lineTo(ring[j].x, ring[j].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRoutes(ctx, camera) {
    ctx.save();
    ctx.strokeStyle = PALETTE.route;
    ctx.lineWidth = 1.4 / camera.zoom;
    ctx.setLineDash([3 / camera.zoom, 6 / camera.zoom]);
    ctx.beginPath();
    for (var i = 0; i < ROUTES.length; i++) {
      var a = CITY_BY_ID[ROUTES[i][0]], b = CITY_BY_ID[ROUTES[i][1]];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Superposición de depuración de la malla de navegación (tecla G). */
  function drawNavGrid(ctx, camera) {
    var v = camera.visibleWorldBounds();
    var c0 = Math.max(0, colOf(v.minX)), c1 = Math.min(COLS - 1, colOf(v.maxX));
    var r0 = Math.max(0, rowOf(v.minY)), r1 = Math.min(ROWS - 1, rowOf(v.maxY));
    for (var row = r0; row <= r1; row++) {
      for (var col = c0; col <= c1; col++) {
        var i = cellIndex(col, row);
        if (walkable[i]) ctx.fillStyle = PALETTE.navFree;
        else if (terrain[i]) ctx.fillStyle = PALETTE.navMargin;
        else continue; // el mar se deja limpio
        ctx.fillRect(WORLD.minX + col * CELL, WORLD.minY + row * CELL,
                     CELL - 0.5, CELL - 0.5);
      }
    }
  }

  var CITY_STYLE = {
    hq:      { color: PALETTE.cityHq,      r: 9, glyph: 'star' },
    city:    { color: PALETTE.city,        r: 6, glyph: 'dot' },
    plaza:   { color: PALETTE.cityPlaza,   r: 6, glyph: 'square' },
    hostile: { color: PALETTE.cityHostile, r: 6, glyph: 'cross' }
  };

  function drawCityGlyph(ctx, city, s, scale) {
    var r = s.r / scale;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 1.6 / scale;

    if (s.glyph === 'star') {
      ctx.beginPath();
      for (var k = 0; k < 10; k++) {
        var ang = -Math.PI / 2 + k * Math.PI / 5;
        var rad = (k % 2 === 0) ? r : r * 0.44;
        var fx = city.x + Math.cos(ang) * rad;
        var fy = city.y + Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(city.x, city.y, r * 1.75, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.glyph === 'square') {
      ctx.beginPath();
      ctx.rect(city.x - r * 0.72, city.y - r * 0.72, r * 1.44, r * 1.44);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(city.x - r * 1.4, city.y - r * 1.4, r * 2.8, r * 2.8);
      ctx.stroke();
    } else if (s.glyph === 'cross') {
      ctx.beginPath();
      ctx.moveTo(city.x - r, city.y - r); ctx.lineTo(city.x + r, city.y + r);
      ctx.moveTo(city.x + r, city.y - r); ctx.lineTo(city.x - r, city.y + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(city.x, city.y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(city.x, city.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(city.x, city.y, r * 1.25, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Nodos de ciudad: glifos en espacio mundo, rótulos en espacio pantalla. */
  function drawCities(ctx, camera) {
    var i, city, s;

    for (i = 0; i < CITIES.length; i++) {
      city = CITIES[i];
      s = CITY_STYLE[city.role] || CITY_STYLE.city;
      ctx.save();
      ctx.globalAlpha = 0.95;
      drawCityGlyph(ctx, city, s, camera.zoom);
      ctx.restore();
    }

    // Rótulos con tamaño constante en pantalla.
    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.textBaseline = 'middle';
    for (i = 0; i < CITIES.length; i++) {
      city = CITIES[i];
      s = CITY_STYLE[city.role] || CITY_STYLE.city;
      var p = camera.worldToScreen(city.x, city.y);
      if (p.x < -160 || p.y < -40 || p.x > camera.viewWidth + 160 || p.y > camera.viewHeight + 40) {
        continue;
      }
      var toRight = city.anchor !== 'left';
      var off = (s.r * 1.9) + 6;
      ctx.textAlign = toRight ? 'left' : 'right';
      var tx = p.x + (toRight ? off : -off);

      var main = city.role === 'hq' ? 'bold 13px' : '12px';
      ctx.font = main + ' "Segoe UI", Roboto, system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4, 10, 18, 0.85)';
      ctx.strokeText(city.name, tx, p.y);
      ctx.fillStyle = city.role === 'hostile' ? PALETTE.cityHostile : s.color;
      ctx.fillText(city.name, tx, p.y);

      if (city.label && camera.zoom > 0.75) {
        ctx.font = '10px "Segoe UI", Roboto, system-ui, sans-serif';
        ctx.strokeText(city.label, tx, p.y + 14);
        ctx.fillStyle = PALETTE.labelSea;
        ctx.fillText(city.label, tx, p.y + 14);
      }
    }
    ctx.restore();
  }

  /** Rótulos geográficos, también con tamaño constante en pantalla. */
  function drawRegionLabels(ctx, camera) {
    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < REGION_LABELS.length; i++) {
      var l = REGION_LABELS[i];
      var p = camera.worldToScreen(l.x, l.y);
      if (p.x < -200 || p.y < -60 || p.x > camera.viewWidth + 200 || p.y > camera.viewHeight + 60) {
        continue;
      }
      var color = PALETTE.labelSea;
      if (l.kind === 'land') color = 'rgba(190, 224, 214, 0.40)';
      else if (l.kind === 'foreign') color = PALETTE.labelForeign;
      else if (l.kind === 'enemy') color = PALETTE.labelEnemy;
      else if (l.kind === 'strait') color = 'rgba(180, 226, 255, 0.62)';

      ctx.save();
      ctx.translate(p.x, p.y);
      if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180);
      ctx.font = '600 ' + l.size + 'px "Segoe UI", Roboto, system-ui, sans-serif';
      ctx.letterSpacing = '2px';
      ctx.fillStyle = color;
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------------
   * 9. API PÚBLICA
   * ------------------------------------------------------------------------ */

  buildNavGrid();

  OP.Map = {
    WORLD: WORLD,
    PALETTE: PALETTE,
    CELL: CELL,
    SEA_SNAP_CELLS: SEA_SNAP_CELLS,
    cities: CITIES,
    cityById: function (id) { return CITY_BY_ID[id]; },
    landmasses: LANDMASSES,

    projX: projX,
    projY: projY,
    lonAt: lonAt,
    latAt: latAt,

    isLand: isLand,
    isSea: isSea,
    isWalkable: isWalkable,
    landmassAt: landmassAt,
    nearestWalkablePoint: nearestWalkablePoint,
    hasLineOfWalk: hasLineOfWalk,
    findPath: findPath,

    navStats: function () {
      var free = 0, land = 0;
      for (var i = 0; i < CELL_COUNT; i++) { if (terrain[i]) land++; if (walkable[i]) free++; }
      return { cols: COLS, rows: ROWS, cells: CELL_COUNT, land: land, walkable: free };
    },

    drawSea: drawSea,
    drawGraticule: drawGraticule,
    drawLand: drawLand,
    drawRoutes: drawRoutes,
    drawNavGrid: drawNavGrid,
    drawCities: drawCities,
    drawRegionLabels: drawRegionLabels
  };

})(OP);
