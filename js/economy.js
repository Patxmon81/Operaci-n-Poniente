/* =============================================================================
 * OPERACIÓN PONIENTE — Motor isométrico
 * js/economy.js — Recursos, costes, población, construcción y producción.
 *
 * Tres recursos, en la línea del bucle clásico del género pero traducidos a la
 * ambientación: víveres (frutales y huertas), madera (pinares y olivares) y
 * metal (chatarra). El zapador es el aldeano: recolecta, acarrea y levanta obra.
 * ========================================================================== */

var OP = window.OP || (window.OP = {});

(function (OP) {
  'use strict';

  var KINDS = ['viveres', 'madera', 'metal'];

  var LABEL = {
    viveres: 'Víveres',
    madera: 'Madera',
    metal: 'Metal'
  };

  /** Ritmo de recolección, en unidades por segundo y zapador. */
  var GATHER_RATE = { viveres: 1.5, madera: 1.4, metal: 1.1 };

  /** Carga máxima antes de tener que volver a un punto de descarga. */
  var CARRY_CAPACITY = 12;

  /** Distancia a la que un zapador alcanza un nodo o una obra, en tiles. */
  var REACH = 1.6;

  /* ---------------------------------------------------------------------------
   * 1. CATÁLOGO DE EDIFICIOS
   *
   * `buildTime` se mide en segundos-zapador: dos zapadores levantan la obra en
   * la mitad de tiempo.
   * ------------------------------------------------------------------------ */

  var BUILDINGS = {
    mando: {
      id: 'mando', name: 'Centro de Mando', w: 3, h: 3,
      cost: null,                      // no se puede construir: es el punto de partida
      buildTime: 90,
      dropoff: true, popCap: 10,
      trains: ['zapador'],
      blurb: 'Descarga de recursos y adiestramiento de zapadores.'
    },
    deposito: {
      id: 'deposito', name: 'Depósito', w: 2, h: 2,
      cost: { madera: 100 }, buildTime: 20,
      dropoff: true, hotkey: 'KeyV', hotkeyLabel: 'V',
      blurb: 'Punto de descarga avanzado. Acorta los acarreos.'
    },
    casa: {
      id: 'casa', name: 'Alojamiento', w: 2, h: 2,
      cost: { madera: 60 }, buildTime: 16,
      popCap: 5, hotkey: 'KeyC', hotkeyLabel: 'C',
      blurb: 'Eleva el límite de personal en 5.'
    },
    huerta: {
      id: 'huerta', name: 'Huerta', w: 2, h: 2,
      cost: { madera: 70 }, buildTime: 14,
      flat: true, yields: { type: 'viveres', amount: 320 },
      hotkey: 'KeyU', hotkeyLabel: 'U',
      blurb: 'Víveres renovables mientras quede cosecha.'
    },
    almacen: {
      id: 'almacen', name: 'Almacén', w: 2, h: 3,
      cost: { madera: 120, metal: 30 }, buildTime: 26,
      dropoff: true, hotkey: 'KeyN', hotkeyLabel: 'N',
      blurb: 'Descarga de recursos y depósito de material.'
    },
    barracon: {
      id: 'barracon', name: 'Barracón', w: 3, h: 2,
      cost: { madera: 160, metal: 40 }, buildTime: 34,
      trains: ['fusilero', 'explorador'],
      hotkey: 'KeyB', hotkeyLabel: 'B',
      blurb: 'Adiestra fusileros y exploradores.'
    },
    torre: {
      id: 'torre', name: 'Torre de vigilancia', w: 1, h: 1,
      cost: { madera: 50, metal: 80 }, buildTime: 24,
      hotkey: 'KeyT', hotkeyLabel: 'T',
      blurb: 'Puesto elevado. Sin guarnición hasta la fase de combate.'
    }
  };

  /** Orden del panel de construcción. */
  var BUILD_ORDER = ['casa', 'deposito', 'huerta', 'almacen', 'barracon', 'torre'];

  /* ---------------------------------------------------------------------------
   * 2. CATÁLOGO DE UNIDADES
   * ------------------------------------------------------------------------ */

  var UNITS = {
    zapador:    { id: 'zapador',    name: 'Zapador',    cost: { viveres: 50 },              time: 11, pop: 1 },
    fusilero:   { id: 'fusilero',   name: 'Fusilero',   cost: { viveres: 60, metal: 20 },   time: 15, pop: 1 },
    explorador: { id: 'explorador', name: 'Explorador', cost: { viveres: 50, madera: 20 },  time: 13, pop: 1 }
  };

  /* ---------------------------------------------------------------------------
   * 3. ESTADO
   * ------------------------------------------------------------------------ */

  var stock = { viveres: 320, madera: 300, metal: 140 };
  var pop = { used: 0, cap: 0 };
  var POP_LIMIT = 60;

  /** Acumulado de lo recolectado, sólo para el informe del HUD. */
  var harvested = { viveres: 0, madera: 0, metal: 0 };

  function canAfford(cost) {
    if (!cost) return false;
    for (var k in cost) if (stock[k] < cost[k]) return false;
    return true;
  }

  function missing(cost) {
    var out = [];
    for (var k in cost) if (stock[k] < cost[k]) out.push(LABEL[k]);
    return out;
  }

  function spend(cost) {
    if (!canAfford(cost)) return false;
    for (var k in cost) stock[k] -= cost[k];
    return true;
  }

  function refund(cost) {
    if (!cost) return;
    for (var k in cost) stock[k] += cost[k];
  }

  function deposit(kind, amount) {
    // Sin este filtro, una carga sin tipo mete una clave basura en el almacén.
    if (!kind || stock[kind] === undefined || !(amount > 0)) return 0;
    stock[kind] += amount;
    harvested[kind] += amount;
    return amount;
  }

  function formatCost(cost) {
    if (!cost) return '—';
    return KINDS.filter(function (k) { return cost[k]; })
      .map(function (k) { return cost[k] + ' ' + LABEL[k].toLowerCase(); })
      .join(' · ');
  }

  /* ---------------------------------------------------------------------------
   * 4. POBLACIÓN
   * ------------------------------------------------------------------------ */

  /**
   * Recalcula personal en servicio y límite. El límite sólo lo dan los
   * edificios terminados: una obra a medio levantar no aloja a nadie.
   */
  function recalcPop(units, entities) {
    var used = 0, cap = 0, i;
    for (i = 0; i < units.length; i++) {
      if (units[i].playable) used += (UNITS[units[i].type.key] || { pop: 1 }).pop;
    }
    for (i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e.kind !== 'building' || e.faction !== 'met') continue;
      var def = BUILDINGS[e.id];
      if (def && def.popCap) cap += def.popCap;
    }
    // Las unidades en cola ya ocupan plaza, para no pasarse del límite.
    for (i = 0; i < entities.length; i++) {
      var b = entities[i];
      if (b.queue) {
        for (var q = 0; q < b.queue.length; q++) {
          used += (UNITS[b.queue[q].unit] || { pop: 1 }).pop;
        }
      }
    }
    pop.used = used;
    pop.cap = Math.min(cap, POP_LIMIT);
    return pop;
  }

  function hasRoom(unitKey) {
    return pop.used + (UNITS[unitKey] || { pop: 1 }).pop <= pop.cap;
  }

  /* ---------------------------------------------------------------------------
   * 5. PRODUCCIÓN
   *
   * La cola vive en la propia entidad del edificio: `entity.queue`.
   * ------------------------------------------------------------------------ */

  var MAX_QUEUE = 6;

  /**
   * Encola una unidad en un edificio.
   * @returns {{ok:boolean, reason:string|null}}
   */
  function enqueue(building, unitKey) {
    var def = BUILDINGS[building.id];
    if (!def || !def.trains || def.trains.indexOf(unitKey) < 0) {
      return { ok: false, reason: 'no-disponible' };
    }
    if (building.site) return { ok: false, reason: 'en-obra' };
    building.queue = building.queue || [];
    if (building.queue.length >= MAX_QUEUE) return { ok: false, reason: 'cola-llena' };

    var unit = UNITS[unitKey];
    if (!hasRoom(unitKey)) return { ok: false, reason: 'sin-alojamiento' };
    if (!canAfford(unit.cost)) return { ok: false, reason: 'sin-recursos', falta: missing(unit.cost) };

    spend(unit.cost);
    building.queue.push({ unit: unitKey, remaining: unit.time, total: unit.time });
    return { ok: true, reason: null };
  }

  /** Cancela el último elemento de la cola y devuelve su coste. */
  function dequeue(building) {
    if (!building.queue || !building.queue.length) return false;
    var item = building.queue.pop();
    refund(UNITS[item.unit].cost);
    return true;
  }

  /**
   * Avanza todas las colas. `spawn(unitKey, building)` debe crear la unidad y
   * devolver true si lo consiguió; si devuelve false, la unidad espera.
   */
  function updateProduction(entities, dt, spawn) {
    for (var i = 0; i < entities.length; i++) {
      var b = entities[i];
      if (!b.queue || !b.queue.length || b.site) continue;
      var head = b.queue[0];
      head.remaining -= dt;
      if (head.remaining > 0) continue;
      if (spawn(head.unit, b)) b.queue.shift();
      else head.remaining = 0.5;   // sin sitio donde aparecer: reintenta enseguida
    }
  }

  OP.Economy = {
    KINDS: KINDS,
    LABEL: LABEL,
    GATHER_RATE: GATHER_RATE,
    CARRY_CAPACITY: CARRY_CAPACITY,
    REACH: REACH,
    BUILDINGS: BUILDINGS,
    BUILD_ORDER: BUILD_ORDER,
    UNITS: UNITS,
    MAX_QUEUE: MAX_QUEUE,
    stock: stock,
    pop: pop,
    harvested: harvested,
    canAfford: canAfford,
    missing: missing,
    spend: spend,
    refund: refund,
    deposit: deposit,
    formatCost: formatCost,
    recalcPop: recalcPop,
    hasRoom: hasRoom,
    enqueue: enqueue,
    dequeue: dequeue,
    updateProduction: updateProduction
  };

})(OP);
