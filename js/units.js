/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/units.js — Unidades: estado, selección, órdenes y dibujado animado.
 *
 * La posición vive en coordenadas continuas de rejilla (gx, gy) medidas en
 * tiles. La fase del ciclo de marcha avanza con la distancia recorrida, no con
 * el reloj, así que los pies no patinan aunque cambie la velocidad.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;

  var TYPES = {
    fusilero: {
      key: 'fusilero',
      name: 'Fusilero',
      speed: 2.3,          // tiles por segundo
      radius: 0.30,
      stride: 1.05,        // tiles por ciclo completo de marcha
      turnRate: 9
    },
    explorador: {
      key: 'explorador',
      name: 'Explorador',
      speed: 3.4,
      radius: 0.27,
      stride: 1.25,
      turnRate: 12
    },
    zapador: {
      key: 'zapador',
      name: 'Zapador',
      speed: 2.0,
      radius: 0.32,
      stride: 0.95,
      turnRate: 8
    }
  };

  var FACTIONS = {
    met: { id: 'met', name: 'Mando de Emergencia Territorial', color: '#3f7fd4', light: '#a8d2ff' },
    pon: { id: 'pon', name: 'Consorcio Poniente', color: '#c4452f', light: '#ffb0a0' }
  };

  var ARRIVAL = 0.06;   // holgura de llegada al waypoint, en tiles
  var serial = 0;

  /* ---------------------------------------------------------------------------
   * UNIDAD
   * ------------------------------------------------------------------------ */

  function Unit(options) {
    var type = TYPES[options.type] || TYPES.fusilero;
    serial++;

    this.kind = 'unit';
    this.id = 'U' + String(serial).padStart(2, '0');
    this.callsign = options.callsign || this.id;
    this.type = type;
    this.faction = FACTIONS[options.faction || 'met'];
    this.playable = options.playable !== false;

    this.gx = options.gx;
    this.gy = options.gy;
    this.radius = type.radius;
    this.dir = options.dir != null ? options.dir : 3;
    this.yaw = this.dir * Math.PI / 4;
    this.phase = 0;

    this.selected = false;
    this.path = [];
    this.status = 'en espera';

    this.sx = 0; this.sy = 0; this.depth = 0;
  }

  Unit.prototype.isMoving = function () { return this.path.length > 0; };

  Unit.prototype.stop = function () {
    this.path.length = 0;
    this.status = 'en espera';
  };

  Unit.prototype.setPath = function (points) {
    this.path = points.slice();
    this.status = this.path.length ? 'en marcha' : 'en posición';
  };

  Unit.prototype.update = function (dt) {
    if (!this.path.length) {
      // Vuelve suavemente a la fase de firmes.
      this.phase *= 0.85;
      return;
    }

    var budget = this.type.speed * dt;
    var travelled = 0;

    while (budget > 0 && this.path.length) {
      var target = this.path[0];
      var dx = target.gx - this.gx;
      var dy = target.gy - this.gy;
      var dist = Math.hypot(dx, dy);

      if (dist <= ARRIVAL) { this.path.shift(); continue; }

      var step = Math.min(budget, dist);
      this.gx += (dx / dist) * step;
      this.gy += (dy / dist) * step;
      budget -= step;
      travelled += step;

      // Orientación: giro progresivo hacia el rumbo deseado.
      var desired = Math.atan2(dx, dy);
      var delta = normalizeAngle(desired - this.yaw);
      var maxTurn = this.type.turnRate * dt;
      this.yaw = normalizeAngle(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, delta)));

      if (step >= dist - ARRIVAL) this.path.shift();
    }

    this.dir = ((Math.round(this.yaw / (Math.PI / 4)) % 8) + 8) % 8;
    this.phase = (this.phase + travelled / this.type.stride) % 1;

    if (!this.path.length) this.status = 'en posición';
  };

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* ---------------------------------------------------------------------------
   * GESTOR
   * ------------------------------------------------------------------------ */

  function UnitManager() {
    this.units = [];
  }

  UnitManager.prototype.add = function (options) {
    var u = new Unit(options);
    this.units.push(u);
    return u;
  };

  UnitManager.prototype.playable = function () {
    return this.units.filter(function (u) { return u.playable; });
  };

  UnitManager.prototype.selected = function () {
    return this.units.filter(function (u) { return u.selected; });
  };

  UnitManager.prototype.clearSelection = function () {
    this.units.forEach(function (u) { u.selected = false; });
  };

  /**
   * Impacto del cursor sobre el cuerpo de una unidad. La elipse aproxima el
   * bulto del sprite: ancho estrecho, alto hasta la cabeza.
   */
  function hits(unit, worldX, worldY) {
    var p = Iso.toScreen(unit.gx, unit.gy);
    var dx = worldX - p.x;
    var dy = worldY - p.y;
    return (dx / 15) * (dx / 15) + ((dy + 17) / 24) * ((dy + 17) / 24) <= 1;
  }

  UnitManager.prototype.selectAt = function (worldX, worldY, additive) {
    var best = null, bestDepth = -Infinity;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.playable) continue;
      // Ante solapamiento gana la unidad más cercana al espectador.
      if (hits(u, worldX, worldY) && (u.gx + u.gy) > bestDepth) {
        bestDepth = u.gx + u.gy;
        best = u;
      }
    }
    if (!additive) this.clearSelection();
    if (best) best.selected = additive ? !best.selected : true;
    return best;
  };

  UnitManager.prototype.selectInRect = function (x0, y0, x1, y1, additive) {
    var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    var minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    if (!additive) this.clearSelection();
    var n = 0;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.playable) continue;
      var p = Iso.toScreen(u.gx, u.gy);
      // El punto de referencia son los pies: predecible al encuadrar.
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
        u.selected = true;
        n++;
      }
    }
    return n;
  };

  UnitManager.prototype.selectAll = function () {
    var n = 0;
    this.units.forEach(function (u) { if (u.playable) { u.selected = true; n++; } });
    return n;
  };

  /** Huecos de formación en anillos, del centro hacia fuera. */
  function formationSlots(cx, cy, count, spacing) {
    var slots = [{ gx: cx, gy: cy }];
    var ring = 1;
    while (slots.length < count) {
      var perRing = ring * 6;
      for (var i = 0; i < perRing && slots.length < count; i++) {
        var a = (i / perRing) * Math.PI * 2 + ring * 0.4;
        slots.push({
          gx: cx + Math.cos(a) * spacing * ring,
          gy: cy + Math.sin(a) * spacing * ring
        });
      }
      if (++ring > 10) break;
    }
    return slots;
  }

  /**
   * Orden de movimiento para la selección actual.
   * @returns {{ordered:number, failed:number, relocated:boolean, reason:string|null}}
   */
  UnitManager.prototype.issueMoveOrder = function (world, gx, gy) {
    var selection = this.selected();
    var result = { ordered: 0, failed: 0, relocated: false, reason: null };

    if (!selection.length) { result.reason = 'sin-seleccion'; return result; }

    var anchor = world.nearestFree(gx, gy, 14);
    if (!anchor) {
      result.failed = selection.length;
      result.reason = 'destino-inalcanzable';
      return result;
    }
    if (Math.round(gx) !== anchor.gx || Math.round(gy) !== anchor.gy) {
      result.relocated = true;
      result.reason = world.inside(Math.round(gx), Math.round(gy)) &&
                      world.typeAt(Math.round(gx), Math.round(gy)) === 'agua'
        ? 'destino-en-agua' : 'destino-ocupado';
    }
    var center = { gx: anchor.gx + 0.5, gy: anchor.gy + 0.5 };

    var slots = formationSlots(center.gx, center.gy, selection.length, 0.95);
    var taken = new Array(slots.length);
    var assignment = new Array(selection.length);

    // Las unidades más cercanas al destino eligen hueco primero.
    var order = selection.map(function (u, i) {
      return { i: i, d: (u.gx - center.gx) * (u.gx - center.gx) + (u.gy - center.gy) * (u.gy - center.gy) };
    }).sort(function (a, b) { return a.d - b.d; });

    order.forEach(function (entry) {
      var u = selection[entry.i];
      var best = -1, bestD = Infinity;
      for (var k = 0; k < slots.length; k++) {
        if (taken[k]) continue;
        var dd = (slots[k].gx - u.gx) * (slots[k].gx - u.gx) + (slots[k].gy - u.gy) * (slots[k].gy - u.gy);
        if (dd < bestD) { bestD = dd; best = k; }
      }
      if (best >= 0) { taken[best] = true; assignment[entry.i] = slots[best]; }
      else assignment[entry.i] = center;
    });

    for (var i = 0; i < selection.length; i++) {
      var u = selection[i];
      var goal = assignment[i];
      var route = world.findPath(u.gx, u.gy, goal.gx, goal.gy);
      if (!route && goal !== center) route = world.findPath(u.gx, u.gy, center.gx, center.gy);

      if (route) {
        u.setPath(route.points);
        result.ordered++;
      } else {
        u.stop();
        u.status = 'sin ruta';
        result.failed++;
        if (!result.reason) result.reason = 'sin-ruta';
      }
    }
    return result;
  };

  UnitManager.prototype.stopSelected = function () {
    var sel = this.selected();
    sel.forEach(function (u) { u.stop(); });
    return sel.length;
  };

  UnitManager.prototype.update = function (world, dt) {
    var i;
    for (i = 0; i < this.units.length; i++) this.units[i].update(dt);
    this.separate(world);
  };

  /** Separación de cuerpos; nunca empuja a una unidad a un tile bloqueado. */
  UnitManager.prototype.separate = function (world) {
    var us = this.units;
    for (var i = 0; i < us.length; i++) {
      for (var j = i + 1; j < us.length; j++) {
        var a = us[i], b = us[j];
        var dx = b.gx - a.gx, dy = b.gy - a.gy;
        var min = a.radius + b.radius;
        var d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        var d = Math.sqrt(d2);
        if (d < 1e-5) { dx = 1; dy = 0; d = 1; }
        var push = (min - d) * 0.5;
        var nx = (dx / d) * push, ny = (dy / d) * push;

        var ax = a.gx - nx, ay = a.gy - ny;
        var bx = b.gx + nx, by = b.gy + ny;
        if (!world.isBlocked(Math.floor(ax), Math.floor(ay))) { a.gx = ax; a.gy = ay; }
        if (!world.isBlocked(Math.floor(bx), Math.floor(by))) { b.gx = bx; b.gy = by; }
      }
    }
  };

  /** Vuelca las unidades visibles en `out`, con su posición en píxeles de mundo. */
  UnitManager.prototype.collect = function (camera, out) {
    var v = camera.visibleWorldBounds(140);
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var p = Iso.toScreen(u.gx, u.gy);
      if (p.x < v.minX - 80 || p.x > v.maxX + 80 ||
          p.y < v.minY - 120 || p.y > v.maxY + 80) continue;
      u.sx = p.x; u.sy = p.y;
      u.depth = u.gx + u.gy;
      out.push(u);
    }
    return out;
  };

  /* ---------------------------------------------------------------------------
   * DIBUJADO
   * ------------------------------------------------------------------------ */

  function drawUnit(ctx, u, art) {
    var atlas = art.units[u.type.key][u.faction.id];

    // Marca de selección en el suelo.
    if (u.selected) {
      ctx.save();
      ctx.strokeStyle = '#9ef0c9';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(u.sx, u.sy + 1, 13, 6.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(158, 240, 201, 0.28)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }

    var col = u.isMoving()
      ? 1 + (Math.floor(u.phase * art.WALK_FRAMES) % art.WALK_FRAMES)
      : 0;

    ctx.drawImage(
      atlas.img,
      col * atlas.fw, u.dir * atlas.fh, atlas.fw, atlas.fh,
      u.sx - atlas.ax, u.sy - atlas.ay, atlas.fw, atlas.fh
    );
  }

  /** Trazas de ruta de las unidades seleccionadas, en píxeles de mundo. */
  function drawPaths(ctx, units) {
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.selected || !u.path.length) continue;
      var from = Iso.toScreen(u.gx, u.gy);
      ctx.strokeStyle = 'rgba(158, 240, 201, 0.5)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (var k = 0; k < u.path.length; k++) {
        var p = Iso.toScreen(u.path[k].gx, u.path[k].gy);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  OP.Units = {
    TYPES: TYPES,
    FACTIONS: FACTIONS,
    Unit: Unit,
    UnitManager: UnitManager,
    createManager: function () { return new UnitManager(); },
    drawUnit: drawUnit,
    drawPaths: drawPaths
  };

})(OP);
