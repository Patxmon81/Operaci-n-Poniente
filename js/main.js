/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/main.js — Arranque, entrada, bucle, HUD, construcción y producción.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;
  var Art = OP.Art;
  var World = OP.World;
  var Units = OP.Units;
  var Eco = OP.Economy;

  var canvas, ctx, mini, miniCtx;
  var camera, units;
  var hud = {};

  var input = {
    screen: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
    grid: { gx: 0, gy: 0 },
    panning: false,
    panLast: { x: 0, y: 0 },
    box: null,
    spaceHeld: false,
    shiftHeld: false,
    keys: Object.create(null),
    miniDrag: false,
    touch: { mode: null, a: null, dist: 0 }
  };

  var placing = null;          // definición de edificio pendiente de colocar
  var selectedBuilding = null; // edificio propio seleccionado
  var markers = [];
  var showHud = true;
  var time = 0;
  var stats = { fps: 0, frames: 0, acc: 0 };

  /* ---------------------------------------------------------------------------
   * 1. ARRANQUE
   * ------------------------------------------------------------------------ */

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d', { alpha: false });
    mini = document.getElementById('minimap');
    miniCtx = mini.getContext('2d');

    hud.loading = document.getElementById('loading');
    hud.root = document.getElementById('hud');
    hud.cursor = document.getElementById('readout-cursor');
    hud.terrain = document.getElementById('readout-terrain');
    hud.zoom = document.getElementById('readout-zoom');
    hud.fps = document.getElementById('readout-fps');
    hud.selection = document.getElementById('selection-list');
    hud.selectionTitle = document.getElementById('selection-title');
    hud.selectionCount = document.getElementById('selection-count');
    hud.toast = document.getElementById('toast');
    hud.buildList = document.getElementById('build-list');
    hud.buildHint = document.getElementById('build-hint');
    hud.resources = {};

    requestAnimationFrame(function () { setTimeout(boot, 0); });
  }

  function boot() {
    var t0 = performance.now();
    Art.build();
    var tArt = performance.now() - t0;
    World.build();
    var tWorld = performance.now() - t0 - tArt;

    var m = World.minimap();
    mini.width = m.width;
    mini.height = m.height;
    mini.style.aspectRatio = m.width + ' / ' + m.height;

    camera = new Iso.Camera(World.bounds);
    resize();
    camera.zoom = 1.0;
    camera.centerOnGrid(World.baseMet.gx, World.baseMet.gy + 4);

    units = Units.createManager();
    spawnForces();
    buildResourceBar();
    buildBuildPanel();
    bindEvents();

    var s = World.stats();
    document.getElementById('readout-world').textContent =
      World.W + '×' + World.H + ' · ' + s.nodos + ' nodos';

    hud.loading.classList.add('done');
    notify('Cuatro zapadores esperan órdenes. Clic derecho sobre un árbol, un frutal o un montón de chatarra para ponerlos a trabajar.', 'info', 7000);

    console.log('[Operación Poniente] arte ' + tArt.toFixed(0) + ' ms, escenario ' + tWorld.toFixed(0) + ' ms');
    requestAnimationFrame(frame);
  }

  function spawnForces() {
    var base = World.baseMet;
    var roster = [
      { type: 'zapador', gx: base.gx - 4, gy: base.gy + 3 },
      { type: 'zapador', gx: base.gx - 3, gy: base.gy + 4 },
      { type: 'zapador', gx: base.gx - 2, gy: base.gy + 4 },
      { type: 'zapador', gx: base.gx - 1, gy: base.gy + 3 },
      { type: 'fusilero', gx: base.gx + 2, gy: base.gy + 4 },
      { type: 'fusilero', gx: base.gx + 3, gy: base.gy + 3 },
      { type: 'explorador', gx: base.gx + 4, gy: base.gy + 4 }
    ];
    roster.forEach(function (entry) {
      var spot = World.nearestFree(entry.gx, entry.gy, 10) || entry;
      units.add({
        type: entry.type, faction: 'met',
        gx: spot.gx + 0.5, gy: spot.gy + 0.5, dir: 1
      });
    });

    [[base.gx - 62, base.gy + 58, 5], [base.gx - 64, base.gy + 60, 6]].forEach(function (p, i) {
      var spot = World.nearestFree(p[0], p[1], 10);
      if (!spot) return;
      units.add({
        type: i ? 'explorador' : 'fusilero', faction: 'pon', playable: false,
        gx: spot.gx + 0.5, gy: spot.gy + 0.5, dir: p[2]
      });
    });
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || window.innerWidth;
    var cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (camera) camera.resize(cssW, cssH, dpr);
  }

  /* ---------------------------------------------------------------------------
   * 2. MARCADOR DE RECURSOS Y PANEL DE CONSTRUCCIÓN
   * ------------------------------------------------------------------------ */

  function buildResourceBar() {
    var bar = document.getElementById('resources');
    bar.innerHTML = '';
    Eco.KINDS.concat(['poblacion']).forEach(function (kind) {
      var item = document.createElement('div');
      item.className = 'res';
      var icon = document.createElement('i');
      icon.style.backgroundImage = 'url(' + Art.icons[kind] + ')';
      var value = document.createElement('span');
      value.className = 'val';
      value.textContent = '0';
      item.appendChild(icon);
      item.appendChild(value);
      item.title = kind === 'poblacion' ? 'Personal en servicio / alojamiento' : Eco.LABEL[kind];
      bar.appendChild(item);
      hud.resources[kind] = { item: item, value: value };
    });
  }

  function buildBuildPanel() {
    hud.buildList.innerHTML = '';
    hud.buildButtons = {};
    Eco.BUILD_ORDER.forEach(function (id) {
      var def = Eco.BUILDINGS[id];
      var btn = document.createElement('button');
      btn.className = 'build-btn';
      btn.type = 'button';
      btn.innerHTML =
        '<span class="bk">' + def.hotkeyLabel + '</span>' +
        '<span class="bn">' + def.name + '</span>' +
        '<span class="bc">' + Eco.formatCost(def.cost) + '</span>';
      btn.addEventListener('click', function () { startPlacing(def); });
      btn.addEventListener('mouseenter', function () { hud.buildHint.textContent = def.blurb; });
      btn.addEventListener('mouseleave', function () { hud.buildHint.textContent = ''; });
      hud.buildList.appendChild(btn);
      hud.buildButtons[id] = btn;
    });
  }

  var affordSignature = null;

  function refreshBuildPanel() {
    var sig = Eco.BUILD_ORDER.map(function (id) {
      return Eco.canAfford(Eco.BUILDINGS[id].cost) ? '1' : '0';
    }).join('') + (placing ? placing.id : '');
    if (sig === affordSignature) return;
    affordSignature = sig;

    Eco.BUILD_ORDER.forEach(function (id) {
      var btn = hud.buildButtons[id];
      btn.classList.toggle('poor', !Eco.canAfford(Eco.BUILDINGS[id].cost));
      btn.classList.toggle('active', !!placing && placing.id === id);
    });
  }

  function startPlacing(def) {
    if (!Eco.canAfford(def.cost)) {
      notify('Faltan recursos: ' + Eco.missing(def.cost).join(' y ') + '.', 'warn');
      return;
    }
    placing = def;
    selectedBuilding = null;
    hud.buildHint.textContent = 'Clic izquierdo para asentar ' + def.name.toLowerCase() +
      '. Esc o clic derecho para cancelar.';
  }

  function cancelPlacing() {
    if (!placing) return false;
    placing = null;
    hud.buildHint.textContent = '';
    return true;
  }

  function tryPlace(gx, gy) {
    var def = placing;
    if (!def) return;
    var tx = Math.floor(gx), ty = Math.floor(gy);
    if (!World.canPlace(def, tx, ty)) {
      notify('Ahí no cabe: el terreno está ocupado o es agua.', 'warn');
      return;
    }
    if (!Eco.canAfford(def.cost)) {
      notify('Faltan recursos: ' + Eco.missing(def.cost).join(' y ') + '.', 'warn');
      cancelPlacing();
      return;
    }
    Eco.spend(def.cost);
    var site = World.addSite(def.id, 'met', tx, ty);
    if (!site) { Eco.refund(def.cost); return; }

    // Los zapadores seleccionados van a la obra; si no hay, avisa.
    var workers = units.selectedWorkers();
    if (workers.length) {
      workers.forEach(function (u) { u.assignBuild(World, site); });
      notify(def.name + ': obra abierta, ' + workers.length + ' zapador(es) en camino.', 'info');
    } else {
      notify(def.name + ': obra abierta. Selecciona zapadores y haz clic derecho sobre ella.', 'warn', 4200);
    }
    addMarker(tx + def.w / 2, ty + def.h / 2, 'good');
    if (!input.shiftHeld) cancelPlacing();
  }

  /* ---------------------------------------------------------------------------
   * 3. ENTRADA
   * ------------------------------------------------------------------------ */

  function bindEvents() {
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', function (e) { if (!e.touches.length) input.touch.mode = null; });
    mini.addEventListener('mousedown', onMiniDown);
    mini.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () {
      input.keys = Object.create(null);
      input.spaceHeld = false;
      input.shiftHeld = false;
      input.panning = false;
      canvas.classList.remove('grab', 'grabbing');
    });
  }

  function local(event, el) {
    var rect = (el || canvas).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onMouseDown(event) {
    var p = local(event);
    if (event.button === 1 || (event.button === 0 && (input.spaceHeld || event.ctrlKey))) {
      event.preventDefault();
      input.panning = true;
      input.panLast = p;
      canvas.classList.add('grabbing');
      return;
    }
    if (event.button !== 0) return;

    var w = camera.screenToWorld(p.x, p.y);
    if (placing) {
      var g = Iso.toGrid(w.x, w.y);
      tryPlace(g.gx, g.gy);
      return;
    }
    input.box = {
      start: w, end: { x: w.x, y: w.y },
      startScreen: p, moved: false, additive: event.shiftKey
    };
  }

  function onMouseMove(event) {
    var p = local(event);
    input.screen = p;
    input.world = camera.screenToWorld(p.x, p.y);
    input.grid = Iso.toGrid(input.world.x, input.world.y);

    if (input.miniDrag) { miniSeek(local(event, mini)); return; }
    if (input.panning) {
      camera.panByScreen(p.x - input.panLast.x, p.y - input.panLast.y);
      input.panLast = p;
      return;
    }
    if (input.box) {
      input.box.end = camera.screenToWorld(p.x, p.y);
      var dx = p.x - input.box.startScreen.x, dy = p.y - input.box.startScreen.y;
      if (dx * dx + dy * dy > 36) input.box.moved = true;
    }
  }

  function onMouseUp(event) {
    input.miniDrag = false;
    if (input.panning) {
      input.panning = false;
      canvas.classList.remove('grabbing');
      return;
    }
    if (event.button !== 0 || !input.box) return;
    var box = input.box;
    input.box = null;

    if (box.moved) {
      selectedBuilding = null;
      var n = units.selectInRect(box.start.x, box.start.y, box.end.x, box.end.y, box.additive);
      if (!n && !box.additive) notify('Ninguna unidad dentro del encuadre.', 'info');
    } else {
      var picked = units.selectAt(box.end.x, box.end.y, box.additive);
      if (picked) {
        selectedBuilding = null;
      } else {
        // Sin unidad bajo el cursor: prueba a seleccionar un edificio propio.
        var g = Iso.toGrid(box.end.x, box.end.y);
        var e = World.entityAt(g.gx, g.gy);
        selectedBuilding = (e && e.kind === 'building' && e.faction === 'met') ? e : null;
        if (selectedBuilding) units.clearSelection();
      }
    }
    refreshSelection();
  }

  function onContextMenu(event) {
    event.preventDefault();
    if (cancelPlacing()) return;

    var p = local(event);
    var w = camera.screenToWorld(p.x, p.y);
    var g = Iso.toGrid(w.x, w.y);

    // Sobre una entidad explotable o en obra, la orden es de trabajo.
    var entity = World.entityAt(g.gx, g.gy);
    if (entity && (entity.resource || entity.site) && units.selectedWorkers().length) {
      var res = units.issueTargetOrder(World, entity);
      if (res.count) {
        addMarker(entity.gx, entity.gy, 'work');
        notify(res.kind === 'construir'
          ? res.count + ' zapador(es) a la obra.'
          : res.count + ' zapador(es) ' + (Units.TYPES.zapador ? '' : '') + 'a por ' + Eco.LABEL[res.resource].toLowerCase() + '.',
          'info', 2000);
        refreshSelection();
        return;
      }
    }

    var result = units.issueMoveOrder(World, g.gx, g.gy);
    if (result.reason === 'sin-seleccion') {
      notify('Selecciona primero alguna unidad.', 'warn');
      addMarker(g.gx, g.gy, 'bad');
      return;
    }
    if (result.ordered > 0) {
      addMarker(g.gx, g.gy, result.relocated ? 'adjusted' : 'good');
      if (result.reason === 'destino-en-agua') notify('Destino en el río: reasignado a la orilla.', 'warn');
      else if (result.reason === 'destino-ocupado') notify('Destino ocupado: reasignado al hueco libre más próximo.', 'warn');
      else if (result.failed) notify(result.failed + ' unidad(es) sin ruta.', 'warn');
    } else {
      addMarker(g.gx, g.gy, 'bad');
      notify('Sin ruta terrestre hasta ese punto.', 'error');
    }
    refreshSelection();
  }

  function onWheel(event) {
    event.preventDefault();
    var p = local(event);
    camera.zoomAt(p.x, p.y, Math.pow(0.9988, event.deltaY * (event.deltaMode === 1 ? 16 : 1)));
  }

  function onMiniDown(event) {
    event.preventDefault();
    input.miniDrag = true;
    miniSeek(local(event, mini));
  }

  function miniSeek(p) {
    var m = World.minimap();
    var g = World.minimapToGrid(p.x * (m.width / mini.clientWidth),
                                p.y * (m.height / mini.clientHeight));
    camera.centerOnGrid(g.gx, g.gy);
  }

  function onTouchStart(event) {
    event.preventDefault();
    var rect = canvas.getBoundingClientRect();
    if (event.touches.length === 1) {
      input.touch.mode = 'pan';
      input.touch.a = { x: event.touches[0].clientX - rect.left, y: event.touches[0].clientY - rect.top };
    } else if (event.touches.length >= 2) {
      input.touch.mode = 'zoom';
      var a = event.touches[0], b = event.touches[1];
      input.touch.dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    var rect = canvas.getBoundingClientRect();
    if (input.touch.mode === 'pan' && event.touches.length === 1) {
      var p = { x: event.touches[0].clientX - rect.left, y: event.touches[0].clientY - rect.top };
      camera.panByScreen(p.x - input.touch.a.x, p.y - input.touch.a.y);
      input.touch.a = p;
    } else if (input.touch.mode === 'zoom' && event.touches.length >= 2) {
      var a = event.touches[0], b = event.touches[1];
      var d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      if (input.touch.dist > 0) {
        camera.zoomAt((a.clientX + b.clientX) / 2 - rect.left,
                      (a.clientY + b.clientY) / 2 - rect.top, d / input.touch.dist);
      }
      input.touch.dist = d;
    }
  }

  var BUILD_HOTKEY = {};
  Eco.BUILD_ORDER.forEach(function (id) {
    var def = Eco.BUILDINGS[id];
    if (def.hotkey) BUILD_HOTKEY[def.hotkey] = def;
  });

  function onKeyDown(event) {
    var code = event.code;
    input.keys[code] = true;
    input.shiftHeld = event.shiftKey;

    if (code === 'Space') {
      input.spaceHeld = true;
      event.preventDefault();
      canvas.classList.add('grab');
      return;
    }
    if (BUILD_HOTKEY[code]) { startPlacing(BUILD_HOTKEY[code]); return; }

    if (code === 'KeyH') { showHud = !showHud; hud.root.classList.toggle('hidden', !showHud); }
    else if (code === 'KeyF') { camera.centerOnGrid(World.baseMet.gx, World.baseMet.gy); notify('Cámara sobre la base.', 'info'); }
    else if (code === 'KeyX') { var n = units.stopSelected(); if (n) notify('Alto a ' + n + ' unidad(es).', 'info'); refreshSelection(); }
    else if (code === 'Escape') {
      if (!cancelPlacing()) { units.clearSelection(); selectedBuilding = null; refreshSelection(); }
    } else if (code === 'Period') {
      // Zapadores sin tajo: el atajo más útil de todo el juego.
      units.clearSelection();
      selectedBuilding = null;
      var idle = 0;
      units.units.forEach(function (u) {
        if (u.playable && u.isWorker() && !u.job && !u.isMoving()) { u.selected = true; idle++; }
      });
      notify(idle ? idle + ' zapador(es) sin tajo.' : 'Todos los zapadores están ocupados.', idle ? 'info' : 'warn', 1800);
      refreshSelection();
    } else if (code === 'KeyA' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      selectedBuilding = null;
      units.selectAll();
      refreshSelection();
    } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      if (selectedBuilding) { trainFromSelected(parseInt(code.slice(5), 10) - 1); return; }
      var type = ['zapador', 'fusilero', 'explorador'][parseInt(code.slice(5), 10) - 1];
      if (!event.shiftKey) units.clearSelection();
      var picked = 0;
      units.units.forEach(function (u) {
        if (u.playable && u.type.key === type) { u.selected = true; picked++; }
      });
      if (picked) notify(picked + ' × ' + Units.TYPES[type].name, 'info', 1400);
      refreshSelection();
    }
  }

  function onKeyUp(event) {
    input.keys[event.code] = false;
    input.shiftHeld = event.shiftKey;
    if (event.code === 'Space') {
      input.spaceHeld = false;
      canvas.classList.remove('grab');
    }
  }

  function keyboardCamera(dt) {
    var speed = 1000 / camera.zoom * dt;
    var dx = 0, dy = 0;
    if (input.keys.KeyA || input.keys.ArrowLeft) dx -= speed;
    if (input.keys.KeyD || input.keys.ArrowRight) dx += speed;
    if (input.keys.KeyW || input.keys.ArrowUp) dy -= speed;
    if (input.keys.KeyS || input.keys.ArrowDown) dy += speed;
    if (dx || dy) { camera.x += dx; camera.y += dy; camera.clamp(); }
    var zf = 1;
    if (input.keys.KeyE || input.keys.Equal || input.keys.NumpadAdd) zf = 1 + 1.5 * dt;
    if (input.keys.KeyQ || input.keys.Minus || input.keys.NumpadSubtract) zf = 1 - 1.5 * dt;
    if (zf !== 1) camera.zoomAt(camera.viewWidth / 2, camera.viewHeight / 2, zf);
  }

  /* ---------------------------------------------------------------------------
   * 4. PRODUCCIÓN
   * ------------------------------------------------------------------------ */

  function trainFromSelected(slot) {
    var b = selectedBuilding;
    if (!b || !b.def.trains || b.site) return;
    var unitKey = b.def.trains[slot];
    if (!unitKey) return;
    queueUnit(b, unitKey);
  }

  function queueUnit(building, unitKey) {
    var res = Eco.enqueue(building, unitKey);
    if (res.ok) {
      notify(Eco.UNITS[unitKey].name + ' en instrucción.', 'info', 1500);
      return;
    }
    if (res.reason === 'sin-recursos') notify('Faltan recursos: ' + res.falta.join(' y ') + '.', 'warn');
    else if (res.reason === 'sin-alojamiento') notify('Sin alojamiento. Levanta un alojamiento (tecla C).', 'warn', 3600);
    else if (res.reason === 'cola-llena') notify('La cola está completa.', 'warn');
    else if (res.reason === 'en-obra') notify('El edificio aún está en obras.', 'warn');
  }

  function spawnTrained(unitKey, building) {
    var spot = World.freeTileNear(
      building.tileX + building.tilesW / 2,
      building.tileY + building.tilesH + 1, 10);
    if (!spot) return false;
    units.add({
      type: unitKey, faction: building.faction,
      gx: spot.gx + 0.5, gy: spot.gy + 0.5, dir: 1
    });
    return true;
  }

  /* ---------------------------------------------------------------------------
   * 5. MARCADORES Y AVISOS
   * ------------------------------------------------------------------------ */

  function addMarker(gx, gy, kind) { markers.push({ gx: gx, gy: gy, kind: kind, life: 0, ttl: 0.85 }); }

  function updateMarkers(dt) {
    for (var i = markers.length - 1; i >= 0; i--) {
      markers[i].life += dt;
      if (markers[i].life >= markers[i].ttl) markers.splice(i, 1);
    }
  }

  var MARKER_RGB = {
    bad: '255, 96, 80', adjusted: '255, 198, 96',
    work: '232, 206, 122', good: '158, 240, 201'
  };

  function drawMarkers() {
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var t = m.life / m.ttl;
      var p = Iso.toScreen(m.gx, m.gy);
      ctx.strokeStyle = 'rgba(' + (MARKER_RGB[m.kind] || MARKER_RGB.good) + ', ' + ((1 - t) * 0.9).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 6 + 26 * t, (6 + 26 * t) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  var toastTimer = null;

  function notify(text, kind, duration) {
    hud.toast.textContent = text;
    hud.toast.className = 'visible ' + (kind || 'info');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hud.toast.className = ''; }, duration || 2800);
  }

  /* ---------------------------------------------------------------------------
   * 6. HUD
   * ------------------------------------------------------------------------ */

  var selectionSignature = null;

  function refreshSelection() {
    var sig;
    if (selectedBuilding) {
      sig = 'B' + selectedBuilding.uid + ':' +
        (selectedBuilding.site ? Math.floor(selectedBuilding.progress) : 'ok') + ':' +
        (selectedBuilding.queue || []).map(function (q) { return q.unit; }).join(',');
    } else {
      sig = units.selected().map(function (u) {
        return u.callsign + ':' + u.status + ':' + Math.floor(u.carry.amount);
      }).join('|') + '/' + units.playable().length;
    }
    if (sig === selectionSignature) return;
    selectionSignature = sig;

    if (selectedBuilding) { renderBuildingPanel(selectedBuilding); return; }

    var sel = units.selected();
    hud.selectionTitle.textContent = 'Fuerzas propias';
    hud.selectionCount.textContent = sel.length + ' / ' + units.playable().length;

    if (!sel.length) {
      hud.selection.innerHTML = '<li class="empty">Sin unidades seleccionadas</li>';
      return;
    }
    hud.selection.innerHTML = sel.slice(0, 12).map(function (u) {
      var load = u.carry.amount > 0.5
        ? '<span class="load ' + u.carry.type + '">' + Math.floor(u.carry.amount) + '</span>' : '';
      return '<li>' +
        '<span class="badge ' + u.type.key + '"></span>' +
        '<span class="callsign">' + esc(u.callsign) + '</span>' +
        '<span class="utype">' + esc(u.type.name) + '</span>' +
        load +
        '<span class="ustatus">' + esc(u.status) + '</span>' +
        '</li>';
    }).join('') + (sel.length > 12 ? '<li class="empty">y ' + (sel.length - 12) + ' más</li>' : '');
  }

  function renderBuildingPanel(b) {
    hud.selectionTitle.textContent = b.def.name;
    hud.selectionCount.textContent = b.site ? 'en obra' : 'operativo';

    if (b.site) {
      var pct = Math.round(100 * b.progress / b.needed);
      hud.selection.innerHTML =
        '<li class="empty">Obra al ' + pct + ' %. Manda zapadores con clic derecho.</li>';
      return;
    }

    var html = '<li class="empty">' + esc(b.def.blurb) + '</li>';
    if (b.def.trains) {
      html += b.def.trains.map(function (key, i) {
        var u = Eco.UNITS[key];
        var poor = !Eco.canAfford(u.cost) || !Eco.hasRoom(key);
        return '<li class="train' + (poor ? ' poor' : '') + '" data-unit="' + key + '">' +
          '<span class="bk">' + (i + 1) + '</span>' +
          '<span class="callsign">' + esc(u.name) + '</span>' +
          '<span class="utype">' + esc(Eco.formatCost(u.cost)) + '</span>' +
          '<span class="ustatus">' + u.time + ' s</span>' +
          '</li>';
      }).join('');

      if (b.queue && b.queue.length) {
        var head = b.queue[0];
        var p = Math.round(100 * (1 - head.remaining / head.total));
        html += '<li class="queue"><span class="qbar"><i style="width:' + p + '%"></i></span>' +
          '<span class="ustatus">' + b.queue.length + ' en cola</span></li>';
      }
    }
    hud.selection.innerHTML = html;

    Array.prototype.forEach.call(hud.selection.querySelectorAll('.train'), function (li) {
      li.addEventListener('click', function () { queueUnit(b, li.getAttribute('data-unit')); });
    });
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var TERRAIN_LABEL = {
    agua: 'río — intransitable', arena: 'arenal de ribera', tierra: 'camino de tierra',
    secano: 'rastrojo', pasto: 'pastizal', matorral: 'monte bajo'
  };

  function terrainLabel(g) {
    var gx = Math.floor(g.gx), gy = Math.floor(g.gy);
    if (!World.inside(gx, gy)) return 'fuera del sector';
    var e = World.entityAt(gx, gy);
    if (e && e.resource && e.resource.amount > 0) {
      return Eco.LABEL[e.resource.type] + ' · ' + Math.ceil(e.resource.amount) + ' restantes';
    }
    if (e && e.kind === 'building') return e.def.name + (e.site ? ' (en obra)' : '');
    var base = TERRAIN_LABEL[World.typeAt(gx, gy)] || '—';
    if (World.typeAt(gx, gy) !== 'agua' && World.isBlocked(gx, gy)) return base + ' — ocupado';
    return base;
  }

  var resourceSignature = null;

  function refreshResources() {
    var sig = Eco.KINDS.map(function (k) { return Math.floor(Eco.stock[k]); }).join('|') +
      '/' + Eco.pop.used + '/' + Eco.pop.cap;
    if (sig === resourceSignature) return;
    resourceSignature = sig;

    Eco.KINDS.forEach(function (k) {
      hud.resources[k].value.textContent = Math.floor(Eco.stock[k]);
    });
    var popEl = hud.resources.poblacion;
    popEl.value.textContent = Eco.pop.used + ' / ' + Eco.pop.cap;
    popEl.item.classList.toggle('full', Eco.pop.used >= Eco.pop.cap);
  }

  function drawMinimap() {
    var m = World.minimap();
    World.syncMinimap();
    miniCtx.setTransform(1, 0, 0, 1, 0, 0);
    miniCtx.clearRect(0, 0, mini.width, mini.height);
    miniCtx.drawImage(m.terrain, 0, 0);
    miniCtx.drawImage(m.props, 0, 0);

    for (var i = 0; i < units.units.length; i++) {
      var u = units.units[i];
      var px = (u.gx - u.gy) * m.scale + m.ox;
      var py = (u.gx + u.gy) * m.scale / 2;
      miniCtx.fillStyle = u.selected ? '#9ef0c9' : u.faction.color;
      miniCtx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }

    var v = camera.visibleWorldBounds(0);
    var pts = [
      Iso.toGrid(v.minX, v.minY), Iso.toGrid(v.maxX, v.minY),
      Iso.toGrid(v.maxX, v.maxY), Iso.toGrid(v.minX, v.maxY)
    ];
    miniCtx.strokeStyle = 'rgba(232, 245, 250, 0.85)';
    miniCtx.lineWidth = 1;
    miniCtx.beginPath();
    pts.forEach(function (g, k) {
      var px2 = (g.gx - g.gy) * m.scale + m.ox;
      var py2 = (g.gx + g.gy) * m.scale / 2;
      if (k === 0) miniCtx.moveTo(px2, py2); else miniCtx.lineTo(px2, py2);
    });
    miniCtx.closePath();
    miniCtx.stroke();
  }

  /* ---------------------------------------------------------------------------
   * 7. BUCLE
   * ------------------------------------------------------------------------ */

  var lastTime = 0;
  var popTimer = 0;
  var scene = [];

  function frame(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;
    time += dt;

    keyboardCamera(dt);
    units.update(World, dt);
    Eco.updateProduction(World.entities, dt, spawnTrained);
    popTimer -= dt;
    if (popTimer <= 0) {
      popTimer = 0.25;
      Eco.recalcPop(units.units, World.entities);
    }
    updateMarkers(dt);

    // El edificio seleccionado pudo demolerse o terminarse.
    if (selectedBuilding && World.entities.indexOf(selectedBuilding) < 0) selectedBuilding = null;

    render();

    stats.frames++; stats.acc += dt;
    if (stats.acc >= 0.5) {
      stats.fps = Math.round(stats.frames / stats.acc);
      stats.frames = 0; stats.acc = 0;
      hud.fps.textContent = stats.fps + ' fps';
    }

    hud.cursor.textContent = input.grid.gx.toFixed(1) + ', ' + input.grid.gy.toFixed(1);
    hud.terrain.textContent = terrainLabel(input.grid);
    hud.zoom.textContent = '×' + camera.zoom.toFixed(2);
    refreshResources();
    refreshBuildPanel();
    refreshSelection();
    drawMinimap();

    requestAnimationFrame(frame);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a2417';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    camera.applyTransform(ctx);

    World.drawTerrain(ctx, camera);
    World.drawWaterSparkle(ctx, camera, time);
    drawHover();
    Units.drawPaths(ctx, units.units);
    drawMarkers();

    scene.length = 0;
    World.collectStatics(camera, scene);
    units.collect(camera, scene);
    scene.sort(function (a, b) { return a.depth - b.depth; });
    for (var i = 0; i < scene.length; i++) {
      var e = scene[i];
      if (e.kind === 'unit') Units.drawUnit(ctx, e, Art);
      else World.drawEntity(ctx, e);
    }

    drawOverlays();
    drawSelectionBox();
  }

  /** Casilla bajo el cursor, o huella fantasma del edificio en colocación. */
  function drawHover() {
    var gx = Math.floor(input.grid.gx), gy = Math.floor(input.grid.gy);
    if (!World.inside(gx, gy)) return;

    if (placing) {
      var ok = World.canPlace(placing, gx, gy) && Eco.canAfford(placing.cost);
      ctx.save();
      ctx.fillStyle = ok ? 'rgba(120, 230, 160, 0.24)' : 'rgba(240, 110, 90, 0.26)';
      ctx.strokeStyle = ok ? 'rgba(158, 240, 201, 0.9)' : 'rgba(255, 120, 100, 0.9)';
      ctx.lineWidth = 1.6;
      for (var dy = 0; dy < placing.h; dy++) {
        for (var dx = 0; dx < placing.w; dx++) {
          var p = Iso.toScreen(gx + dx + 0.5, gy + dy + 0.5);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - Iso.HH);
          ctx.lineTo(p.x + Iso.HW, p.y);
          ctx.lineTo(p.x, p.y + Iso.HH);
          ctx.lineTo(p.x - Iso.HW, p.y);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }

    var q = Iso.toScreen(gx + 0.5, gy + 0.5);
    ctx.strokeStyle = World.isBlocked(gx, gy)
      ? 'rgba(255, 120, 100, 0.5)' : 'rgba(240, 250, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - Iso.HH);
    ctx.lineTo(q.x + Iso.HW, q.y);
    ctx.lineTo(q.x, q.y + Iso.HH);
    ctx.lineTo(q.x - Iso.HW, q.y);
    ctx.closePath();
    ctx.stroke();
  }

  /** Barras de obra, de producción y aro del edificio seleccionado. */
  function drawOverlays() {
    for (var i = 0; i < scene.length; i++) {
      var e = scene[i];
      if (e.kind !== 'building') continue;

      var top = e.sprite ? e.sy - e.sprite.ay - 8 : e.sy - 34;
      if (e.site) {
        drawBar(e.sx, top, e.progress / e.needed, '#e8ce7a');
      } else if (e.queue && e.queue.length) {
        var head = e.queue[0];
        drawBar(e.sx, top, 1 - head.remaining / head.total, '#7fc3f0');
      }

      if (e === selectedBuilding) {
        ctx.save();
        ctx.strokeStyle = '#9ef0c9';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        var w = e.tilesW, h = e.tilesH;
        var c0 = Iso.toScreen(e.tileX, e.tileY);
        var c1 = Iso.toScreen(e.tileX + w, e.tileY);
        var c2 = Iso.toScreen(e.tileX + w, e.tileY + h);
        var c3 = Iso.toScreen(e.tileX, e.tileY + h);
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawBar(x, y, ratio, color) {
    var w = 34, h = 5;
    ctx.fillStyle = 'rgba(10, 14, 8, 0.75)';
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2 + 1, y + 1, (w - 2) * Math.max(0, Math.min(1, ratio)), h - 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawSelectionBox() {
    if (!input.box || !input.box.moved) return;
    var a = camera.worldToScreen(input.box.start.x, input.box.start.y);
    var b = camera.worldToScreen(input.box.end.x, input.box.end.y);
    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillStyle = 'rgba(158, 240, 201, 0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(158, 240, 201, 0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.restore();
  }

  OP.Game = {
    get camera() { return camera; },
    get units() { return units; },
    get selectedBuilding() { return selectedBuilding; },
    startPlacing: startPlacing,
    tryPlace: tryPlace,
    queueUnit: queueUnit,
    notify: notify
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(OP);
