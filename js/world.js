/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/world.js — Escenario, terreno, entidades estáticas y navegación.
 *
 * Escenario: «Vega del Jarama», al noreste de Madrid. Un río cruza el sector en
 * diagonal, con una base del Mando de Emergencia Territorial en la margen
 * oriental y un puesto avanzado del Consorcio Poniente en la occidental.
 *
 * El terreno se hornea por sectores de 16×16 tiles en mapas de bits fuera de
 * pantalla; en cada fotograma sólo se vuelcan los sectores visibles.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;
  var Art = OP.Art;

  var W = 80, H = 80;                 // tamaño del mapa, en tiles
  var CHUNK = 16;
  var CHUNKS_X = Math.ceil(W / CHUNK);
  var CHUNKS_Y = Math.ceil(H / CHUNK);

  var TYPES = ['agua', 'arena', 'tierra', 'secano', 'pasto', 'matorral'];
  var TYPE_INDEX = {};
  TYPES.forEach(function (t, i) { TYPE_INDEX[t] = i; });

  var tiles = new Uint8Array(W * H);       // índice en TYPES
  var variant = new Uint8Array(W * H);     // variante del sprite de terreno
  var blocked = new Uint8Array(W * H);     // 1 = intransitable
  var entities = [];                       // props y edificios, con profundidad
  var chunkCache = [];                     // sectores horneados, o null

  function idx(gx, gy) { return gy * W + gx; }
  function inside(gx, gy) { return gx >= 0 && gx < W && gy >= 0 && gy < H; }
  function typeAt(gx, gy) { return inside(gx, gy) ? TYPES[tiles[idx(gx, gy)]] : 'agua'; }
  function isBlocked(gx, gy) { return !inside(gx, gy) || blocked[idx(gx, gy)] === 1; }

  /* ---------------------------------------------------------------------------
   * 1. RUIDO
   * ------------------------------------------------------------------------ */

  function hash(x, y, s) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function vnoise(x, y, s) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var a = hash(x0, y0, s), b = hash(x0 + 1, y0, s);
    var c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }

  function fbm(x, y, s) {
    return vnoise(x, y, s) * 0.6 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3
         + vnoise(x * 4.3, y * 4.3, s + 19) * 0.1;
  }

  /* ---------------------------------------------------------------------------
   * 2. GENERACIÓN DEL ESCENARIO
   * ------------------------------------------------------------------------ */

  /** Eje del río para una fila dada: baja en diagonal y serpentea. */
  function riverAxis(gy) {
    return 16 + gy * 0.42 + Math.sin(gy * 0.11) * 6.5 + Math.sin(gy * 0.31) * 2.2;
  }

  function riverWidth(gy) { return 3.1 + Math.sin(gy * 0.07 + 1.2) * 1.1; }

  /** Vado del Jarama: el único paso a la margen occidental. */
  var FORD = [[33, 35], [27, 36], [21, 37], [14, 38]];

  var ROADS = [
    // De la base al vado y, cruzándolo, hasta el puesto del Consorcio.
    [[57, 20], [50, 26], [44, 30], [38, 33], [33, 35], [27, 36], [21, 37], [17, 45], [20, 57]],
    [[57, 22], [60, 32], [63, 44], [62, 56], [66, 68]],
    [[57, 21], [66, 18], [74, 14]]
  ];

  var BUILDINGS = [
    { id: 'mando',    fac: 'met', gx: 55, gy: 19, w: 3, h: 3 },
    { id: 'barracon', fac: 'met', gx: 50, gy: 17, w: 3, h: 2 },
    { id: 'barracon', fac: 'met', gx: 50, gy: 23, w: 3, h: 2 },
    { id: 'almacen',  fac: 'met', gx: 59, gy: 23, w: 2, h: 3 },
    { id: 'torre',    fac: 'met', gx: 54, gy: 15, w: 1, h: 1 },
    { id: 'torre',    fac: 'met', gx: 60, gy: 28, w: 1, h: 1 },
    { id: 'casa',     fac: 'met', gx: 62, gy: 17, w: 2, h: 2 },
    { id: 'casa',     fac: 'met', gx: 47, gy: 27, w: 2, h: 2 },

    { id: 'barracon', fac: 'pon', gx: 18, gy: 58, w: 3, h: 2 },
    { id: 'torre',    fac: 'pon', gx: 23, gy: 57, w: 1, h: 1 },
    { id: 'almacen',  fac: 'pon', gx: 17, gy: 62, w: 2, h: 3 },
    { id: 'casa',     fac: 'pon', gx: 22, gy: 62, w: 2, h: 2 }
  ];

  function distanceToPolyline(gx, gy, pts) {
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / len2)) : 0;
      var px = ax + dx * t, py = ay + dy * t;
      best = Math.min(best, Math.hypot(gx - px, gy - py));
    }
    return best;
  }

  function generateTerrain() {
    for (var gy = 0; gy < H; gy++) {
      var axis = riverAxis(gy), half = riverWidth(gy);
      for (var gx = 0; gx < W; gx++) {
        var i = idx(gx, gy);
        var dRiver = Math.abs(gx - axis);
        var wobble = (fbm(gx * 0.18, gy * 0.18, 91) - 0.5) * 1.8;
        var type;

        if (dRiver + wobble < half) {
          type = 'agua';
        } else if (dRiver + wobble < half + 1.8) {
          type = 'arena';
        } else {
          // Humedad: alta junto al río y en las vaguadas del ruido.
          var wet = fbm(gx * 0.055, gy * 0.055, 17);
          var proximity = Math.max(0, 1 - (dRiver - half) / 16);
          var moisture = wet * 0.72 + proximity * 0.45;
          if (moisture > 0.62) type = 'pasto';
          else if (moisture > 0.42) type = 'secano';
          else type = fbm(gx * 0.13, gy * 0.13, 53) > 0.55 ? 'matorral' : 'secano';
        }

        // Los caminos pisan el terreno natural.
        for (var r = 0; r < ROADS.length; r++) {
          if (distanceToPolyline(gx, gy, ROADS[r]) < 1.25 && type !== 'agua') {
            type = 'tierra';
            break;
          }
        }

        tiles[i] = TYPE_INDEX[type];
        variant[i] = (hash(gx, gy, 5) * 4) | 0;
        blocked[i] = type === 'agua' ? 1 : 0;
      }
    }

    // El vado se abre al final: convierte el cauce en arenal transitable.
    for (var fy = 0; fy < H; fy++) {
      for (var fx = 0; fx < W; fx++) {
        if (distanceToPolyline(fx, fy, FORD) > 1.4) continue;
        var fi = idx(fx, fy);
        tiles[fi] = TYPE_INDEX['arena'];
        blocked[fi] = 0;
      }
    }

    // Explanada de tierra batida bajo cada base.
    [{ x: 55, y: 21, r: 8 }, { x: 20, y: 60, r: 5.5 }].forEach(function (base) {
      for (var gy2 = 0; gy2 < H; gy2++) {
        for (var gx2 = 0; gx2 < W; gx2++) {
          var d = Math.hypot(gx2 - base.x, gy2 - base.y);
          if (d < base.r - fbm(gx2 * 0.3, gy2 * 0.3, 77) * 2.6 && typeAt(gx2, gy2) !== 'agua') {
            tiles[idx(gx2, gy2)] = TYPE_INDEX['tierra'];
          }
        }
      }
    });
  }

  function addProp(kind, gx, gy, spriteVariant) {
    if (!inside(gx, gy) || blocked[idx(gx, gy)]) return;
    var set = Art.props[kind];
    entities.push({
      kind: 'prop',
      gx: gx + 0.5, gy: gy + 0.5,
      depth: gx + gy + 1,
      sprite: set[spriteVariant % set.length]
    });
    blocked[idx(gx, gy)] = 1;
  }

  function plantVegetation() {
    var gx, gy, n;

    // Pinares en las lomas secas, lejos del río y de las bases.
    for (gy = 0; gy < H; gy++) {
      for (gx = 0; gx < W; gx++) {
        if (typeAt(gx, gy) === 'agua' || typeAt(gx, gy) === 'tierra') continue;
        if (Math.hypot(gx - 55, gy - 21) < 11) continue;
        if (Math.hypot(gx - 20, gy - 60) < 8) continue;

        var forest = fbm(gx * 0.085, gy * 0.085, 131);
        n = hash(gx, gy, 211);
        if (forest > 0.60 && n > 0.52) {
          addProp('pino', gx, gy, (n * 97) | 0);
        } else if (typeAt(gx, gy) === 'matorral' && n > 0.86) {
          addProp('matorral', gx, gy, (n * 53) | 0);
        } else if (n > 0.975) {
          addProp('roca', gx, gy, (n * 31) | 0);
        }
      }
    }

    // Olivar: hileras regulares, la marca del paisaje agrícola castellano.
    for (var row = 0; row < 9; row++) {
      for (var col = 0; col < 11; col++) {
        var ox = 52 + col * 2, oy = 44 + row * 2;
        if (!inside(ox, oy) || typeAt(ox, oy) === 'agua' || typeAt(ox, oy) === 'tierra') continue;
        addProp('olivo', ox, oy, (hash(ox, oy, 13) * 61) | 0);
      }
    }

    // Ribera: matorral disperso en las orillas arenosas.
    for (gy = 0; gy < H; gy++) {
      for (gx = 0; gx < W; gx++) {
        if (typeAt(gx, gy) !== 'arena') continue;
        if (hash(gx, gy, 307) > 0.9) addProp('matorral', gx, gy, (hash(gx, gy, 311) * 43) | 0);
      }
    }
  }

  /** Enseres de base: dan escala y hacen que la explanada no parezca vacía. */
  var BASE_PROPS = [
    ['sacos', 53, 17], ['sacos', 57, 15], ['sacos', 58, 27], ['sacos', 49, 29],
    ['cajas', 58, 21], ['cajas', 58, 22], ['cajas', 57, 26], ['cajas', 52, 20],
    ['bidones', 59, 20], ['bidones', 52, 25], ['bidones', 61, 22],
    ['cajas', 49, 20], ['bidones', 47, 25],

    ['sacos', 21, 56], ['sacos', 24, 62], ['cajas', 17, 57],
    ['bidones', 20, 65], ['cajas', 23, 64]
  ];

  function placeBaseProps() {
    BASE_PROPS.forEach(function (p) {
      addProp(p[0], p[1], p[2], (hash(p[1], p[2], 991) * 17) | 0);
    });
  }

  function raiseBuildings() {
    BUILDINGS.forEach(function (b) {
      var art = Art.buildings[b.id] && Art.buildings[b.id][b.fac];
      if (!art) return;
      for (var dy = 0; dy < b.h; dy++) {
        for (var dx = 0; dx < b.w; dx++) {
          if (inside(b.gx + dx, b.gy + dy)) blocked[idx(b.gx + dx, b.gy + dy)] = 1;
        }
      }
      entities.push({
        kind: 'building',
        id: b.id, faction: b.fac,
        gx: b.gx + b.w / 2, gy: b.gy + b.h / 2,
        depth: b.gx + b.gy + b.w + b.h - 1,
        sprite: art
      });
    });
  }

  /* ---------------------------------------------------------------------------
   * 3. DIBUJADO DEL TERRENO
   * ------------------------------------------------------------------------ */

  /** Caja envolvente, en píxeles de mundo, del sector (cx, cy). */
  function chunkBox(cx, cy) {
    var x0 = cx * CHUNK, y0 = cy * CHUNK;
    var x1 = Math.min(x0 + CHUNK, W) - 1, y1 = Math.min(y0 + CHUNK, H) - 1;
    return {
      x0: x0, y0: y0, x1: x1, y1: y1,
      minX: (x0 - y1) * Iso.HW - Iso.HW,
      maxX: (x1 - y0) * Iso.HW + Iso.HW,
      minY: (x0 + y0) * Iso.HH,
      maxY: (x1 + y1) * Iso.HH + Iso.TILE_H
    };
  }

  /** Vecino por cada borde del rombo: 0 NE, 1 SE, 2 SO, 3 NO. */
  var EDGE_NEIGHBOUR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function bakeChunk(cx, cy) {
    var box = chunkBox(cx, cy);
    var c = document.createElement('canvas');
    c.width = Math.ceil(box.maxX - box.minX);
    c.height = Math.ceil(box.maxY - box.minY);
    var x = c.getContext('2d');

    for (var gy = box.y0; gy <= box.y1; gy++) {
      for (var gx = box.x0; gx <= box.x1; gx++) {
        var type = typeAt(gx, gy);
        var px = (gx - gy) * Iso.HW - Iso.HW - box.minX;
        var py = (gx + gy) * Iso.HH - box.minY;
        var set = Art.tiles[type];
        x.drawImage(set[variant[idx(gx, gy)] % set.length], px, py);

        // Fleco del vecino de mayor prioridad, para fundir la frontera.
        var prio = Art.TERRAIN[type].prio;
        for (var e = 0; e < 4; e++) {
          var nx = gx + EDGE_NEIGHBOUR[e][0], ny = gy + EDGE_NEIGHBOUR[e][1];
          if (!inside(nx, ny)) continue;
          var nType = typeAt(nx, ny);
          if (nType === type) continue;
          if (Art.TERRAIN[nType].prio <= prio) continue;
          x.drawImage(Art.fringes[nType][e], px, py);
        }

        // Orilla: bajío y espuma en el lado del agua que da a tierra.
        if (type === 'agua') {
          for (var se = 0; se < 4; se++) {
            var sx2 = gx + EDGE_NEIGHBOUR[se][0], sy2 = gy + EDGE_NEIGHBOUR[se][1];
            if (!inside(sx2, sy2) || typeAt(sx2, sy2) === 'agua') continue;
            x.drawImage(Art.shores[se], px, py);
          }
        }
      }
    }

    // Mata suelta: se dibuja después de todos los tiles y con desplazamiento
    // libre, así que cruza los bordes de los rombos y deshace la cuadrícula.
    // Se omite el anillo exterior del sector para que nada quede cortado.
    for (var ty = box.y0 + 1; ty < box.y1; ty++) {
      for (var tx = box.x0 + 1; tx < box.x1; tx++) {
        var t = typeAt(tx, ty);
        var def = Art.TERRAIN[t];
        if (!def.fleck.length) continue;
        var cxp = (tx - ty) * Iso.HW - box.minX;
        var cyp = (tx + ty) * Iso.HH + Iso.HH - box.minY;
        for (var k = 0; k < 3; k++) {
          var h1 = hash(tx, ty, 900 + k), h2 = hash(tx, ty, 950 + k), h3 = hash(tx, ty, 980 + k);
          x.globalAlpha = 0.3 + h3 * 0.4;
          x.fillStyle = def.fleck[(h3 * def.fleck.length) | 0];
          x.beginPath();
          x.ellipse(cxp + (h1 - 0.5) * 42, cyp + (h2 - 0.5) * 22,
                    1.6 + h3 * 4.2, 1.1 + h1 * 2.2, h2 * Math.PI, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
    x.globalAlpha = 1;

    // Variación de luz a gran escala, anclada en coordenadas de mundo para que
    // no se note la costura entre sectores contiguos.
    if (Art.cloud) {
      var pattern = x.createPattern(Art.cloud, 'repeat');
      if (pattern) {
        x.save();
        x.globalCompositeOperation = 'source-atop';
        x.translate(-box.minX, -box.minY);
        x.fillStyle = pattern;
        x.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
        x.restore();
      }
    }

    return { canvas: c, box: box };
  }

  function chunkAt(cx, cy) {
    var key = cy * CHUNKS_X + cx;
    if (!chunkCache[key]) chunkCache[key] = bakeChunk(cx, cy);
    return chunkCache[key];
  }

  function drawTerrain(ctx, camera) {
    var v = camera.visibleWorldBounds(Iso.TILE_W);
    for (var cy = 0; cy < CHUNKS_Y; cy++) {
      for (var cx = 0; cx < CHUNKS_X; cx++) {
        var box = chunkBox(cx, cy);
        if (box.maxX < v.minX || box.minX > v.maxX ||
            box.maxY < v.minY || box.minY > v.maxY) continue;
        var ch = chunkAt(cx, cy);
        ctx.drawImage(ch.canvas, ch.box.minX, ch.box.minY);
      }
    }
  }

  /** Brillos animados sobre el agua; se dibujan sueltos para que se muevan. */
  function drawWaterSparkle(ctx, camera, time) {
    var v = camera.visibleWorldBounds(Iso.TILE_W);
    var g0 = Iso.toGrid(v.minX, v.minY), g1 = Iso.toGrid(v.maxX, v.maxY);
    // El rectángulo visible en píxeles se convierte en un rombo en la rejilla,
    // así que hay que abarcar las cuatro esquinas, no sólo dos.
    var cs = [g0, Iso.toGrid(v.maxX, v.minY), g1, Iso.toGrid(v.minX, v.maxY)];
    var xs = cs.map(function (g) { return g.gx; }), ys = cs.map(function (g) { return g.gy; });
    var gxMin = Math.max(0, Math.floor(Math.min.apply(null, xs)) - 2);
    var gxMax = Math.min(W - 1, Math.ceil(Math.max.apply(null, xs)) + 2);
    var gyMin = Math.max(0, Math.floor(Math.min.apply(null, ys)) - 2);
    var gyMax = Math.min(H - 1, Math.ceil(Math.max.apply(null, ys)) + 2);

    ctx.fillStyle = '#cfeaf4';
    for (var gy = gyMin; gy <= gyMax; gy++) {
      for (var gx = gxMin; gx <= gxMax; gx++) {
        if (typeAt(gx, gy) !== 'agua') continue;
        var seed = hash(gx, gy, 401);
        var a = 0.10 + 0.16 * Math.max(0, Math.sin(time * 1.5 + seed * 12.5));
        var p = Iso.toScreen(gx + 0.5, gy + 0.5);
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.ellipse(p.x + (seed - 0.5) * 24, p.y + (hash(gx, gy, 409) - 0.5) * 12,
                    4.5, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Entidades estáticas visibles, volcadas en `out` sin ordenar. */
  function collectStatics(camera, out) {
    var v = camera.visibleWorldBounds(160);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      var p = Iso.toScreen(e.gx, e.gy);
      if (p.x < v.minX - 120 || p.x > v.maxX + 120 ||
          p.y < v.minY - 220 || p.y > v.maxY + 120) continue;
      e.sx = p.x; e.sy = p.y;
      out.push(e);
    }
    return out;
  }

  function drawEntity(ctx, e) {
    var s = e.sprite;
    ctx.drawImage(s.img, e.sx - s.ax, e.sy - s.ay);
  }

  /* ---------------------------------------------------------------------------
   * 4. NAVEGACIÓN
   * ------------------------------------------------------------------------ */

  var N = W * H;
  var gScore = new Float32Array(N);
  var fScore = new Float32Array(N);
  var cameFrom = new Int32Array(N);
  var seen = new Int32Array(N);
  var closed = new Int32Array(N);
  var heap = new Int32Array(N);
  var heapSize = 0;
  var stamp = 0;
  var SQRT2 = Math.SQRT2;

  function heapPush(node) {
    var i = heapSize++;
    heap[i] = node;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (fScore[heap[p]] <= fScore[heap[i]]) break;
      var t = heap[p]; heap[p] = heap[i]; heap[i] = t;
      i = p;
    }
  }

  function heapPop() {
    var top = heap[0];
    if (--heapSize > 0) {
      heap[0] = heap[heapSize];
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, best = i;
        if (l < heapSize && fScore[heap[l]] < fScore[heap[best]]) best = l;
        if (r < heapSize && fScore[heap[r]] < fScore[heap[best]]) best = r;
        if (best === i) break;
        var t = heap[best]; heap[best] = heap[i]; heap[i] = t;
        i = best;
      }
    }
    return top;
  }

  function octile(ax, ay, bx, by) {
    var dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return dx > dy ? (dx - dy) + SQRT2 * dy : (dy - dx) + SQRT2 * dx;
  }

  var NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  /** Tile libre más cercano, por anillos concéntricos. */
  function nearestFree(gx, gy, maxRadius) {
    gx = Math.max(0, Math.min(W - 1, Math.round(gx)));
    gy = Math.max(0, Math.min(H - 1, Math.round(gy)));
    if (!isBlocked(gx, gy)) return { gx: gx, gy: gy };
    var limit = maxRadius || 14;
    for (var r = 1; r <= limit; r++) {
      var best = null, bestD = Infinity;
      for (var dx = -r; dx <= r; dx++) {
        for (var dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var nx = gx + dx, ny = gy + dy;
          if (isBlocked(nx, ny)) continue;
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { gx: nx, gy: ny }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  function lineOfWalk(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var steps = Math.ceil(Math.hypot(dx, dy) * 3);
    if (steps === 0) return !isBlocked(Math.floor(ax), Math.floor(ay));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      if (isBlocked(Math.floor(ax + dx * t), Math.floor(ay + dy * t))) return false;
    }
    return true;
  }

  function smooth(points) {
    if (points.length <= 2) return points.slice();
    var out = [points[0]];
    var anchor = 0;
    for (var i = 2; i < points.length; i++) {
      if (!lineOfWalk(points[anchor].gx, points[anchor].gy, points[i].gx, points[i].gy)) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /**
   * Ruta terrestre entre dos posiciones continuas de la rejilla.
   * @returns {{points: Array<{gx,gy}>, relocated: boolean}|null}
   */
  function findPath(fromX, fromY, toX, toY) {
    var start = nearestFree(fromX, fromY, 6);
    if (!start) return null;
    var goalRaw = { gx: Math.round(toX), gy: Math.round(toY) };
    var goal = nearestFree(goalRaw.gx, goalRaw.gy, 14);
    if (!goal) return null;
    var relocated = goal.gx !== goalRaw.gx || goal.gy !== goalRaw.gy;

    var startIdx = idx(start.gx, start.gy);
    var goalIdx = idx(goal.gx, goal.gy);

    if (startIdx !== goalIdx) {
      stamp++;
      heapSize = 0;
      gScore[startIdx] = 0;
      fScore[startIdx] = octile(start.gx, start.gy, goal.gx, goal.gy);
      cameFrom[startIdx] = -1;
      seen[startIdx] = stamp;
      heapPush(startIdx);

      var found = false;
      while (heapSize > 0) {
        var cur = heapPop();
        if (closed[cur] === stamp) continue;
        closed[cur] = stamp;
        if (cur === goalIdx) { found = true; break; }

        var cx = cur % W, cy = (cur - cx) / W;
        for (var n = 0; n < 8; n++) {
          var dx = NEIGHBOURS[n][0], dy = NEIGHBOURS[n][1];
          var nx = cx + dx, ny = cy + dy;
          if (isBlocked(nx, ny)) continue;
          if (dx && dy && (isBlocked(cx + dx, cy) || isBlocked(cx, cy + dy))) continue;
          var nIdx = idx(nx, ny);
          if (closed[nIdx] === stamp) continue;
          var tentative = gScore[cur] + (dx && dy ? SQRT2 : 1);
          if (seen[nIdx] !== stamp || tentative < gScore[nIdx]) {
            seen[nIdx] = stamp;
            gScore[nIdx] = tentative;
            fScore[nIdx] = tentative + octile(nx, ny, goal.gx, goal.gy);
            cameFrom[nIdx] = cur;
            heapPush(nIdx);
          }
        }
      }
      if (!found) return null;
    }

    var cells = [];
    var node = goalIdx;
    while (node !== -1) {
      var px = node % W;
      cells.push({ gx: px + 0.5, gy: (node - px) / W + 0.5 });
      if (node === startIdx) break;
      node = cameFrom[node];
    }
    cells.reverse();

    var points = [{ gx: fromX, gy: fromY }].concat(cells);
    var path = smooth(points);
    path.shift();
    return { points: path, relocated: relocated };
  }

  /* ---------------------------------------------------------------------------
   * 5. MINIMAPA
   * ------------------------------------------------------------------------ */

  var MINI_SCALE = 2.2;
  var minimap = null;

  function buildMinimap() {
    var w = Math.ceil((W + H) * MINI_SCALE), h = Math.ceil((W + H) * MINI_SCALE / 2);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    var ox = H * MINI_SCALE;

    for (var gy = 0; gy < H; gy++) {
      for (var gx = 0; gx < W; gx++) {
        x.fillStyle = Art.TERRAIN[typeAt(gx, gy)].base;
        var px = (gx - gy) * MINI_SCALE + ox;
        var py = (gx + gy) * MINI_SCALE / 2;
        x.fillRect(px - MINI_SCALE, py, MINI_SCALE * 2, MINI_SCALE + 0.5);
      }
    }
    // Arbolado y construcciones sobre la base del terreno.
    entities.forEach(function (e) {
      x.fillStyle = e.kind === 'building'
        ? Art.FACTION_COLORS[e.faction].team
        : 'rgba(40, 62, 30, 0.75)';
      var px = (e.gx - e.gy) * MINI_SCALE + ox;
      var py = (e.gx + e.gy) * MINI_SCALE / 2;
      var r = e.kind === 'building' ? 3 : 1.6;
      x.fillRect(px - r, py - r / 2, r * 2, r);
    });
    minimap = { canvas: c, scale: MINI_SCALE, ox: ox };
    return minimap;
  }

  /** Píxel del minimapa → rejilla. */
  function minimapToGrid(px, py) {
    var rx = (px - minimap.ox) / MINI_SCALE;
    var ry = py / (MINI_SCALE / 2);
    return { gx: (ry + rx) / 2, gy: (ry - rx) / 2 };
  }

  /* ---------------------------------------------------------------------------
   * 6. API
   * ------------------------------------------------------------------------ */

  function build() {
    generateTerrain();
    plantVegetation();
    raiseBuildings();
    placeBaseProps();
    buildMinimap();

    var corners = [
      Iso.toScreen(0, 0), Iso.toScreen(W, 0),
      Iso.toScreen(W, H), Iso.toScreen(0, H)
    ];
    world.bounds = {
      minX: Math.min.apply(null, corners.map(function (p) { return p.x; })) - 120,
      maxX: Math.max.apply(null, corners.map(function (p) { return p.x; })) + 120,
      minY: Math.min.apply(null, corners.map(function (p) { return p.y; })) - 220,
      maxY: Math.max.apply(null, corners.map(function (p) { return p.y; })) + 160
    };
    return world;
  }

  var world = {
    W: W, H: H,
    bounds: null,
    entities: entities,
    build: build,
    typeAt: typeAt,
    isBlocked: isBlocked,
    inside: inside,
    nearestFree: nearestFree,
    findPath: findPath,
    drawTerrain: drawTerrain,
    drawWaterSparkle: drawWaterSparkle,
    collectStatics: collectStatics,
    drawEntity: drawEntity,
    minimap: function () { return minimap; },
    minimapToGrid: minimapToGrid,
    buildings: BUILDINGS,
    stats: function () {
      var free = 0;
      for (var i = 0; i < N; i++) if (!blocked[i]) free++;
      return { tiles: N, transitables: free, entidades: entities.length };
    }
  };

  OP.World = world;

})(OP);
