/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/art.js — Fábrica de sprites procedurales.
 *
 * No hay archivos de imagen: todo el arte se dibuja con canvas al arrancar y se
 * cachea en mapas de bits fuera de pantalla. Terreno, vegetación y edificios son
 * sprites sueltos; las unidades se hornean en atlas de 8 direcciones × N
 * fotogramas.
 *
 * Paleta: meseta castellana en verano — pasto agostado, ocres, olivo y encina.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var TILE_W = 64, TILE_H = 32;
  var PX = 32, PY = 16, PZ = 30;   // escalas de proyección para modelos

  /* ---------------------------------------------------------------------------
   * 1. UTILIDADES
   * ------------------------------------------------------------------------ */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Generador pseudoaleatorio determinista (xorshift32). */
  function rng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) {
      r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount;
    } else {
      r *= (1 + amount); g *= (1 + amount); b *= (1 + amount);
    }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function diamond(ctx, cx, cy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  /** Sprite con punto de anclaje: (ax, ay) es el punto que pisa el suelo. */
  function sprite(canvas, ax, ay) { return { img: canvas, ax: ax, ay: ay }; }

  /* ---------------------------------------------------------------------------
   * 2. TERRENO
   * ------------------------------------------------------------------------ */

  var TERRAIN = {
    pasto:   { base: '#6f8446', fleck: ['#7f9553', '#5e7339', '#8aa05e'], prio: 4, blades: true },
    secano:  { base: '#a89b5e', fleck: ['#b9ad6f', '#948750', '#c6ba7e'], prio: 3, blades: true },
    tierra:  { base: '#9a7b4e', fleck: ['#aa8b5c', '#856843', '#b59a71'], prio: 2 },
    arena:   { base: '#d3bf8b', fleck: ['#e0cf9e', '#bfa976'], prio: 1 },
    agua:    { base: '#2d6a86', fleck: [], prio: 0 },
    matorral:{ base: '#6b7a42', fleck: ['#7b8a4f', '#5a6836', '#899a5c'], prio: 5, blades: true }
  };

  var VARIANTS = 4;

  /** Punto medio de cada lado del rombo, en el orden de EDGE_NEIGHBOUR. */
  var EDGE_MIDPOINT = [
    { x: TILE_W * 0.75, y: TILE_H * 0.75 },   // 0: +gx → sureste
    { x: TILE_W * 0.25, y: TILE_H * 0.75 },   // 1: +gy → suroeste
    { x: TILE_W * 0.25, y: TILE_H * 0.25 },   // 2: -gx → noroeste
    { x: TILE_W * 0.75, y: TILE_H * 0.25 }    // 3: -gy → noreste
  ];

  function paintTile(type, variant) {
    var def = TERRAIN[type];
    var c = makeCanvas(TILE_W, TILE_H);
    var x = c.getContext('2d');
    var rand = rng(variant * 7919 + type.length * 104729 + type.charCodeAt(0) * 31);

    x.save();
    diamond(x, TILE_W / 2, TILE_H / 2, TILE_W / 2, TILE_H / 2);
    x.clip();

    if (type === 'agua') {
      var g = x.createLinearGradient(0, 0, 0, TILE_H);
      g.addColorStop(0, '#35799a');
      g.addColorStop(1, '#255a76');
      x.fillStyle = g;
      x.fillRect(0, 0, TILE_W, TILE_H);
      // Ondas suaves.
      x.strokeStyle = 'rgba(180, 225, 240, 0.16)';
      x.lineWidth = 1;
      for (var w = 0; w < 3; w++) {
        var wy = 6 + rand() * 20;
        x.beginPath();
        x.moveTo(0, wy);
        x.bezierCurveTo(16, wy - 2.2, 32, wy + 2.2, 48, wy - 1.4);
        x.lineTo(TILE_W, wy + 0.6);
        x.stroke();
      }
    } else {
      x.fillStyle = def.base;
      x.fillRect(0, 0, TILE_W, TILE_H);

      // Manchas amplias: rompen la uniformidad del color plano.
      for (var m = 0; m < 5; m++) {
        x.fillStyle = def.fleck[(rand() * def.fleck.length) | 0];
        x.globalAlpha = 0.22 + rand() * 0.2;
        x.beginPath();
        x.ellipse(rand() * TILE_W, rand() * TILE_H,
                  6 + rand() * 12, 3 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
        x.fill();
      }
      x.globalAlpha = 1;

      // Grano fino.
      for (var s = 0; s < 90; s++) {
        x.fillStyle = def.fleck[(rand() * def.fleck.length) | 0];
        x.globalAlpha = 0.3 + rand() * 0.45;
        x.fillRect((rand() * TILE_W) | 0, (rand() * TILE_H) | 0, 1, 1);
      }

      // Briznas: pequeños trazos verticales que dan textura de pasto.
      if (def.blades) {
        x.globalAlpha = 0.5;
        x.lineWidth = 1;
        for (var b = 0; b < 26; b++) {
          var bx = rand() * TILE_W, by = 4 + rand() * (TILE_H - 6);
          x.strokeStyle = def.fleck[(rand() * def.fleck.length) | 0];
          x.beginPath();
          x.moveTo(bx, by);
          x.lineTo(bx + (rand() - 0.5) * 2, by - 1.5 - rand() * 2);
          x.stroke();
        }
      }
      x.globalAlpha = 1;
    }

    x.restore();
    return c;
  }

  /**
   * Fleco de transición: mancha del terreno `type` desvaída hacia uno de los
   * cuatro bordes del rombo, para dibujar encima del tile vecino y que la
   * frontera entre terrenos no sea un filo recto.
   * El índice de borde sigue al vecino: 0 = +gx (sureste), 1 = +gy (suroeste),
   * 2 = -gx (noroeste), 3 = -gy (noreste).
   */
  function paintFringe(type, edge) {
    var def = TERRAIN[type];
    var c = makeCanvas(TILE_W, TILE_H);
    var x = c.getContext('2d');
    var rand = rng(edge * 104729 + type.charCodeAt(1) * 7919 + 13);

    // Punto medio del borde elegido, hacia donde se concentra la mancha.
    var mid = EDGE_MIDPOINT[edge];

    x.save();
    diamond(x, TILE_W / 2, TILE_H / 2, TILE_W / 2, TILE_H / 2);
    x.clip();

    var colors = def.fleck.length ? def.fleck : [def.base];
    for (var i = 0; i < 120; i++) {
      var t = rand();
      // Reparto sesgado hacia el borde: t² acerca la mayoría de las manchas.
      var px_ = mid.x + (rand() - 0.5) * TILE_W * (0.7 + t * 1.2);
      var py_ = mid.y + (rand() - 0.5) * TILE_H * (0.7 + t * 1.2);
      var d = Math.hypot(px_ - mid.x, (py_ - mid.y) * 2) / (TILE_W * 0.92);
      var alpha = Math.max(0, 1 - d * d) * 0.95;
      if (alpha <= 0.02) continue;
      x.globalAlpha = alpha;
      x.fillStyle = i % 4 === 0 ? def.base : colors[(rand() * colors.length) | 0];
      x.beginPath();
      x.ellipse(px_, py_, 2.2 + rand() * 5.5, 1.3 + rand() * 3.0, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
    return c;
  }

  /**
   * Capa de nubes: manchas suaves de luz y sombra que se repiten sin costura.
   * Superpuesta al terreno en coordenadas de mundo, rompe la cuadrícula de
   * rombos, que es lo que delata que el suelo son tiles.
   */
  function makeCloud(size, blobs, seed) {
    var c = makeCanvas(size, size), x = c.getContext('2d');
    var rand = rng(seed);
    for (var i = 0; i < blobs; i++) {
      var bx = rand() * size, by = rand() * size;
      var r = size * (0.10 + rand() * 0.26);
      var light = rand() > 0.45;
      var col = light ? '255, 248, 214' : '26, 32, 14';
      var peak = light ? 0.085 : 0.115;
      // Se dibuja nueve veces en rejilla 3×3 para que el patrón case al repetirse.
      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          var cx = bx + ox * size, cy = by + oy * size;
          var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(' + col + ', ' + peak + ')');
          g.addColorStop(1, 'rgba(' + col + ', 0)');
          x.fillStyle = g;
          x.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }
    }
    return c;
  }

  /**
   * Orilla: se dibuja sobre un tile de agua que linda con tierra por ese lado.
   * Un bajío claro más una línea de espuma disimulan el escalonado del rombo,
   * que es lo que delata la rejilla en la línea de costa.
   */
  function paintShore(edge) {
    var mid = EDGE_MIDPOINT[edge];
    var c = makeCanvas(TILE_W, TILE_H);
    var x = c.getContext('2d');
    var rand = rng(edge * 20011 + 5);
    var cx = TILE_W / 2, cy = TILE_H / 2;

    x.save();
    diamond(x, cx, cy, cx, cy);
    x.clip();

    // Bajío: agua más clara según se acerca a la orilla.
    var g = x.createRadialGradient(mid.x, mid.y, 1, mid.x, mid.y, TILE_W * 0.62);
    g.addColorStop(0, 'rgba(146, 199, 205, 0.85)');
    g.addColorStop(0.45, 'rgba(86, 156, 173, 0.45)');
    g.addColorStop(1, 'rgba(86, 156, 173, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, TILE_W, TILE_H);

    // Espuma: salpicaduras claras muy pegadas al borde.
    for (var i = 0; i < 34; i++) {
      var t = rand();
      var px_ = mid.x + (rand() - 0.5) * TILE_W * (0.25 + t * 0.5);
      var py_ = mid.y + (rand() - 0.5) * TILE_H * (0.25 + t * 0.5);
      var d = Math.hypot(px_ - mid.x, (py_ - mid.y) * 2) / (TILE_W * 0.34);
      x.globalAlpha = Math.max(0, 1 - d * d) * 0.75;
      x.fillStyle = '#e2f2f2';
      x.beginPath();
      x.ellipse(px_, py_, 1.2 + rand() * 2.6, 0.8 + rand() * 1.4, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
    return c;
  }

  /* ---------------------------------------------------------------------------
   * 3. VEGETACIÓN Y ROCAS
   * ------------------------------------------------------------------------ */

  function groundShadow(x, cx, cy, rx, ry, alpha) {
    x.globalAlpha = alpha == null ? 0.26 : alpha;
    x.fillStyle = '#1d2410';
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    x.fill();
    x.globalAlpha = 1;
  }

  /** Pino carrasco: tronco desnudo y copa en tres pisos. */
  function paintPine(variant) {
    var W = 72, H = 104, ax = W / 2, ay = H - 10;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 7723 + 41);
    var scale = 0.82 + rand() * 0.36;
    var trunkH = 26 * scale;

    groundShadow(x, ax + 3, ay + 1, 15 * scale, 7 * scale);

    x.strokeStyle = '#5a4227';
    x.lineWidth = 4.2 * scale;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(ax, ay);
    x.lineTo(ax + (rand() - 0.5) * 4, ay - trunkH);
    x.stroke();

    var tiers = 3;
    for (var t = 0; t < tiers; t++) {
      var ty = ay - trunkH - t * 16 * scale;
      var tw = (30 - t * 7) * scale;
      var th = (17 - t * 3) * scale;
      x.fillStyle = ['#3c5a2c', '#44653220', '#4a6f37'][t % 3] || '#416030';
      x.fillStyle = t === 0 ? '#3a5729' : (t === 1 ? '#436331' : '#4b6f38');
      x.beginPath();
      x.moveTo(ax, ty - th * 1.7);
      x.lineTo(ax + tw, ty + th * 0.5);
      x.quadraticCurveTo(ax, ty + th * 1.05, ax - tw, ty + th * 0.5);
      x.closePath();
      x.fill();
      // Luz por la izquierda.
      x.fillStyle = 'rgba(150, 190, 110, 0.22)';
      x.beginPath();
      x.moveTo(ax, ty - th * 1.7);
      x.lineTo(ax - tw, ty + th * 0.5);
      x.quadraticCurveTo(ax - tw * 0.4, ty + th * 0.85, ax - tw * 0.15, ty + th * 0.6);
      x.closePath();
      x.fill();
    }
    return sprite(c, ax, ay);
  }

  /** Olivo: tronco retorcido y copa plateada y redondeada. */
  function paintOlive(variant) {
    var W = 76, H = 88, ax = W / 2, ay = H - 10;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 3301 + 97);
    var scale = 0.85 + rand() * 0.3;

    groundShadow(x, ax + 4, ay + 1, 17 * scale, 8 * scale);

    x.strokeStyle = '#6b5b41';
    x.lineWidth = 5 * scale;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(ax, ay);
    x.quadraticCurveTo(ax - 4 * scale, ay - 12 * scale, ax + 2 * scale, ay - 20 * scale);
    x.stroke();
    x.lineWidth = 2.6 * scale;
    x.beginPath();
    x.moveTo(ax + 2 * scale, ay - 18 * scale);
    x.lineTo(ax - 8 * scale, ay - 27 * scale);
    x.moveTo(ax + 2 * scale, ay - 18 * scale);
    x.lineTo(ax + 10 * scale, ay - 28 * scale);
    x.stroke();

    var blobs = [
      { dx: 0, dy: -36, r: 19, c: '#77894f' },
      { dx: -13, dy: -29, r: 14, c: '#6a7c46' },
      { dx: 13, dy: -30, r: 14.5, c: '#82945a' },
      { dx: -3, dy: -45, r: 12.5, c: '#8a9c62' }
    ];
    blobs.forEach(function (b) {
      x.fillStyle = b.c;
      x.beginPath();
      x.ellipse(ax + b.dx * scale, ay + b.dy * scale, b.r * scale, b.r * 0.82 * scale, 0, 0, Math.PI * 2);
      x.fill();
    });
    // Reflejo plateado característico del olivo.
    x.globalAlpha = 0.3;
    x.fillStyle = '#c3cfa2';
    for (var i = 0; i < 16; i++) {
      x.beginPath();
      x.ellipse(ax + (rand() - 0.65) * 26 * scale, ay - (26 + rand() * 22) * scale,
                2 + rand() * 3, 1.4 + rand() * 1.8, rand() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
    return sprite(c, ax, ay);
  }

  /** Matorral bajo: tomillo, retama, jara. */
  function paintScrub(variant) {
    var W = 48, H = 40, ax = W / 2, ay = H - 6;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 1543 + 7);
    groundShadow(x, ax + 2, ay, 11, 5, 0.2);
    for (var i = 0; i < 5; i++) {
      x.fillStyle = ['#6d7c44', '#7d8c52', '#5f6d3a', '#87955d'][(rand() * 4) | 0];
      x.beginPath();
      x.ellipse(ax + (rand() - 0.5) * 20, ay - 4 - rand() * 9,
                4 + rand() * 6, 3 + rand() * 4, 0, 0, Math.PI * 2);
      x.fill();
    }
    return sprite(c, ax, ay);
  }

  /** Afloramiento calizo. */
  function paintRock(variant) {
    var W = 56, H = 48, ax = W / 2, ay = H - 6;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 6577 + 3);
    groundShadow(x, ax + 3, ay, 15, 7, 0.24);
    for (var i = 0; i < 3; i++) {
      var bx = ax + (rand() - 0.5) * 18, by = ay - rand() * 5;
      var w = 9 + rand() * 9, h = 8 + rand() * 10;
      x.fillStyle = '#8d8878';
      x.beginPath();
      x.moveTo(bx - w, by);
      x.lineTo(bx - w * 0.6, by - h);
      x.lineTo(bx + w * 0.3, by - h * 1.15);
      x.lineTo(bx + w, by - h * 0.35);
      x.lineTo(bx + w * 0.7, by);
      x.closePath();
      x.fill();
      x.fillStyle = '#a8a292';
      x.beginPath();
      x.moveTo(bx - w * 0.6, by - h);
      x.lineTo(bx + w * 0.3, by - h * 1.15);
      x.lineTo(bx + w * 0.1, by - h * 0.55);
      x.lineTo(bx - w * 0.75, by - h * 0.45);
      x.closePath();
      x.fill();
    }
    return sprite(c, ax, ay);
  }

  /** Pila de cajas de munición. */
  function paintCrate(variant) {
    var W = 52, H = 48, ax = W / 2, ay = H - 8;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 8161 + 11);
    groundShadow(x, ax + 3, ay, 14, 7, 0.26);

    var stack = 2 + ((rand() * 2) | 0);
    for (var i = 0; i < stack; i++) {
      var by = ay - i * 9 - 2;
      var bx = ax + (rand() - 0.5) * 7;
      var w = 11, h = 6, tall = 9;
      var top = [{ x: bx, y: by - h - tall }, { x: bx + w, y: by - tall },
                 { x: bx, y: by + h - tall }, { x: bx - w, y: by - tall }];
      quad(x, { x: bx - w, y: by - tall }, { x: bx, y: by + h - tall },
              { x: bx, y: by + h }, { x: bx - w, y: by }, '#8b6f42');
      quad(x, { x: bx, y: by + h - tall }, { x: bx + w, y: by - tall },
              { x: bx + w, y: by }, { x: bx, y: by + h }, '#6d5733');
      quad(x, top[0], top[1], top[2], top[3], '#a38554', '#54431f');
    }
    return sprite(c, ax, ay);
  }

  /** Bidones de combustible. */
  function paintBarrel(variant) {
    var W = 46, H = 44, ax = W / 2, ay = H - 8;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 4099 + 29);
    groundShadow(x, ax + 3, ay, 12, 6, 0.24);
    var n = 2 + ((rand() * 2) | 0);
    for (var i = 0; i < n; i++) {
      var bx = ax + (i - (n - 1) / 2) * 9 + (rand() - 0.5) * 3;
      var by = ay - (rand() * 3);
      var tall = 13;
      x.fillStyle = '#5f6a4c';
      x.beginPath();
      x.moveTo(bx - 5, by - 3); x.lineTo(bx - 5, by - 3 - tall);
      x.lineTo(bx + 5, by - 3 - tall); x.lineTo(bx + 5, by - 3);
      x.closePath(); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.22)';
      x.fillRect(bx + 1, by - 3 - tall, 4, tall);
      x.fillStyle = '#78855e';
      x.beginPath(); x.ellipse(bx, by - 3 - tall, 5, 2.4, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.28)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(bx - 5, by - 3 - tall * 0.62); x.lineTo(bx + 5, by - 3 - tall * 0.62);
      x.stroke();
    }
    return sprite(c, ax, ay);
  }

  /** Parapeto de sacos terreros. */
  function paintSandbags(variant) {
    var W = 76, H = 44, ax = W / 2, ay = H - 8;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 2557 + 61);
    groundShadow(x, ax + 3, ay, 26, 9, 0.24);
    for (var row = 0; row < 3; row++) {
      for (var i = 0; i < 7 - row; i++) {
        var bx = ax - 26 + i * 8.4 + row * 4.2 + (rand() - 0.5) * 1.5;
        var by = ay - 4 - row * 5.4;
        // Las filas siguen la diagonal del rombo, como un muro isométrico.
        var slope = (bx - ax) * 0.5 * (TILE_H / TILE_W) * 2;
        x.fillStyle = (i + row) % 2 ? '#a2946a' : '#8e815a';
        x.strokeStyle = 'rgba(60, 52, 30, 0.5)';
        x.lineWidth = 0.8;
        x.beginPath();
        x.ellipse(bx, by + slope, 5.4, 3.4, 0, 0, Math.PI * 2);
        x.fill(); x.stroke();
      }
    }
    return sprite(c, ax, ay);
  }

  /** Almendro: copa clara y fruto visible. Fuente de víveres. */
  function paintFruitTree(variant) {
    var W = 70, H = 84, ax = W / 2, ay = H - 10;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 5381 + 71);
    var scale = 0.88 + rand() * 0.26;

    groundShadow(x, ax + 4, ay + 1, 16 * scale, 8 * scale);

    x.strokeStyle = '#7a6349';
    x.lineWidth = 4.4 * scale;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(ax, ay);
    x.lineTo(ax + 1 * scale, ay - 18 * scale);
    x.stroke();
    x.lineWidth = 2.2 * scale;
    x.beginPath();
    x.moveTo(ax + 1 * scale, ay - 16 * scale);
    x.lineTo(ax - 9 * scale, ay - 25 * scale);
    x.moveTo(ax + 1 * scale, ay - 16 * scale);
    x.lineTo(ax + 10 * scale, ay - 24 * scale);
    x.stroke();

    [{ dx: 0, dy: -33, r: 18, c: '#8aa04f' },
     { dx: -12, dy: -27, r: 13, c: '#7d9345' },
     { dx: 12, dy: -28, r: 13.5, c: '#96ab5c' },
     { dx: -2, dy: -41, r: 12, c: '#9fb464' }].forEach(function (b) {
      x.fillStyle = b.c;
      x.beginPath();
      x.ellipse(ax + b.dx * scale, ay + b.dy * scale, b.r * scale, b.r * 0.84 * scale, 0, 0, Math.PI * 2);
      x.fill();
    });

    // Fruto: puntos claros que distinguen el frutal del olivo de un vistazo.
    x.fillStyle = '#e8c87a';
    for (var i = 0; i < 13; i++) {
      x.beginPath();
      x.arc(ax + (rand() - 0.5) * 30 * scale, ay - (22 + rand() * 24) * scale,
            1.5 + rand() * 1.1, 0, Math.PI * 2);
      x.fill();
    }
    return sprite(c, ax, ay);
  }

  /** Tocón: lo que queda de un árbol talado. */
  function paintStump(variant) {
    var W = 34, H = 28, ax = W / 2, ay = H - 6;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 911 + 13);
    groundShadow(x, ax + 2, ay, 9, 4.5, 0.2);
    x.fillStyle = '#6b573a';
    x.beginPath();
    x.moveTo(ax - 5, ay - 2); x.lineTo(ax - 5, ay - 7);
    x.lineTo(ax + 5, ay - 7); x.lineTo(ax + 5, ay - 2);
    x.closePath(); x.fill();
    x.fillStyle = '#9b8259';
    x.beginPath(); x.ellipse(ax, ay - 7, 5.2, 2.6, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#7d6844';
    x.lineWidth = 0.8;
    x.beginPath(); x.ellipse(ax, ay - 7, 2.8, 1.4, 0, 0, Math.PI * 2); x.stroke();
    // Astillas alrededor.
    x.fillStyle = '#8a7350';
    for (var i = 0; i < 4; i++) {
      x.fillRect(ax + (rand() - 0.5) * 18, ay - rand() * 3, 2.5, 1.2);
    }
    return sprite(c, ax, ay);
  }

  /** Montón de chatarra: carrocerías y vigas. Fuente de metal. */
  function paintScrap(variant) {
    var W = 72, H = 56, ax = W / 2, ay = H - 8;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    var rand = rng(variant * 7549 + 23);
    groundShadow(x, ax + 4, ay, 22, 10, 0.26);

    // Carrocería volcada.
    var bx = ax - 4, by = ay - 3;
    x.fillStyle = '#6d6257';
    x.beginPath();
    x.moveTo(bx - 17, by - 2); x.lineTo(bx - 9, by - 13);
    x.lineTo(bx + 11, by - 13); x.lineTo(bx + 18, by - 1);
    x.lineTo(bx + 9, by + 5); x.lineTo(bx - 10, by + 5);
    x.closePath(); x.fill();
    x.fillStyle = '#877a6c';
    x.beginPath();
    x.moveTo(bx - 9, by - 13); x.lineTo(bx + 11, by - 13);
    x.lineTo(bx + 6, by - 18); x.lineTo(bx - 5, by - 18);
    x.closePath(); x.fill();
    // Óxido.
    x.fillStyle = 'rgba(150, 84, 42, 0.55)';
    for (var i = 0; i < 14; i++) {
      x.beginPath();
      x.ellipse(bx + (rand() - 0.5) * 32, by - rand() * 15, 1.5 + rand() * 3.5, 1 + rand() * 2, 0, 0, Math.PI * 2);
      x.fill();
    }
    // Vigas apiladas.
    x.strokeStyle = '#5d554b';
    x.lineWidth = 3.2;
    x.lineCap = 'round';
    for (var j = 0; j < 4; j++) {
      var jx = ax + 8 + rand() * 14, jy = ay - 2 - j * 3.2;
      x.beginPath();
      x.moveTo(jx - 12, jy + 4); x.lineTo(jx + 10, jy - 3);
      x.stroke();
    }
    return sprite(c, ax, ay);
  }

  /** Huerta: parcela roturada con caballones. Se dibuja plana sobre el suelo. */
  function paintFarm(w, h, growth) {
    var pad = 14;
    function P(gx, gy) { return { x: (gx - gy) * PX, y: (gx + gy) * PY }; }
    var corners = [P(0, 0), P(w, 0), P(w, h), P(0, h)];
    var xs = corners.map(function (p) { return p.x; });
    var ys = corners.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs) - pad, maxX = Math.max.apply(null, xs) + pad;
    var minY = Math.min.apply(null, ys) - pad, maxY = Math.max.apply(null, ys) + pad;

    var c = makeCanvas(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
    var x = c.getContext('2d');
    var ox = -minX, oy = -minY;
    var anchor = P(w / 2, h / 2);
    function T(p) { return { x: p.x + ox, y: p.y + oy }; }

    var A = T(corners[0]), B = T(corners[1]), C = T(corners[2]), D = T(corners[3]);
    quad(x, A, B, C, D, '#6f5636', 'rgba(50, 38, 22, 0.7)');

    // Caballones en la diagonal de la parcela.
    x.save();
    x.beginPath();
    x.moveTo(A.x, A.y); x.lineTo(B.x, B.y); x.lineTo(C.x, C.y); x.lineTo(D.x, D.y);
    x.closePath();
    x.clip();
    var rows = w * 4;
    for (var r = 0; r <= rows; r++) {
      var f = r / rows;
      var p1 = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f };
      var p2 = { x: D.x + (C.x - D.x) * f, y: D.y + (C.y - D.y) * f };
      x.strokeStyle = r % 2 ? 'rgba(139, 110, 70, 0.75)' : 'rgba(76, 58, 34, 0.55)';
      x.lineWidth = 2.6;
      x.beginPath(); x.moveTo(p1.x, p1.y); x.lineTo(p2.x, p2.y); x.stroke();

      // Mata verde sobre el caballón, según lo crecida que esté la huerta.
      if (growth > 0 && r % 2 === 0) {
        var n = 5;
        for (var k = 1; k < n; k++) {
          var g = k / n;
          x.fillStyle = growth > 0.6 ? '#6d8c3f' : '#7b8f52';
          x.beginPath();
          x.ellipse(p1.x + (p2.x - p1.x) * g, p1.y + (p2.y - p1.y) * g,
                    2.6 * growth, 1.8 * growth, 0, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
    x.restore();
    return sprite(c, anchor.x + ox, anchor.y + oy);
  }

  /** Andamio de obra: postes, cinta y tierra removida. */
  function paintScaffold(w, h) {
    var pad = 26, tall = 1.0;
    function P(gx, gy, gz) { return { x: (gx - gy) * PX, y: (gx + gy) * PY - (gz || 0) * PZ }; }
    var base = [P(0, 0), P(w, 0), P(w, h), P(0, h)];
    var top = [P(0, 0, tall), P(w, 0, tall), P(w, h, tall), P(0, h, tall)];
    var all = base.concat(top);
    var minX = Math.min.apply(null, all.map(function (p) { return p.x; })) - pad;
    var maxX = Math.max.apply(null, all.map(function (p) { return p.x; })) + pad;
    var minY = Math.min.apply(null, all.map(function (p) { return p.y; })) - pad;
    var maxY = Math.max.apply(null, all.map(function (p) { return p.y; })) + pad;

    var c = makeCanvas(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
    var x = c.getContext('2d');
    var ox = -minX, oy = -minY;
    var anchor = P(w / 2, h / 2);
    function T(p) { return { x: p.x + ox, y: p.y + oy }; }
    var A = T(base[0]), B = T(base[1]), C = T(base[2]), D = T(base[3]);

    // Tierra removida.
    quad(x, A, B, C, D, 'rgba(104, 82, 50, 0.85)', 'rgba(58, 44, 26, 0.8)');

    // Postes en las cuatro esquinas.
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(function (corner) {
      var b = T(P(corner[0], corner[1]));
      var t = T(P(corner[0], corner[1], tall));
      x.strokeStyle = '#8a6f45';
      x.lineWidth = 3;
      x.lineCap = 'round';
      x.beginPath(); x.moveTo(b.x, b.y); x.lineTo(t.x, t.y); x.stroke();
    });

    // Cinta de obra entre los postes.
    var tA = T(top[0]), tB = T(top[1]), tC = T(top[2]), tD = T(top[3]);
    x.setLineDash([7, 5]);
    x.strokeStyle = '#e0b23c';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(tA.x, tA.y); x.lineTo(tB.x, tB.y); x.lineTo(tC.x, tC.y);
    x.lineTo(tD.x, tD.y); x.closePath();
    x.stroke();
    x.setLineDash([]);
    return sprite(c, anchor.x + ox, anchor.y + oy);
  }

  /* ---------------------------------------------------------------------------
   * 4. EDIFICIOS
   *
   * Cajas isométricas levantadas sobre una huella de w×h tiles. Se ven siempre
   * las dos caras que concurren en la esquina frontal.
   * ------------------------------------------------------------------------ */

  function quad(x, p1, p2, p3, p4, fill, stroke) {
    x.beginPath();
    x.moveTo(p1.x, p1.y); x.lineTo(p2.x, p2.y);
    x.lineTo(p3.x, p3.y); x.lineTo(p4.x, p4.y);
    x.closePath();
    x.fillStyle = fill;
    x.fill();
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1; x.stroke(); }
  }

  function paintBuilding(spec) {
    var w = spec.w, h = spec.h, tall = spec.height;
    var pad = 30;

    // Huella proyectada: A atrás, B derecha, C frente, D izquierda.
    function P(gx, gy, gz) {
      return { x: (gx - gy) * PX, y: (gx + gy) * PY - gz * PZ };
    }
    var corners = [P(0, 0, 0), P(w, 0, 0), P(w, h, 0), P(0, h, 0)];
    var top = [P(0, 0, tall), P(w, 0, tall), P(w, h, tall), P(0, h, tall)];
    var all = corners.concat(top);
    var minX = Math.min.apply(null, all.map(function (p) { return p.x; })) - pad;
    var maxX = Math.max.apply(null, all.map(function (p) { return p.x; })) + pad;
    var minY = Math.min.apply(null, all.map(function (p) { return p.y; })) - pad - tall * 14;
    var maxY = Math.max.apply(null, all.map(function (p) { return p.y; })) + pad;

    var c = makeCanvas(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
    var x = c.getContext('2d');
    var ox = -minX, oy = -minY;
    // Anclaje: centro de la huella a nivel del suelo.
    var anchor = P(w / 2, h / 2, 0);

    function T(p) { return { x: p.x + ox, y: p.y + oy }; }
    var A = T(corners[0]), B = T(corners[1]), C = T(corners[2]), D = T(corners[3]);
    var At = T(top[0]), Bt = T(top[1]), Ct = T(top[2]), Dt = T(top[3]);

    // Sombra proyectada sobre el suelo, desplazada hacia la izquierda.
    x.globalAlpha = 0.28;
    x.fillStyle = '#25200f';
    x.beginPath();
    x.moveTo(A.x - tall * 12, A.y + 3);
    x.lineTo(B.x - tall * 12, B.y + 3);
    x.lineTo(C.x + 2, C.y + 3);
    x.lineTo(D.x + 2, D.y + 3);
    x.closePath();
    x.fill();
    x.globalAlpha = 1;

    // Zócalo.
    quad(x, A, B, C, D, shade(spec.wall, -0.5));

    var wallL = shade(spec.wall, 0.06);    // cara izquierda-frontal, iluminada
    var wallR = shade(spec.wall, -0.26);   // cara derecha-frontal, en sombra
    quad(x, D, C, Ct, Dt, wallL, shade(spec.wall, -0.45));
    quad(x, C, B, Bt, Ct, wallR, shade(spec.wall, -0.5));

    // Vetas horizontales: dan escala y textura de hormigón o chapa.
    var rand = rng(spec.seed || 17);
    x.globalAlpha = 0.14;
    for (var s = 1; s < tall * 4; s++) {
      var f = s / (tall * 4);
      var l1 = { x: D.x + (Dt.x - D.x) * f, y: D.y + (Dt.y - D.y) * f };
      var l2 = { x: C.x + (Ct.x - C.x) * f, y: C.y + (Ct.y - C.y) * f };
      var l3 = { x: B.x + (Bt.x - B.x) * f, y: B.y + (Bt.y - B.y) * f };
      x.strokeStyle = s % 2 ? '#000' : '#fff';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(l1.x, l1.y); x.lineTo(l2.x, l2.y); x.lineTo(l3.x, l3.y);
      x.stroke();
    }
    x.globalAlpha = 1;

    // Puerta en la cara izquierda-frontal.
    if (spec.door !== false) {
      var dfx = 0.42, dfy = 0.62;
      var base1 = { x: D.x + (C.x - D.x) * (dfx - 0.13), y: D.y + (C.y - D.y) * (dfx - 0.13) };
      var base2 = { x: D.x + (C.x - D.x) * (dfx + 0.13), y: D.y + (C.y - D.y) * (dfx + 0.13) };
      var up = { x: (Dt.x - D.x) * dfy * 0.55, y: (Dt.y - D.y) * dfy * 0.55 };
      quad(x,
        base1, base2,
        { x: base2.x + up.x, y: base2.y + up.y },
        { x: base1.x + up.x, y: base1.y + up.y },
        '#2b2a26');
    }

    // Ventanas o troneras.
    if (spec.windows) {
      x.fillStyle = 'rgba(232, 214, 150, 0.55)';
      for (var wi = 0; wi < spec.windows; wi++) {
        var f2 = (wi + 1) / (spec.windows + 1);
        var wb = { x: D.x + (C.x - D.x) * f2, y: D.y + (C.y - D.y) * f2 };
        var wu = { x: (Dt.x - D.x) * 0.62, y: (Dt.y - D.y) * 0.62 };
        quad(x,
          { x: wb.x - 3.4, y: wb.y - 1.7 + wu.y * 0.55 },
          { x: wb.x + 3.4, y: wb.y + 1.7 + wu.y * 0.55 },
          { x: wb.x + 3.4, y: wb.y + 1.7 + wu.y * 0.8 },
          { x: wb.x - 3.4, y: wb.y - 1.7 + wu.y * 0.8 },
          'rgba(232, 214, 150, 0.5)');
      }
    }

    // Cubierta.
    if (spec.roof === 'gable') {
      var ridgeA = P(w / 2, 0, tall + 0.42), ridgeC = P(w / 2, h, tall + 0.42);
      var Ra = T(ridgeA), Rc = T(ridgeC);
      quad(x, Dt, Ct, Rc, Ra, shade(spec.roofColor, 0.10), shade(spec.roofColor, -0.4));
      quad(x, Ct, Bt, Ra, Rc, shade(spec.roofColor, -0.22), shade(spec.roofColor, -0.45));
      // Nervios de la chapa.
      x.globalAlpha = 0.18;
      x.strokeStyle = '#000';
      x.lineWidth = 1;
      for (var r = 1; r < 7; r++) {
        var fr = r / 7;
        x.beginPath();
        x.moveTo(Dt.x + (Ct.x - Dt.x) * fr, Dt.y + (Ct.y - Dt.y) * fr);
        x.lineTo(Ra.x + (Rc.x - Ra.x) * fr, Ra.y + (Rc.y - Ra.y) * fr);
        x.stroke();
      }
      x.globalAlpha = 1;
    } else {
      quad(x, At, Bt, Ct, Dt, shade(spec.roofColor, 0.02), shade(spec.roofColor, -0.35));
      // Pretil.
      var inset = 0.1;
      var pA = T(P(inset, inset, tall + 0.14)), pB = T(P(w - inset, inset, tall + 0.14));
      var pC = T(P(w - inset, h - inset, tall + 0.14)), pD = T(P(inset, h - inset, tall + 0.14));
      x.strokeStyle = shade(spec.wall, -0.15);
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(pA.x, pA.y); x.lineTo(pB.x, pB.y); x.lineTo(pC.x, pC.y);
      x.lineTo(pD.x, pD.y); x.closePath();
      x.stroke();
    }

    // Sacos terreros al pie de la cara frontal.
    if (spec.sandbags) {
      for (var sb = 0; sb < 7; sb++) {
        var fs = 0.12 + sb * 0.13;
        var sp = { x: D.x + (C.x - D.x) * fs, y: D.y + (C.y - D.y) * fs };
        x.fillStyle = sb % 2 ? '#9c8f66' : '#8a7e58';
        x.beginPath();
        x.ellipse(sp.x, sp.y - 2, 5.2, 3.2, 0, 0, Math.PI * 2);
        x.fill();
        x.beginPath();
        x.ellipse(sp.x + 2.5, sp.y - 6.4, 5.2, 3.2, 0, 0, Math.PI * 2);
        x.fillStyle = sb % 2 ? '#8a7e58' : '#9c8f66';
        x.fill();
      }
    }

    // Antena y banderola de facción: la marca de propiedad del edificio.
    if (spec.mast) {
      var mBase = T(P(w * 0.22, h * 0.22, tall));
      var mTop = T(P(w * 0.22, h * 0.22, tall + 1.5));
      x.strokeStyle = '#3a3d40';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(mBase.x, mBase.y); x.lineTo(mTop.x, mTop.y);
      x.stroke();
      x.fillStyle = spec.team;
      x.beginPath();
      x.moveTo(mTop.x, mTop.y + 1);
      x.lineTo(mTop.x + 15, mTop.y + 6);
      x.lineTo(mTop.x, mTop.y + 11);
      x.closePath();
      x.fill();
    }

    // Franja del color de facción sobre la fachada.
    x.globalAlpha = 0.9;
    x.strokeStyle = spec.team;
    x.lineWidth = 2.5;
    x.beginPath();
    x.moveTo(Dt.x, Dt.y + 4); x.lineTo(Ct.x, Ct.y + 4); x.lineTo(Bt.x, Bt.y + 4);
    x.stroke();
    x.globalAlpha = 1;

    return sprite(c, anchor.x + ox, anchor.y + oy);
  }

  /* ---------------------------------------------------------------------------
   * 5. PERSONAJES
   *
   * Un esqueleto sencillo en coordenadas de modelo (x derecha, y adelante,
   * z arriba, medidas en tiles) se posa, se gira sobre el eje vertical y se
   * proyecta. Las extremidades se pintan como cápsulas con contorno, ordenadas
   * por profundidad para que el brazo y la pierna del fondo queden detrás.
   * ------------------------------------------------------------------------ */

  var FRAME_W = 64, FRAME_H = 64, FRAME_AX = 32, FRAME_AY = 48;
  var WALK_FRAMES = 8;

  function projectModel(mx, my, mz, yaw) {
    var s = Math.sin(yaw), co = Math.cos(yaw);
    var rx = mx * co + my * s;
    var ry = -mx * s + my * co;
    return { x: (rx - ry) * PX, y: (rx + ry) * PY - mz * PZ, d: rx + ry };
  }

  /**
   * Postura del esqueleto.
   * @param {number} phase 0..1 dentro del ciclo de marcha
   * @param {boolean} moving false para la postura de firmes
   */
  function poseSkeleton(phase, moving) {
    var a = phase * Math.PI * 2;
    var sw = moving ? Math.sin(a) : 0;
    var swOpp = moving ? Math.sin(a + Math.PI) : 0;
    var bob = moving ? Math.abs(Math.sin(a * 2)) * 0.022 : 0;

    var stride = 0.20, armSwing = 0.13;
    var hipZ = 0.56 + bob, chestZ = 0.95 + bob, headZ = 1.20 + bob;

    function leg(side, s2) {
      var dx = side * 0.085;
      var footY = s2 * stride;
      var lift = Math.max(0, s2) * 0.055 * (moving ? 1 : 0);
      return {
        hip:  [dx, 0, hipZ],
        knee: [dx, footY * 0.55, hipZ * 0.5 + lift * 0.6],
        foot: [dx, footY, lift]
      };
    }
    function arm(side, s2) {
      var dx = side * 0.165;
      return {
        shoulder: [dx, 0, chestZ],
        elbow: [dx * 1.06, s2 * armSwing * 0.6 + 0.03, chestZ - 0.20],
        hand: [dx * 1.0, s2 * armSwing + 0.09, chestZ - 0.37]
      };
    }

    return {
      legL: leg(-1, sw), legR: leg(1, swOpp),
      armL: arm(-1, swOpp), armR: arm(1, sw),
      hip: [0, 0, hipZ],
      chest: [0, 0, chestZ],
      neck: [0, 0, chestZ + 0.06],
      head: [0, 0, headZ],
      headR: 0.115,
      lean: moving ? 0.02 : 0
    };
  }

  function capsule(x, a, b, width, fill, outline) {
    x.lineCap = 'round';
    x.strokeStyle = outline;
    x.lineWidth = width + 1.8;
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    x.strokeStyle = fill;
    x.lineWidth = width;
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
  }

  var KIT = {
    fusilero:   { helmet: true,  rifle: true,  pack: true,  scale: 1.00 },
    explorador: { helmet: false, rifle: true,  pack: false, scale: 0.95 },
    zapador:    { helmet: true,  rifle: false, pack: true,  scale: 1.02, tool: true }
  };

  function paintCharacter(ctx, ox, oy, type, yaw, phase, moving, colors) {
    var kit = KIT[type] || KIT.fusilero;
    var sk = poseSkeleton(phase, moving);
    var k = kit.scale;

    function P(p) {
      var q = projectModel(p[0] * k, (p[1] + sk.lean) * k, p[2] * k, yaw);
      return { x: q.x + ox, y: q.y + oy, d: q.d };
    }

    var uniform = colors.uniform, uniformDark = shade(colors.uniform, -0.42);
    var gear = colors.gear, gearDark = shade(colors.gear, -0.4);
    var team = colors.team, teamDark = shade(colors.team, -0.4);
    var skin = '#c2946a', skinDark = '#8a6444';
    var boot = '#3c3227';

    var items = [];

    // --- Piernas ---
    [['legL', sk.legL], ['legR', sk.legR]].forEach(function (entry) {
      var L = entry[1];
      var hip = P(L.hip), knee = P(L.knee), foot = P(L.foot);
      items.push({ d: (hip.d + foot.d) / 2 - 0.001, draw: function () {
        capsule(ctx, hip, knee, 4.4 * k, uniform, uniformDark);
        capsule(ctx, knee, foot, 3.9 * k, uniform, uniformDark);
        capsule(ctx, foot, { x: foot.x + 1.5, y: foot.y + 0.5 }, 4.2 * k, boot, '#241d15');
      } });
    });

    // --- Brazo del fondo ---
    var armBack = sk.armL, armFront = sk.armR;
    if (P(sk.armL.hand).d > P(sk.armR.hand).d) { armBack = sk.armR; armFront = sk.armL; }

    function drawArm(A) {
      var sh = P(A.shoulder), el = P(A.elbow), ha = P(A.hand);
      return { d: (sh.d + ha.d) / 2, draw: function () {
        capsule(ctx, sh, el, 3.8 * k, uniform, uniformDark);
        capsule(ctx, el, ha, 3.4 * k, uniform, uniformDark);
        capsule(ctx, ha, { x: ha.x + 0.4, y: ha.y + 0.4 }, 3.0 * k, gear, gearDark);
      } };
    }
    items.push(drawArm(armBack));

    // --- Torso ---
    var hip = P(sk.hip), chest = P(sk.chest), neck = P(sk.neck);
    items.push({ d: chest.d, draw: function () {
      capsule(ctx, hip, chest, 9.5 * k, uniform, uniformDark);
      capsule(ctx, chest, neck, 4.2 * k, uniform, uniformDark);
      // Chaleco con el color de facción.
      var vTop = { x: chest.x, y: chest.y + 1.5 * k };
      var vBot = { x: hip.x, y: hip.y - 1.0 * k };
      capsule(ctx, vBot, vTop, 8.2 * k, team, teamDark);
      // Correaje.
      ctx.strokeStyle = gearDark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(chest.x - 3.5 * k, chest.y + 2 * k);
      ctx.lineTo(hip.x + 2.5 * k, hip.y - 1 * k);
      ctx.stroke();
    } });

    // --- Mochila ---
    if (kit.pack) {
      var packTop = P([0, -0.105, sk.chest[2] - 0.06]);
      var packBot = P([0, -0.105, sk.chest[2] - 0.30]);
      items.push({ d: packTop.d, draw: function () {
        capsule(ctx, packBot, packTop, 7.0 * k, gear, gearDark);
        ctx.strokeStyle = gearDark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(packBot.x - 3 * k, (packBot.y + packTop.y) / 2);
        ctx.lineTo(packBot.x + 3 * k, (packBot.y + packTop.y) / 2);
        ctx.stroke();
      } });
    }

    // --- Cabeza y casco ---
    var head = P(sk.head);
    var hr = sk.headR * k * PZ * 0.92;
    items.push({ d: head.d + 0.0005, draw: function () {
      ctx.fillStyle = skin;
      ctx.strokeStyle = skinDark;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(head.x, head.y, hr * 0.88, hr, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      if (kit.helmet) {
        ctx.fillStyle = gear;
        ctx.strokeStyle = gearDark;
        ctx.beginPath();
        ctx.ellipse(head.x, head.y - hr * 0.22, hr * 1.12, hr * 0.92, 0, Math.PI, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(head.x, head.y - hr * 0.18, hr * 1.2, hr * 0.3, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = team;
        ctx.beginPath();
        ctx.ellipse(head.x, head.y - hr * 0.3, hr * 1.0, hr * 0.66, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(team, -0.3);
        ctx.beginPath();
        ctx.ellipse(head.x - hr * 0.5, head.y - hr * 0.24, hr * 0.7, hr * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } });

    // --- Brazo delantero y armamento ---
    items.push(drawArm(armFront));

    if (kit.rifle) {
      var gripA = P([0.16, 0.20, 0.70]);
      var gripB = P([-0.07, -0.02, 0.92]);
      items.push({ d: Math.max(gripA.d, gripB.d) + 0.01, draw: function () {
        capsule(ctx, gripA, gripB, 2.0, '#3b352c', '#1d1a14');
        ctx.fillStyle = '#5e5446';
        ctx.beginPath();
        ctx.ellipse((gripA.x + gripB.x) / 2, (gripA.y + gripB.y) / 2, 2.4, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } });
    }
    if (kit.tool) {
      var boxPt = P([0.20, 0.10, 0.42]);
      items.push({ d: boxPt.d + 0.01, draw: function () {
        ctx.fillStyle = '#8a6a33';
        ctx.strokeStyle = '#5c4620';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(boxPt.x - 4.5, boxPt.y - 3, 9, 6.5);
        ctx.fill(); ctx.stroke();
      } });
    }

    // Sombra en el suelo, siempre debajo de todo.
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#22280f';
    ctx.beginPath();
    ctx.ellipse(ox + 2, oy, 9 * k, 4.4 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    items.sort(function (a, b) { return a.d - b.d; });
    for (var i = 0; i < items.length; i++) items[i].draw();
  }

  /** Atlas de un tipo de unidad: 8 direcciones × (1 firme + N de marcha). */
  function buildUnitAtlas(type, colors) {
    var cols = 1 + WALK_FRAMES;
    var c = makeCanvas(FRAME_W * cols, FRAME_H * 8);
    var x = c.getContext('2d');
    for (var dir = 0; dir < 8; dir++) {
      var yaw = dir * Math.PI / 4;
      for (var f = 0; f < cols; f++) {
        var ox = f * FRAME_W + FRAME_AX;
        var oy = dir * FRAME_H + FRAME_AY;
        x.save();
        paintCharacter(x, ox, oy, type, yaw, f === 0 ? 0 : (f - 1) / WALK_FRAMES, f !== 0, colors);
        x.restore();
      }
    }
    return { img: c, cols: cols, fw: FRAME_W, fh: FRAME_H, ax: FRAME_AX, ay: FRAME_AY };
  }

  /** Iconos de 32×32 para el marcador de recursos del HUD. */
  function paintIcon(kind) {
    var c = makeCanvas(32, 32), x = c.getContext('2d');
    x.lineCap = 'round';
    x.lineJoin = 'round';

    if (kind === 'viveres') {
      // Espiga.
      x.strokeStyle = '#b98f3c';
      x.lineWidth = 2.6;
      x.beginPath(); x.moveTo(16, 29); x.lineTo(16, 9); x.stroke();
      x.fillStyle = '#e0b551';
      for (var i = 0; i < 4; i++) {
        var y = 10 + i * 4.6;
        x.beginPath(); x.ellipse(11.5, y + 1.5, 4.6, 2.5, -0.5, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.ellipse(20.5, y + 1.5, 4.6, 2.5, 0.5, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = '#f0cd77';
      x.beginPath(); x.ellipse(16, 7, 3, 5, 0, 0, Math.PI * 2); x.fill();
    } else if (kind === 'madera') {
      // Tronco con anillos.
      x.fillStyle = '#8a6a41';
      x.beginPath(); x.roundRect ? x.roundRect(4, 11, 24, 12, 5) : x.rect(4, 11, 24, 12);
      x.fill();
      x.fillStyle = '#b08a56';
      x.beginPath(); x.ellipse(26, 17, 3.2, 6, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#7a5c37';
      x.lineWidth = 1.3;
      x.beginPath(); x.ellipse(26, 17, 1.6, 3, 0, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = 'rgba(90, 66, 38, 0.7)';
      x.lineWidth = 1.1;
      x.beginPath(); x.moveTo(9, 13); x.lineTo(9, 21);
      x.moveTo(15, 12.5); x.lineTo(15, 21.5); x.stroke();
    } else if (kind === 'metal') {
      // Lingote.
      x.fillStyle = '#98a0a6';
      x.beginPath();
      x.moveTo(7, 22); x.lineTo(11, 13); x.lineTo(25, 13); x.lineTo(28, 22);
      x.closePath(); x.fill();
      x.fillStyle = '#c2cad0';
      x.beginPath();
      x.moveTo(11, 13); x.lineTo(25, 13); x.lineTo(23, 10); x.lineTo(13, 10);
      x.closePath(); x.fill();
      x.strokeStyle = '#6f777d';
      x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(7, 22); x.lineTo(28, 22); x.stroke();
    } else {
      // Silueta de persona, para la población.
      x.fillStyle = '#7fb3ee';
      x.beginPath(); x.arc(16, 10, 4.6, 0, Math.PI * 2); x.fill();
      x.beginPath();
      x.moveTo(9, 27); x.quadraticCurveTo(9, 16, 16, 16);
      x.quadraticCurveTo(23, 16, 23, 27);
      x.closePath(); x.fill();
    }
    return c.toDataURL('image/png');
  }

  /* ---------------------------------------------------------------------------
   * 6. CONSTRUCCIÓN DEL CATÁLOGO
   * ------------------------------------------------------------------------ */

  var FACTION_COLORS = {
    met: { team: '#4a8ade', uniform: '#7c8660', gear: '#4e5444' },
    pon: { team: '#cf4f38', uniform: '#8a7a63', gear: '#4a423a' }
  };

  var art = {
    TILE_W: TILE_W, TILE_H: TILE_H, PX: PX, PY: PY, PZ: PZ,
    TERRAIN: TERRAIN,
    WALK_FRAMES: WALK_FRAMES,
    tiles: {}, fringes: {}, shores: [], props: {}, buildings: {}, units: {},
    farm: [], scaffolds: {}, icons: {}, cloud: null,
    ready: false
  };

  function build() {
    if (art.ready) return art;

    Object.keys(TERRAIN).forEach(function (type) {
      art.tiles[type] = [];
      for (var v = 0; v < VARIANTS; v++) art.tiles[type].push(paintTile(type, v));
      art.fringes[type] = [];
      for (var e = 0; e < 4; e++) art.fringes[type].push(paintFringe(type, e));
    });

    art.cloud = makeCloud(512, 26, 0x5eed);
    art.props.pino = [0, 1, 2, 3].map(paintPine);
    art.props.olivo = [0, 1, 2, 3].map(paintOlive);
    art.props.matorral = [0, 1, 2, 3].map(paintScrub);
    art.props.roca = [0, 1, 2].map(paintRock);
    art.props.cajas = [0, 1, 2].map(paintCrate);
    art.props.bidones = [0, 1, 2].map(paintBarrel);
    art.props.sacos = [0, 1].map(paintSandbags);
    art.props.frutal = [0, 1, 2, 3].map(paintFruitTree);
    art.props.chatarra = [0, 1, 2].map(paintScrap);
    art.props.tocon = [0, 1, 2].map(paintStump);

    // Huerta en cuatro estados de crecimiento.
    art.farm = [0, 0.35, 0.7, 1].map(function (g) { return paintFarm(2, 2, g); });

    // Un andamio por cada huella de edificio en uso.
    art.scaffolds = {};
    [[1, 1], [2, 2], [2, 3], [3, 2], [3, 3]].forEach(function (d) {
      art.scaffolds[d[0] + 'x' + d[1]] = paintScaffold(d[0], d[1]);
    });

    art.icons = {
      viveres: paintIcon('viveres'),
      madera: paintIcon('madera'),
      metal: paintIcon('metal'),
      poblacion: paintIcon('poblacion')
    };

    art.shores = [0, 1, 2, 3].map(paintShore);

    var BUILDINGS = {
      mando:    { w: 3, h: 3, height: 1.5, wall: '#9a9384', roofColor: '#6f6a5e', roof: 'flat',  windows: 3, mast: true, sandbags: true, seed: 11 },
      barracon: { w: 3, h: 2, height: 0.95, wall: '#8d8a78', roofColor: '#5f6b57', roof: 'gable', windows: 3, seed: 23 },
      almacen:  { w: 2, h: 3, height: 1.1, wall: '#87826f', roofColor: '#6b6355', roof: 'gable', windows: 0, seed: 31 },
      casa:     { w: 2, h: 2, height: 0.85, wall: '#c3b393', roofColor: '#9c5a3c', roof: 'gable', windows: 2, seed: 43 },
      deposito: { w: 2, h: 2, height: 0.75, wall: '#8f8a76', roofColor: '#69705c', roof: 'gable', windows: 0, sandbags: true, seed: 71 },
      torre:    { w: 1, h: 1, height: 2.3, wall: '#9d9588', roofColor: '#6a6459', roof: 'flat',  windows: 1, mast: true, door: false, seed: 57 }
    };

    art.buildings = {};
    Object.keys(BUILDINGS).forEach(function (id) {
      art.buildings[id] = {};
      Object.keys(FACTION_COLORS).forEach(function (fac) {
        var spec = Object.create(BUILDINGS[id]);
        spec.team = FACTION_COLORS[fac].team;
        art.buildings[id][fac] = paintBuilding(spec);
      });
    });

    Object.keys(KIT).forEach(function (type) {
      art.units[type] = {};
      Object.keys(FACTION_COLORS).forEach(function (fac) {
        art.units[type][fac] = buildUnitAtlas(type, FACTION_COLORS[fac]);
      });
    });

    art.ready = true;
    return art;
  }

  art.build = build;
  art.shade = shade;
  art.rng = rng;
  art.FACTION_COLORS = FACTION_COLORS;
  OP.Art = art;

})(OP);
