/* A Tiempo: interfaz.
 * Mapa (MapLibre con el mapa base empaquetado), tarjeta de hoy, planificador, paraderos, rutinas, ajustes y datos en vivo.
 * Los datos de cada persona viven en su espacio privado de la base del artifact y en el navegador; nunca en el codigo. */
(function () {
  'use strict';

  var P = window.Planificador;
  var SERVIDOR = 'api tm';                       // nombre del conector de Croma en claude.ai
  var CLAVE = 'atiempo.datos.v1';
  var CLAVE_FILTROS = 'atiempo.filtros.v1';
  var NOMBRE_SIS = ['TransMilenio', 'Alimentador', 'Dual', 'SITP', 'Complementario', 'Especial', 'TransMiCable'];
  var COLOR_SIS = ['#d32a2a', '#2a9440', '#b3261e', '#1763c6', '#d9730d', '#8a2346', '#c2185b'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var LETRA_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ICONOS = ['casa', 'u', 'trabajo', 'estrella', 'pin'];
  var FILTROS = [
    { id: 'paraderos', texto: 'Paraderos', color: '#1763c6' },
    { id: 'estaciones', texto: 'Estaciones', color: '#d32a2a' },
    { id: 'recargas', texto: 'Recargas', color: '#1e9e57' },
    { id: 'buses', texto: 'Buses en vivo', color: '#b95f00' }
  ];
  var CAJA = [[-74.42, 4.28], [-73.84, 4.98]];
  var VACIO = { type: 'FeatureCollection', features: [] };

  var raiz = document.documentElement;
  var base = null, red = null;                   // red de transporte (los viajes viven en el proceso de fondo)
  var E = null;                                  // datos de la persona
  var filtros = { paraderos: true, estaciones: true, recargas: false, buses: false };
  var vista = 'hoy', pestana = 'hoy';
  var viajes = [];                               // proximos viajes de las rutinas
  var Q = { desde: null, hasta: null, modo: 'ahora', hora: '', res: null, sel: 0, estado: '', rutina: null, sec: 0 };
  var seleccion = null;                          // lo que se toco en el mapa
  var busqueda = { contexto: 'general', texto: '' };
  var edicion = null;                            // lugar o rutina que se esta editando
  var eligiendo = null;                          // { texto, alElegir(lat, lon) }
  var activo = null;                             // trayecto dibujado { tr, desde, hasta }
  var linea = null;                              // ruta completa mostrada desde el buscador
  var mapa = null, mapaListo = false, marcadores = [], marcaPunto = null;
  var datosMapa = { paraderos: VACIO, estaciones: VACIO, ruta: VACIO, rutaCompleta: VACIO, rutaParadas: VACIO, buses: VACIO, toque: VACIO };
  var indice = [];                               // textos para el buscador
  var panelEstado = 'medio';
  var desfase = 0;                               // solo para pruebas: corre el reloj
  var busesVivo = { cuenta: 0, reloj: null, en: 0 };

  /* ---------- utilidades ---------- */

  function $(id) { return document.getElementById(id); }
  function agregar(e, hijo) {
    if (hijo === null || hijo === undefined || hijo === false) return;
    if (Array.isArray(hijo)) { hijo.forEach(function (x) { agregar(e, x); }); return; }
    e.appendChild(typeof hijo === 'string' || typeof hijo === 'number' ? document.createTextNode(String(hijo)) : hijo);
  }
  function h(etiqueta, props) {
    var e = document.createElement(etiqueta), k;
    if (props) for (k in props) {
      var v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'value') e.value = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) agregar(e, arguments[i]);
    return e;
  }
  function icono(nombre) {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
    s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', '#i-' + nombre); s.appendChild(u);
    return s;
  }
  function boton(texto, clase, alPulsar, nombreIcono) {
    return h('button', { type: 'button', class: 'boton ' + (clase || ''), onclick: alPulsar }, nombreIcono ? icono(nombreIcono) : null, texto);
  }
  function redondo(nombreIcono, etiqueta, alPulsar) {
    return h('button', { type: 'button', class: 'redondo', 'aria-label': etiqueta, onclick: alPulsar }, icono(nombreIcono));
  }
  function chip(sis, cod) { return h('span', { class: 'chip s' + sis, text: cod }); }
  function sello(texto, color) { return h('span', { class: 'sello ' + (color || ''), text: texto }); }
  function cabecera(titulo, atras, derecha) {
    return h('div', { class: 'cab' }, atras ? redondo('atras', 'Volver', atras) : null, h('h2', { text: titulo }), derecha || null);
  }
  function espera(texto) { return h('div', { class: 'espera' }, h('i'), h('span', { text: texto })); }
  var relojTostada = null;
  function tostada(texto) {
    var t = $('tostada');
    t.textContent = texto; t.hidden = false;
    clearTimeout(relojTostada);
    relojTostada = setTimeout(function () { t.hidden = true; }, 4200);
  }

  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function hora12(seg) {
    var m = ((Math.floor(seg / 60) % 1440) + 1440) % 1440, hh = Math.floor(m / 60), mm = m % 60;
    return (((hh + 11) % 12) + 1) + ':' + dos(mm) + (hh < 12 ? ' a. m.' : ' p. m.');
  }
  function minutos(seg) {
    var m = Math.max(0, Math.round(seg / 60));
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  function pesos(n) { return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function hhmmASeg(texto) { var p = String(texto || '0:0').split(':'); return (+p[0] || 0) * 3600 + (+p[1] || 0) * 60; }
  function segAHhmm(seg) { var m = Math.floor(seg / 60) % 1440; return dos(Math.floor(m / 60)) + ':' + dos(m % 60); }
  function sinTildes(s) { return String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }
  function nuevoId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function ahora() { return new Date(Date.now() + desfase); }
  function servicio() { return P.diaServicio(base, ahora()); }
  function faltaPara(fecha, seg) { return (P.instanteDe(fecha, seg).getTime() - ahora().getTime()) / 1000; }
  function partes(fecha) { var p = fecha.split('-'); return [+p[0], +p[1], +p[2]]; }
  function sumarDias(fecha, n) {
    var p = partes(fecha), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate());
  }
  function diaSemana(fecha) { var p = partes(fecha); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function fechaLarga(fecha) { var p = partes(fecha); return DIAS[diaSemana(fecha)] + ' ' + p[2] + ' de ' + MESES[p[1] - 1]; }
  function esAncho() { return window.innerWidth >= 900; }
  function pocoMovimiento() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ---------- datos de la persona ---------- */

  function estadoInicial() {
    return { v: 1, actualizado: 0, lugares: [], rutinas: [], saldo: null,
             ajustes: { ritmo: 80, colchon: 3, margen: 5, maxCaminata: 700, transbordos: 1, motoBase: 3000, motoKm: 1800, topeDiario: 12, vivoAuto: true },
             consumo: { dia: '', vivoHoy: 0, mes: '', creditosMes: 0 }, aprendizaje: {} };
  }
  function normalizar(e) {
    var ini = estadoInicial(), k;
    if (!e || typeof e !== 'object') return ini;
    for (k in ini) if (e[k] === undefined || e[k] === null) e[k] = ini[k];
    for (k in ini.ajustes) if (e.ajustes[k] === undefined) e.ajustes[k] = ini.ajustes[k];
    for (k in ini.consumo) if (e.consumo[k] === undefined) e.consumo[k] = ini.consumo[k];
    if (e.saldo === undefined) e.saldo = null;
    if (!Array.isArray(e.lugares)) e.lugares = [];
    if (!Array.isArray(e.rutinas)) e.rutinas = [];
    return e;
  }
  function leerLocal() {
    try { return JSON.parse(localStorage.getItem(CLAVE)); } catch (e) { return null; }
  }
  function guardarLocal() {
    try { localStorage.setItem(CLAVE, JSON.stringify(E)); } catch (e) { /* sin almacenamiento: sigue en memoria */ }
  }
  var nube = { doc: null, reloj: null, ocupada: false, pendiente: false };
  function guardar() {
    E.actualizado = Date.now();
    guardarLocal();
    programarNube();
  }
  function programarNube() {
    if (!nube.doc) return;
    clearTimeout(nube.reloj);
    nube.reloj = setTimeout(escribirNube, 1500);
  }
  function escribirNube() {
    if (!nube.doc) return;
    if (nube.ocupada) { nube.pendiente = true; return; }
    nube.ocupada = true;
    nube.doc.set(JSON.parse(JSON.stringify(E))).catch(function () { /* sin permiso de escritura: queda en el navegador */ })
      .then(function () { nube.ocupada = false; if (nube.pendiente) { nube.pendiente = false; programarNube(); } });
  }
  function conLimite(promesa, ms) {
    return Promise.race([promesa, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]);
  }
  function iniciarNube() {
    if (!window.claude || !window.claude.use) return;
    Promise.all([window.claude.use('user'), window.claude.use('db')]).then(function (r) {
      if (!r[0] || !r[1]) return null;
      return r[0].id().then(function (id) {
        if (!id) return null;
        nube.doc = r[1].doc('data/users/' + id + '/datos');
        return conLimite(nube.doc.get(), 10000);
      });
    }).then(function (foto) {
      if (!nube.doc) return;
      var remoto = foto && foto.exists ? foto.data() : null;
      if (remoto && (remoto.actualizado || 0) > (E.actualizado || 0)) {
        E = normalizar(JSON.parse(JSON.stringify(remoto)));
        guardarLocal();
        alCambiarDatos();
      } else if (E.actualizado && (!remoto || (remoto.actualizado || 0) < E.actualizado)) {
        programarNube();
      }
    }).catch(function () { /* sin base: los datos quedan en el navegador */ });
  }
  function alCambiarDatos() { pintarLugares(); planearViajes(); pintar(); }
  function lugar(id) { for (var i = 0; i < E.lugares.length; i++) if (E.lugares[i].id === id) return E.lugares[i]; return null; }

  /* ---------- motor: planificador en segundo plano ---------- */

  var motor = (function () {
    var w = null, sec = 0, pendientes = {}, cargas = {};
    function enPagina(m) {
      if (!cargas[m.tipo]) {
        cargas[m.tipo] = fetch('red/viajes-' + m.tipo + '.json').then(function (r) { return r.json(); })
          .then(function (d) { P.cargarViajes(red, m.tipo, d); });
      }
      return cargas[m.tipo].then(function () { return P.atender(red, m); });
    }
    function caer() {
      w = null;
      Object.keys(pendientes).forEach(function (id) {
        var p = pendientes[id]; delete pendientes[id];
        enPagina(p.m).then(p.si, p.no);
      });
    }
    return {
      iniciar: function () {
        try {
          w = new Worker('trabajador.js');
          w.onmessage = function (e) {
            var p = pendientes[e.data.id];
            if (!p) return;
            delete pendientes[e.data.id];
            if (e.data.ok) p.si(e.data.r); else p.no(new Error(e.data.error));
          };
          w.onerror = caer;
        } catch (e) { w = null; }
      },
      pedir: function (m) {
        if (!w) return enPagina(m);
        return new Promise(function (si, no) { m.id = ++sec; pendientes[m.id] = { si: si, no: no, m: m }; w.postMessage(m); });
      }
    };
  })();

  /* ---------- mapa ---------- */

  var teselas = null, letras = null, pakoListo = null;
  function aBytes(b64) {
    var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function inflar(bytes) {
    if (window.DecompressionStream) {
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if (!pakoListo) {
      pakoListo = new Promise(function (si, no) {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako_inflate.min.js';
        s.onload = si; s.onerror = no;
        document.head.appendChild(s);
      });
    }
    return pakoListo.then(function () { return window.pako.ungzip(bytes).buffer; });
  }
  function leerJson(ruta) {
    return fetch(ruta).then(function (r) { if (!r.ok) throw new Error(ruta + ' ' + r.status); return r.json(); });
  }
  function protocolo(pedido) {
    var m = /^at:\/\/t\/(\d+)\/(\d+)\/(\d+)/.exec(pedido.url);
    if (m) {
      return teselas.then(function (ind) {
        var lista = ind.t[m[1]];
        if (!lista || lista.indexOf(m[2] + '-' + m[3]) < 0) throw new Error('sin tesela');
        return leerJson('mapa/t/' + m[1] + '-' + m[2] + '-' + m[3] + '.json');
      }).then(function (texto) { return inflar(aBytes(texto)); }).then(function (datos) { return { data: datos }; });
    }
    m = /^at:\/\/letras\/([^/]+)\/([\d-]+)/.exec(pedido.url);
    if (m) {
      return letras.then(function (todas) {
        var texto = todas[decodeURIComponent(m[1]) + '/' + m[2]];
        return texto ? inflar(aBytes(texto)) : new ArrayBuffer(0);
      }).then(function (datos) { return { data: datos }; });
    }
    return Promise.reject(new Error('recurso desconocido'));
  }

  function temaOscuro() {
    var t = raiz.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function estilo(oscuro) {
    var c = oscuro ? {
      tierra: '#17171a', verde: '#1c2a1f', bosque: '#18251b', agua: '#11202f', uso: '#1d1d21', pista: '#26262b',
      via: '#2b2b30', borde: '#17171a', mayor: '#3a3a40', auto: '#4b4638', bordeAuto: '#17171a', tren: '#3a3a40',
      texto: '#9a9aa2', halo: '#17171a', lugar: '#c9c9cf', pie: '#b7b7be', blanco: '#1c1c1e'
    } : {
      tierra: '#f3f2ee', verde: '#d9ead0', bosque: '#cde3c4', agua: '#b9d7f1', uso: '#ebe9e2', pista: '#e2e0d9',
      via: '#ffffff', borde: '#dbd9d1', mayor: '#ffffff', auto: '#ffeebe', bordeAuto: '#e6d39a', tren: '#c9c7c0',
      texto: '#6f6f76', halo: '#ffffff', lugar: '#4b4b52', pie: '#55555c', blanco: '#ffffff'
    };
    function z(paradas, mas) {
      var e = ['interpolate', ['exponential', 1.5], ['zoom']];
      for (var i = 0; i < paradas.length; i += 2) e.push(paradas[i], paradas[i + 1] + (mas || 0));
      return e;
    }
    function clase(lista) { return ['in', ['get', 'class'], ['literal', lista]]; }
    function via(id, lista, color, anchos, minimo, mas) {
      return { id: id, type: 'line', source: 'base', 'source-layer': 'transportation', minzoom: minimo, filter: clase(lista),
               layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': z(anchos, mas) } };
    }
    var menor = [13, 0.7, 16, 5.5, 18, 15], media = [11.5, 0.8, 14, 3, 16, 8.5, 18, 20];
    var mayor = [10, 0.9, 14, 4, 16, 11, 18, 24], auto = [9, 1.1, 14, 5, 16, 13, 18, 28];
    function texto(id, capa, extra) {
      var l = { id: id, type: 'symbol', source: 'base', 'source-layer': capa,
                layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
                paint: { 'text-color': c.texto, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } }, k;
      for (k in extra) { if (k === 'layout' || k === 'paint') { for (var j in extra[k]) l[k][j] = extra[k][j]; } else l[k] = extra[k]; }
      return l;
    }
    function circulo(id, fuente, extra) {
      var l = { id: id, type: 'circle', source: fuente, paint: {} }, k;
      for (k in extra) l[k] = extra[k];
      return l;
    }
    var visible = function (si) { return { visibility: si ? 'visible' : 'none' }; };
    var geo = function (nombre) { return { type: 'geojson', data: datosMapa[nombre] }; };

    return {
      version: 8,
      glyphs: 'at://letras/{fontstack}/{range}',
      sources: {
        base: { type: 'vector', tiles: ['at://t/{z}/{x}/{y}'], minzoom: 9, maxzoom: 14 },
        paraderos: geo('paraderos'), estaciones: geo('estaciones'), rutaCompleta: geo('rutaCompleta'), ruta: geo('ruta'),
        rutaParadas: geo('rutaParadas'), buses: geo('buses'), toque: geo('toque')
      },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': c.tierra } },
        { id: 'uso', type: 'fill', source: 'base', 'source-layer': 'landuse', paint: { 'fill-color': c.uso } },
        { id: 'reserva', type: 'fill', source: 'base', 'source-layer': 'park', paint: { 'fill-color': c.bosque, 'fill-opacity': 0.7 } },
        { id: 'bosque', type: 'fill', source: 'base', 'source-layer': 'landcover', filter: clase(['wood']), paint: { 'fill-color': c.bosque } },
        { id: 'pasto', type: 'fill', source: 'base', 'source-layer': 'landcover', filter: clase(['grass', 'wetland']), paint: { 'fill-color': c.verde } },
        { id: 'agua', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': c.agua } },
        { id: 'rios', type: 'line', source: 'base', 'source-layer': 'waterway', paint: { 'line-color': c.agua, 'line-width': z([11, 1, 16, 4]) } },
        { id: 'aeropuerto', type: 'fill', source: 'base', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.pista } },
        { id: 'pistas', type: 'line', source: 'base', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': c.pista, 'line-width': z([11, 1, 15, 14]) } },
        via('via-menor-b', ['minor'], c.borde, menor, 14.5, 1.6),
        via('via-media-b', ['tertiary', 'secondary'], c.borde, media, 12.5, 1.6),
        via('via-mayor-b', ['primary'], c.borde, mayor, 11.5, 1.8),
        via('via-auto-b', ['trunk', 'motorway'], c.bordeAuto, auto, 11, 2),
        via('via-peatonal', ['path'], c.via, [14, 1.2, 18, 6], 14),
        via('via-menor', ['minor'], c.via, menor, 13),
        via('via-bus', ['busway', 'bus_guideway'], c.mayor, [12, 0.8, 16, 5], 12),
        via('via-media', ['tertiary', 'secondary'], c.via, media, 11.5),
        via('via-mayor', ['primary'], c.mayor, mayor, 10),
        via('via-auto', ['trunk', 'motorway'], c.auto, auto, 9),
        { id: 'tren', type: 'line', source: 'base', 'source-layer': 'transportation', minzoom: 12, filter: clase(['rail', 'transit']),
          paint: { 'line-color': c.tren, 'line-width': 1.2, 'line-dasharray': [3, 2] } },

        { id: 'ruta-completa', type: 'line', source: 'rutaCompleta', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 2, 16, 4]), 'line-opacity': 0.32 } },
        { id: 'ruta-borde', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.blanco, 'line-width': z([10, 6, 16, 11]) } },
        { id: 'ruta-linea', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 3.5, 16, 7]) } },
        { id: 'ruta-pie', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'pie'], layout: { 'line-cap': 'round' },
          paint: { 'line-color': c.pie, 'line-width': z([10, 2.5, 16, 4.5]), 'line-dasharray': [0.1, 1.8] } },

        texto('nombres-via', 'transportation_name', { minzoom: 12.5, filter: ['any', ['!=', ['get', 'class'], 'minor'], ['>=', ['zoom'], 15]],
          layout: { 'symbol-placement': 'line', 'text-size': z([13, 10.5, 17, 13.5]), 'text-letter-spacing': 0.02, 'symbol-spacing': 320, 'text-max-angle': 35 } }),
        texto('barrios', 'place', { minzoom: 12.2, maxzoom: 16.5,
          filter: ['any', ['==', ['get', 'class'], 'suburb'], ['all', clase(['quarter', 'neighbourhood', 'hamlet']), ['>=', ['zoom'], 14]]],
          layout: { 'text-font': ['Noto Sans Bold'], 'text-size': z([12, 10, 16, 12.5]), 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7 } }),
        texto('ciudades', 'place', { maxzoom: 12.2, filter: clase(['city', 'town', 'village']),
          layout: { 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'class'], 'city', 17, 'town', 13.5, 11.5] }, paint: { 'text-color': c.lugar } }),

        circulo('par-zonal', 'paraderos', { minzoom: 14.3, filter: ['==', ['get', 'k'], 'z'], layout: visible(filtros.paraderos),
          paint: { 'circle-radius': z([14.3, 2.6, 17, 6]), 'circle-color': c.blanco, 'circle-stroke-color': '#1763c6', 'circle-stroke-width': z([14.3, 1.4, 17, 2.4]) } }),
        circulo('par-alim', 'paraderos', { minzoom: 14.3, filter: ['==', ['get', 'k'], 'a'], layout: visible(filtros.paraderos),
          paint: { 'circle-radius': z([14.3, 2.6, 17, 6]), 'circle-color': c.blanco, 'circle-stroke-color': '#2a9440', 'circle-stroke-width': z([14.3, 1.4, 17, 2.4]) } }),
        circulo('estaciones', 'estaciones', { minzoom: 10.5, layout: visible(filtros.estaciones),
          paint: { 'circle-radius': z([10.5, 2.2, 14, 6, 17, 10]), 'circle-color': ['get', 'color'], 'circle-stroke-color': c.blanco, 'circle-stroke-width': z([10.5, 0.8, 14, 2]) } }),
        circulo('recargas', 'estaciones', { minzoom: 10.5, layout: visible(filtros.recargas),
          paint: { 'circle-radius': z([10.5, 3.2, 14, 8.5, 17, 12]), 'circle-color': '#1e9e57', 'circle-stroke-color': c.blanco, 'circle-stroke-width': z([10.5, 1, 14, 2]) } }),
        { id: 'recargas-signo', type: 'symbol', source: 'estaciones', minzoom: 12.5,
          layout: { visibility: filtros.recargas ? 'visible' : 'none', 'text-field': '$', 'text-font': ['Noto Sans Bold'], 'text-size': z([12.5, 9, 17, 14]), 'text-allow-overlap': true, 'text-ignore-placement': true },
          paint: { 'text-color': '#ffffff' } },
        { id: 'estaciones-texto', type: 'symbol', source: 'estaciones', minzoom: 13.2,
          layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 8, 'text-optional': true },
          paint: { 'text-color': c.lugar, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },

        circulo('ruta-paradas', 'rutaParadas', { minzoom: 13, filter: ['==', ['get', 'extremo'], ''],
          paint: { 'circle-radius': z([13, 2, 16, 4.5]), 'circle-color': c.blanco, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.6 } }),
        circulo('ruta-extremos', 'rutaParadas', { filter: ['!=', ['get', 'extremo'], ''],
          paint: { 'circle-radius': z([10, 5, 16, 9]), 'circle-color': c.blanco, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3.2 } }),
        { id: 'ruta-extremos-texto', type: 'symbol', source: 'rutaParadas', minzoom: 11.5, filter: ['!=', ['get', 'extremo'], ''],
          layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9, 'text-allow-overlap': false },
          paint: { 'text-color': c.lugar, 'text-halo-color': c.halo, 'text-halo-width': 1.8 } },
        circulo('toque', 'toque', { paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': c.lugar, 'circle-stroke-width': 2.5 } }),
        circulo('buses', 'buses', { paint: { 'circle-radius': z([10, 5, 15, 10]), 'circle-color': ['get', 'color'], 'circle-stroke-color': c.blanco, 'circle-stroke-width': 2.2 } }),
        { id: 'buses-texto', type: 'symbol', source: 'buses', minzoom: 12,
          layout: { 'text-field': ['get', 'cod'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, -1.5], 'text-anchor': 'bottom', 'text-allow-overlap': true },
          paint: { 'text-color': c.lugar, 'text-halo-color': c.halo, 'text-halo-width': 1.8 } }
      ]
    };
  }

  function iniciarMapa() {
    if (!window.maplibregl) { $('mapa').appendChild(h('div', { class: 'vacio', text: 'No se pudo cargar el mapa. La planeación sigue funcionando.' })); return; }
    teselas = leerJson('mapa/indice.json');
    letras = leerJson('mapa/letras.json');
    teselas.catch(function () {}); letras.catch(function () {});
    maplibregl.addProtocol('at', protocolo);
    var inicio = E.lugares[0] ? [E.lugares[0].lon, E.lugares[0].lat] : [-74.085, 4.66];
    mapa = new maplibregl.Map({ container: 'mapa', style: estilo(temaOscuro()), center: inicio, zoom: E.lugares[0] ? 12.6 : 11.2,
                                minZoom: 9.3, maxZoom: 18, maxBounds: CAJA, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
    mapa.touchZoomRotate.disableRotation();
    mapa.keyboard.disableRotation();
    mapa.on('error', function () { /* teselas fuera de la zona empaquetada: se usa la de menor detalle */ });
    mapa.on('load', function () { mapaListo = true; pintarLugares(); if (activo) dibujarTrayecto(activo.tr, activo.desde, activo.hasta, true); });
    mapa.on('click', alTocarMapa);
    var oscuroAntes = temaOscuro();
    function revisarTema() {
      var o = temaOscuro();
      if (o === oscuroAntes) return;
      oscuroAntes = o;
      mapa.setStyle(estilo(o));
    }
    new MutationObserver(revisarTema).observe(raiz, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', revisarTema);
  }

  function ponerDatos(nombres) {
    if (!mapa) return;
    nombres.forEach(function (n) {
      var f = mapa.getSource(n);
      if (f) f.setData(datosMapa[n]);
    });
  }
  function fc(lista) { return { type: 'FeatureCollection', features: lista }; }
  function punto(coord, props) { return { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: props }; }
  function trazo(coords, props) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props }; }

  function cargarCapasTransporte() {
    var pars = [], ests = [], b = base, i;
    for (i = 0; i < b.par.id.length; i++) {
      var sis = b.par.sis[i];
      if (sis & 64) { ests.push(punto([red.lon[i], red.lat[i]], { tipo: 'cable', i: i, n: b.par.nom[i], color: COLOR_SIS[6] })); continue; }
      if (b.par.est[i] >= 0) continue;
      pars.push(punto([red.lon[i], red.lat[i]], { i: i, k: (sis & (8 | 16 | 32)) ? 'z' : 'a' }));
    }
    for (i = 0; i < b.est.id.length; i++) ests.push(punto([b.est.lon[i] / 1e5, b.est.lat[i] / 1e5], { tipo: 'estacion', e: i, n: b.est.nom[i], color: COLOR_SIS[0] }));
    datosMapa.paraderos = fc(pars); datosMapa.estaciones = fc(ests);
    if (mapaListo) ponerDatos(['paraderos', 'estaciones']); else if (mapa) mapa.once('load', function () { ponerDatos(['paraderos', 'estaciones']); });
  }

  function relleno() {
    if (esAncho()) return { left: 450, top: 110, right: 70, bottom: 60 };
    var panel = parseFloat(getComputedStyle(raiz).getPropertyValue('--panel-px')) || 300, alto = $('app').clientHeight;
    return { left: 40, right: 40, top: 130, bottom: Math.max(40, Math.min(panel + 58 + 30, alto - 130 - 160)) };
  }
  function encuadrar(coords, zoomMax) {
    if (!mapa || !coords.length) return;
    var a = [Infinity, Infinity], b = [-Infinity, -Infinity];
    coords.forEach(function (c) { a[0] = Math.min(a[0], c[0]); a[1] = Math.min(a[1], c[1]); b[0] = Math.max(b[0], c[0]); b[1] = Math.max(b[1], c[1]); });
    mapa.fitBounds([a, b], { padding: relleno(), maxZoom: zoomMax || 15.5, duration: pocoMovimiento() ? 0 : 600 });
  }
  function volar(lon, lat, zoom) {
    if (!mapa) return;
    var r = relleno();
    mapa.easeTo({ center: [lon, lat], zoom: Math.max(mapa.getZoom(), zoom || 15), offset: [(r.left - r.right) / 2, (r.top - r.bottom) / 2], duration: pocoMovimiento() ? 0 : 500 });
  }

  var formas = null, formasDecodificadas = {}, posiciones = {};
  function cargarFormas() {
    if (!formas) formas = leerJson('red/formas.json').then(function (d) { return d.f; });
    return formas;
  }
  function formaDe(lista, ruta) {
    if (!formasDecodificadas[ruta]) formasDecodificadas[ruta] = lista[ruta] ? P.decodificar(lista[ruta]) : [];
    return formasDecodificadas[ruta];
  }
  function posDe(p, forma) {
    if (!posiciones[p.i]) posiciones[p.i] = P.ubicarEnForma(red, p, forma);
    return posiciones[p.i];
  }

  function dibujarTrayecto(tr, a, b, sinMover) {
    activo = { tr: tr, desde: a, hasta: b };
    linea = null;
    cargarFormas().then(function (lista) {
      if (!activo || activo.tr !== tr) return;
      var lineas = [], completas = [], paradas = [], limites = [];
      tr.tramos.forEach(function (t) {
        var q;
        if (t.tipo === 'pie') {
          var p1 = t.desde === -1 ? [a.lon, a.lat] : [red.lon[t.desde], red.lat[t.desde]];
          var p2 = t.hasta === -2 ? [b.lon, b.lat] : [red.lon[t.hasta], red.lat[t.hasta]];
          lineas.push(trazo([p1, p2], { tipo: 'pie' }));
          limites.push(p1, p2);
          return;
        }
        var p = red.pat[t.pat], forma = formaDe(lista, t.ruta), coords = [];
        if (forma.length > 1) {
          var pos = posDe(p, forma);
          coords = P.tramoDeForma(forma, pos[t.posSube], pos[t.posBaja]);
          completas.push(trazo(forma, { color: COLOR_SIS[t.sis] }));
        } else {
          for (q = t.posSube; q <= t.posBaja; q++) coords.push([red.lon[p.s[q]], red.lat[p.s[q]]]);
        }
        lineas.push(trazo(coords, { tipo: 'bus', color: COLOR_SIS[t.sis] }));
        for (q = t.posSube; q <= t.posBaja; q++) {
          var extremo = q === t.posSube ? 'sube' : (q === t.posBaja ? 'baja' : '');
          paradas.push(punto([red.lon[p.s[q]], red.lat[p.s[q]]], { extremo: extremo, color: COLOR_SIS[t.sis], i: p.s[q],
            nombre: (extremo === 'sube' ? 'Sube: ' : extremo === 'baja' ? 'Baja: ' : '') + base.par.nom[p.s[q]] }));
        }
        coords.forEach(function (x) { limites.push(x); });
      });
      datosMapa.ruta = fc(lineas); datosMapa.rutaCompleta = fc(completas); datosMapa.rutaParadas = fc(paradas);
      ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas']);
      if (!sinMover) encuadrar(limites);
      if (filtros.buses) refrescarBuses(true);
    }).catch(function () { tostada('No se pudo cargar el recorrido.'); });
  }
  function limpiarTrayecto() {
    activo = null; linea = null;
    datosMapa.ruta = datosMapa.rutaCompleta = datosMapa.rutaParadas = datosMapa.buses = VACIO;
    ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas', 'buses']);
  }
  function dibujarLinea(ruta) {
    cargarFormas().then(function (lista) {
      var forma = formaDe(lista, ruta), sis = base.rut.sis[ruta], paradas = [], p = null;
      for (var i = 0; i < red.pat.length; i++) if (red.pat[i].r === ruta) { p = red.pat[i]; break; }
      if (p) for (var q = 0; q < p.s.length; q++) paradas.push(punto([red.lon[p.s[q]], red.lat[p.s[q]]], { extremo: '', color: COLOR_SIS[sis], i: p.s[q], nombre: base.par.nom[p.s[q]] }));
      activo = null;
      datosMapa.ruta = fc(forma.length > 1 ? [trazo(forma, { tipo: 'bus', color: COLOR_SIS[sis] })] : []);
      datosMapa.rutaCompleta = VACIO; datosMapa.rutaParadas = fc(paradas); datosMapa.buses = VACIO;
      ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas', 'buses']);
      encuadrar(forma.length > 1 ? forma : paradas.map(function (x) { return x.geometry.coordinates; }), 14);
    });
  }

  function pinDe(nombreIcono, clase) {
    return h('div', { class: 'marca' }, h('div', { class: 'pin ' + (clase || '') }, icono(nombreIcono)));
  }
  function pintarLugares() {
    if (!mapa || !mapaListo) return;
    marcadores.forEach(function (m) { m.remove(); });
    marcadores = E.lugares.map(function (l) {
      var e = pinDe(l.icono || 'pin');
      e.setAttribute('role', 'button'); e.setAttribute('aria-label', l.nombre);
      e.addEventListener('click', function (ev) { ev.stopPropagation(); seleccionar({ tipo: 'lugar', id: l.id }); });
      return new maplibregl.Marker({ element: e, anchor: 'bottom', offset: [0, -7] }).setLngLat([l.lon, l.lat]).addTo(mapa);
    });
  }
  function marcarPunto(lon, lat) {
    if (marcaPunto) { marcaPunto.remove(); marcaPunto = null; }
    datosMapa.toque = VACIO;
    if (lon !== undefined && mapa) marcaPunto = new maplibregl.Marker({ element: pinDe('pin', 'punto'), anchor: 'bottom', offset: [0, -7] }).setLngLat([lon, lat]).addTo(mapa);
    ponerDatos(['toque']);
  }
  function resaltar(lon, lat) {
    if (marcaPunto) { marcaPunto.remove(); marcaPunto = null; }
    datosMapa.toque = fc([punto([lon, lat], {})]);
    ponerDatos(['toque']);
  }

  function alTocarMapa(e) {
    if (eligiendo) {
      var f = eligiendo; eligiendo = null; $('elegir').hidden = true; $('arriba').hidden = false;
      f.alElegir(e.lngLat.lat, e.lngLat.lng);
      return;
    }
    var caja = [[e.point.x - 9, e.point.y - 9], [e.point.x + 9, e.point.y + 9]];
    var capas = ['buses', 'ruta-extremos', 'ruta-paradas', 'recargas', 'estaciones', 'par-zonal', 'par-alim'].filter(function (id) { return mapa.getLayer(id); });
    var hallados = mapa.queryRenderedFeatures(caja, { layers: capas });
    if (hallados.length) {
      var p = hallados[0].properties;
      if (hallados[0].layer.id === 'buses') { tostada('Bus ' + p.cod + (p.placa ? ' · ' + p.placa : '') + (p.va ? ' · va hacia ' + p.va : '')); return; }
      if (p.tipo === 'estacion') { seleccionar({ tipo: 'estacion', e: +p.e }); return; }
      if (p.i !== undefined) { seleccionar({ tipo: 'paradero', i: +p.i }); return; }
    }
    seleccionar({ tipo: 'punto', lat: e.lngLat.lat, lon: e.lngLat.lng });
  }
  function elegirEnMapa(texto, alElegir) {
    eligiendo = { alElegir: alElegir };
    $('elegir-texto').textContent = texto;
    $('elegir').hidden = false; $('arriba').hidden = true;
    if (!esAncho()) fijarPanel('min');
  }

  /* ---------- panel deslizable ---------- */

  function altoPanel(estado) {
    var H = $('app').clientHeight;
    if (estado === 'min') return 148;
    if (estado === 'max') return Math.max(260, H - 190);
    return Math.round(Math.max(240, Math.min(H * 0.47, H - 230)));
  }
  function fijarPanel(estado) {
    panelEstado = estado;
    if (esAncho()) { raiz.style.removeProperty('--panel-px'); return; }
    raiz.style.setProperty('--panel-px', altoPanel(estado) + 'px');
  }
  function conectarPanel() {
    var asa = $('asa'), panel = $('panel'), arrastre = null;
    asa.addEventListener('pointerdown', function (e) {
      if (esAncho()) return;
      arrastre = { y: e.clientY, alto: panel.getBoundingClientRect().height, movido: false };
      asa.setPointerCapture(e.pointerId);
      panel.classList.add('arrastrando');
    });
    asa.addEventListener('pointermove', function (e) {
      if (!arrastre) return;
      var dy = arrastre.y - e.clientY, H = $('app').clientHeight;
      if (Math.abs(dy) > 5) arrastre.movido = true;
      raiz.style.setProperty('--panel-px', Math.max(110, Math.min(H - 150, arrastre.alto + dy)) + 'px');
    });
    function soltar() {
      if (!arrastre) return;
      panel.classList.remove('arrastrando');
      if (!arrastre.movido) fijarPanel(panelEstado === 'medio' ? 'max' : 'medio');
      else {
        var actual = panel.getBoundingClientRect().height, mejor = 'medio', dist = Infinity;
        ['min', 'medio', 'max'].forEach(function (s) { var d = Math.abs(altoPanel(s) - actual); if (d < dist) { dist = d; mejor = s; } });
        fijarPanel(mejor);
      }
      arrastre = null;
    }
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
    window.addEventListener('resize', function () { fijarPanel(panelEstado); if (mapa) mapa.resize(); });
  }

  /* ---------- viajes de las rutinas ---------- */

  function primerBus(tr) { for (var i = 0; i < tr.tramos.length; i++) if (tr.tramos[i].tipo === 'bus') return tr.tramos[i]; return null; }
  function rutasDe(tr) { return tr.tramos.filter(function (t) { return t.tipo === 'bus'; }).map(function (t) { return base.rut.id[t.ruta]; }).join('|'); }
  function coord(l) { return { lat: l.lat, lon: l.lon }; }

  function consulta(a, b, modo, t, tipo) {
    return { desde: coord(a), hasta: coord(b), modo: modo, t: t, tipo: tipo, velocidad: E.ajustes.ritmo, maxCaminata: E.ajustes.maxCaminata,
             transbordos: E.ajustes.transbordos, colchon: E.ajustes.colchon * 60, alternativas: 4 };
  }

  function proximosViajes() {
    var s = servicio(), lista = [];
    for (var d = 0; d < 8 && !lista.length; d++) {
      var fecha = sumarDias(s.fecha, d), tipo = P.tipoDeFecha(base, fecha);
      var diaRutina = tipo === 'festivo' ? 0 : diaSemana(fecha);
      E.rutinas.forEach(function (r) {
        if (!r.dias || r.dias.indexOf(diaRutina) < 0 || !lugar(r.desde) || !lugar(r.hasta)) return;
        var objetivo = hhmmASeg(r.hora);
        if (objetivo < 3 * 3600) objetivo += 86400;
        if (d === 0 && objetivo < s.seg - 45 * 60) return;
        lista.push({ clave: r.id + '|' + fecha + '|' + r.hora + '|' + r.modo + '|' + r.desde + '|' + r.hasta, rutina: r, fecha: fecha, tipo: tipo, objetivo: objetivo, dias: d });
      });
    }
    lista.sort(function (x, y) { return x.objetivo - y.objetivo; });
    return lista;
  }
  function planearViajes(forzar) {
    if (!base) return;
    var antes = viajes;
    viajes = proximosViajes().map(function (v) {
      var previo = null;
      if (!forzar) antes.forEach(function (x) { if (x.clave === v.clave) previo = x; });
      return previo || v;
    });
    viajes.forEach(function (v) { if (!v.estado) calcularViaje(v); });
  }
  function calcularViaje(v) {
    var a = lugar(v.rutina.desde), b = lugar(v.rutina.hasta);
    var t = v.rutina.modo === 'llegar' ? v.objetivo - E.ajustes.margen * 60 : v.objetivo;
    v.estado = 'calculando';
    motor.pedir({ orden: 'planear', tipo: v.tipo, consulta: consulta(a, b, v.rutina.modo, t, v.tipo) }).then(function (res) {
      v.res = res; v.estado = 'listo'; v.tr = null;
      if (res.trayectos.length) {
        v.tr = res.trayectos[0];
        if (v.rutina.preferida) res.trayectos.forEach(function (x) { if (rutasDe(x) === v.rutina.preferida) v.tr = x; });
      }
      if (vista === 'hoy') { pintar(); if (!activo && v === viajes[0] && v.tr) dibujarTrayecto(v.tr, a, b); }
    }, function (e) { v.estado = 'error'; v.error = e.message; if (vista === 'hoy') pintar(); });
  }
  function recalcularTarde(v) {
    var a = lugar(v.rutina.desde), b = lugar(v.rutina.hasta), s = servicio();
    if (v.fecha !== s.fecha || (v.tarde && v.tarde.pidiendo)) return;
    v.tarde = { pidiendo: true, en: Date.now(), tr: v.tarde ? v.tarde.tr : null, listo: !!(v.tarde && v.tarde.listo) };
    motor.pedir({ orden: 'planear', tipo: v.tipo, consulta: consulta(a, b, 'salir', s.seg, v.tipo) }).then(function (res) {
      v.tarde = { pidiendo: false, en: Date.now(), tr: res.trayectos[0] || null, listo: true };
      if (vista === 'hoy') pintar();
    }, function () { v.tarde = { pidiendo: false, en: Date.now(), tr: null, listo: true }; });
  }

  /* Plan vigente de un viaje: el del horario, el recalculado si ya va tarde, o el ajustado con datos en vivo */
  function planVigente(v) {
    var tr = v.tr, tarde = false;
    if (!tr) return null;
    var falta = faltaPara(v.fecha, tr.sale);
    if (v.dias === 0 && falta < -75 && v.tarde && v.tarde.listo) { tr = v.tarde.tr; tarde = true; if (!tr) return { sinBus: true, tarde: true }; }
    var bus = primerBus(tr), sale = tr.sale, llega = tr.llega, fuente = 'horario';
    var vivo = v.vivo;
    if (vivo && vivo.estado === 'listo' && Date.now() - vivo.en < 5 * 60000 && vivo.elegido && vivo.ruta === bus.ruta && vivo.paradero === bus.sube) {
      sale = vivo.elegido.seg - E.ajustes.colchon * 60 - tr.tramos[0].seg;
      llega = vivo.elegido.seg + (tr.llega - bus.sale);
      fuente = 'vivo';
    }
    return { tr: tr, bus: bus, sale: sale, llega: llega, fuente: fuente, tarde: tarde, falta: faltaPara(v.fecha, sale) };
  }

  function moto(a, b, seg, tipo) {
    var km = P.distancia(a.lat, a.lon, b.lat, b.lon) * 1.35 / 1000, hh = Math.floor(seg / 3600) % 24;
    var pico = tipo === 'habil' && ((hh >= 6 && hh < 9) || (hh >= 16 && hh < 20));
    var vel = pico ? 22 : ((hh >= 21 || hh < 5) ? 36 : 29);
    return { seg: Math.round((km / vel * 60 + 4) * 60), costo: Math.round((E.ajustes.motoBase + E.ajustes.motoKm * km) / 100) * 100, km: km };
  }
  function convieneMoto(m, durBus, noLlega) { return noLlega || (durBus > 2 * m.seg && durBus - m.seg > 25 * 60); }
  function lineaMoto(a, b, seg, tipo, durBus, noLlega) {
    var m = moto(a, b, seg, tipo), conviene = convieneMoto(m, durBus, noLlega);
    return h('div', { class: 'fila mini', style: 'margin-top:10px' }, icono('moto'),
      h('span', { class: 'crece', text: 'En moto: unos ' + minutos(m.seg) + ' · ' + pesos(m.costo) + ' (estimado)' }),
      conviene ? sello('Te conviene', 'naranja') : null);
  }

  /* ---------- datos en vivo (conector api tm) ---------- */

  var mcp = null, mcpEstado = 'buscando';
  function iniciarVivo() {
    if (!window.claude || !window.claude.use) { mcpEstado = 'no'; return; }
    window.claude.use('mcp').then(function (m) { mcp = m; mcpEstado = m ? 'listo' : 'no'; if (vista === 'ajustes') pintar(); },
      function () { mcpEstado = 'no'; });
  }
  function rotarConsumo() {
    var hoy = servicio().fecha, c = E.consumo;
    if (c.dia !== hoy) { c.dia = hoy; c.vivoHoy = 0; }
    if (c.mes !== hoy.slice(0, 7)) { c.mes = hoy.slice(0, 7); c.creditosMes = 0; }
  }
  function cupoVivo() { rotarConsumo(); return E.consumo.vivoHoy < E.ajustes.topeDiario; }
  function llamar(herramienta, entrada) {
    if (!mcp) return Promise.reject({ code: 'sin_conector' });
    if (!cupoVivo()) return Promise.reject({ code: 'tope' });
    return mcp.callTool(SERVIDOR, herramienta, entrada, { cache: false }).then(function (r) {
      var carga = r && r.payload;
      if (typeof carga === 'string') { try { carga = JSON.parse(carga); } catch (e) { carga = null; } }
      if (!carga || !carga.data) throw { code: 'respuesta' };
      rotarConsumo(); E.consumo.vivoHoy++; E.consumo.creditosMes += 10; guardar();
      return carga.data;
    });
  }
  function textoError(e) {
    switch (e && e.code) {
      case 'sin_conector': case 'not_granted': case 'capability_disabled': case 'capability_removed':
        return 'Lo vivo no está disponible aquí. Abre la app en Claude con el conector "' + SERVIDOR + '".';
      case 'tope': return 'Llegaste al tope diario de consultas en vivo. Se cambia en Ajustes.';
      case 'server_not_connected': case 'server_not_found': return 'Falta conectar "' + SERVIDOR + '" en Claude: Configuración, Conectores.';
      case 'needs_reauth': return 'Vuelve a conectar "' + SERVIDOR + '" en Claude: Configuración, Conectores.';
      case 'not_in_manifest': case 'consent_required': case 'approval_required': return 'Falta tu permiso para usar "' + SERVIDOR + '" en esta página.';
      case 'selection_required': return 'Tienes más de un conector llamado "' + SERVIDOR + '". Elige uno en Claude.';
      case 'blocked_by_policy': return 'Tu organización bloquea esta consulta.';
      case 'server_unavailable': case 'rate_limited': return 'Croma no respondió. Intenta de nuevo en un momento.';
      case 'tool_error': return 'Croma devolvió un error. Intenta de nuevo en un momento.';
      default: return 'No se pudo consultar en vivo.';
    }
  }
  function segDeInstante(texto, fecha) {
    var ms = Date.parse(texto);
    return isNaN(ms) ? null : Math.round((ms - P.instanteDe(fecha, 0).getTime()) / 1000);
  }
  function claveAprendizaje(ruta, tipo, seg) { return base.rut.id[ruta] + '|' + tipo + '|' + Math.floor(seg / 1800); }
  function aprender(ruta, tipo, seg, retraso) {
    var k = claveAprendizaje(ruta, tipo, seg), a = E.aprendizaje[k] || { n: 0, media: 0 };
    a.n++; a.media = Math.round(a.media + (retraso - a.media) / Math.min(a.n, 10));
    E.aprendizaje[k] = a;
    guardar();
  }
  function aprendido(ruta, tipo, seg) { return E.aprendizaje[claveAprendizaje(ruta, tipo, seg)] || null; }

  function consultarVivo(v, automatico) {
    var plan = planVigente(v);
    if (!plan || !plan.bus) return;
    var bus = plan.bus, tr = plan.tr, s = servicio();
    v.vivo = { estado: 'cargando', en: Date.now(), ruta: bus.ruta, paradero: bus.sube, automatico: !!automatico };
    if (vista === 'hoy') pintar();
    llamar('transmilenio_stop_arrivals', { stop_id: base.par.id[bus.sube], limit: 20 }).then(function (d) {
      var idRuta = base.rut.id[bus.ruta], lista = [];
      (d.arrivals || []).forEach(function (x) {
        if (String(x.route_id) !== idRuta) return;
        var seg = segDeInstante(x.predicted_at, v.fecha);
        if (seg === null && typeof x.minutes_away === 'number') seg = s.seg + x.minutes_away * 60;
        if (seg !== null) lista.push({ seg: seg, base: x.basis || '', bus: x.vehicle_label || '' });
      });
      lista.sort(function (x, y) { return x.seg - y.seg; });
      var listo = servicio().seg + tr.tramos[0].seg, elegido = null;
      lista.forEach(function (x) { if (!elegido && x.seg >= listo) elegido = x; });
      v.vivo = { estado: 'listo', en: Date.now(), seg: servicio().seg, ruta: bus.ruta, paradero: bus.sube, lista: lista, elegido: elegido, retraso: null, automatico: !!automatico };
      if (vista === 'hoy') pintar();
      if (!lista.length) return;
      motor.pedir({ orden: 'pasos', tipo: v.tipo, ruta: bus.ruta, paradero: bus.sube, desde: lista[0].seg - 1500, hasta: lista[0].seg + 1500 }).then(function (pasos) {
        var mejor = null;
        pasos.forEach(function (t) { if (mejor === null || Math.abs(t - lista[0].seg) < Math.abs(mejor - lista[0].seg)) mejor = t; });
        if (mejor === null) return;
        v.vivo.retraso = lista[0].seg - mejor;
        aprender(bus.ruta, v.tipo, mejor, v.vivo.retraso);
        if (vista === 'hoy') pintar();
      });
    }).catch(function (e) {
      v.vivo = { estado: 'error', en: Date.now(), error: textoError(e), ruta: bus.ruta, paradero: bus.sube, automatico: !!automatico };
      if (vista === 'hoy') pintar();
    });
  }

  function refrescarBuses(primera) {
    clearTimeout(busesVivo.reloj);
    if (!filtros.buses) return;
    if (!activo) { tostada('Elige una ruta para ver sus buses en vivo.'); return; }
    if (primera) busesVivo.cuenta = 0;
    var legs = activo.tr.tramos.filter(function (t) { return t.tipo === 'bus'; });
    var rutas = {}, codigos = [];
    legs.forEach(function (t) { if (!rutas[t.ruta]) { rutas[t.ruta] = t; codigos.push(t.ruta); } });
    Promise.all(codigos.slice(0, 2).map(function (r) {
      return llamar('transmilenio_vehicles', { route: base.rut.cod[r], per_page: 200 }).then(function (d) {
        return (d.vehicles || []).filter(function (x) { return String(x.route_id) === base.rut.id[r] && typeof x.latitude === 'number'; })
          .map(function (x) { return punto([x.longitude, x.latitude], { cod: base.rut.cod[r], color: COLOR_SIS[base.rut.sis[r]], placa: x.license_plate || '', va: x.stop_name || '' }); });
      });
    })).then(function (grupos) {
      var todos = [];
      grupos.forEach(function (g) { todos = todos.concat(g); });
      datosMapa.buses = fc(todos);
      ponerDatos(['buses']);
      busesVivo.en = Date.now(); busesVivo.cuenta++;
      if (primera) tostada(todos.length ? todos.length + ' buses en el mapa.' : 'No hay buses reportando en esta ruta ahora.');
      if (busesVivo.cuenta < 4 && !document.hidden) busesVivo.reloj = setTimeout(function () { refrescarBuses(false); }, 60000);
      else if (busesVivo.cuenta >= 4) tostada('Buses en vivo en pausa para ahorrar créditos. Toca el filtro para seguir.');
    }).catch(function (e) {
      tostada(textoError(e));
      filtros.buses = false; pintarFiltros();
    });
  }

  /* ---------- filtros ---------- */

  function pintarFiltros() {
    var c = $('filtros');
    c.textContent = '';
    FILTROS.forEach(function (f) {
      c.appendChild(h('button', { type: 'button', class: 'filtro', 'aria-pressed': String(!!filtros[f.id]), onclick: function () { alternarFiltro(f.id); } },
        h('i', { style: 'background:' + f.color }), f.texto));
    });
    if (!mapa || !mapaListo) return;
    var ver = function (id, si) { if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', si ? 'visible' : 'none'); };
    ver('par-zonal', filtros.paraderos); ver('par-alim', filtros.paraderos);
    ver('estaciones', filtros.estaciones); ver('recargas', filtros.recargas); ver('recargas-signo', filtros.recargas);
    ver('buses', filtros.buses); ver('buses-texto', filtros.buses);
  }
  function alternarFiltro(id) {
    filtros[id] = !filtros[id];
    try { localStorage.setItem(CLAVE_FILTROS, JSON.stringify({ paraderos: filtros.paraderos, estaciones: filtros.estaciones, recargas: filtros.recargas })); } catch (e) { /* sin almacenamiento */ }
    pintarFiltros();
    if (id === 'buses') { if (filtros.buses) refrescarBuses(true); else { clearTimeout(busesVivo.reloj); datosMapa.buses = VACIO; ponerDatos(['buses']); } }
    if (id === 'paraderos' && filtros.paraderos && mapa && mapa.getZoom() < 14.3) tostada('Acerca el mapa para ver los paraderos.');
    if (id === 'recargas' && filtros.recargas) tostada('Se recarga en las taquillas de estaciones y portales.');
  }

  /* ---------- vistas ---------- */

  function ir(nombre) {
    vista = nombre;
    if (nombre === 'hoy' || nombre === 'rutinas' || nombre === 'ajustes') pestana = nombre;
    pintar();
    $('contenido').scrollTop = 0;
    if (!esAncho() && panelEstado === 'min' && !eligiendo) fijarPanel('medio');
  }
  function volverAHoy() { seleccion = null; marcarPunto(); ir('hoy'); dibujarPrimero(); }
  function dibujarPrimero() {
    var v = viajes[0];
    if (activo || linea !== null || !v || !v.tr) return;
    dibujarTrayecto(v.tr, lugar(v.rutina.desde), lugar(v.rutina.hasta), true);
  }

  function pintar() {
    var c = $('contenido'), arriba = c.scrollTop;
    c.textContent = '';
    Array.prototype.forEach.call($('pestanas').children, function (b) {
      if (b.getAttribute('data-pestana') === pestana) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!base) { c.appendChild(cabecera('A Tiempo')); c.appendChild(espera('Cargando la red de transporte…')); return; }
    ({ hoy: vistaHoy, ruta: vistaRuta, toque: vistaToque, buscar: vistaBuscar, rutinas: vistaRutinas, rutina: vistaRutina,
       ajustes: vistaAjustes, lugar: vistaLugar, linea: vistaLinea }[vista] || vistaHoy)(c);
    c.scrollTop = arriba;
  }

  function nombreDia(v) { return v.dias === 0 ? 'Hoy' : (v.dias === 1 ? 'Mañana' : DIAS[diaSemana(v.fecha)]); }

  function vistaHoy(c) {
    var s = servicio();
    var saldo = h('button', { type: 'button', class: 'sello ' + (E.saldo !== null && E.saldo < base.tarifa * 2 ? 'naranja' : ''), onclick: function () { ir('ajustes'); },
      text: E.saldo === null ? 'Anotar saldo' : 'Saldo ' + pesos(E.saldo) });
    c.appendChild(cabecera(viajes.length && viajes[0].dias > 0 ? 'Tu próximo viaje' : 'Hoy', null, saldo));
    c.appendChild(h('p', { class: 'sub', text: fechaLarga(s.fecha) + (s.tipo === 'festivo' && diaSemana(s.fecha) !== 0 ? ' · festivo' : '') }));

    if (!E.lugares.length) {
      var logo = icono('logo');
      logo.setAttribute('class', 'logo');
      c.appendChild(h('div', { class: 'tarjeta bienvenida' }, logo, h('h2', { text: 'Llega a tiempo en SITP y TransMilenio' }),
        h('p', { text: 'Guarda tu casa y el lugar al que vas. La app te dice qué ruta tomar y a qué hora salir.' }),
        h('div', { class: 'botones' }, boton('Agregar mi casa', 'principal', function () { nuevoLugar('Casa', 'casa'); }, 'casa'))));
      c.appendChild(h('p', { class: 'mini', style: 'text-align:center', text: 'También puedes tocar cualquier punto del mapa para planear un viaje.' }));
      return;
    }
    if (!E.rutinas.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: 'Crea tu primera rutina' }),
        h('p', { class: 'sub', text: 'Dile a la app a qué hora debes llegar o salir y qué días. Ella calcula el resto.' }),
        h('div', { class: 'botones' }, boton('Nueva rutina', 'principal', function () { nuevaRutina(); }, 'calendario'))));
    } else if (!viajes.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: 'No tienes viajes en los próximos días' }),
        h('p', { class: 'sub', text: 'Revisa los días de tus rutinas.' })));
    }
    viajes.forEach(function (v) { c.appendChild(tarjetaViaje(v)); });

    c.appendChild(h('div', { class: 'seccion', text: 'Mis lugares' }));
    var lista = h('div', { class: 'lista' });
    E.lugares.forEach(function (l) {
      lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { seleccionar({ tipo: 'lugar', id: l.id }); } },
        h('span', { class: 'icono-lugar' }, icono(l.icono || 'pin')), h('span', { class: 'crece t corta', text: l.nombre }), icono('derecha')));
    });
    lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { nuevoLugar('', 'pin'); } },
      h('span', { class: 'icono-lugar gris' }, icono('mas')), h('span', { class: 'crece t', text: 'Agregar lugar' })));
    c.appendChild(lista);
    c.appendChild(h('div', { class: 'botones' }, boton('Planear otro viaje', '', function () { abrirRuta(null, null, {}); }, 'buscar')));
  }

  function resumenTramos(tr) {
    var fila = h('div', { class: 'tramos' });
    tr.tramos.forEach(function (t, i) {
      if (i) fila.appendChild(h('span', { class: 'mini', text: '›' }));
      if (t.tipo === 'pie') agregar(fila, [icono('caminar'), h('span', { class: 'mini num', text: Math.max(1, Math.round(t.seg / 60)) + '' })]);
      else fila.appendChild(chip(t.sis, t.letrero));
    });
    return fila;
  }

  function tarjetaViaje(v) {
    var a = lugar(v.rutina.desde), b = lugar(v.rutina.hasta);
    var t = h('div', { class: 'tarjeta' });
    t.appendChild(h('div', { class: 'entre' },
      h('span', { class: 'fuerte corta', text: v.rutina.nombre }),
      h('span', { class: 'mini', text: nombreDia(v) + ' · ' + (v.rutina.modo === 'llegar' ? 'llegar ' : 'salir ') + hora12(v.objetivo) })));
    if (v.estado === 'calculando' || !v.estado) { t.appendChild(espera('Buscando la mejor ruta…')); return t; }
    if (v.estado === 'error') { t.appendChild(h('p', { class: 'sub', text: 'No se pudo calcular. ' + (v.error || '') })); return t; }
    var plan = planVigente(v);
    if (!plan || plan.sinBus) {
      t.appendChild(h('div', { class: 'grande rojo', style: 'font-size:26px', text: plan ? 'Ya no hay bus que te sirva' : 'Sin ruta en bus a esa hora' }));
      t.appendChild(h('p', { class: 'sub', text: v.res && v.res.motivo === 'sin_paraderos' ? 'No hay paraderos cerca de uno de los dos puntos.' : 'No hay servicio que llegue a esa hora. Prueba otra hora o usa otro medio.' }));
      t.appendChild(lineaMoto(a, b, servicio().seg, v.tipo, 0, true));
      return t;
    }
    var tr = plan.tr, bus = plan.bus, falta = plan.falta, limite = v.objetivo;
    var noLlega = v.rutina.modo === 'llegar' && plan.llega > limite;
    var titulo, color = '';
    if (v.dias > 0 || falta > 90 * 60) { titulo = 'Sal a las ' + hora12(plan.sale); color = 'hora'; }
    else if (falta > 120) { titulo = 'Sal en ' + minutos(falta); color = plan.tarde && v.rutina.modo === 'llegar' ? 'naranja' : 'verde'; }
    else { titulo = 'Sal ya'; color = 'naranja'; }
    if (noLlega) { titulo = 'No llegas a las ' + hora12(limite); color = 'rojo hora'; }
    t.appendChild(h('div', { class: 'grande ' + color, text: titulo }));

    var paradero = base.par.nom[bus.sube];
    t.appendChild(h('p', { class: 'sub', text: (plan.tarde ? 'Si sales ya: caminas ' : 'Caminas ') + minutos(tr.tramos[0].seg) + ' hasta ' + paradero + '.' }));
    var fila = h('div', { class: 'fila', style: 'margin-top:8px' }, resumenTramos(tr));
    t.appendChild(fila);
    t.appendChild(h('p', { class: 'sub num', text: 'Pasa ' + hora12(plan.fuente === 'vivo' ? v.vivo.elegido.seg : bus.sale) + ' · llegas ' + hora12(plan.llega) +
      (v.rutina.modo === 'llegar' ? (noLlega ? ' (' + minutos(plan.llega - limite) + ' tarde)' : '') : '') }));

    var sellos = h('div', { class: 'sellos', style: 'margin-top:8px' });
    sellos.appendChild(sello(plan.fuente === 'vivo' ? 'En vivo' : 'Horario oficial', plan.fuente === 'vivo' ? 'verde' : ''));
    if (bus.ultimo !== null && bus.ultimo - bus.sale < 60) sellos.appendChild(sello('Último bus del día', 'naranja'));
    else if (bus.ultimo !== null && bus.ultimo - bus.sale < 45 * 60) sellos.appendChild(sello('Último a las ' + hora12(bus.ultimo), 'naranja'));
    var sabe = aprendido(bus.ruta, v.tipo, bus.sale);
    if (sabe && sabe.n >= 2 && Math.abs(sabe.media) >= 90) sellos.appendChild(sello('Suele pasar ' + minutos(Math.abs(sabe.media)) + (sabe.media > 0 ? ' tarde' : ' antes'), 'azul'));
    if (E.saldo !== null && E.saldo < base.tarifa) sellos.appendChild(sello('Saldo insuficiente', 'rojo'));
    t.appendChild(sellos);

    if (v.vivo) {
      if (v.vivo.estado === 'cargando') t.appendChild(espera('Consultando en vivo…'));
      else if (v.vivo.estado === 'error') t.appendChild(h('p', { class: 'mini rojo', style: 'margin:8px 0 0', text: v.vivo.error }));
      else {
        var lista = v.vivo.lista.slice(0, 3).map(function (x) { return Math.max(0, Math.round((x.seg - servicio().seg) / 60)); });
        var texto = lista.length ? bus.letrero + ' pasa en ' + lista.join(', ') + ' min' : 'No hay buses de la ' + bus.letrero + ' reportando ahora';
        if (v.vivo.retraso !== null && Math.abs(v.vivo.retraso) >= 60) texto += ' · va ' + minutos(Math.abs(v.vivo.retraso)) + (v.vivo.retraso > 0 ? ' tarde' : ' adelantado');
        t.appendChild(h('div', { class: 'fila mini', style: 'margin-top:8px' }, icono('vivo'), h('span', { class: 'crece', text: 'A las ' + hora12(v.vivo.seg) + ': ' + texto + '.' })));
      }
    }
    if (noLlega || plan.tarde) t.appendChild(lineaMoto(a, b, servicio().seg, v.tipo, plan.llega - plan.sale, noLlega));

    t.appendChild(h('div', { class: 'botones' },
      boton('Mapa', 'principal chico', function () { dibujarTrayecto(tr, a, b); if (!esAncho()) fijarPanel('min'); }, 'mapa'),
      boton('En vivo', 'claro chico', function () { consultarVivo(v, false); }, 'vivo'),
      boton(v.abierto ? 'Menos' : 'Detalles', 'claro chico', function () { v.abierto = !v.abierto; pintar(); })));
    if (v.abierto) {
      t.appendChild(detalleTrayecto(tr, a, b));
      t.appendChild(lineaMoto(a, b, tr.sale, v.tipo, tr.duracion, false));
      t.appendChild(h('div', { class: 'botones' },
        boton('Otras opciones', 'claro chico', function () { abrirRuta({ tipo: 'lugar', id: a.id }, { tipo: 'lugar', id: b.id }, { modo: v.rutina.modo, hora: v.rutina.hora, rutina: v.rutina.id, fecha: v.fecha, tipo: v.tipo }); }),
        boton('Alertas de la ruta', 'claro chico', function () { revisarAlertas(tr); }, 'alerta'),
        E.saldo !== null ? boton('Descontar pasaje', 'claro chico', function () { E.saldo = Math.max(0, E.saldo - base.tarifa); guardar(); pintar(); tostada('Saldo estimado: ' + pesos(E.saldo)); }, 'tarjeta') : null));
    }
    return t;
  }

  function nombrePunto(indiceParadero, a, b, extremo) {
    if (indiceParadero === -1) return a.nombre || 'tu punto de partida';
    if (indiceParadero === -2) return b.nombre || 'tu destino';
    return base.par.nom[indiceParadero] + (base.par.cod[indiceParadero] ? ' (' + base.par.cod[indiceParadero] + ')' : '') + (extremo || '');
  }
  function detalleTrayecto(tr, a, b) {
    var ul = h('ul', { class: 'pasos' });
    tr.tramos.forEach(function (t) {
      if (t.tipo === 'pie') {
        ul.appendChild(h('li', {}, h('div', { class: 't', text: 'Camina ' + minutos(t.seg) + ' · ' + t.m + ' m' }),
          h('div', { class: 'mini', text: 'Hasta ' + nombrePunto(t.hasta, a, b) })));
      } else {
        var sig = t.siguientes.map(hora12).join(', ');
        ul.appendChild(h('li', { class: 'bus', style: '--c:' + COLOR_SIS[t.sis] },
          h('div', { class: 'fila' }, chip(t.sis, t.letrero), h('span', { class: 't crece corta', text: t.destino || NOMBRE_SIS[t.sis] })),
          h('div', { class: 'mini num', text: 'Sube en ' + nombrePunto(t.sube, a, b) + ' a las ' + hora12(t.sale) }),
          h('div', { class: 'mini num', text: 'Baja en ' + nombrePunto(t.baja, a, b) + ' a las ' + hora12(t.llega) + ' · ' + t.paradas + (t.paradas === 1 ? ' parada' : ' paradas') }),
          h('div', { class: 'mini num', text: (sig ? 'Siguientes: ' + sig + ' · ' : 'No hay más después · ') + (t.ultimo !== null ? 'último ' + hora12(t.ultimo) : '') })));
      }
    });
    var pie = h('div', { class: 'mini', style: 'margin-top:10px', text: 'Pasaje ' + pesos(tr.tarifa) + (tr.transbordos ? ' · el transbordo no se cobra' : '') +
      (E.saldo !== null ? ' · saldo estimado ' + pesos(E.saldo) : '') });
    return h('div', { style: 'margin-top:12px' }, ul, pie);
  }

  function revisarAlertas(tr) {
    var bus = primerBus(tr), propios = {};
    tr.tramos.forEach(function (t) { if (t.tipo === 'bus') { propios[base.par.id[t.sube]] = 1; propios[base.par.id[t.baja]] = 1; } });
    tostada('Consultando alertas…');
    llamar('transmilenio_alerts', { route: base.rut.cod[bus.ruta] }).then(function (d) {
      var alertas = (d.alerts || []).filter(function (x) { return (x.routes || []).some(function (r) { return String(r.route_id) === base.rut.id[bus.ruta]; }); });
      var tocan = alertas.filter(function (x) { return (x.stops || []).some(function (p) { return propios[String(p.stop_id)]; }); });
      if (tocan.length) tostada('Atención: hay un desvío que afecta tu paradero. Revisa antes de salir.');
      else if (alertas.length) tostada('La ' + bus.letrero + ' tiene ' + alertas.length + (alertas.length === 1 ? ' desvío' : ' desvíos') + ', pero no en tus paraderos.');
      else tostada('Sin alertas para la ' + bus.letrero + '.');
    }).catch(function (e) { tostada(textoError(e)); });
  }

  /* ----- planear ----- */

  function resolver(ref) {
    if (!ref) return null;
    if (ref.tipo === 'lugar') { var l = lugar(ref.id); return l ? { lat: l.lat, lon: l.lon, nombre: l.nombre, id: l.id } : null; }
    return { lat: ref.lat, lon: ref.lon, nombre: ref.nombre || 'Punto en el mapa' };
  }
  function abrirRuta(desde, hasta, op) {
    if (!desde && E.lugares[0] && !(hasta && hasta.tipo === 'lugar' && hasta.id === E.lugares[0].id)) desde = { tipo: 'lugar', id: E.lugares[0].id };
    Q.desde = desde; Q.hasta = hasta; Q.modo = op.modo || 'ahora';
    Q.hora = op.hora || segAHhmm(servicio().seg); Q.rutina = op.rutina || null;
    Q.fecha = op.fecha || null; Q.tipo = op.tipo || null;
    Q.res = null; Q.sel = 0; Q.estado = '';
    seleccion = null; marcarPunto();
    ir('ruta');
    calcularRuta();
  }
  function calcularRuta() {
    var a = resolver(Q.desde), b = resolver(Q.hasta);
    Q.res = null;
    if (!a || !b) { Q.estado = ''; pintar(); return; }
    var s = servicio(), t = Q.modo === 'ahora' ? s.seg : hhmmASeg(Q.hora);
    if (Q.modo !== 'ahora' && t < 3 * 3600) t += 86400;
    Q.tUsado = t; Q.tipoUsado = Q.tipo || s.tipo; Q.fechaUsada = Q.fecha || s.fecha;
    Q.estado = 'calculando';
    var marca = ++Q.sec, modo = Q.modo === 'llegar' ? 'llegar' : 'salir';
    pintar();
    motor.pedir({ orden: 'planear', tipo: Q.tipoUsado, consulta: consulta(a, b, modo, modo === 'llegar' ? t - E.ajustes.margen * 60 : t, Q.tipoUsado) }).then(function (res) {
      if (marca !== Q.sec) return;
      Q.res = res; Q.estado = 'listo'; Q.sel = 0;
      if (vista === 'ruta') pintar();
      if (res.trayectos[0]) dibujarTrayecto(res.trayectos[0], a, b); else limpiarTrayecto();
    }, function (e) { if (marca !== Q.sec) return; Q.estado = 'error'; Q.error = e.message; if (vista === 'ruta') pintar(); });
  }

  function vistaRuta(c) {
    var a = resolver(Q.desde), b = resolver(Q.hasta);
    c.appendChild(cabecera('Planear viaje', function () { limpiarTrayecto(); volverAHoy(); planearViajes(); }));
    var puntos = h('div', { class: 'puntos' },
      h('button', { type: 'button', class: 'punto-b', onclick: function () { abrirBuscador('desde'); } }, h('small', { text: 'Desde' }), h('b', { class: 'corta', text: a ? a.nombre : 'Elige el punto de partida' })),
      h('button', { type: 'button', class: 'punto-b', onclick: function () { abrirBuscador('hasta'); } }, h('small', { text: 'Hasta' }), h('b', { class: 'corta', text: b ? b.nombre : 'Elige a dónde vas' })));
    c.appendChild(h('div', { class: 'ruta-ab' }, puntos, redondo('cambiar', 'Invertir', function () { var x = Q.desde; Q.desde = Q.hasta; Q.hasta = x; calcularRuta(); })));

    var seg = h('div', { class: 'segmentado', style: 'margin-top:10px' });
    [['ahora', 'Salir ahora'], ['salir', 'Salir a las'], ['llegar', 'Llegar a las']].forEach(function (m) {
      seg.appendChild(h('button', { type: 'button', 'aria-pressed': String(Q.modo === m[0]), text: m[1], onclick: function () { Q.modo = m[0]; calcularRuta(); } }));
    });
    c.appendChild(seg);
    if (Q.modo !== 'ahora') {
      c.appendChild(h('label', { class: 'campo' }, h('span', { text: Q.modo === 'llegar' ? 'Hora de llegada' : 'Hora de salida' }),
        h('input', { class: 'entrada', id: 'ruta-hora', type: 'time', value: Q.hora, onchange: function (e) { if (e.target.value) { Q.hora = e.target.value; calcularRuta(); } } })));
    }
    if (!a || !b) { c.appendChild(h('div', { class: 'vacio', text: 'Elige de dónde sales y a dónde vas. También puedes tocar el mapa.' })); return; }
    if (Q.estado === 'calculando') { c.appendChild(espera('Buscando la mejor ruta…')); return; }
    if (Q.estado === 'error') { c.appendChild(h('div', { class: 'vacio', text: 'No se pudo calcular. Intenta de nuevo.' })); return; }
    var res = Q.res;
    if (!res) return;
    if (!res.trayectos.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: res.motivo === 'sin_paraderos' ? 'No hay paraderos cerca' : 'No hay ruta en bus a esa hora' }),
        h('p', { class: 'sub', text: res.motivo === 'sin_paraderos' ? 'Uno de los dos puntos queda lejos de la red. Prueba un punto más cercano a una vía principal.' : 'A esa hora no hay servicio que te sirva. Prueba otra hora.' }),
        res.aPie ? h('p', { class: 'sub', text: 'A pie son unos ' + minutos(res.aPie.seg) + ' (' + res.aPie.m + ' m).' }) : null,
        lineaMoto(a, b, Q.tUsado, Q.tipoUsado, 0, true)));
      return;
    }
    res.trayectos.forEach(function (tr, i) {
      var elegida = i === Q.sel;
      var t = h('button', { type: 'button', class: 'tarjeta opcion', 'aria-pressed': String(elegida), onclick: function () { Q.sel = i; pintar(); dibujarTrayecto(tr, a, b); } },
        h('div', { class: 'entre' }, h('span', { class: 'fuerte num', text: hora12(tr.sale) + ' → ' + hora12(tr.llega) }), h('span', { class: 'mini num', text: minutos(tr.duracion) })),
        resumenTramos(tr),
        tr.etiquetas.length ? h('div', { class: 'sellos' }, tr.etiquetas.map(function (e, j) { return sello(e, i === 0 && j === 0 ? 'verde' : ''); })) : null);
      c.appendChild(t);
      if (elegida) {
        var d = h('div', { style: 'margin:-2px 2px 14px' }, detalleTrayecto(tr, a, b));
        var acciones = h('div', { class: 'botones' }, boton('Ver en el mapa', 'principal chico', function () { dibujarTrayecto(tr, a, b); if (!esAncho()) fijarPanel('min'); }, 'mapa'));
        if (Q.rutina) acciones.appendChild(boton('Usar siempre esta ruta', 'chico', function () {
          E.rutinas.forEach(function (r) { if (r.id === Q.rutina) r.preferida = rutasDe(tr); });
          guardar(); planearViajes(true); tostada('Listo. Tu rutina usará esta ruta cuando esté disponible.');
        }, 'check'));
        d.appendChild(acciones);
        c.appendChild(d);
      }
    });
    var mejor = res.trayectos[0];
    c.appendChild(lineaMoto(a, b, Q.tUsado, Q.tipoUsado, mejor.duracion, false));
    if (res.aPie && res.aPie.seg < mejor.duracion) c.appendChild(h('div', { class: 'fila mini', style: 'margin-top:8px' }, icono('caminar'), h('span', { text: 'A pie llegas en ' + minutos(res.aPie.seg) + ' (' + res.aPie.m + ' m).' })));
    c.appendChild(h('p', { class: 'mini', style: 'margin-top:14px', text: 'Horario oficial vigente al ' + base.generado.split('-').reverse().join('/') + '. El tráfico real puede cambiar los tiempos.' }));
  }

  /* ----- lo que se toca en el mapa ----- */

  function seleccionar(s) {
    seleccion = s; s.salidas = null; s.vivo = null;
    if (s.tipo === 'paradero') { resaltar(red.lon[s.i], red.lat[s.i]); volar(red.lon[s.i], red.lat[s.i], 15.5); pedirSalidas(s, [s.i]); }
    else if (s.tipo === 'estacion') {
      var lon = base.est.lon[s.e] / 1e5, lat = base.est.lat[s.e] / 1e5, hijos = [];
      for (var i = 0; i < base.par.est.length; i++) if (base.par.est[i] === s.e) hijos.push(i);
      s.hijos = hijos; resaltar(lon, lat); volar(lon, lat, 15); pedirSalidas(s, hijos);
    } else if (s.tipo === 'lugar') { var l = lugar(s.id); if (l) { marcarPunto(); volar(l.lon, l.lat, 15); } }
    else marcarPunto(s.lon, s.lat);
    ir('toque');
  }
  function pedirSalidas(s, paraderos) {
    var dia = servicio();
    motor.pedir({ orden: 'paraderos', tipo: dia.tipo, paraderos: paraderos, t: dia.seg, cuantas: 14 }).then(function (lista) {
      s.salidas = lista; if (seleccion === s && vista === 'toque') pintar();
    }, function () { s.salidas = []; if (seleccion === s && vista === 'toque') pintar(); });
  }
  function vivoParadero(s) {
    s.vivo = { estado: 'cargando' };
    pintar();
    llamar('transmilenio_stop_arrivals', { stop_id: base.par.id[s.i], limit: 14 }).then(function (d) {
      s.vivo = { estado: 'listo', lista: (d.arrivals || []).map(function (x) { return { cod: x.route_code || '', nombre: x.route_name || '', min: x.minutes_away, sis: 3, ruta: String(x.route_id || '') }; }) };
      s.vivo.lista.forEach(function (x) { var r = base.rut.id.indexOf(x.ruta); if (r >= 0) x.sis = base.rut.sis[r]; });
      if (seleccion === s && vista === 'toque') pintar();
    }).catch(function (e) { s.vivo = { estado: 'error', error: textoError(e) }; if (seleccion === s && vista === 'toque') pintar(); });
  }
  function vistaToque(c) {
    var s = seleccion;
    if (!s) { vistaHoy(c); return; }
    var punto0, titulo, sub;
    if (s.tipo === 'paradero') {
      punto0 = { lat: red.lat[s.i], lon: red.lon[s.i], nombre: base.par.nom[s.i] };
      titulo = base.par.nom[s.i];
      var sis = [], bits = base.par.sis[s.i];
      NOMBRE_SIS.forEach(function (n, i) { if (bits & (1 << i)) sis.push(n); });
      sub = 'Paradero ' + (base.par.cod[s.i] || '') + ' · ' + sis.join(', ');
    } else if (s.tipo === 'estacion') {
      punto0 = { lat: base.est.lat[s.e] / 1e5, lon: base.est.lon[s.e] / 1e5, nombre: base.est.nom[s.e] };
      titulo = base.est.nom[s.e]; sub = 'Estación de TransMilenio · tiene taquilla para recargar';
    } else if (s.tipo === 'lugar') {
      var l = lugar(s.id);
      if (!l) { volverAHoy(); return; }
      punto0 = { lat: l.lat, lon: l.lon, nombre: l.nombre, id: l.id }; titulo = l.nombre; sub = 'Lugar guardado';
    } else {
      var cerca = P.cercanos(red, s.lat, s.lon, 500)[0];
      punto0 = { lat: s.lat, lon: s.lon, nombre: cerca ? 'Cerca de ' + base.par.nom[cerca[0]] : 'Punto en el mapa' };
      titulo = 'Punto en el mapa'; sub = cerca ? 'A ' + Math.round(cerca[1]) + ' m del paradero ' + base.par.nom[cerca[0]] : 'No hay paraderos a menos de 500 m';
    }
    c.appendChild(cabecera(titulo, volverAHoy));
    c.appendChild(h('p', { class: 'sub', text: sub }));
    var ref = s.tipo === 'lugar' ? { tipo: 'lugar', id: s.id } : { tipo: 'punto', lat: punto0.lat, lon: punto0.lon, nombre: punto0.nombre };
    c.appendChild(h('div', { class: 'botones' },
      boton('Ir aquí', 'principal', function () { abrirRuta(null, ref, {}); }),
      boton('Salir de aquí', '', function () { abrirRuta(ref, null, {}); }),
      s.tipo === 'lugar' ? boton('Editar', '', function () { edicion = { tipo: 'lugar', datos: JSON.parse(JSON.stringify(lugar(s.id))), nuevo: false }; ir('lugar'); }, 'editar')
        : boton('Guardar', '', function () { edicion = { tipo: 'lugar', datos: { id: nuevoId(), nombre: '', icono: 'pin', lat: punto0.lat, lon: punto0.lon }, nuevo: true }; ir('lugar'); }, 'estrella')));

    if (s.tipo === 'paradero' || s.tipo === 'estacion') {
      c.appendChild(h('div', { class: 'seccion', text: s.vivo && s.vivo.estado === 'listo' ? 'Llegadas en vivo' : 'Próximas salidas según el horario' }));
      if (s.vivo && s.vivo.estado === 'cargando') c.appendChild(espera('Consultando en vivo…'));
      else if (s.vivo && s.vivo.estado === 'listo') {
        if (!s.vivo.lista.length) c.appendChild(h('div', { class: 'vacio', text: 'No hay buses reportando hacia este paradero ahora.' }));
        else {
          var lv = h('div', { class: 'lista' });
          s.vivo.lista.forEach(function (x) {
            lv.appendChild(h('div', { class: 'item' }, chip(x.sis, x.cod), h('span', { class: 'crece corta', text: x.nombre }), h('span', { class: 'fuerte num', text: (x.min <= 0 ? 'Llegando' : x.min + ' min') })));
          });
          c.appendChild(lv);
        }
      } else if (!s.salidas) c.appendChild(espera('Cargando horarios…'));
      else if (!s.salidas.length) c.appendChild(h('div', { class: 'vacio', text: 'No hay más salidas hoy desde aquí.' }));
      else {
        var ahoraSeg = servicio().seg, ls = h('div', { class: 'lista' });
        s.salidas.forEach(function (x) {
          var n = P.nombreTramo(red, { pat: x.pat, posSube: x.pos });
          ls.appendChild(h('div', { class: 'item' }, chip(n.sis, n.letrero), h('span', { class: 'crece corta', text: n.destino }),
            h('span', { class: 'num', style: 'text-align:right' }, h('span', { class: 'fuerte', text: hora12(x.sale) }), h('div', { class: 'mini', text: 'en ' + minutos(x.sale - ahoraSeg) }))));
        });
        c.appendChild(ls);
      }
      if (s.vivo && s.vivo.estado === 'error') c.appendChild(h('p', { class: 'mini rojo', text: s.vivo.error }));
      if (s.tipo === 'paradero') c.appendChild(h('div', { class: 'botones' }, boton('Ver llegadas en vivo', 'claro', function () { vivoParadero(s); }, 'vivo')));
    } else {
      var vecinos = P.cercanos(red, punto0.lat, punto0.lon, 500).slice(0, 4);
      if (vecinos.length) {
        c.appendChild(h('div', { class: 'seccion', text: 'Paraderos cercanos' }));
        var lp = h('div', { class: 'lista' });
        vecinos.forEach(function (x) {
          lp.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { seleccionar({ tipo: 'paradero', i: x[0] }); } },
            h('span', { class: 'crece' }, h('div', { class: 't corta', text: base.par.nom[x[0]] }), h('div', { class: 'mini', text: (base.par.cod[x[0]] || '') + ' · a ' + Math.round(x[1]) + ' m' })), icono('derecha')));
        });
        c.appendChild(lp);
      }
    }
  }

  /* ----- buscador ----- */

  function prepararBusqueda() {
    var i;
    indice = [];
    for (i = 0; i < base.est.id.length; i++) indice.push({ t: sinTildes(base.est.nom[i]), tipo: 'estacion', e: i });
    for (i = 0; i < base.rut.id.length; i++) indice.push({ t: sinTildes(base.rut.cod[i] + ' ' + base.rut.c1[i] + ' ' + base.rut.c2[i]), tipo: 'ruta', r: i });
    for (i = 0; i < base.par.id.length; i++) if (base.par.est[i] < 0) indice.push({ t: sinTildes(base.par.nom[i] + ' ' + base.par.cod[i]), tipo: 'paradero', i: i });
  }
  function abrirBuscador(contexto) { busqueda = { contexto: contexto, texto: '' }; ir('buscar'); if (!esAncho()) fijarPanel('max'); }
  function elegirResultado(ref, punto0) {
    var ctx = busqueda.contexto;
    if (ctx === 'desde' || ctx === 'hasta') { Q[ctx] = ref; ir('ruta'); if (!esAncho()) fijarPanel('medio'); calcularRuta(); return; }
    if (!esAncho()) fijarPanel('medio');
    if (ref.tipo === 'lugar') { seleccionar({ tipo: 'lugar', id: ref.id }); return; }
    seleccionar(punto0);
  }
  function vistaBuscar(c) {
    var ctx = busqueda.contexto, enRuta = ctx === 'desde' || ctx === 'hasta';
    c.appendChild(cabecera(ctx === 'desde' ? '¿Desde dónde?' : (ctx === 'hasta' ? '¿A dónde vas?' : 'Buscar'), function () { if (enRuta) ir('ruta'); else volverAHoy(); if (!esAncho()) fijarPanel('medio'); }));
    var resultados = h('div');
    var entrada = h('input', { class: 'entrada', id: 'buscar-texto', type: 'search', placeholder: 'Paradero, estación o ruta', autocomplete: 'off', value: busqueda.texto,
      oninput: function (e) { busqueda.texto = e.target.value; llenar(); } });
    c.appendChild(entrada);
    c.appendChild(resultados);
    function fila(nombreIcono, titulo, sub, alPulsar, gris) {
      return h('button', { type: 'button', class: 'item', onclick: alPulsar }, h('span', { class: 'icono-lugar ' + (gris ? 'gris' : '') }, icono(nombreIcono)),
        h('span', { class: 'crece' }, h('div', { class: 't corta', text: titulo }), sub ? h('div', { class: 'mini corta', text: sub }) : null));
    }
    function llenar() {
      resultados.textContent = '';
      var q = sinTildes(busqueda.texto.trim()), lista = h('div', { class: 'lista' });
      if (enRuta) lista.appendChild(fila('mapa', 'Elegir en el mapa', 'Toca el punto exacto', function () {
        elegirEnMapa(ctx === 'desde' ? 'Toca el mapa: punto de partida' : 'Toca el mapa: a dónde vas', function (lat, lon) {
          var cerca = P.cercanos(red, lat, lon, 400)[0];
          Q[ctx] = { tipo: 'punto', lat: lat, lon: lon, nombre: cerca ? 'Cerca de ' + base.par.nom[cerca[0]] : 'Punto en el mapa' };
          ir('ruta'); fijarPanel('medio'); calcularRuta();
        });
        ir('ruta');
      }, true));
      E.lugares.forEach(function (l) {
        if (q && sinTildes(l.nombre).indexOf(q) < 0) return;
        lista.appendChild(fila(l.icono || 'pin', l.nombre, 'Lugar guardado', function () { elegirResultado({ tipo: 'lugar', id: l.id }); }));
      });
      if (q.length >= 2) {
        var hallados = [];
        for (var i = 0; i < indice.length && hallados.length < 400; i++) {
          var p = indice[i].t.indexOf(q);
          if (p >= 0 && !(enRuta && indice[i].tipo === 'ruta')) hallados.push([p === 0 ? 0 : (indice[i].t.charAt(p - 1) === ' ' ? 1 : 2), indice[i]]);
        }
        hallados.sort(function (x, y) { return x[0] - y[0] || (x[1].tipo === y[1].tipo ? 0 : (x[1].tipo === 'estacion' ? -1 : (y[1].tipo === 'estacion' ? 1 : (x[1].tipo === 'ruta' ? -1 : 1)))); });
        hallados.slice(0, 24).forEach(function (x) {
          var r = x[1];
          if (r.tipo === 'estacion') lista.appendChild(fila('bus', base.est.nom[r.e], 'Estación de TransMilenio', function () {
            elegirResultado({ tipo: 'punto', lat: base.est.lat[r.e] / 1e5, lon: base.est.lon[r.e] / 1e5, nombre: base.est.nom[r.e] }, { tipo: 'estacion', e: r.e }); }, true));
          else if (r.tipo === 'paradero') lista.appendChild(fila('pin', base.par.nom[r.i], 'Paradero ' + base.par.cod[r.i], function () {
            elegirResultado({ tipo: 'punto', lat: red.lat[r.i], lon: red.lon[r.i], nombre: base.par.nom[r.i] }, { tipo: 'paradero', i: r.i }); }, true));
          else lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { linea = r.r; dibujarLinea(r.r); ir('linea'); if (!esAncho()) fijarPanel('min'); } },
            chip(base.rut.sis[r.r], base.rut.cod[r.r]), h('span', { class: 'crece' }, h('div', { class: 't corta', text: base.rut.nom[r.r] }), h('div', { class: 'mini', text: 'Ruta de ' + NOMBRE_SIS[base.rut.sis[r.r]] }))));
        });
      }
      if (lista.children.length) resultados.appendChild(lista);
      if (q.length < 2) resultados.appendChild(h('p', { class: 'mini', style: 'margin-top:12px', text: 'Escribe el nombre o código de un paradero, una estación o una ruta. También puedes tocar cualquier punto del mapa.' }));
      else if (lista.children.length <= (enRuta ? 1 : 0)) resultados.appendChild(h('div', { class: 'vacio', text: 'Nada con ese nombre. Prueba con otra palabra o toca el punto en el mapa.' }));
    }
    llenar();
    setTimeout(function () { entrada.focus(); }, 60);
  }
  function vistaLinea(c) {
    if (linea === null) { vistaHoy(c); return; }
    c.appendChild(cabecera('Ruta ' + base.rut.cod[linea], function () { limpiarTrayecto(); volverAHoy(); planearViajes(); }, chip(base.rut.sis[linea], base.rut.cod[linea])));
    c.appendChild(h('p', { class: 'sub', text: base.rut.nom[linea] + ' · ' + NOMBRE_SIS[base.rut.sis[linea]] }));
    c.appendChild(h('p', { class: 'mini', style: 'margin-top:10px', text: 'El mapa muestra el recorrido completo y sus paraderos. Toca un paradero para ver a qué hora pasa.' }));
  }

  /* ----- lugares ----- */

  function nuevoLugar(nombre, nombreIcono) {
    elegirEnMapa('Toca el mapa donde queda' + (nombre ? ' tu ' + nombre.toLowerCase() : ' el lugar'), function (lat, lon) {
      edicion = { tipo: 'lugar', datos: { id: nuevoId(), nombre: nombre, icono: nombreIcono, lat: lat, lon: lon }, nuevo: true };
      marcarPunto(lon, lat);
      ir('lugar'); fijarPanel('medio');
    });
    tostada('Acerca el mapa y toca el punto exacto.');
  }
  function vistaLugar(c) {
    var ed = edicion;
    if (!ed || ed.tipo !== 'lugar') { vistaHoy(c); return; }
    var d = ed.datos;
    c.appendChild(cabecera(ed.nuevo ? 'Nuevo lugar' : 'Editar lugar', function () { edicion = null; volverAHoy(); }));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Nombre' }), h('input', { class: 'entrada', id: 'lugar-nombre', type: 'text', maxlength: '30', placeholder: 'Casa, universidad, trabajo…', value: d.nombre, oninput: function (e) { d.nombre = e.target.value; } })));
    var iconos = h('div', { class: 'dias' });
    ICONOS.forEach(function (n) { iconos.appendChild(h('button', { type: 'button', 'aria-pressed': String(d.icono === n), 'aria-label': n, onclick: function () { d.icono = n; pintar(); } }, icono(n))); });
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Icono' }), iconos));
    c.appendChild(h('div', { class: 'botones' }, boton('Cambiar ubicación en el mapa', '', function () {
      elegirEnMapa('Toca el mapa donde queda el lugar', function (lat, lon) { d.lat = lat; d.lon = lon; marcarPunto(lon, lat); ir('lugar'); fijarPanel('medio'); });
    }, 'mapa')));
    c.appendChild(h('div', { class: 'botones' },
      boton('Guardar', 'principal', function () {
        d.nombre = (d.nombre || '').trim() || 'Lugar';
        var existe = false;
        E.lugares = E.lugares.map(function (l) { if (l.id === d.id) { existe = true; return d; } return l; });
        if (!existe) E.lugares.push(d);
        edicion = null; guardar(); marcarPunto(); pintarLugares(); planearViajes(true); volverAHoy();
        tostada('Lugar guardado.');
      }, 'check'),
      ed.nuevo ? null : boton('Eliminar', '', function () {
        E.lugares = E.lugares.filter(function (l) { return l.id !== d.id; });
        E.rutinas = E.rutinas.filter(function (r) { return r.desde !== d.id && r.hasta !== d.id; });
        edicion = null; guardar(); pintarLugares(); planearViajes(true); volverAHoy();
      }, 'borrar')));
  }

  /* ----- rutinas ----- */

  function textoDias(dias) {
    if (dias.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return dias.indexOf(d) >= 0; })) return 'lunes a viernes';
    if (dias.length === 7) return 'todos los días';
    return [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return dias.indexOf(d) >= 0; }).map(function (d) { return DIAS[d].slice(0, 3); }).join(', ');
  }
  function nuevaRutina() {
    if (E.lugares.length < 2) { tostada('Primero guarda dos lugares: de dónde sales y a dónde vas.'); ir('hoy'); return; }
    edicion = { tipo: 'rutina', nuevo: true, datos: { id: nuevoId(), nombre: '', desde: E.lugares[0].id, hasta: E.lugares[1].id, modo: 'llegar', hora: '07:00', dias: [1, 2, 3, 4, 5] } };
    ir('rutina');
  }
  function vistaRutinas(c) {
    c.appendChild(cabecera('Rutinas', null, redondo('mas', 'Nueva rutina', nuevaRutina)));
    c.appendChild(h('p', { class: 'sub', text: 'Tus viajes de cada semana. La app calcula la mejor ruta y a qué hora salir.' }));
    if (!E.rutinas.length) { c.appendChild(h('div', { class: 'vacio', text: 'Aún no tienes rutinas. Crea la primera con el botón de arriba.' })); return; }
    var lista = h('div', { class: 'lista' });
    E.rutinas.forEach(function (r) {
      var a = lugar(r.desde), b = lugar(r.hasta);
      lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { edicion = { tipo: 'rutina', nuevo: false, datos: JSON.parse(JSON.stringify(r)) }; ir('rutina'); } },
        h('span', { class: 'icono-lugar' }, icono(r.modo === 'llegar' ? 'reloj' : 'derecha')),
        h('span', { class: 'crece' }, h('div', { class: 't corta', text: r.nombre }),
          h('div', { class: 'mini corta', text: (a ? a.nombre : '?') + ' a ' + (b ? b.nombre : '?') + ' · ' + (r.modo === 'llegar' ? 'llegar ' : 'salir ') + hora12(hhmmASeg(r.hora)) }),
          h('div', { class: 'mini', text: textoDias(r.dias) })), icono('derecha')));
    });
    c.appendChild(lista);
  }
  function vistaRutina(c) {
    var ed = edicion;
    if (!ed || ed.tipo !== 'rutina') { vistaRutinas(c); return; }
    var d = ed.datos;
    function selector(campo, id) {
      var s = h('select', { class: 'entrada', id: id, onchange: function (e) { d[campo] = e.target.value; } });
      E.lugares.forEach(function (l) { var o = h('option', { value: l.id, text: l.nombre }); if (l.id === d[campo]) o.selected = true; s.appendChild(o); });
      return s;
    }
    c.appendChild(cabecera(ed.nuevo ? 'Nueva rutina' : 'Editar rutina', function () { edicion = null; ir('rutinas'); }));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Nombre' }), h('input', { class: 'entrada', id: 'rutina-nombre', type: 'text', maxlength: '30', placeholder: 'Ir a la universidad', value: d.nombre, oninput: function (e) { d.nombre = e.target.value; } })));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Desde' }), selector('desde', 'rutina-desde')));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Hasta' }), selector('hasta', 'rutina-hasta')));
    var seg = h('div', { class: 'segmentado' });
    [['llegar', 'Debo llegar a las'], ['salir', 'Salgo a las']].forEach(function (m) {
      seg.appendChild(h('button', { type: 'button', 'aria-pressed': String(d.modo === m[0]), text: m[1], onclick: function () { d.modo = m[0]; pintar(); } }));
    });
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Horario' }), seg));
    c.appendChild(h('input', { class: 'entrada', id: 'rutina-hora', type: 'time', 'aria-label': 'Hora', value: d.hora, onchange: function (e) { if (e.target.value) d.hora = e.target.value; } }));
    var dias = h('div', { class: 'dias' });
    [1, 2, 3, 4, 5, 6, 0].forEach(function (n) {
      dias.appendChild(h('button', { type: 'button', 'aria-pressed': String(d.dias.indexOf(n) >= 0), 'aria-label': DIAS[n], text: LETRA_DIA[n], onclick: function () {
        if (d.dias.indexOf(n) >= 0) d.dias = d.dias.filter(function (x) { return x !== n; }); else d.dias.push(n);
        pintar();
      } }));
    });
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Días (los festivos cuentan como domingo)' }), dias));
    c.appendChild(h('div', { class: 'botones' },
      boton('Guardar', 'principal', function () {
        if (d.desde === d.hasta) { tostada('El punto de partida y el destino deben ser distintos.'); return; }
        if (!d.dias.length) { tostada('Elige al menos un día.'); return; }
        d.nombre = (d.nombre || '').trim() || ((d.modo === 'llegar' ? 'Ir a ' : 'Salir de ') + (lugar(d.modo === 'llegar' ? d.hasta : d.desde) || {}).nombre);
        var existe = false;
        E.rutinas = E.rutinas.map(function (r) { if (r.id === d.id) { existe = true; return d; } return r; });
        if (!existe) E.rutinas.push(d);
        edicion = null; guardar(); planearViajes(true); ir('rutinas'); tostada('Rutina guardada.');
      }, 'check'),
      ed.nuevo ? null : boton('Eliminar', '', function () { E.rutinas = E.rutinas.filter(function (r) { return r.id !== d.id; }); edicion = null; guardar(); planearViajes(true); ir('rutinas'); }, 'borrar')));
  }

  /* ----- ajustes ----- */

  function vistaAjustes(c) {
    var A = E.ajustes;
    function numero(id, valor, min, max, alCambiar) {
      return h('input', { class: 'entrada', id: id, type: 'number', inputmode: 'numeric', min: String(min), max: String(max), value: String(valor), onchange: function (e) {
        var n = Math.round(+e.target.value);
        if (isNaN(n)) return;
        alCambiar(Math.max(min, Math.min(max, n))); guardar(); planearViajes(true); pintar();
      } });
    }
    function opciones(lista, actual, alElegir) {
      var s = h('div', { class: 'segmentado' });
      lista.forEach(function (o) { s.appendChild(h('button', { type: 'button', 'aria-pressed': String(actual === o[0]), text: o[1], onclick: function () { alElegir(o[0]); guardar(); planearViajes(true); pintar(); } })); });
      return s;
    }
    c.appendChild(cabecera('Ajustes'));

    c.appendChild(h('div', { class: 'seccion', text: 'Caminata y márgenes' }));
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Ritmo al caminar' }), opciones([[67, 'Lento'], [80, 'Normal'], [92, 'Rápido']], A.ritmo, function (v) { A.ritmo = v; })));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Minutos de espera en el paradero antes de que pase el bus' }), numero('aj-colchon', A.colchon, 0, 15, function (v) { A.colchon = v; })));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Minutos de margen para llegar al destino' }), numero('aj-margen', A.margen, 0, 30, function (v) { A.margen = v; })));
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Caminata máxima hasta el paradero' }), opciones([[450, '450 m'], [700, '700 m'], [1000, '1 km']], A.maxCaminata, function (v) { A.maxCaminata = v; })));
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Transbordos permitidos' }), opciones([[0, 'Ninguno'], [1, 'Uno'], [2, 'Dos']], A.transbordos, function (v) { A.transbordos = v; })));

    c.appendChild(h('div', { class: 'seccion', text: 'Saldo estimado de la tarjeta' }));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Anota tu saldo. La app descuenta ' + pesos(base.tarifa) + ' cuando registras un viaje.' }),
      h('input', { class: 'entrada', id: 'aj-saldo', type: 'number', inputmode: 'numeric', min: '0', placeholder: 'Por ejemplo 15000', value: E.saldo === null ? '' : String(E.saldo), onchange: function (e) {
        E.saldo = e.target.value === '' ? null : Math.max(0, Math.round(+e.target.value) || 0); guardar(); pintar();
      } })));
    c.appendChild(h('p', { class: 'mini', text: 'La app no puede leer la tarjeta con el NFC del celular. Para ver el saldo real o recargar, usa los canales oficiales de TuLlave.' }));

    c.appendChild(h('div', { class: 'seccion', text: 'Comparación con moto' }));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Cobro base del viaje' }), numero('aj-moto-base', A.motoBase, 0, 20000, function (v) { A.motoBase = v; })));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Cobro por kilómetro' }), numero('aj-moto-km', A.motoKm, 0, 10000, function (v) { A.motoKm = v; })));

    c.appendChild(h('div', { class: 'seccion', text: 'Datos en vivo' }));
    rotarConsumo();
    var estado = mcpEstado === 'listo' ? 'Conector "' + SERVIDOR + '" disponible.' : (mcpEstado === 'buscando' ? 'Buscando el conector…' : 'Sin conector: la app funciona con el horario oficial.');
    c.appendChild(h('div', { class: 'tarjeta' },
      h('div', { class: 'fila' }, icono('vivo'), h('span', { class: 'crece fuerte', text: estado })),
      h('div', { class: 'medidor' }, h('i', { style: 'width:' + Math.min(100, E.consumo.creditosMes / 50) + '%' })),
      h('div', { class: 'entre mini' }, h('span', { text: 'Créditos de Croma usados este mes (aprox.)' }), h('span', { class: 'num fuerte', text: E.consumo.creditosMes + ' de 5.000' })),
      h('div', { class: 'mini', style: 'margin-top:4px', text: 'Hoy: ' + E.consumo.vivoHoy + ' de ' + A.topeDiario + ' consultas en vivo. Cada una cuesta 10 créditos; planear y ver horarios no gasta.' })));
    c.appendChild(h('div', { class: 'campo' }, h('span', { text: 'Consultar en vivo sola antes de salir' }), opciones([[true, 'Sí'], [false, 'No']], A.vivoAuto, function (v) { A.vivoAuto = v; })));
    c.appendChild(h('label', { class: 'campo' }, h('span', { text: 'Tope de consultas en vivo por día' }), numero('aj-tope', A.topeDiario, 0, 60, function (v) { A.topeDiario = v; })));

    c.appendChild(h('div', { class: 'seccion', text: 'Acerca de' }));
    c.appendChild(h('p', { class: 'mini', text: 'Horarios y recorridos: datos abiertos de TransMilenio S.A. (GTFS del ' + base.generado.split('-').reverse().join('/') + '). En vivo: Croma. Mapa: OpenStreetMap, OpenMapTiles y OpenFreeMap.' }));
    c.appendChild(h('p', { class: 'mini', text: 'La app no puede leer tu ubicación ni avisar cuando está cerrada. Tus lugares y rutinas se guardan en tu espacio privado.' }));
  }

  /* ---------- reloj ---------- */

  function tic() {
    if (!base || document.hidden) return;
    viajes.forEach(function (v) {
      if (v.estado !== 'listo' || !v.tr || v.dias !== 0) return;
      var falta = faltaPara(v.fecha, v.tr.sale);
      if (falta < -75 && (!v.tarde || (!v.tarde.pidiendo && Date.now() - v.tarde.en > 120000))) recalcularTarde(v);
      if (E.ajustes.vivoAuto && mcp && falta < 12 * 60 && falta > -4 * 60 && cupoVivo()) {
        var edad = v.vivo ? Date.now() - v.vivo.en : Infinity;
        if (!v.vivo || (falta < 4.5 * 60 && edad > 6 * 60000 && v.vivo.automatico)) consultarVivo(v, true);
      }
    });
    var nuevos = proximosViajes();
    if (nuevos.length !== viajes.length || nuevos.some(function (n, i) { return n.clave !== viajes[i].clave; })) planearViajes();
    var enfoque = document.activeElement;
    if (vista === 'hoy' && !(enfoque && /^(INPUT|SELECT|TEXTAREA)$/.test(enfoque.tagName))) pintar();
  }

  /* ---------- arranque ---------- */

  function conectar() {
    Array.prototype.forEach.call($('pestanas').children, function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-pestana');
        if (p === 'hoy') { seleccion = null; marcarPunto(); }
        edicion = null;
        ir(p);
      });
    });
    $('abrir-buscador').addEventListener('click', function () { abrirBuscador('general'); });
    $('elegir-cancelar').addEventListener('click', function () { eligiendo = null; $('elegir').hidden = true; $('arriba').hidden = false; fijarPanel('medio'); });
    $('c-mas').addEventListener('click', function () { if (mapa) mapa.zoomIn(); });
    $('c-menos').addEventListener('click', function () { if (mapa) mapa.zoomOut(); });
    $('c-centrar').addEventListener('click', function () {
      if (activo) { dibujarTrayecto(activo.tr, activo.desde, activo.hasta); return; }
      if (E.lugares.length) encuadrar(E.lugares.map(function (l) { return [l.lon, l.lat]; }), 13.5);
      else if (mapa) mapa.easeTo({ center: [-74.085, 4.66], zoom: 11.2 });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tic(); });
    conectarPanel();
  }

  function iniciar() {
    E = normalizar(leerLocal());
    try { var f = JSON.parse(localStorage.getItem(CLAVE_FILTROS)); if (f) { filtros.paraderos = !!f.paraderos; filtros.estaciones = !!f.estaciones; filtros.recargas = !!f.recargas; } } catch (e) { /* sin almacenamiento */ }
    conectar();
    fijarPanel('medio');
    pintarFiltros();
    iniciarMapa();
    leerJson('red/base.json').then(function (b) {
      base = b; red = P.crearRed(b);
      prepararBusqueda();
      cargarCapasTransporte();
      motor.iniciar();
      planearViajes();
      pintar();
      iniciarNube();
      iniciarVivo();
      setInterval(tic, 20000);
    }).catch(function () {
      var c = $('contenido');
      c.textContent = '';
      c.appendChild(cabecera('A Tiempo'));
      c.appendChild(h('div', { class: 'vacio', text: 'No se pudo cargar la red de transporte. Revisa tu conexión y vuelve a abrir la app.' }));
    });
  }

  // solo para pruebas: mover el reloj y cargar datos de ejemplo sin tocar la base
  window.ATiempo = {
    fijarAhora: function (iso) { desfase = iso ? new Date(iso).getTime() - Date.now() : 0; planearViajes(true); pintar(); },
    cargar: function (datos) { E = normalizar(datos); pintarLugares(); planearViajes(true); pintar(); },
    estado: function () { return { vista: vista, viajes: viajes.map(function (v) { return { estado: v.estado, sale: v.tr && v.tr.sale, llega: v.tr && v.tr.llega }; }) }; }
  };

  iniciar();
})();
