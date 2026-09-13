/* =============================================================================
 * OPERACIÓN PONIENTE — Fase 1 del motor
 * js/main.js
 *
 * Arranque, cámara (desplazamiento y zoom), entrada de ratón/teclado/táctil,
 * bucle de simulación y actualización del HUD.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var WORLD = OP.Map.WORLD;

  /* ---------------------------------------------------------------------------
   * 1. CÁMARA
   * ------------------------------------------------------------------------ */

  function Camera() {
    this.x = 0;              // centro de la vista, en unidades de mundo
    this.y = 0;
    this.zoom = 1;
    this.dpr = 1;
    this.viewWidth = 1;      // tamaño de la vista, en píxeles CSS
    this.viewHeight = 1;
    this.minZoom = 0.25;
    this.maxZoom = 6;
  }

  Camera.prototype.resize = function (cssWidth, cssHeight, dpr) {
    this.viewWidth = cssWidth;
    this.viewHeight = cssHeight;
    this.dpr = dpr;
    // No permitir alejarse más allá de encajar el mundo completo con holgura.
    var fit = Math.min(cssWidth / WORLD.width, cssHeight / WORLD.height);
    this.minZoom = Math.max(0.12, fit * 0.92);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampToWorld();
  };

  Camera.prototype.worldToScreen = function (wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewHeight / 2
    };
  };

  Camera.prototype.screenToWorld = function (sx, sy) {
    return {
      x: (sx - this.viewWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewHeight / 2) / this.zoom + this.y
    };
  };

  Camera.prototype.applyTransform = function (ctx) {
    var k = this.zoom * this.dpr;
    ctx.setTransform(
      k, 0, 0, k,
      this.dpr * (this.viewWidth / 2 - this.x * this.zoom),
      this.dpr * (this.viewHeight / 2 - this.y * this.zoom)
    );
  };

  Camera.prototype.visibleWorldBounds = function () {
    var halfW = this.viewWidth / (2 * this.zoom);
    var halfH = this.viewHeight / (2 * this.zoom);
    return {
      minX: this.x - halfW, minY: this.y - halfH,
      maxX: this.x + halfW, maxY: this.y + halfH
    };
  };

  var CAMERA_MARGIN = 90; // holgura de mar visible más allá del mundo

  Camera.prototype.clampToWorld = function () {
    var halfW = this.viewWidth / (2 * this.zoom);
    var halfH = this.viewHeight / (2 * this.zoom);

    var minX = WORLD.minX - CAMERA_MARGIN + halfW;
    var maxX = WORLD.maxX + CAMERA_MARGIN - halfW;
    var minY = WORLD.minY - CAMERA_MARGIN + halfH;
    var maxY = WORLD.maxY + CAMERA_MARGIN - halfH;

    this.x = (minX > maxX) ? (WORLD.minX + WORLD.maxX) / 2 : clamp(this.x, minX, maxX);
    this.y = (minY > maxY) ? (WORLD.minY + WORLD.maxY) / 2 : clamp(this.y, minY, maxY);
  };

  Camera.prototype.panByScreen = function (dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clampToWorld();
  };

  /** Zoom manteniendo fijo el punto del mundo bajo el cursor. */
  Camera.prototype.zoomAt = function (screenX, screenY, factor) {
    var before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    var after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToWorld();
  };

  Camera.prototype.centerOn = function (wx, wy) {
    this.x = wx;
    this.y = wy;
    this.clampToWorld();
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------------------------------------------------------------------------
   * 2. ESTADO DEL JUEGO
   * ------------------------------------------------------------------------ */

  var canvas, ctx;
  var camera = new Camera();
  var units = OP.Units.createManager();

  var input = {
    mouse: { x: 0, y: 0, inside: false },
    world: { x: 0, y: 0 },
    panning: false,
    panLast: { x: 0, y: 0 },
    box: null,            // {startWorld, endWorld, startScreen, moved}
    spaceHeld: false,
    keys: Object.create(null),
    touch: { mode: null, lastA: null, lastB: null, lastDist: 0 }
  };

  var markers = [];       // destellos de confirmación de órdenes
  var showNavGrid = false;
  var showHud = true;
  var stats = { fps: 0, frames: 0, acc: 0 };

  var hud = {};

  /* ---------------------------------------------------------------------------
   * 3. ARRANQUE
   * ------------------------------------------------------------------------ */

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d', { alpha: false });

    hud.cursor = document.getElementById('readout-cursor');
    hud.terrain = document.getElementById('readout-terrain');
    hud.zoom = document.getElementById('readout-zoom');
    hud.fps = document.getElementById('readout-fps');
    hud.nav = document.getElementById('readout-nav');
    hud.selection = document.getElementById('selection-list');
    hud.selectionCount = document.getElementById('selection-count');
    hud.toast = document.getElementById('toast');
    hud.root = document.getElementById('hud');

    resize();
    spawnStartingForce();

    var hq = OP.Map.cityById('madrid');
    camera.zoom = 1.35;
    camera.resize(camera.viewWidth, camera.viewHeight, camera.dpr);
    camera.centerOn(hq.x, hq.y + 40);

    bindEvents();

    var nav = OP.Map.navStats();
    hud.nav.textContent = nav.cols + '×' + nav.rows + ' celdas · ' +
      nav.walkable.toLocaleString('es-ES') + ' transitables';

    notify('Fase 1 operativa. Arrastra con el botón central (o Espacio + arrastrar) para desplazar el mapa.', 'info', 5200);
    refreshSelectionPanel();
    requestAnimationFrame(frame);
  }

  /** Coloca las unidades de ejemplo en torno al CG de Madrid. */
  function spawnStartingForce() {
    var hq = OP.Map.cityById('madrid');
    var roster = [
      { type: 'mecanizada',     callsign: 'LOBO-1',     dx: -46, dy: 46 },
      { type: 'infanteria',     callsign: 'CASTILLO-2', dx:   2, dy: 66 },
      { type: 'reconocimiento', callsign: 'GALGO-3',    dx:  50, dy: 40 }
    ];

    roster.forEach(function (entry) {
      var spot = OP.Map.nearestWalkablePoint(hq.x + entry.dx, hq.y + entry.dy);
      if (!spot) spot = { x: hq.x, y: hq.y };
      units.add({ type: entry.type, callsign: entry.callsign, x: spot.x, y: spot.y });
    });
  }

  /* ---------------------------------------------------------------------------
   * 4. REDIMENSIONADO
   * ------------------------------------------------------------------------ */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || window.innerWidth;
    var cssH = canvas.clientHeight || window.innerHeight;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    camera.resize(cssW, cssH, dpr);
  }

  /* ---------------------------------------------------------------------------
   * 5. ENTRADA
   * ------------------------------------------------------------------------ */

  function bindEvents() {
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', function () { input.mouse.inside = false; });
    canvas.addEventListener('mouseenter', function () { input.mouse.inside = true; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () {
      input.keys = Object.create(null);
      input.spaceHeld = false;
      input.panning = false;
    });
  }

  function localPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onMouseDown(event) {
    var p = localPoint(event);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.inside = true;

    // Botón central, o Espacio/Ctrl + botón izquierdo → desplazar cámara.
    if (event.button === 1 || (event.button === 0 && (input.spaceHeld || event.ctrlKey))) {
      event.preventDefault();
      input.panning = true;
      input.panLast.x = p.x;
      input.panLast.y = p.y;
      canvas.classList.add('grabbing');
      return;
    }

    if (event.button === 0) {
      var w = camera.screenToWorld(p.x, p.y);
      input.box = {
        startWorld: w,
        endWorld: { x: w.x, y: w.y },
        startScreen: { x: p.x, y: p.y },
        moved: false,
        additive: event.shiftKey
      };
    }
  }

  function onMouseMove(event) {
    var p = localPoint(event);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.world = camera.screenToWorld(p.x, p.y);

    if (input.panning) {
      camera.panByScreen(p.x - input.panLast.x, p.y - input.panLast.y);
      input.panLast.x = p.x;
      input.panLast.y = p.y;
      return;
    }

    if (input.box) {
      input.box.endWorld = camera.screenToWorld(p.x, p.y);
      var dx = p.x - input.box.startScreen.x;
      var dy = p.y - input.box.startScreen.y;
      if (dx * dx + dy * dy > 36) input.box.moved = true;
    }
  }

  function onMouseUp(event) {
    if (input.panning && (event.button === 1 || event.button === 0)) {
      input.panning = false;
      canvas.classList.remove('grabbing');
      return;
    }

    if (event.button !== 0 || !input.box) return;

    var box = input.box;
    input.box = null;

    if (box.moved) {
      var count = units.selectInRect(
        box.startWorld.x, box.startWorld.y,
        box.endWorld.x, box.endWorld.y,
        box.additive
      );
      if (count === 0 && !box.additive) notify('Ninguna unidad en el área marcada.', 'info');
    } else {
      var picked = units.selectAt(box.endWorld.x, box.endWorld.y, camera, box.additive);
      if (!picked && !box.additive) {
        var city = cityNear(box.endWorld.x, box.endWorld.y);
        if (city) notify('Nodo: ' + city.name + ' · ' + cityRoleLabel(city), 'info');
      }
    }
    refreshSelectionPanel();
  }

  function onContextMenu(event) {
    event.preventDefault();
    var p = localPoint(event);
    var w = camera.screenToWorld(p.x, p.y);

    var result = units.issueMoveOrder(w.x, w.y);

    if (result.reason === 'sin-seleccion') {
      notify('Selecciona al menos una unidad antes de dar la orden.', 'warn');
      addMarker(w.x, w.y, 'bad');
      return;
    }

    if (result.ordered > 0) {
      addMarker(w.x, w.y, result.relocated ? 'adjusted' : 'good');
      if (result.reason === 'destino-en-mar') {
        notify('Destino en el mar: reasignado al punto de costa más próximo.', 'warn');
      } else if (result.reason === 'destino-ajustado') {
        notify('Destino demasiado pegado a la costa: reasignado tierra adentro.', 'warn');
      } else if (result.failed > 0) {
        notify(result.failed + ' unidad(es) sin ruta terrestre hasta el destino.', 'warn');
      }
    } else {
      addMarker(w.x, w.y, 'bad');
      notify(result.reason === 'destino-inalcanzable'
        ? 'Destino inalcanzable: no hay costa navegable cerca.'
        : 'Sin ruta terrestre: el destino está al otro lado del mar.', 'error');
    }
    refreshSelectionPanel();
  }

  function onWheel(event) {
    event.preventDefault();
    var p = localPoint(event);
    var factor = Math.pow(0.9988, event.deltaY * (event.deltaMode === 1 ? 16 : 1));
    camera.zoomAt(p.x, p.y, factor);
  }

  /* --- Táctil: un dedo desplaza, dos dedos hacen zoom ----------------------- */

  function touchPoint(touch) {
    var rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function onTouchStart(event) {
    event.preventDefault();
    if (event.touches.length === 1) {
      input.touch.mode = 'pan';
      input.touch.lastA = touchPoint(event.touches[0]);
    } else if (event.touches.length >= 2) {
      input.touch.mode = 'zoom';
      var a = touchPoint(event.touches[0]), b = touchPoint(event.touches[1]);
      input.touch.lastA = a;
      input.touch.lastB = b;
      input.touch.lastDist = Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    if (input.touch.mode === 'pan' && event.touches.length === 1) {
      var p = touchPoint(event.touches[0]);
      camera.panByScreen(p.x - input.touch.lastA.x, p.y - input.touch.lastA.y);
      input.touch.lastA = p;
    } else if (input.touch.mode === 'zoom' && event.touches.length >= 2) {
      var a = touchPoint(event.touches[0]), b = touchPoint(event.touches[1]);
      var dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (input.touch.lastDist > 0) {
        camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / input.touch.lastDist);
      }
      input.touch.lastDist = dist;
    }
  }

  function onTouchEnd(event) {
    if (event.touches.length === 0) input.touch.mode = null;
  }

  /* --- Teclado -------------------------------------------------------------- */

  function onKeyDown(event) {
    var code = event.code;
    input.keys[code] = true;

    if (code === 'Space') {
      input.spaceHeld = true;
      event.preventDefault();
      canvas.classList.add('grab');
      return;
    }

    if (code === 'KeyG') { showNavGrid = !showNavGrid; notify('Malla de navegación: ' + (showNavGrid ? 'visible' : 'oculta'), 'info'); }
    else if (code === 'KeyH') { showHud = !showHud; hud.root.classList.toggle('hidden', !showHud); }
    else if (code === 'KeyF') { var hq = OP.Map.cityById('madrid'); camera.centerOn(hq.x, hq.y); notify('Cámara centrada en el CG de Madrid.', 'info'); }
    else if (code === 'KeyX') { var n = units.stopSelected(); if (n) notify('Alto ordenado a ' + n + ' unidad(es).', 'info'); refreshSelectionPanel(); }
    else if (code === 'Escape') { units.clearSelection(); refreshSelectionPanel(); }
    else if (code === 'KeyA' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      units.selectAll();
      refreshSelectionPanel();
    } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      var idx = parseInt(code.slice(5), 10) - 1;
      if (units.units[idx]) {
        if (!event.shiftKey) units.clearSelection();
        units.units[idx].selected = true;
        refreshSelectionPanel();
      }
    }
  }

  function onKeyUp(event) {
    input.keys[event.code] = false;
    if (event.code === 'Space') {
      input.spaceHeld = false;
      canvas.classList.remove('grab');
    }
  }

  /** Desplazamiento con WASD / flechas y zoom con +/−. */
  function applyKeyboardCamera(dt) {
    var speed = 700 / camera.zoom * dt;
    var dx = 0, dy = 0;
    if (input.keys.KeyA || input.keys.ArrowLeft) dx -= speed;
    if (input.keys.KeyD || input.keys.ArrowRight) dx += speed;
    if (input.keys.KeyW || input.keys.ArrowUp) dy -= speed;
    if (input.keys.KeyS || input.keys.ArrowDown) dy += speed;
    if (dx || dy) {
      camera.x += dx;
      camera.y += dy;
      camera.clampToWorld();
    }
    var zf = 1;
    if (input.keys.Equal || input.keys.NumpadAdd || input.keys.KeyE) zf = 1 + 1.4 * dt;
    if (input.keys.Minus || input.keys.NumpadSubtract || input.keys.KeyQ) zf = 1 - 1.4 * dt;
    if (zf !== 1) camera.zoomAt(camera.viewWidth / 2, camera.viewHeight / 2, zf);
  }

  /* ---------------------------------------------------------------------------
   * 6. MARCADORES Y AVISOS
   * ------------------------------------------------------------------------ */

  function addMarker(x, y, kind) {
    markers.push({ x: x, y: y, kind: kind, life: 0, ttl: 0.9 });
  }

  function updateMarkers(dt) {
    for (var i = markers.length - 1; i >= 0; i--) {
      markers[i].life += dt;
      if (markers[i].life >= markers[i].ttl) markers.splice(i, 1);
    }
  }

  function drawMarkers(ctx2) {
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var t = m.life / m.ttl;
      var r = (6 + 22 * t) / camera.zoom;
      var alpha = 1 - t;
      var color = m.kind === 'bad' ? '255, 96, 80'
                : m.kind === 'adjusted' ? '255, 198, 96'
                : '158, 240, 201';
      ctx2.strokeStyle = 'rgba(' + color + ', ' + (alpha * 0.9).toFixed(3) + ')';
      ctx2.lineWidth = 2 / camera.zoom;
      ctx2.beginPath();
      ctx2.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx2.stroke();
    }
  }

  var toastTimer = null;

  function notify(text, kind, duration) {
    if (!hud.toast) return;
    hud.toast.textContent = text;
    hud.toast.className = 'visible ' + (kind || 'info');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hud.toast.className = ''; }, duration || 2800);
  }

  /* ---------------------------------------------------------------------------
   * 7. HUD
   * ------------------------------------------------------------------------ */

  function cityNear(wx, wy) {
    var best = null, bestD = Infinity;
    var tol = 16 / camera.zoom;
    var cities = OP.Map.cities;
    for (var i = 0; i < cities.length; i++) {
      var dx = cities[i].x - wx, dy = cities[i].y - wy;
      var d = dx * dx + dy * dy;
      if (d < tol * tol && d < bestD) { bestD = d; best = cities[i]; }
    }
    return best;
  }

  function cityRoleLabel(city) {
    if (city.role === 'hq') return 'Cuartel General';
    if (city.role === 'plaza') return 'plaza de soberanía';
    if (city.role === 'hostile') return 'enclave del Consorcio Poniente';
    return 'nodo urbano';
  }

  function formatCoords(wx, wy) {
    var lon = OP.Map.lonAt(wx), lat = OP.Map.latAt(wy);
    var ns = lat >= 0 ? 'N' : 'S';
    var ew = lon >= 0 ? 'E' : 'O';
    return Math.abs(lat).toFixed(2) + '° ' + ns + '  ' + Math.abs(lon).toFixed(2) + '° ' + ew;
  }

  function terrainLabel(wx, wy) {
    if (wx < WORLD.minX || wx > WORLD.maxX || wy < WORLD.minY || wy > WORLD.maxY) {
      return 'fuera del teatro';
    }
    var mass = OP.Map.landmassAt(wx, wy);
    if (!mass) return 'mar — intransitable';
    var name = mass.shortName || mass.name;
    if (!mass.navigable) return name + ' — fuera de operaciones';
    if (!OP.Map.isWalkable(wx, wy)) return name + ' — franja costera';
    return name + ' — transitable';
  }

  var selectionSignature = null;

  /**
   * Vuelca la selección al panel. Se llama en cada fotograma, pero sólo toca el
   * DOM cuando cambia la firma (unidades y estados), así que no cuesta nada.
   */
  function refreshSelectionPanel() {
    var sel = units.selected();
    var signature = sel.map(function (u) { return u.callsign + ':' + u.status; }).join('|')
      + '/' + units.units.length;
    if (signature === selectionSignature) return;
    selectionSignature = signature;

    hud.selectionCount.textContent = sel.length + ' / ' + units.units.length;

    if (!sel.length) {
      hud.selection.innerHTML = '<li class="empty">Sin unidades seleccionadas</li>';
      return;
    }

    hud.selection.innerHTML = sel.map(function (u) {
      return '<li>' +
        '<span class="callsign">' + escapeHtml(u.callsign) + '</span>' +
        '<span class="utype">' + escapeHtml(u.type.name) + '</span>' +
        '<span class="ustatus">' + escapeHtml(u.status) + '</span>' +
        '</li>';
    }).join('');
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------------------------
   * 8. BUCLE PRINCIPAL
   * ------------------------------------------------------------------------ */

  var lastTime = 0;

  function frame(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;

    applyKeyboardCamera(dt);
    units.update(dt);
    updateMarkers(dt);
    render();

    stats.frames++;
    stats.acc += dt;
    if (stats.acc >= 0.5) {
      stats.fps = Math.round(stats.frames / stats.acc);
      stats.frames = 0;
      stats.acc = 0;
      hud.fps.textContent = stats.fps + ' fps';
    }

    hud.cursor.textContent = formatCoords(input.world.x, input.world.y);
    hud.terrain.textContent = terrainLabel(input.world.x, input.world.y);
    hud.zoom.textContent = '×' + camera.zoom.toFixed(2);

    refreshSelectionPanel();

    requestAnimationFrame(frame);
  }

  function render() {
    // Limpieza en espacio dispositivo.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OP.Map.PALETTE.seaDeep;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --- Capas en espacio mundo ---
    camera.applyTransform(ctx);
    OP.Map.drawSea(ctx, camera);
    OP.Map.drawLand(ctx, camera);
    OP.Map.drawGraticule(ctx, camera);
    if (showNavGrid) OP.Map.drawNavGrid(ctx, camera);
    OP.Map.drawRoutes(ctx, camera);
    units.drawPaths(ctx, camera);
    drawMarkers(ctx);
    OP.Map.drawCities(ctx, camera);

    // --- Capas en espacio pantalla ---
    OP.Map.drawRegionLabels(ctx, camera);
    units.drawSymbols(ctx, camera);
    drawSelectionBox();
  }

  function drawSelectionBox() {
    if (!input.box || !input.box.moved) return;
    var a = camera.worldToScreen(input.box.startWorld.x, input.box.startWorld.y);
    var b = camera.worldToScreen(input.box.endWorld.x, input.box.endWorld.y);

    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillStyle = 'rgba(158, 240, 201, 0.10)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(158, 240, 201, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.restore();
  }

  /* ---------------------------------------------------------------------------
   * 9. API DE DEPURACIÓN
   * ------------------------------------------------------------------------ */

  OP.Game = {
    camera: camera,
    units: units,
    notify: notify,
    toggleNavGrid: function () { showNavGrid = !showNavGrid; return showNavGrid; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(OP);
