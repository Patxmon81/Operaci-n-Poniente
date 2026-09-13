/* =============================================================================
 * OPERACIÓN PONIENTE — Fase 1 del motor
 * js/units.js
 *
 * Unidades controlables: estado, selección, órdenes de movimiento, seguimiento
 * de ruta sobre la malla de navegación y dibujado con simbología tipo OTAN.
 *
 * Las unidades se dibujan como símbolos de tamaño constante en pantalla (lectura
 * de mapa operativo), pero su posición, radio de cuerpo y velocidad viven en
 * unidades de mundo.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Map_ = null; // se resuelve en el primer uso (OP.Map)
  function gameMap() { return Map_ || (Map_ = OP.Map); }

  /* ---------------------------------------------------------------------------
   * 1. TIPOS DE UNIDAD
   * ------------------------------------------------------------------------ */

  var UNIT_TYPES = {
    infanteria: {
      key: 'infanteria',
      name: 'Infantería ligera',
      symbol: 'infantry',
      speed: 44,      // unidades de mundo por segundo
      turnRate: 5.0,  // radianes por segundo
      radius: 11
    },
    mecanizada: {
      key: 'mecanizada',
      name: 'Sección mecanizada',
      symbol: 'armor',
      speed: 58,
      turnRate: 3.2,
      radius: 12
    },
    reconocimiento: {
      key: 'reconocimiento',
      name: 'Patrulla de reconocimiento',
      symbol: 'recon',
      speed: 78,
      turnRate: 6.0,
      radius: 10
    }
  };

  var FACTIONS = {
    met: { id: 'met', name: 'Mando de Emergencia Territorial', color: '#5ec8ff', accent: '#b8e8ff' }
  };

  var SYMBOL_PX = 13;          // media anchura del símbolo, en píxeles CSS
  var ARRIVAL_EPSILON = 2.5;   // holgura de llegada al waypoint, en unidades
  var nextSerial = 1;

  /* ---------------------------------------------------------------------------
   * 2. UNIDAD
   * ------------------------------------------------------------------------ */

  function Unit(options) {
    var type = UNIT_TYPES[options.type] || UNIT_TYPES.infanteria;

    this.id = 'U' + String(nextSerial++).padStart(2, '0');
    this.callsign = options.callsign || this.id;
    this.type = type;
    this.faction = FACTIONS[options.faction || 'met'];

    this.x = options.x;
    this.y = options.y;
    this.radius = type.radius;
    this.speed = type.speed;
    this.heading = options.heading != null ? options.heading : -Math.PI / 2;

    this.selected = false;
    this.path = [];        // waypoints pendientes, en unidades de mundo
    this.destination = null;
    this.status = 'en espera';
  }

  Unit.prototype.isMoving = function () { return this.path.length > 0; };

  Unit.prototype.stop = function () {
    this.path.length = 0;
    this.destination = null;
    this.status = 'en espera';
  };

  /**
   * Asigna una ruta ya calculada.
   * @param {Array<{x,y}>} points waypoints, sin incluir la posición actual.
   */
  Unit.prototype.setPath = function (points) {
    this.path = points.slice();
    this.destination = this.path.length ? this.path[this.path.length - 1] : null;
    this.status = this.path.length ? 'en movimiento' : 'en espera';
  };

  Unit.prototype.update = function (dt) {
    if (!this.path.length) return;

    var budget = this.speed * dt;

    while (budget > 0 && this.path.length) {
      var target = this.path[0];
      var dx = target.x - this.x;
      var dy = target.y - this.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= ARRIVAL_EPSILON) {
        this.path.shift();
        continue;
      }

      // Orientación progresiva hacia el waypoint.
      var desired = Math.atan2(dy, dx);
      var delta = normalizeAngle(desired - this.heading);
      var maxTurn = this.type.turnRate * dt;
      this.heading += Math.max(-maxTurn, Math.min(maxTurn, delta));
      this.heading = normalizeAngle(this.heading);

      var step = Math.min(budget, dist);
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      budget -= step;

      if (step >= dist - ARRIVAL_EPSILON) this.path.shift();
    }

    if (!this.path.length) {
      this.destination = null;
      this.status = 'en posición';
    }
  };

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* ---------------------------------------------------------------------------
   * 3. GESTOR DE UNIDADES
   * ------------------------------------------------------------------------ */

  function UnitManager() {
    this.units = [];
  }

  UnitManager.prototype.add = function (options) {
    var unit = new Unit(options);
    this.units.push(unit);
    return unit;
  };

  UnitManager.prototype.selected = function () {
    return this.units.filter(function (u) { return u.selected; });
  };

  UnitManager.prototype.clearSelection = function () {
    for (var i = 0; i < this.units.length; i++) this.units[i].selected = false;
  };

  /** Radio de impacto de una unidad en unidades de mundo, según el zoom actual. */
  function pickRadius(camera) {
    var size = SYMBOL_PX * Math.max(0.62, Math.min(1, camera.zoom / 0.9));
    return (size + 4) / camera.zoom;
  }

  /**
   * Selección por clic. Devuelve la unidad seleccionada o null.
   * Con `additive` la selección previa se conserva.
   */
  UnitManager.prototype.selectAt = function (worldX, worldY, camera, additive) {
    var r = pickRadius(camera);
    var best = null, bestD = Infinity;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var dx = u.x - worldX, dy = u.y - worldY;
      var d = dx * dx + dy * dy;
      if (d <= r * r && d < bestD) { bestD = d; best = u; }
    }

    if (!additive) this.clearSelection();
    if (best) {
      best.selected = additive ? !best.selected : true;
    }
    return best;
  };

  /** Selección por rectángulo (en coordenadas de mundo). */
  UnitManager.prototype.selectInRect = function (x0, y0, x1, y1, additive) {
    var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    var minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    if (!additive) this.clearSelection();
    var count = 0;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
        u.selected = true;
        count++;
      }
    }
    return count;
  };

  UnitManager.prototype.selectAll = function () {
    for (var i = 0; i < this.units.length; i++) this.units[i].selected = true;
    return this.units.length;
  };

  /* --- Órdenes de movimiento ------------------------------------------------ */

  /**
   * Reparte posiciones alrededor de un destino para que un grupo no se apile.
   * Devuelve `count` puntos ordenados del centro hacia fuera.
   */
  function formationSlots(cx, cy, count, spacing) {
    if (count <= 1) return [{ x: cx, y: cy }];
    var slots = [{ x: cx, y: cy }];
    var ring = 1;
    while (slots.length < count) {
      var perRing = ring * 6;
      for (var i = 0; i < perRing && slots.length < count; i++) {
        var ang = (i / perRing) * Math.PI * 2;
        slots.push({
          x: cx + Math.cos(ang) * spacing * ring,
          y: cy + Math.sin(ang) * spacing * ring
        });
      }
      ring++;
      if (ring > 12) break;
    }
    return slots;
  }

  /**
   * Ordena a las unidades seleccionadas moverse al punto indicado.
   *
   * @returns {{ordered:number, failed:number, relocated:boolean, reason:string|null}}
   */
  UnitManager.prototype.issueMoveOrder = function (worldX, worldY) {
    var map = gameMap();
    var selection = this.selected();
    var result = { ordered: 0, failed: 0, relocated: false, reason: null };

    if (!selection.length) {
      result.reason = 'sin-seleccion';
      return result;
    }

    // Si el destino cae en el mar, busca el punto de costa transitable más cercano.
    var anchor = { x: worldX, y: worldY };
    if (!map.isWalkable(worldX, worldY)) {
      var relocated = map.nearestWalkablePoint(worldX, worldY, map.SEA_SNAP_CELLS);
      if (!relocated) {
        result.failed = selection.length;
        result.reason = 'destino-inalcanzable';
        return result;
      }
      anchor = relocated;
      result.relocated = true;
      result.reason = map.isSea(worldX, worldY) ? 'destino-en-mar' : 'destino-ajustado';
    }

    // Reparto de huecos: cada unidad al slot libre más cercano.
    var spacing = 0;
    for (var s = 0; s < selection.length; s++) {
      spacing = Math.max(spacing, selection[s].radius);
    }
    spacing *= 3.0;

    var slots = formationSlots(anchor.x, anchor.y, selection.length, spacing);
    var taken = new Array(slots.length);
    var assignments = new Array(selection.length);

    // Las unidades más cercanas al destino eligen primero.
    var order = selection.map(function (u, idx) {
      var dx = u.x - anchor.x, dy = u.y - anchor.y;
      return { idx: idx, d: dx * dx + dy * dy };
    }).sort(function (a, b) { return a.d - b.d; });

    for (var o = 0; o < order.length; o++) {
      var unit = selection[order[o].idx];
      var bestSlot = -1, bestD = Infinity;
      for (var k = 0; k < slots.length; k++) {
        if (taken[k]) continue;
        var ddx = slots[k].x - unit.x, ddy = slots[k].y - unit.y;
        var dd = ddx * ddx + ddy * ddy;
        if (dd < bestD) { bestD = dd; bestSlot = k; }
      }
      if (bestSlot >= 0) { taken[bestSlot] = true; assignments[order[o].idx] = slots[bestSlot]; }
      else assignments[order[o].idx] = anchor;
    }

    for (var i = 0; i < selection.length; i++) {
      var u = selection[i];
      var goal = assignments[i];
      var route = map.findPath(u.x, u.y, goal.x, goal.y);

      // Si el hueco asignado no es alcanzable, reintenta contra el punto base.
      if (!route && (goal.x !== anchor.x || goal.y !== anchor.y)) {
        route = map.findPath(u.x, u.y, anchor.x, anchor.y);
      }

      if (route && route.points.length) {
        u.setPath(route.points);
        result.ordered++;
      } else if (route) {
        u.stop();
        result.ordered++;
      } else {
        u.stop();
        u.status = 'sin ruta terrestre';
        result.failed++;
        if (!result.reason) result.reason = 'sin-ruta';
      }
    }

    return result;
  };

  UnitManager.prototype.stopSelected = function () {
    var sel = this.selected();
    for (var i = 0; i < sel.length; i++) sel[i].stop();
    return sel.length;
  };

  /* --- Simulación ----------------------------------------------------------- */

  UnitManager.prototype.update = function (dt) {
    var i;
    for (i = 0; i < this.units.length; i++) this.units[i].update(dt);
    this.resolveOverlaps();
  };

  /**
   * Separación mínima entre cuerpos. El empuje se descarta si llevaría a la
   * unidad al mar, así que la malla de navegación sigue siendo la autoridad.
   */
  UnitManager.prototype.resolveOverlaps = function () {
    var map = gameMap();
    var units = this.units;
    for (var i = 0; i < units.length; i++) {
      for (var j = i + 1; j < units.length; j++) {
        var a = units[i], b = units[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var minDist = a.radius + b.radius;
        var d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) continue;

        var d = Math.sqrt(d2);
        if (d < 0.0001) { dx = 1; dy = 0; d = 1; }
        var push = (minDist - d) * 0.5;
        var nx = (dx / d) * push, ny = (dy / d) * push;

        var ax = a.x - nx, ay = a.y - ny;
        var bx = b.x + nx, by = b.y + ny;
        if (map.isWalkable(ax, ay)) { a.x = ax; a.y = ay; }
        if (map.isWalkable(bx, by)) { b.x = bx; b.y = by; }
      }
    }
  };

  /* ---------------------------------------------------------------------------
   * 4. DIBUJADO
   * ------------------------------------------------------------------------ */

  /** Rutas pendientes de las unidades seleccionadas, en espacio mundo. */
  UnitManager.prototype.drawPaths = function (ctx, camera) {
    ctx.save();
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.selected || !u.path.length) continue;

      ctx.strokeStyle = 'rgba(94, 200, 255, 0.45)';
      ctx.lineWidth = 1.4 / camera.zoom;
      ctx.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      for (var k = 0; k < u.path.length; k++) ctx.lineTo(u.path[k].x, u.path[k].y);
      ctx.stroke();

      // Marca del destino final.
      var end = u.path[u.path.length - 1];
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(184, 232, 255, 0.8)';
      ctx.lineWidth = 1.2 / camera.zoom;
      var r = 5 / camera.zoom;
      ctx.beginPath();
      ctx.moveTo(end.x - r, end.y); ctx.lineTo(end.x + r, end.y);
      ctx.moveTo(end.x, end.y - r); ctx.lineTo(end.x, end.y + r);
      ctx.stroke();
    }
    ctx.restore();
  };

  function drawSymbolBody(ctx, kind, half) {
    var w = half * 1.35, h = half * 0.9;

    ctx.beginPath();
    ctx.rect(-w, -h, w * 2, h * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    if (kind === 'infantry') {
      ctx.moveTo(-w, -h); ctx.lineTo(w, h);
      ctx.moveTo(w, -h); ctx.lineTo(-w, h);
    } else if (kind === 'recon') {
      ctx.moveTo(-w, h); ctx.lineTo(w, -h);
    } else if (kind === 'armor') {
      ctx.ellipse(0, 0, w * 0.62, h * 0.62, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  /**
   * Símbolos, en espacio pantalla. Se encogen un poco al alejar la cámara y los
   * distintivos desaparecen en vista de teatro, para que no se amontonen.
   */
  UnitManager.prototype.drawSymbols = function (ctx, camera) {
    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);

    var size = SYMBOL_PX * Math.max(0.62, Math.min(1, camera.zoom / 0.9));
    var showCallsigns = camera.zoom >= 0.62;

    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var p = camera.worldToScreen(u.x, u.y);
      if (p.x < -60 || p.y < -60 || p.x > camera.viewWidth + 60 || p.y > camera.viewHeight + 60) {
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);

      // Vector de rumbo mientras se desplaza.
      if (u.isMoving()) {
        ctx.save();
        ctx.rotate(u.heading);
        ctx.strokeStyle = 'rgba(184, 232, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(size * 1.4, 0);
        ctx.lineTo(size * 2.2, 0);
        ctx.moveTo(size * 1.95, -3.2);
        ctx.lineTo(size * 2.2, 0);
        ctx.lineTo(size * 1.95, 3.2);
        ctx.stroke();
        ctx.restore();
      }

      // Anillo de selección.
      if (u.selected) {
        ctx.strokeStyle = '#9ef0c9';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = 'rgba(16, 44, 70, 0.92)';
      ctx.strokeStyle = u.faction.color;
      ctx.lineWidth = 1.7;
      drawSymbolBody(ctx, u.type.symbol, size);

      // Distintivo de la unidad.
      if (showCallsigns) {
        ctx.font = '9px "Segoe UI", Roboto, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(4, 10, 18, 0.85)';
        ctx.strokeText(u.callsign, 0, size + 4);
        ctx.fillStyle = u.selected ? '#9ef0c9' : u.faction.accent;
        ctx.fillText(u.callsign, 0, size + 4);
      }

      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------------------------------------------------------------------
   * 5. API PÚBLICA
   * ------------------------------------------------------------------------ */

  OP.Units = {
    TYPES: UNIT_TYPES,
    FACTIONS: FACTIONS,
    SYMBOL_PX: SYMBOL_PX,
    Unit: Unit,
    UnitManager: UnitManager,
    createManager: function () { return new UnitManager(); }
  };

})(OP);
