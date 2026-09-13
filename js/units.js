/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/units.js — Unidades: estado, selección, órdenes, oficios y dibujado.
 *
 * El zapador es el aldeano del juego: recolecta de un nodo hasta llenar la
 * carga, la acarrea al punto de descarga más cercano y vuelve; o levanta una
 * obra. Todo ello con una máquina de estados pequeña y explícita.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;
  var Eco = OP.Economy;

  var TYPES = {
    fusilero: {
      key: 'fusilero', name: 'Fusilero',
      speed: 2.3, radius: 0.30, stride: 1.05, turnRate: 9, worker: false
    },
    explorador: {
      key: 'explorador', name: 'Explorador',
      speed: 3.4, radius: 0.27, stride: 1.25, turnRate: 12, worker: false
    },
    zapador: {
      key: 'zapador', name: 'Zapador',
      speed: 2.1, radius: 0.32, stride: 0.95, turnRate: 8, worker: true
    }
  };

  var FACTIONS = {
    met: { id: 'met', name: 'Mando de Emergencia Territorial', color: '#4a8ade', light: '#a8d2ff' },
    pon: { id: 'pon', name: 'Consorcio Poniente', color: '#cf4f38', light: '#ffb0a0' }
  };

  var ARRIVAL = 0.06;
  var serial = 0;

  /** Verbo que describe el oficio, para el panel de selección. */
  var WORK_VERB = {
    madera: 'talando',
    viveres: 'cosechando',
    metal: 'desguazando'
  };

  /* ---------------------------------------------------------------------------
   * 1. UNIDAD
   * ------------------------------------------------------------------------ */

  function Unit(options) {
    var type = TYPES[options.type] || TYPES.fusilero;
    serial++;

    this.kind = 'unit';
    this.id = 'U' + String(serial).padStart(2, '0');
    this.callsign = options.callsign || defaultCallsign(type.key, serial);
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

    // Oficio (sólo zapadores).
    this.job = null;          // {kind:'gather'|'build', node|site}
    this.jobPhase = null;     // 'ir' | 'trabajar' | 'acarrear'
    this.carry = { type: null, amount: 0 };
    this.retryIn = 0;
    this.stuck = 0;

    this.sx = 0; this.sy = 0; this.depth = 0;
  }

  var NAME_POOL = {
    zapador: ['CASTILLO', 'YUNQUE', 'CANTERA', 'FORJA', 'ARADO', 'CIMIENTO', 'TORNO', 'ESCUADRA'],
    fusilero: ['LOBO', 'ACERO', 'LANZA', 'RIBERA', 'ALMENA', 'CENTINELA'],
    explorador: ['GALGO', 'CERNÍCALO', 'VEREDA', 'AZOR', 'RASTRO']
  };

  function defaultCallsign(typeKey, n) {
    var pool = NAME_POOL[typeKey] || ['UNIDAD'];
    return pool[n % pool.length] + '-' + n;
  }

  Unit.prototype.isMoving = function () { return this.path.length > 0; };
  Unit.prototype.isWorker = function () { return this.type.worker; };

  Unit.prototype.stop = function () {
    this.path.length = 0;
    this.status = 'en espera';
  };

  /** Corta el oficio actual; la carga se conserva. */
  Unit.prototype.clearJob = function () {
    this.job = null;
    this.jobPhase = null;
  };

  Unit.prototype.setPath = function (points) {
    this.path = points.slice();
    if (!this.job) this.status = this.path.length ? 'en marcha' : 'en posición';
  };

  /* --- Distancias a objetivos con huella ----------------------------------- */

  function distanceTo(unit, target) {
    var w = target.tilesW || 1, h = target.tilesH || 1;
    var cx = Math.max(target.tileX, Math.min(target.tileX + w, unit.gx));
    var cy = Math.max(target.tileY, Math.min(target.tileY + h, unit.gy));
    return Math.hypot(unit.gx - cx, unit.gy - cy);
  }

  Unit.prototype.routeTo = function (world, target) {
    var route = world.pathToTarget(this.gx, this.gy, target);
    if (!route) { this.path.length = 0; return false; }
    this.path = route.points.slice();
    return true;
  };

  /* --- Órdenes de oficio ---------------------------------------------------- */

  Unit.prototype.assignGather = function (world, node) {
    if (!this.isWorker() || !node || !node.resource) return false;
    // Si viene cargado de otro recurso, lo entrega antes de cambiar de tajo.
    if (this.carry.amount > 0 && this.carry.type !== node.resource.type) {
      Eco.deposit(this.carry.type, this.carry.amount);
      this.carry.amount = 0;
    }
    this.carry.type = node.resource.type;
    this.job = { kind: 'gather', node: node };
    this.jobPhase = 'ir';
    this.retryIn = 0;
    this.routeTo(world, node);
    this.status = 'en marcha';
    return true;
  };

  Unit.prototype.assignBuild = function (world, site) {
    if (!this.isWorker() || !site || !site.site) return false;
    this.job = { kind: 'build', site: site };
    this.jobPhase = 'ir';
    this.retryIn = 0;
    this.routeTo(world, site);
    this.status = 'en marcha';
    return true;
  };

  /* --- Máquina de estados del oficio ---------------------------------------- */

  Unit.prototype.think = function (world, dt) {
    if (!this.job) return;
    if (this.retryIn > 0) this.retryIn -= dt;

    if (this.job.kind === 'gather') this.thinkGather(world, dt);
    else if (this.job.kind === 'build') this.thinkBuild(world, dt);
  };

  Unit.prototype.thinkGather = function (world, dt) {
    var node = this.job.node;

    // El nodo puede haberse agotado mientras venía de camino.
    if (!node || !node.resource || node.resource.amount <= 0) {
      var next = world.findNode(this.carry.type, this.gx, this.gy, 34);
      if (!next) {
        this.deliverAndIdle(world);
        return;
      }
      this.job.node = next;
      this.jobPhase = 'ir';
      this.routeTo(world, next);
      return;
    }

    if (this.jobPhase === 'acarrear') {
      var drop = this.job.dropoff;
      if (!drop || drop.site || world.entities.indexOf(drop) < 0) {
        drop = world.findDropoff(this.gx, this.gy, this.faction.id);
        this.job.dropoff = drop;
        if (!drop) { this.status = 'sin punto de descarga'; return; }
        this.routeTo(world, drop);
      }
      this.status = 'acarreando';
      if (distanceTo(this, drop) <= Eco.REACH) {
        Eco.deposit(this.carry.type, this.carry.amount);
        this.carry.amount = 0;
        this.stuck = 0;
        this.jobPhase = 'ir';
        this.routeTo(world, node);
      } else if (!this.path.length) {
        this.stuck += dt;
        if (this.retryIn <= 0) {
          this.retryIn = 0.6;
          this.routeTo(world, drop);
        }
        if (this.stuck > 4) this.status = 'sin acceso al depósito';
      } else {
        this.stuck = 0;
      }
      return;
    }

    if (distanceTo(this, node) > Eco.REACH) {
      this.jobPhase = 'ir';
      this.status = 'en marcha';
      if (!this.path.length) {
        this.stuck += dt;
        if (this.retryIn <= 0) {
          this.retryIn = 0.6;
          if (!this.routeTo(world, node)) {
            // Nodo inalcanzable: prueba con otro antes de rendirse.
            var alt = world.findNode(this.carry.type, this.gx, this.gy, 34);
            if (alt && alt !== node) { this.job.node = alt; this.routeTo(world, alt); }
          }
        }
        if (this.stuck > 4) this.status = 'sin acceso al tajo';
      } else {
        this.stuck = 0;
      }
      return;
    }

    // En el tajo.
    this.path.length = 0;
    this.stuck = 0;
    this.jobPhase = 'trabajar';
    this.status = WORK_VERB[node.resource.type] || 'trabajando';
    this.faceTowards(node.gx - this.gx, node.gy - this.gy);

    var rate = Eco.GATHER_RATE[node.resource.type] || 1;
    var room = Eco.CARRY_CAPACITY - this.carry.amount;
    var taken = Math.min(rate * dt, room, node.resource.amount);
    this.carry.amount += taken;
    node.resource.amount -= taken;

    if (node.resource.amount <= 0.001) {
      if (node.prop === 'pino' || node.prop === 'olivo' || node.prop === 'frutal') {
        world.leaveStump(node);
      }
      world.removeEntity(node);
      this.job.node = null;
    }

    if (this.carry.amount >= Eco.CARRY_CAPACITY - 0.001) {
      var dropoff = world.findDropoff(this.gx, this.gy, this.faction.id);
      if (!dropoff) { this.status = 'sin punto de descarga'; return; }
      this.job.dropoff = dropoff;
      this.jobPhase = 'acarrear';
      this.routeTo(world, dropoff);
    }
  };

  /** Entrega lo que lleve encima y queda a la espera. */
  Unit.prototype.deliverAndIdle = function (world) {
    if (this.carry.amount > 0) {
      Eco.deposit(this.carry.type, this.carry.amount);
      this.carry.amount = 0;
    }
    this.clearJob();
    this.path.length = 0;
    this.status = 'sin tajo';
  };

  Unit.prototype.thinkBuild = function (world, dt) {
    var site = this.job.site;
    if (!site || !site.site || world.entities.indexOf(site) < 0) {
      this.clearJob();
      this.status = 'en espera';
      return;
    }

    if (distanceTo(this, site) > Eco.REACH) {
      this.jobPhase = 'ir';
      this.status = 'en marcha';
      if (!this.path.length && this.retryIn <= 0) {
        this.retryIn = 0.6;
        if (!this.routeTo(world, site)) this.status = 'sin acceso a la obra';
      }
      return;
    }

    this.path.length = 0;
    this.jobPhase = 'trabajar';
    this.status = 'construyendo';
    this.faceTowards(site.gx - this.gx, site.gy - this.gy);
    site.progress += dt;
    if (site.progress >= site.needed) {
      world.completeSite(site);
      this.clearJob();
      this.status = 'obra terminada';
    }
  };

  Unit.prototype.faceTowards = function (dx, dy) {
    if (!dx && !dy) return;
    this.yaw = Math.atan2(dx, dy);
    this.dir = ((Math.round(this.yaw / (Math.PI / 4)) % 8) + 8) % 8;
  };

  /* --- Movimiento ----------------------------------------------------------- */

  Unit.prototype.update = function (world, dt) {
    this.think(world, dt);

    if (!this.path.length) {
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

      var desired = Math.atan2(dx, dy);
      var delta = normalizeAngle(desired - this.yaw);
      var maxTurn = this.type.turnRate * dt;
      this.yaw = normalizeAngle(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, delta)));

      if (step >= dist - ARRIVAL) this.path.shift();
    }

    this.dir = ((Math.round(this.yaw / (Math.PI / 4)) % 8) + 8) % 8;
    this.phase = (this.phase + travelled / this.type.stride) % 1;

    if (!this.path.length && !this.job) this.status = 'en posición';
  };

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* ---------------------------------------------------------------------------
   * 2. GESTOR
   * ------------------------------------------------------------------------ */

  function UnitManager() {
    this.units = [];
  }

  UnitManager.prototype.add = function (options) {
    var u = new Unit(options);
    this.units.push(u);
    return u;
  };

  UnitManager.prototype.remove = function (unit) {
    var i = this.units.indexOf(unit);
    if (i >= 0) this.units.splice(i, 1);
  };

  UnitManager.prototype.playable = function () {
    return this.units.filter(function (u) { return u.playable; });
  };

  UnitManager.prototype.selected = function () {
    return this.units.filter(function (u) { return u.selected; });
  };

  UnitManager.prototype.selectedWorkers = function () {
    return this.units.filter(function (u) { return u.selected && u.isWorker(); });
  };

  UnitManager.prototype.clearSelection = function () {
    this.units.forEach(function (u) { u.selected = false; });
  };

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

  /* --- Órdenes -------------------------------------------------------------- */

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
    if (Math.floor(gx) !== anchor.gx || Math.floor(gy) !== anchor.gy) {
      result.relocated = true;
      result.reason = world.inside(Math.round(gx), Math.round(gy)) &&
                      world.typeAt(Math.round(gx), Math.round(gy)) === 'agua'
        ? 'destino-en-agua' : 'destino-ocupado';
    }
    var center = { gx: anchor.gx + 0.5, gy: anchor.gy + 0.5 };

    var slots = formationSlots(center.gx, center.gy, selection.length, 0.95);
    var taken = new Array(slots.length);
    var assignment = new Array(selection.length);

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
      u.clearJob();                       // una orden de marcha manda sobre el tajo
      var goal = assignment[i];
      var route = world.findPath(u.gx, u.gy, goal.gx, goal.gy);
      if (!route && goal !== center) route = world.findPath(u.gx, u.gy, center.gx, center.gy);
      if (route) { u.setPath(route.points); result.ordered++; }
      else { u.stop(); u.status = 'sin ruta'; result.failed++; if (!result.reason) result.reason = 'sin-ruta'; }
    }
    return result;
  };

  /**
   * Orden sobre una entidad concreta: los zapadores la explotan o la construyen;
   * el resto simplemente se acerca.
   * @returns {{kind:string, count:number}}
   */
  UnitManager.prototype.issueTargetOrder = function (world, entity) {
    var selection = this.selected();
    if (!selection.length) return { kind: 'sin-seleccion', count: 0 };

    var workers = selection.filter(function (u) { return u.isWorker(); });

    if (entity.site && workers.length) {
      var n = 0;
      workers.forEach(function (u) { if (u.assignBuild(world, entity)) n++; });
      return { kind: 'construir', count: n };
    }
    if (entity.resource && entity.resource.amount > 0 && workers.length) {
      var g = 0;
      workers.forEach(function (u) { if (u.assignGather(world, entity)) g++; });
      return { kind: 'recolectar', count: g, resource: entity.resource.type };
    }
    return { kind: 'ninguna', count: 0 };
  };

  UnitManager.prototype.stopSelected = function () {
    var sel = this.selected();
    sel.forEach(function (u) { u.clearJob(); u.stop(); });
    return sel.length;
  };

  UnitManager.prototype.update = function (world, dt) {
    for (var i = 0; i < this.units.length; i++) this.units[i].update(world, dt);
    this.separate(world);
  };

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
   * 3. DIBUJADO
   * ------------------------------------------------------------------------ */

  var CARRY_COLOR = {
    madera: ['#9a7846', '#6d5430'],
    viveres: ['#b8c06a', '#828a46'],
    metal: ['#a9b0b6', '#767c82']
  };

  function drawUnit(ctx, u, art) {
    var atlas = art.units[u.type.key][u.faction.id];

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

    // Fardo al hombro: se ve de un vistazo quién vuelve cargado.
    if (u.carry.amount > 0.5 && u.carry.type) {
      var c = CARRY_COLOR[u.carry.type] || ['#999', '#555'];
      var full = u.carry.amount / OP.Economy.CARRY_CAPACITY;
      var w = 5 + full * 4;
      ctx.fillStyle = c[0];
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(u.sx - w / 2 + 7, u.sy - 34, w, 5.5);
      ctx.fill(); ctx.stroke();
    }

    // Barra de progreso sobre la obra en la que trabaja: ya la pinta el mundo.
  }

  function drawPaths(ctx, units) {
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.selected || !u.path.length) continue;
      var from = Iso.toScreen(u.gx, u.gy);
      ctx.strokeStyle = u.job ? 'rgba(232, 206, 122, 0.45)' : 'rgba(158, 240, 201, 0.5)';
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
