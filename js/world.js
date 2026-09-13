/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/world.js — Escenario, terreno, entidades, recursos y navegación.
 *
 * Escenario: «Vega del Jarama», 128×128 tiles. El río parte el sector en dos y
 * sólo se cruza por el vado. Al este, la base del Mando de Emergencia
 * Territorial; al oeste, un puesto avanzado del Consorcio Poniente.
 *
 * El terreno se hornea por sectores de 16×16 tiles, con caché acotada y
 * desalojo del menos usado: un mapa de este tamaño no cabe entero en memoria.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;
  var Art = OP.Art;
  var Eco = OP.Economy;

  var W = 128, H = 128;
  var CHUNK = 16;
  var CHUNKS_X = Math.ceil(W / CHUNK);
  var CHUNKS_Y = Math.ceil(H / CHUNK);
  var CHUNK_LIMIT = 54;              // sectores horneados que se conservan

  var TYPES = ['agua', 'arena', 'tierra', 'secano', 'pasto', 'matorral'];
  var TYPE_INDEX = {};
  TYPES.forEach(function (t, i) { TYPE_INDEX[t] = i; });

  var tiles = new Uint8Array(W * H);
  var variant = new Uint8Array(W * H);
  var blocked = new Uint8Array(W * H);
  var entities = [];
  var chunkCache = new Map();
  var chunkClock = 0;
  var entityClock = 0;
  var propsDirty = true;

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
   * 2. GEOGRAFÍA DEL SECTOR
   * ------------------------------------------------------------------------ */

  function riverAxis(gy) {
    return 24 + gy * 0.40 + Math.sin(gy * 0.055) * 10 + Math.sin(gy * 0.17) * 3.4;
  }

  function riverWidth(gy) { return 3.4 + Math.sin(gy * 0.045 + 1.2) * 1.3; }

  /** Vado: el único paso a la margen occidental. */
  var FORD = [[64, 56], [58, 58], [52, 60], [46, 61]];

  var ROADS = [
    // De la base al vado y, cruzándolo, hasta el puesto del Consorcio.
    [[92, 36], [86, 44], [78, 50], [70, 54], [64, 56], [58, 58], [52, 60],
     [46, 61], [38, 70], [33, 84], [30, 94]],
    // Cinturón oriental: base → olivar → sureste.
    [[94, 40], [98, 56], [96, 72], [100, 88], [108, 104]],
    // Salida norte.
    [[92, 34], [100, 26], [112, 20]]
  ];

  var BASE_MET = { gx: 92, gy: 38 };
  var BASE_PON = { gx: 30, gy: 96 };

  var START_BUILDINGS = [
    { id: 'mando',    fac: 'met', gx: 91, gy: 36 },
    { id: 'barracon', fac: 'met', gx: 86, gy: 34 },
    { id: 'casa',     fac: 'met', gx: 87, gy: 41 },
    { id: 'casa',     fac: 'met', gx: 96, gy: 33 },
    { id: 'torre',    fac: 'met', gx: 90, gy: 32 },
    { id: 'torre',    fac: 'met', gx: 96, gy: 41 },

    { id: 'barracon', fac: 'pon', gx: 28, gy: 94 },
    { id: 'torre',    fac: 'pon', gx: 33, gy: 93 },
    { id: 'almacen',  fac: 'pon', gx: 27, gy: 98 },
    { id: 'casa',     fac: 'pon', gx: 32, gy: 98 }
  ];

  /** Manchas de chatarra: el metal del sector. */
  var SCRAP_FIELDS = [
    { gx: 101, gy: 45, r: 4.2 }, { gx: 78, gy: 28, r: 3.8 },
    { gx: 84, gy: 62, r: 4.2 },  { gx: 112, gy: 74, r: 4.0 },
    { gx: 44, gy: 74, r: 3.6 },  { gx: 60, gy: 96, r: 4.0 }
  ];

  /** Pinares de partida: madera a tiro de piedra de cada base. */
  var COPSES = [
    { gx: 84, gy: 45, r: 3.8 }, { gx: 100, gy: 30, r: 3.4 },
    { gx: 88, gy: 27, r: 3.0 }, { gx: 23, gy: 91, r: 3.2 }
  ];

  /** Bosquetes de frutales: los víveres iniciales. */
  var ORCHARDS = [
    { gx: 97, gy: 44, r: 4.0 }, { gx: 85, gy: 29, r: 3.4 },
    { gx: 102, gy: 34, r: 3.2 }, { gx: 74, gy: 46, r: 3.6 },
    { gx: 36, gy: 88, r: 3.4 }, { gx: 24, gy: 90, r: 3.0 }
  ];

  function distanceToPolyline(gx, gy, pts) {
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(gx - (ax + dx * t), gy - (ay + dy * t)));
    }
    return best;
  }

  function generateTerrain() {
    var gx, gy, i, r;

    for (gy = 0; gy < H; gy++) {
      var axis = riverAxis(gy), half = riverWidth(gy);
      for (gx = 0; gx < W; gx++) {
        i = idx(gx, gy);
        var dRiver = Math.abs(gx - axis);
        var wobble = (fbm(gx * 0.18, gy * 0.18, 91) - 0.5) * 2.0;
        var type;

        if (dRiver + wobble < half) {
          type = 'agua';
        } else if (dRiver + wobble < half + 1.9) {
          type = 'arena';
        } else {
          var wet = fbm(gx * 0.042, gy * 0.042, 17);
          var proximity = Math.max(0, 1 - (dRiver - half) / 20);
          var moisture = wet * 0.72 + proximity * 0.42;
          if (moisture > 0.62) type = 'pasto';
          else if (moisture > 0.42) type = 'secano';
          else type = fbm(gx * 0.10, gy * 0.10, 53) > 0.55 ? 'matorral' : 'secano';
        }

        for (r = 0; r < ROADS.length; r++) {
          if (distanceToPolyline(gx, gy, ROADS[r]) < 1.3 && type !== 'agua') {
            type = 'tierra';
            break;
          }
        }

        tiles[i] = TYPE_INDEX[type];
        variant[i] = (hash(gx, gy, 5) * 4) | 0;
        blocked[i] = type === 'agua' ? 1 : 0;
      }
    }

    // Explanadas de tierra batida bajo cada base.
    [{ x: BASE_MET.gx, y: BASE_MET.gy, r: 10 }, { x: BASE_PON.gx, y: BASE_PON.gy, r: 7 }]
      .forEach(function (base) {
        for (var by = 0; by < H; by++) {
          for (var bx = 0; bx < W; bx++) {
            var d = Math.hypot(bx - base.x, by - base.y);
            if (d < base.r - fbm(bx * 0.3, by * 0.3, 77) * 3 && typeAt(bx, by) !== 'agua') {
              tiles[idx(bx, by)] = TYPE_INDEX['tierra'];
            }
          }
        }
      });

    // El vado se abre al final: convierte el cauce en arenal transitable.
    for (gy = 0; gy < H; gy++) {
      for (gx = 0; gx < W; gx++) {
        if (distanceToPolyline(gx, gy, FORD) > 1.5) continue;
        i = idx(gx, gy);
        tiles[i] = TYPE_INDEX['arena'];
        blocked[i] = 0;
      }
    }
  }

  /* ---------------------------------------------------------------------------
   * 3. ENTIDADES
   * ------------------------------------------------------------------------ */

  function pushEntity(e) {
    e.uid = ++entityClock;
    entities.push(e);
    propsDirty = true;
    return e;
  }

  function occupy(gx, gy, w, h, value) {
    for (var dy = 0; dy < h; dy++) {
      for (var dx = 0; dx < w; dx++) {
        if (inside(gx + dx, gy + dy)) blocked[idx(gx + dx, gy + dy)] = value;
      }
    }
  }

  /** Retira una entidad del mundo y libera sus casillas. */
  function removeEntity(e) {
    var i = entities.indexOf(e);
    if (i < 0) return false;
    entities.splice(i, 1);
    occupy(e.tileX, e.tileY, e.tilesW || 1, e.tilesH || 1, 0);
    propsDirty = true;
    return true;
  }

  /** Sustituye un árbol agotado por su tocón: da constancia de que se taló. */
  function leaveStump(e) {
    var set = Art.props.tocon;
    pushEntity({
      kind: 'prop', prop: 'tocon', decor: true,
      tileX: e.tileX, tileY: e.tileY, tilesW: 1, tilesH: 1,
      gx: e.gx, gy: e.gy, depth: e.depth,
      sprite: set[(hash(e.tileX, e.tileY, 771) * set.length) | 0]
    });
  }

  var RESOURCE_OF_PROP = {
    pino: { type: 'madera', amount: 110 },
    olivo: { type: 'madera', amount: 95 },
    frutal: { type: 'viveres', amount: 180 },
    chatarra: { type: 'metal', amount: 300 }
  };

  function addProp(kind, gx, gy, spriteVariant) {
    if (!inside(gx, gy) || blocked[idx(gx, gy)]) return null;
    var set = Art.props[kind];
    if (!set) return null;
    var res = RESOURCE_OF_PROP[kind];
    var e = pushEntity({
      kind: 'prop', prop: kind,
      tileX: gx, tileY: gy, tilesW: 1, tilesH: 1,
      gx: gx + 0.5, gy: gy + 0.5,
      depth: gx + gy + 1,
      sprite: set[spriteVariant % set.length],
      resource: res ? { type: res.type, amount: res.amount, max: res.amount } : null
    });
    blocked[idx(gx, gy)] = 1;
    return e;
  }

  function plantVegetation() {
    var gx, gy, n;

    for (gy = 0; gy < H; gy++) {
      for (gx = 0; gx < W; gx++) {
        var t = typeAt(gx, gy);
        if (t === 'agua' || t === 'tierra') continue;
        if (Math.hypot(gx - BASE_MET.gx, gy - BASE_MET.gy) < 12) continue;
        if (Math.hypot(gx - BASE_PON.gx, gy - BASE_PON.gy) < 9) continue;

        var forest = fbm(gx * 0.068, gy * 0.068, 131);
        n = hash(gx, gy, 211);
        if (forest > 0.60 && n > 0.50) addProp('pino', gx, gy, (n * 97) | 0);
        else if (t === 'matorral' && n > 0.88) addProp('matorral', gx, gy, (n * 53) | 0);
        else if (n > 0.982) addProp('roca', gx, gy, (n * 31) | 0);
      }
    }

    // Olivares: hileras regulares, la marca del paisaje agrícola castellano.
    [[86, 76], [104, 94]].forEach(function (origin) {
      for (var row = 0; row < 10; row++) {
        for (var col = 0; col < 12; col++) {
          var ox = origin[0] + col * 2, oy = origin[1] + row * 2;
          if (!inside(ox, oy)) continue;
          var ot = typeAt(ox, oy);
          if (ot === 'agua' || ot === 'tierra') continue;
          addProp('olivo', ox, oy, (hash(ox, oy, 13) * 61) | 0);
        }
      }
    });

    /** Siembra un corro de props respetando el terreno. */
    function scatter(spot, kind, density, seed) {
      var rad = Math.ceil(spot.r);
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          if (Math.hypot(dx, dy) > spot.r) continue;
          var px = spot.gx + dx, py = spot.gy + dy;
          if (!inside(px, py)) continue;
          var pt = typeAt(px, py);
          if (pt === 'agua' || pt === 'tierra') continue;
          if (hash(px, py, seed) < density) continue;
          addProp(kind, px, py, (hash(px, py, seed + 2) * 41) | 0);
        }
      }
    }

    COPSES.forEach(function (c) { scatter(c, 'pino', 0.34, 821); });
    ORCHARDS.forEach(function (o) { scatter(o, 'frutal', 0.42, 617); });
    SCRAP_FIELDS.forEach(function (f) { scatter(f, 'chatarra', 0.55, 733); });

    for (gy = 0; gy < H; gy++) {
      for (gx = 0; gx < W; gx++) {
        if (typeAt(gx, gy) !== 'arena') continue;
        if (hash(gx, gy, 307) > 0.93) addProp('matorral', gx, gy, (hash(gx, gy, 311) * 43) | 0);
      }
    }
  }

  var BASE_PROPS = [
    ['sacos', 89, 32], ['sacos', 95, 31], ['sacos', 95, 43], ['sacos', 86, 43],
    ['cajas', 94, 37], ['cajas', 94, 38], ['cajas', 85, 38], ['cajas', 89, 43],
    ['bidones', 95, 37], ['bidones', 84, 40], ['bidones', 97, 37],
    ['sacos', 27, 92], ['cajas', 31, 100], ['bidones', 26, 101], ['cajas', 34, 96]
  ];

  function placeBaseProps() {
    BASE_PROPS.forEach(function (p) {
      addProp(p[0], p[1], p[2], (hash(p[1], p[2], 991) * 17) | 0);
    });
  }

  /** Sprite que corresponde a un edificio, incluida la huerta según cosecha. */
  function buildingSprite(id, faction, entity) {
    if (id === 'huerta') {
      var ratio = entity && entity.resource ? entity.resource.amount / entity.resource.max : 1;
      var step = ratio > 0.66 ? 3 : (ratio > 0.33 ? 2 : 1);
      return Art.farm[step];
    }
    return Art.buildings[id] && Art.buildings[id][faction];
  }

  function makeBuilding(defId, faction, gx, gy) {
    var def = Eco.BUILDINGS[defId];
    var e = {
      kind: 'building', id: defId, def: def, faction: faction,
      tileX: gx, tileY: gy, tilesW: def.w, tilesH: def.h,
      gx: gx + def.w / 2, gy: gy + def.h / 2,
      depth: def.flat ? gx + gy : gx + gy + def.w + def.h - 1,
      sprite: null, queue: [],
      resource: def.yields
        ? { type: def.yields.type, amount: def.yields.amount, max: def.yields.amount }
        : null
    };
    e.sprite = buildingSprite(defId, faction, e);
    return e;
  }

  function raiseStartBuildings() {
    START_BUILDINGS.forEach(function (b) {
      var def = Eco.BUILDINGS[b.id];
      if (!def) return;
      occupy(b.gx, b.gy, def.w, def.h, 1);
      pushEntity(makeBuilding(b.id, b.fac, b.gx, b.gy));
    });
  }

  /* ---------------------------------------------------------------------------
   * 4. CONSTRUCCIÓN
   * ------------------------------------------------------------------------ */

  /** ¿Cabe aquí una huella de w×h tiles? */
  function canPlace(def, gx, gy) {
    for (var dy = 0; dy < def.h; dy++) {
      for (var dx = 0; dx < def.w; dx++) {
        if (isBlocked(gx + dx, gy + dy)) return false;
        if (typeAt(gx + dx, gy + dy) === 'agua') return false;
      }
    }
    return true;
  }

  /** Abre una obra. Las casillas se ocupan desde el primer momento. */
  function addSite(defId, faction, gx, gy) {
    var def = Eco.BUILDINGS[defId];
    if (!def || !canPlace(def, gx, gy)) return null;
    occupy(gx, gy, def.w, def.h, 1);
    var e = makeBuilding(defId, faction, gx, gy);
    e.site = true;
    e.progress = 0;
    e.needed = def.buildTime;
    return pushEntity(e);
  }

  /** Cierra la obra y la convierte en edificio terminado. */
  function completeSite(site) {
    site.site = false;
    site.progress = site.needed;
    site.sprite = buildingSprite(site.id, site.faction, site);
    propsDirty = true;
    return site;
  }

  /** Punto de descarga terminado más cercano. */
  function findDropoff(gx, gy, faction) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e.kind !== 'building' || e.site || e.faction !== faction) continue;
      if (!e.def || !e.def.dropoff) continue;
      var d = (e.gx - gx) * (e.gx - gx) + (e.gy - gy) * (e.gy - gy);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Nodo de recurso más cercano del tipo indicado, con reservas. */
  function findNode(type, gx, gy, maxDist) {
    var best = null, bestD = Infinity;
    var limit = (maxDist || 40) * (maxDist || 40);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.resource || e.resource.type !== type || e.resource.amount <= 0) continue;
      if (e.site) continue;
      var d = (e.gx - gx) * (e.gx - gx) + (e.gy - gy) * (e.gy - gy);
      if (d < bestD && d <= limit) { bestD = d; best = e; }
    }
    return best;
  }

  /** Entidad bajo una casilla: para seleccionar edificios y nodos con el ratón. */
  function entityAt(gx, gy) {
    var tx = Math.floor(gx), ty = Math.floor(gy);
    for (var i = entities.length - 1; i >= 0; i--) {
      var e = entities[i];
      if (e.decor) continue;
      if (tx >= e.tileX && tx < e.tileX + (e.tilesW || 1) &&
          ty >= e.tileY && ty < e.tileY + (e.tilesH || 1)) return e;
    }
    return null;
  }

  /** Casilla libre más cercana al borde de un edificio, para soltar unidades. */
  function freeTileNear(gx, gy, maxRadius) {
    return nearestFree(gx, gy, maxRadius || 8);
  }

  /* ---------------------------------------------------------------------------
   * 5. DIBUJADO DEL TERRENO
   * ------------------------------------------------------------------------ */

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

  var EDGE_NEIGHBOUR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function bakeChunk(cx, cy) {
    var box = chunkBox(cx, cy);
    var c = document.createElement('canvas');
    c.width = Math.ceil(box.maxX - box.minX);
    c.height = Math.ceil(box.maxY - box.minY);
    var x = c.getContext('2d');
    var gx, gy;

    for (gy = box.y0; gy <= box.y1; gy++) {
      for (gx = box.x0; gx <= box.x1; gx++) {
        var type = typeAt(gx, gy);
        var px = (gx - gy) * Iso.HW - Iso.HW - box.minX;
        var py = (gx + gy) * Iso.HH - box.minY;
        var set = Art.tiles[type];
        x.drawImage(set[variant[idx(gx, gy)] % set.length], px, py);

        var prio = Art.TERRAIN[type].prio;
        for (var e = 0; e < 4; e++) {
          var nx = gx + EDGE_NEIGHBOUR[e][0], ny = gy + EDGE_NEIGHBOUR[e][1];
          if (!inside(nx, ny)) continue;
          var nType = typeAt(nx, ny);
          if (nType === type || Art.TERRAIN[nType].prio <= prio) continue;
          x.drawImage(Art.fringes[nType][e], px, py);
        }

        if (type === 'agua') {
          for (var se = 0; se < 4; se++) {
            var sx2 = gx + EDGE_NEIGHBOUR[se][0], sy2 = gy + EDGE_NEIGHBOUR[se][1];
            if (!inside(sx2, sy2) || typeAt(sx2, sy2) === 'agua') continue;
            x.drawImage(Art.shores[se], px, py);
          }
        }
      }
    }

    // Mata suelta: cruza los bordes de los rombos y deshace la cuadrícula.
    // Se omite el anillo exterior del sector para que nada quede cortado.
    for (gy = box.y0 + 1; gy < box.y1; gy++) {
      for (gx = box.x0 + 1; gx < box.x1; gx++) {
        var def = Art.TERRAIN[typeAt(gx, gy)];
        if (!def.fleck.length) continue;
        var cxp = (gx - gy) * Iso.HW - box.minX;
        var cyp = (gx + gy) * Iso.HH + Iso.HH - box.minY;
        for (var k = 0; k < 3; k++) {
          var h1 = hash(gx, gy, 900 + k), h2 = hash(gx, gy, 950 + k), h3 = hash(gx, gy, 980 + k);
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

    return { canvas: c, box: box, used: 0 };
  }

  /**
   * Sector horneado, con caché acotada: al superar el límite se desaloja el
   * menos usado recientemente. Rehornear cuesta pocos milisegundos.
   */
  function chunkAt(cx, cy) {
    var key = cy * CHUNKS_X + cx;
    var ch = chunkCache.get(key);
    if (!ch) {
      if (chunkCache.size >= CHUNK_LIMIT) {
        var oldestKey = null, oldest = Infinity;
        chunkCache.forEach(function (v, k) {
          if (v.used < oldest) { oldest = v.used; oldestKey = k; }
        });
        if (oldestKey !== null) chunkCache.delete(oldestKey);
      }
      ch = bakeChunk(cx, cy);
      chunkCache.set(key, ch);
    }
    ch.used = ++chunkClock;
    return ch;
  }

  function drawTerrain(ctx, camera) {
    var v = camera.visibleWorldBounds(Iso.TILE_W);
    for (var cy = 0; cy < CHUNKS_Y; cy++) {
      for (var cx = 0; cx < CHUNKS_X; cx++) {
        var box = chunkBox(cx, cy);
        if (box.maxX < v.minX || box.minX > v.maxX ||
            box.maxY < v.minY || box.minY > v.maxY) continue;
        var ch = chunkAt(cx, cy);
        var sx = Math.max(0, Math.floor(v.minX - box.minX));
        var sy = Math.max(0, Math.floor(v.minY - box.minY));
        var sw = Math.min(ch.canvas.width - sx, Math.ceil(v.maxX - box.minX) - sx);
        var sh = Math.min(ch.canvas.height - sy, Math.ceil(v.maxY - box.minY) - sy);
        if (sw <= 0 || sh <= 0) continue;
        ctx.drawImage(ch.canvas, sx, sy, sw, sh, box.minX + sx, box.minY + sy, sw, sh);
      }
    }
  }

  function visibleTileRange(camera, pad) {
    var v = camera.visibleWorldBounds(Iso.TILE_W);
    var cs = [
      Iso.toGrid(v.minX, v.minY), Iso.toGrid(v.maxX, v.minY),
      Iso.toGrid(v.maxX, v.maxY), Iso.toGrid(v.minX, v.maxY)
    ];
    var xs = cs.map(function (g) { return g.gx; }), ys = cs.map(function (g) { return g.gy; });
    var p = pad || 2;
    return {
      x0: Math.max(0, Math.floor(Math.min.apply(null, xs)) - p),
      x1: Math.min(W - 1, Math.ceil(Math.max.apply(null, xs)) + p),
      y0: Math.max(0, Math.floor(Math.min.apply(null, ys)) - p),
      y1: Math.min(H - 1, Math.ceil(Math.max.apply(null, ys)) + p)
    };
  }

  function drawWaterSparkle(ctx, camera, time) {
    if (camera.zoom < 0.8) return;
    var r = visibleTileRange(camera, 2);
    ctx.fillStyle = '#cfeaf4';
    for (var gy = r.y0; gy <= r.y1; gy++) {
      for (var gx = r.x0; gx <= r.x1; gx++) {
        if (typeAt(gx, gy) !== 'agua') continue;
        var seed = hash(gx, gy, 401);
        ctx.globalAlpha = 0.10 + 0.16 * Math.max(0, Math.sin(time * 1.5 + seed * 12.5));
        var p = Iso.toScreen(gx + 0.5, gy + 0.5);
        ctx.beginPath();
        ctx.ellipse(p.x + (seed - 0.5) * 24, p.y + (hash(gx, gy, 409) - 0.5) * 12,
                    4.5, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function collectStatics(camera, out) {
    var v = camera.visibleWorldBounds(200);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      var p = Iso.toScreen(e.gx, e.gy);
      if (p.x < v.minX - 160 || p.x > v.maxX + 160 ||
          p.y < v.minY - 260 || p.y > v.maxY + 160) continue;
      e.sx = p.x; e.sy = p.y;
      out.push(e);
    }
    return out;
  }

  function drawEntity(ctx, e) {
    if (e.site) {
      var scaffold = Art.scaffolds[e.def.w + 'x' + e.def.h];
      if (scaffold) ctx.drawImage(scaffold.img, e.sx - scaffold.ax, e.sy - scaffold.ay);

      var s = e.sprite;
      var ratio = e.needed ? Math.min(1, e.progress / e.needed) : 0;
      if (s && ratio > 0.02) {
        // El edificio se revela de abajo arriba conforme avanza la obra.
        var visible = Math.max(2, s.img.height * ratio);
        ctx.save();
        ctx.beginPath();
        ctx.rect(e.sx - s.ax, e.sy - s.ay + (s.img.height - visible), s.img.width, visible);
        ctx.clip();
        ctx.globalAlpha = 0.6 + 0.4 * ratio;
        ctx.drawImage(s.img, e.sx - s.ax, e.sy - s.ay);
        ctx.restore();
      }
      return;
    }

    // La huerta cambia de sprite según lo que quede por cosechar.
    if (e.id === 'huerta') e.sprite = buildingSprite('huerta', e.faction, e);

    var sp = e.sprite;
    if (sp) ctx.drawImage(sp.img, e.sx - sp.ax, e.sy - sp.ay);
  }

  /* ---------------------------------------------------------------------------
   * 6. NAVEGACIÓN
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

  function nearestFree(gx, gy, maxRadius) {
    gx = Math.max(0, Math.min(W - 1, Math.floor(gx)));
    gy = Math.max(0, Math.min(H - 1, Math.floor(gy)));
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

  function findPath(fromX, fromY, toX, toY) {
    var start = nearestFree(fromX, fromY, 6);
    if (!start) return null;
    var goalRaw = { gx: Math.floor(toX), gy: Math.floor(toY) };
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

    var path = smooth([{ gx: fromX, gy: fromY }].concat(cells));
    path.shift();
    return { points: path, relocated: relocated };
  }

  /**
   * Ruta hasta el borde de un objetivo ocupado (nodo, obra o edificio): se
   * busca la casilla libre más próxima al objetivo desde el lado del origen.
   */
  function pathToTarget(fromX, fromY, target) {
    var w = target.tilesW || 1, h = target.tilesH || 1;
    var best = null, bestD = Infinity;
    for (var dy = -1; dy <= h; dy++) {
      for (var dx = -1; dx <= w; dx++) {
        var inFootprint = dx >= 0 && dx < w && dy >= 0 && dy < h;
        if (inFootprint) continue;
        var tx = target.tileX + dx, ty = target.tileY + dy;
        if (isBlocked(tx, ty)) continue;
        var d = (tx + 0.5 - fromX) * (tx + 0.5 - fromX) + (ty + 0.5 - fromY) * (ty + 0.5 - fromY);
        if (d < bestD) { bestD = d; best = { gx: tx + 0.5, gy: ty + 0.5 }; }
      }
    }
    if (!best) return null;
    return findPath(fromX, fromY, best.gx, best.gy);
  }

  /* ---------------------------------------------------------------------------
   * 7. MINIMAPA
   * ------------------------------------------------------------------------ */

  var MINI_SCALE = 1.6;
  var minimap = null;

  function buildMinimap() {
    var w = Math.ceil((W + H) * MINI_SCALE), h = Math.ceil((W + H) * MINI_SCALE / 2);
    var terrainLayer = document.createElement('canvas');
    terrainLayer.width = w; terrainLayer.height = h;
    var x = terrainLayer.getContext('2d');
    var ox = H * MINI_SCALE;

    for (var gy = 0; gy < H; gy++) {
      for (var gx = 0; gx < W; gx++) {
        x.fillStyle = Art.TERRAIN[typeAt(gx, gy)].base;
        x.fillRect((gx - gy) * MINI_SCALE + ox - MINI_SCALE,
                   (gx + gy) * MINI_SCALE / 2, MINI_SCALE * 2, MINI_SCALE + 0.5);
      }
    }

    var propsLayer = document.createElement('canvas');
    propsLayer.width = w; propsLayer.height = h;

    minimap = { terrain: terrainLayer, props: propsLayer, width: w, height: h,
                scale: MINI_SCALE, ox: ox };
    redrawMinimapProps();
    return minimap;
  }

  var MINI_COLOR = {
    madera: 'rgba(46, 74, 34, 0.85)',
    viveres: 'rgba(150, 176, 84, 0.9)',
    metal: 'rgba(168, 172, 178, 0.9)'
  };

  /** Capa de entidades del minimapa; se rehace sólo cuando algo cambia. */
  function redrawMinimapProps() {
    if (!minimap) return;
    var x = minimap.props.getContext('2d');
    x.clearRect(0, 0, minimap.width, minimap.height);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      var px = (e.gx - e.gy) * MINI_SCALE + minimap.ox;
      var py = (e.gx + e.gy) * MINI_SCALE / 2;
      if (e.kind === 'building') {
        x.fillStyle = e.site ? 'rgba(230, 210, 130, 0.9)' : Art.FACTION_COLORS[e.faction].team;
        x.fillRect(px - 2.5, py - 1.5, 5, 3);
      } else if (e.resource) {
        x.fillStyle = MINI_COLOR[e.resource.type];
        x.fillRect(px - 1, py - 0.5, 2, 1.5);
      }
    }
    propsDirty = false;
  }

  function syncMinimap() {
    if (propsDirty) redrawMinimapProps();
  }

  function minimapToGrid(px, py) {
    var rx = (px - minimap.ox) / MINI_SCALE;
    var ry = py / (MINI_SCALE / 2);
    return { gx: (ry + rx) / 2, gy: (ry - rx) / 2 };
  }

  /* ---------------------------------------------------------------------------
   * 8. API
   * ------------------------------------------------------------------------ */

  function build() {
    generateTerrain();
    plantVegetation();
    raiseStartBuildings();
    placeBaseProps();
    buildMinimap();

    var corners = [
      Iso.toScreen(0, 0), Iso.toScreen(W, 0),
      Iso.toScreen(W, H), Iso.toScreen(0, H)
    ];
    world.bounds = {
      minX: Math.min.apply(null, corners.map(function (p) { return p.x; })) - 140,
      maxX: Math.max.apply(null, corners.map(function (p) { return p.x; })) + 140,
      minY: Math.min.apply(null, corners.map(function (p) { return p.y; })) - 240,
      maxY: Math.max.apply(null, corners.map(function (p) { return p.y; })) + 180
    };
    return world;
  }

  var world = {
    W: W, H: H,
    bounds: null,
    entities: entities,
    baseMet: BASE_MET,
    build: build,
    typeAt: typeAt,
    isBlocked: isBlocked,
    inside: inside,
    nearestFree: nearestFree,
    freeTileNear: freeTileNear,
    findPath: findPath,
    pathToTarget: pathToTarget,
    drawTerrain: drawTerrain,
    drawWaterSparkle: drawWaterSparkle,
    collectStatics: collectStatics,
    drawEntity: drawEntity,
    minimap: function () { return minimap; },
    syncMinimap: syncMinimap,
    minimapToGrid: minimapToGrid,
    markDirty: function () { propsDirty = true; },
    canPlace: canPlace,
    addSite: addSite,
    completeSite: completeSite,
    removeEntity: removeEntity,
    leaveStump: leaveStump,
    findDropoff: findDropoff,
    findNode: findNode,
    entityAt: entityAt,
    stats: function () {
      var free = 0, nodes = 0;
      for (var i = 0; i < N; i++) if (!blocked[i]) free++;
      for (var j = 0; j < entities.length; j++) if (entities[j].resource) nodes++;
      return { tiles: N, transitables: free, entidades: entities.length, nodos: nodes };
    }
  };

  OP.World = world;

})(OP);
