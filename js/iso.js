/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/iso.js — Proyección dimétrica 2:1 y cámara.
 *
 * El mundo se describe en coordenadas de rejilla (gx, gy) en tiles. La
 * proyección las lleva a "píxeles de mundo", que es el espacio sobre el que
 * trabaja la cámara: desplazarla y hacer zoom no toca nunca la rejilla.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var TILE_W = 64;          // anchura del rombo, en píxeles
  var TILE_H = 32;          // altura del rombo (relación 2:1)
  var HW = TILE_W / 2;
  var HH = TILE_H / 2;
  var TILE_Z = 30;          // píxeles verticales que mide un tile de altura

  /** Rejilla → píxeles de mundo. El origen (0,0) queda en el vértice superior. */
  function toScreen(gx, gy) {
    return { x: (gx - gy) * HW, y: (gx + gy) * HH };
  }

  /** Píxeles de mundo → rejilla (con decimales). */
  function toGrid(wx, wy) {
    return {
      gx: (wy / HH + wx / HW) / 2,
      gy: (wy / HH - wx / HW) / 2
    };
  }

  /** Clave de ordenación por profundidad para el algoritmo del pintor. */
  function depth(gx, gy) { return gx + gy; }

  /** Dirección de sprite (0-7) a partir de un desplazamiento en rejilla. */
  function facing(dgx, dgy) {
    var yaw = Math.atan2(dgx, dgy);
    var i = Math.round(yaw / (Math.PI / 4));
    return ((i % 8) + 8) % 8;
  }

  /* ---------------------------------------------------------------------------
   * CÁMARA
   * ------------------------------------------------------------------------ */

  function Camera(bounds) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.dpr = 1;
    this.viewWidth = 1;
    this.viewHeight = 1;
    this.minZoom = 0.45;
    this.maxZoom = 2.4;
    this.bounds = bounds || { minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 };
  }

  Camera.prototype.resize = function (cssWidth, cssHeight, dpr) {
    this.viewWidth = cssWidth;
    this.viewHeight = cssHeight;
    this.dpr = dpr;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clamp();
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

  /** Rejilla bajo un punto de la pantalla. */
  Camera.prototype.screenToGrid = function (sx, sy) {
    var w = this.screenToWorld(sx, sy);
    return toGrid(w.x, w.y);
  };

  Camera.prototype.applyTransform = function (ctx) {
    var k = this.zoom * this.dpr;
    ctx.setTransform(
      k, 0, 0, k,
      this.dpr * (this.viewWidth / 2 - this.x * this.zoom),
      this.dpr * (this.viewHeight / 2 - this.y * this.zoom)
    );
  };

  Camera.prototype.visibleWorldBounds = function (pad) {
    var p = pad || 0;
    var halfW = this.viewWidth / (2 * this.zoom) + p;
    var halfH = this.viewHeight / (2 * this.zoom) + p;
    return {
      minX: this.x - halfW, minY: this.y - halfH,
      maxX: this.x + halfW, maxY: this.y + halfH
    };
  };

  Camera.prototype.clamp = function () {
    var b = this.bounds;
    var halfW = this.viewWidth / (2 * this.zoom);
    var halfH = this.viewHeight / (2 * this.zoom);
    var minX = b.minX + halfW, maxX = b.maxX - halfW;
    var minY = b.minY + halfH, maxY = b.maxY - halfH;
    this.x = (minX > maxX) ? (b.minX + b.maxX) / 2 : clamp(this.x, minX, maxX);
    this.y = (minY > maxY) ? (b.minY + b.maxY) / 2 : clamp(this.y, minY, maxY);
  };

  Camera.prototype.panByScreen = function (dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  };

  /** Zoom manteniendo fijo el punto del mundo que hay bajo el cursor. */
  Camera.prototype.zoomAt = function (sx, sy, factor) {
    var before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    var after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  };

  Camera.prototype.centerOnGrid = function (gx, gy) {
    var p = toScreen(gx, gy);
    this.x = p.x;
    this.y = p.y;
    this.clamp();
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  OP.Iso = {
    TILE_W: TILE_W, TILE_H: TILE_H, HW: HW, HH: HH, TILE_Z: TILE_Z,
    toScreen: toScreen,
    toGrid: toGrid,
    depth: depth,
    facing: facing,
    clamp: clamp,
    Camera: Camera
  };

})(OP);
