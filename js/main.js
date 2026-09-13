/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/main.js — Arranque, entrada, bucle de simulación, HUD y minimapa.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var Iso = OP.Iso;
  var Art = OP.Art;
  var World = OP.World;
  var Units = OP.Units;

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
    keys: Object.create(null),
    miniDrag: false,
    touch: { mode: null, a: null, dist: 0 }
  };

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
    hud.selectionCount = document.getElementById('selection-count');
    hud.toast = document.getElementById('toast');

    // Deja que el navegador pinte el aviso de carga antes de hornear el arte.
    requestAnimationFrame(function () { setTimeout(boot, 0); });
  }

  function boot() {
    var t0 = performance.now();
    Art.build();
    var tArt = performance.now() - t0;
    World.build();
    var tWorld = performance.now() - t0 - tArt;

    var m = World.minimap();
    mini.width = m.canvas.width;
    mini.height = m.canvas.height;
    mini.style.aspectRatio = m.canvas.width + ' / ' + m.canvas.height;

    camera = new Iso.Camera(World.bounds);
    resize();
    camera.zoom = 1.05;
    camera.centerOnGrid(55, 25);

    units = Units.createManager();
    spawnForces();
    bindEvents();

    var s = World.stats();
    document.getElementById('readout-world').textContent =
      World.W + '×' + World.H + ' · ' + s.entidades + ' elementos';

    hud.loading.classList.add('done');
    notify('Sector Vega del Jarama. Arrastra con el botón central para mover la cámara.', 'info', 5000);
    refreshSelection();

    console.log('[Operación Poniente] arte ' + tArt.toFixed(0) + ' ms, escenario ' + tWorld.toFixed(0) + ' ms');
    requestAnimationFrame(frame);
  }

  function spawnForces() {
    var roster = [
      { type: 'fusilero',   callsign: 'LOBO-1',     gx: 51, gy: 27 },
      { type: 'fusilero',   callsign: 'LOBO-2',     gx: 52, gy: 28 },
      { type: 'fusilero',   callsign: 'LOBO-3',     gx: 53, gy: 27 },
      { type: 'explorador', callsign: 'GALGO-1',    gx: 55, gy: 28 },
      { type: 'explorador', callsign: 'GALGO-2',    gx: 56, gy: 27 },
      { type: 'zapador',    callsign: 'CASTILLO-1', gx: 54, gy: 29 }
    ];
    roster.forEach(function (entry) {
      var spot = World.nearestFree(entry.gx, entry.gy, 10) || { gx: entry.gx, gy: entry.gy };
      units.add({
        type: entry.type, callsign: entry.callsign, faction: 'met',
        gx: spot.gx + 0.5, gy: spot.gy + 0.5, dir: 1
      });
    });

    // Centinelas del Consorcio: decorado, sin IA en esta fase.
    [[21, 60, 5], [19, 61, 6], [23, 59, 4]].forEach(function (p, i) {
      var spot = World.nearestFree(p[0], p[1], 8);
      if (!spot) return;
      units.add({
        type: i === 2 ? 'explorador' : 'fusilero',
        callsign: 'PON-' + (i + 1), faction: 'pon', playable: false,
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
   * 2. ENTRADA
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
    if (event.button === 0) {
      var w = camera.screenToWorld(p.x, p.y);
      input.box = {
        start: w, end: { x: w.x, y: w.y },
        startScreen: p, moved: false, additive: event.shiftKey
      };
    }
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
      var n = units.selectInRect(box.start.x, box.start.y, box.end.x, box.end.y, box.additive);
      if (!n && !box.additive) notify('Ninguna unidad dentro del encuadre.', 'info');
    } else {
      units.selectAt(box.end.x, box.end.y, box.additive);
    }
    refreshSelection();
  }

  function onContextMenu(event) {
    event.preventDefault();
    var p = local(event);
    var w = camera.screenToWorld(p.x, p.y);
    var g = Iso.toGrid(w.x, w.y);
    var result = units.issueMoveOrder(World, g.gx, g.gy);

    if (result.reason === 'sin-seleccion') {
      notify('Selecciona primero alguna unidad.', 'warn');
      addMarker(g.gx, g.gy, 'bad');
      return;
    }
    if (result.ordered > 0) {
      addMarker(g.gx, g.gy, result.relocated ? 'adjusted' : 'good');
      if (result.reason === 'destino-en-agua') {
        notify('Destino en el río: reasignado a la orilla más próxima.', 'warn');
      } else if (result.reason === 'destino-ocupado') {
        notify('Destino ocupado: reasignado al hueco libre más próximo.', 'warn');
      } else if (result.failed) {
        notify(result.failed + ' unidad(es) sin ruta hasta el destino.', 'warn');
      }
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
    var scaleX = m.canvas.width / mini.clientWidth;
    var scaleY = m.canvas.height / mini.clientHeight;
    var g = World.minimapToGrid(p.x * scaleX, p.y * scaleY);
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

  function onKeyDown(event) {
    var code = event.code;
    input.keys[code] = true;

    if (code === 'Space') {
      input.spaceHeld = true;
      event.preventDefault();
      canvas.classList.add('grab');
      return;
    }
    if (code === 'KeyH') { showHud = !showHud; hud.root.classList.toggle('hidden', !showHud); }
    else if (code === 'KeyF') { camera.centerOnGrid(55, 22); notify('Cámara sobre la base.', 'info'); }
    else if (code === 'KeyX') { var n = units.stopSelected(); if (n) notify('Alto a ' + n + ' unidad(es).', 'info'); refreshSelection(); }
    else if (code === 'Escape') { units.clearSelection(); refreshSelection(); }
    else if (code === 'KeyA' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      units.selectAll();
      refreshSelection();
    } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      var type = ['fusilero', 'explorador', 'zapador'][parseInt(code.slice(5), 10) - 1];
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
    if (event.code === 'Space') {
      input.spaceHeld = false;
      canvas.classList.remove('grab');
    }
  }

  function keyboardCamera(dt) {
    var speed = 900 / camera.zoom * dt;
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
   * 3. MARCADORES Y AVISOS
   * ------------------------------------------------------------------------ */

  function addMarker(gx, gy, kind) { markers.push({ gx: gx, gy: gy, kind: kind, life: 0, ttl: 0.85 }); }

  function updateMarkers(dt) {
    for (var i = markers.length - 1; i >= 0; i--) {
      markers[i].life += dt;
      if (markers[i].life >= markers[i].ttl) markers.splice(i, 1);
    }
  }

  function drawMarkers() {
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var t = m.life / m.ttl;
      var p = Iso.toScreen(m.gx, m.gy);
      var rgb = m.kind === 'bad' ? '255, 96, 80'
              : m.kind === 'adjusted' ? '255, 198, 96' : '158, 240, 201';
      ctx.strokeStyle = 'rgba(' + rgb + ', ' + ((1 - t) * 0.9).toFixed(3) + ')';
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
   * 4. HUD
   * ------------------------------------------------------------------------ */

  var selectionSignature = null;

  function refreshSelection() {
    var sel = units.selected();
    var sig = sel.map(function (u) { return u.callsign + ':' + u.status; }).join('|')
      + '/' + units.playable().length;
    if (sig === selectionSignature) return;
    selectionSignature = sig;

    hud.selectionCount.textContent = sel.length + ' / ' + units.playable().length;
    if (!sel.length) {
      hud.selection.innerHTML = '<li class="empty">Sin unidades seleccionadas</li>';
      return;
    }
    hud.selection.innerHTML = sel.map(function (u) {
      return '<li>' +
        '<span class="badge ' + u.type.key + '"></span>' +
        '<span class="callsign">' + esc(u.callsign) + '</span>' +
        '<span class="utype">' + esc(u.type.name) + '</span>' +
        '<span class="ustatus">' + esc(u.status) + '</span>' +
        '</li>';
    }).join('');
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
    var base = TERRAIN_LABEL[World.typeAt(gx, gy)] || '—';
    if (World.typeAt(gx, gy) !== 'agua' && World.isBlocked(gx, gy)) return base + ' — ocupado';
    return base;
  }

  function drawMinimap() {
    var m = World.minimap();
    miniCtx.setTransform(1, 0, 0, 1, 0, 0);
    miniCtx.clearRect(0, 0, mini.width, mini.height);
    miniCtx.drawImage(m.canvas, 0, 0);

    // Unidades.
    for (var i = 0; i < units.units.length; i++) {
      var u = units.units[i];
      var px = (u.gx - u.gy) * m.scale + m.ox;
      var py = (u.gx + u.gy) * m.scale / 2;
      miniCtx.fillStyle = u.selected ? '#9ef0c9' : u.faction.color;
      miniCtx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }

    // Encuadre de la cámara.
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
   * 5. BUCLE
   * ------------------------------------------------------------------------ */

  var lastTime = 0;

  function frame(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;
    time += dt;

    keyboardCamera(dt);
    units.update(World, dt);
    updateMarkers(dt);
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
    refreshSelection();
    drawMinimap();

    requestAnimationFrame(frame);
  }

  var scene = [];

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a2417';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    camera.applyTransform(ctx);

    World.drawTerrain(ctx, camera);
    World.drawWaterSparkle(ctx, camera, time);
    drawHoverTile();
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

    drawSelectionBox();
  }

  function drawHoverTile() {
    var gx = Math.floor(input.grid.gx), gy = Math.floor(input.grid.gy);
    if (!World.inside(gx, gy)) return;
    var p = Iso.toScreen(gx + 0.5, gy + 0.5);
    ctx.strokeStyle = World.isBlocked(gx, gy)
      ? 'rgba(255, 120, 100, 0.5)' : 'rgba(240, 250, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - Iso.HH);
    ctx.lineTo(p.x + Iso.HW, p.y);
    ctx.lineTo(p.x, p.y + Iso.HH);
    ctx.lineTo(p.x - Iso.HW, p.y);
    ctx.closePath();
    ctx.stroke();
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
    notify: notify
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(OP);
