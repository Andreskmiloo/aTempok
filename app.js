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
  var datosMapa = { paraderos: VACIO, estaciones: VACIO, ruta: VACIO, rutaCompleta: VACIO, rutaParadas: VACIO, buses: VACIO, toque: VACIO, cinta: VACIO, buses3d: VACIO, trayectorias: VACIO };
  var indice = [];                               // textos para el buscador
  var panelEstado = 'medio';
  var desfase = 0;                               // solo para pruebas: corre el reloj
  var busesVivo = { cuenta: 0, reloj: null, en: 0, antes: {}, ruta: null };
  var COLOR_TRAFICO = { fluido: '#1e9e57', moderado: '#e8850c', pesado: '#d23b2f' };
  var NOMBRE_TRAFICO = { fluido: 'Tráfico fluido', moderado: 'Tráfico moderado', pesado: 'Tráfico pesado' };
  var CAUSAS = { accident: 'Accidente', construction: 'Obras', demonstration: 'Manifestación', weather: 'Clima', technical_problem: 'Falla técnica',
                 strike: 'Paro', police_activity: 'Operativo policial', medical_emergency: 'Emergencia médica', maintenance: 'Mantenimiento', holiday: 'Festivo' };
  var EFECTOS = { detour: 'Desvío', no_service: 'Sin servicio', reduced_service: 'Servicio reducido', significant_delays: 'Retrasos fuertes',
                  modified_service: 'Servicio modificado', stop_moved: 'Paradero movido', additional_service: 'Servicio adicional' };
  var reloj = { corr: 0, estado: 'buscando', en: 0 };    // correccion del reloj con la hora del servidor
  var ubi = { estado: 'nada', lat: null, lon: null, precision: null, en: 0, marca: null, vigia: null, manual: false };
  var cerca = { clave: '', en: 0, lista: null, pidiendo: false, vivo: null };
  var senales = [];                              // marcadores de lo que pasa en la ruta dibujada
  var lineaInfo = null, lineaSel = null, plano = false;   // ruta vista completa
  var perfiles = {};                             // trafico por hora de cada rutina (para "Lo que he aprendido")
  var rutasFiltro = { texto: '', sis: -1 };
  var destinoVisto = false;                      // la pantalla "A donde vas?" se abre una vez por sesion

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
  function sinTildes(s) {
    s = String(s).toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }
  function nuevoId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function ahora() { return new Date(Date.now() + reloj.corr + desfase); }

  /* Hora de Bogota: se corrige el reloj del dispositivo con la cabecera Date de un archivo propio de la app */
  function sincronizarHora() {
    if (navigator.onLine === false) { reloj.estado = 'sin'; pintarSiHoy(); return; }
    var t0 = Date.now();
    fetch('mapa/indice.json', { cache: 'no-store' }).then(function (r) {
      var t1 = Date.now(), servidor = Date.parse(r.headers.get('Date') || '');
      if (isNaN(servidor)) { reloj.estado = 'dispositivo'; return; }
      var corr = servidor + 500 + (t1 - t0) / 2 - t1;     // la cabecera viene en segundos enteros
      reloj.corr = Math.abs(corr) < 2500 ? 0 : Math.round(corr);
      reloj.estado = 'ok'; reloj.en = Date.now();
    }).catch(function () { reloj.estado = navigator.onLine === false ? 'sin' : 'dispositivo'; }).then(pintarSiHoy);
  }
  function pintarSiHoy() {
    var enfoque = document.activeElement;
    if (base && (vista === 'hoy' || vista === 'destino') && !(enfoque && /^(INPUT|SELECT|TEXTAREA)$/.test(enfoque.tagName))) pintar();
  }
  function textoReloj() {
    var hora = hora12(servicio().seg);
    if (reloj.estado === 'sin') return 'Sin conexión · hora del dispositivo ' + hora;
    return 'Hora de Bogotá ' + hora;
  }
  /* Horas de alto trafico en dia habil: 5:30 a 9:00 y 4:00 a 8:00 p. m. */
  function esPico(tipo, seg) {
    var s = seg % 86400;
    return tipo === 'habil' && ((s >= 19800 && s < 32400) || (s >= 57600 && s < 72000));
  }
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
             consumo: { dia: '', vivoHoy: 0, mes: '', creditosMes: 0 }, aprendizaje: {}, perfil: { nombre: '' }, historial: [] };
  }
  function normalizar(e) {
    var ini = estadoInicial(), k;
    if (!e || typeof e !== 'object') return ini;
    for (k in ini) if (e[k] === undefined || e[k] === null) e[k] = ini[k];
    if (typeof e.perfil !== 'object') e.perfil = { nombre: '' };
    if (typeof e.perfil.nombre !== 'string') e.perfil.nombre = '';
    if (!Array.isArray(e.historial)) e.historial = [];
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
  var nube = { doc: null, reloj: null, ocupada: false, pendiente: false, buscando: false };
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
    nube.buscando = true;
    function terminar() {
      if (nube.nombrePendiente) {               // el nombre se escribio mientras cargaba: se aplica sobre lo guardado
        if (!E.perfil.nombre) { E.perfil.nombre = nube.nombrePendiente; guardar(); }
        nube.nombrePendiente = '';
      }
      pintarEntrada();
      if (nube.buscando) { nube.buscando = false; if (vista === 'hoy') pintar(); }
    }
    setTimeout(terminar, 12000);
    Promise.all([window.claude.use('user'), window.claude.use('db')]).then(function (r) {
      if (!r[0] || !r[1]) return null;
      return r[0].id().then(function (id) {
        if (!id) return null;
        nube.doc = r[1].doc('data/users/' + id + '/datos');
        return conLimite(nube.doc.get(), 10000);
      });
    }).then(function (foto) {
      if (!nube.doc) return;
      if (!foto) { nube.doc = null; return; }   // la base no respondio: no se escribe para no pisar lo guardado
      var remoto = foto.exists ? foto.data() : null;
      // un dispositivo nuevo nunca pisa lugares guardados con un estado vacio
      var vacioLocal = !E.lugares.length && !E.rutinas.length, conDatos = remoto && remoto.lugares && remoto.lugares.length;
      if (remoto && ((remoto.actualizado || 0) > (E.actualizado || 0) || (vacioLocal && conDatos))) {
        var nombreLocal = E.perfil.nombre;
        E = normalizar(JSON.parse(JSON.stringify(remoto)));
        guardarLocal();
        if (!E.perfil.nombre && nombreLocal) { E.perfil.nombre = nombreLocal; guardar(); }
        nube.buscando = false;
        alCambiarDatos();
      } else if (E.actualizado && (!remoto || (remoto.actualizado || 0) < E.actualizado)) {
        programarNube();
      }
    }).catch(function () { nube.doc = null; }).then(terminar);
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
    m = /^at:\/\/r\/(\d+)\/(\d+)\/(\d+)/.exec(pedido.url);
    if (m) {   // relieve: PNG Terrarium guardado en base64
      return teselas.then(function (ind) {
        var lista = ind.r && ind.r[m[1]];
        if (!lista || lista.indexOf(m[2] + '-' + m[3]) < 0) throw new Error('sin relieve');
        return leerJson('mapa/r/' + m[1] + '-' + m[2] + '-' + m[3] + '.json');
      }).then(function (texto) { return { data: aBytes(texto).buffer }; });
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

  /* ---------- luz real: el cielo sigue al sol sobre Bogota (idea del Ojo de Dios) ---------- */

  function elevacionSol(fecha) {
    var R = Math.PI / 180, d = fecha.getTime() / 86400000 - 10957.5;      // dias desde J2000
    var g = (357.529 + 0.98560028 * d) * R, q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R, e = (23.439 - 0.00000036 * d) * R;
    var dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24, ha = (gmst * 15 - 74.08) * R - ra, lat = 4.65 * R;
    return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / R;
  }
  function mezclar(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    var x = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); }), y = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join('');
  }
  function cielo(oscuro) {
    var t = ahora(), elev = elevacionSol(t), subiendo = elevacionSol(new Date(t.getTime() + 600000)) > elev;
    var dia = oscuro ? { s: '#1b2740', h: '#2c3550', f: '#17171a' } : { s: '#8fbde8', h: '#e8f0f8', f: '#f3f2ee' };
    var noche = { s: '#03050b', h: '#0b1424', f: oscuro ? '#0b0d12' : '#1a1d26' };
    var oro = subiendo ? { s: '#2a3b5c', h: '#ffb36b', f: '#3a3340' } : { s: '#2b2a4a', h: '#ff7a45', f: '#3b2b35' };
    var c;
    if (elev <= -8) c = noche;
    else if (elev < 0) c = { s: mezclar(noche.s, oro.s, (elev + 8) / 8), h: mezclar(noche.h, oro.h, (elev + 8) / 8), f: mezclar(noche.f, oro.f, (elev + 8) / 8) };
    else if (elev < 12) c = { s: mezclar(oro.s, dia.s, elev / 12), h: mezclar(oro.h, dia.h, elev / 12), f: mezclar(oro.f, dia.f, elev / 12) };
    else c = dia;
    return { 'sky-color': c.s, 'horizon-color': c.h, 'fog-color': c.f, 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.25, 'atmosphere-blend': 0.6 };
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
      sky: cielo(oscuro),
      sources: {
        base: { type: 'vector', tiles: ['at://t/{z}/{x}/{y}'], minzoom: 9, maxzoom: 14 },
        relieve: { type: 'raster-dem', tiles: ['at://r/{z}/{x}/{y}'], encoding: 'terrarium', tileSize: 256, minzoom: 9, maxzoom: 12 },
        // paraderos agrupados en burbujas al alejar el mapa
        paraderos: { type: 'geojson', data: datosMapa.paraderos, cluster: true, clusterMaxZoom: 13, clusterRadius: 75 }, estaciones: geo('estaciones'), rutaCompleta: geo('rutaCompleta'), ruta: geo('ruta'),
        rutaParadas: geo('rutaParadas'), buses: geo('buses'), toque: geo('toque'), cinta: geo('cinta'), buses3d: geo('buses3d'), trayectorias: geo('trayectorias')
      },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': c.tierra } },
        { id: 'uso', type: 'fill', source: 'base', 'source-layer': 'landuse', paint: { 'fill-color': c.uso } },
        { id: 'reserva', type: 'fill', source: 'base', 'source-layer': 'park', paint: { 'fill-color': c.bosque, 'fill-opacity': 0.7 } },
        { id: 'bosque', type: 'fill', source: 'base', 'source-layer': 'landcover', filter: clase(['wood']), paint: { 'fill-color': c.bosque } },
        { id: 'pasto', type: 'fill', source: 'base', 'source-layer': 'landcover', filter: clase(['grass', 'wetland']), paint: { 'fill-color': c.verde } },
        // sombras del relieve: los cerros orientales se ven en volumen
        { id: 'sombras', type: 'hillshade', source: 'relieve', paint: { 'hillshade-exaggeration': oscuro ? 0.45 : 0.32,
          'hillshade-shadow-color': oscuro ? '#000000' : '#6b6b78', 'hillshade-highlight-color': oscuro ? '#2a2a30' : '#ffffff', 'hillshade-accent-color': oscuro ? '#101014' : '#8a8a96' } },
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

        // edificios en volumen al acercarse
        { id: 'edificios', type: 'fill-extrusion', source: 'base', 'source-layer': 'building', minzoom: 14.5,
          paint: { 'fill-extrusion-color': oscuro ? '#2a2a30' : '#dcdad3', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
                   'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.8] } },
        { id: 'ruta-completa', type: 'line', source: 'rutaCompleta', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 2, 16, 4]), 'line-opacity': 0.32 } },
        // el borde de la ruta toma el color del trafico (verde, naranja o rojo), como en Waze
        // brillo de la ruta mientras se sigue en vivo (la opacidad la mueve moverBuses)
        { id: 'ruta-brillo', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 16, 16, 34]), 'line-blur': 10, 'line-opacity': 0 } },
        { id: 'ruta-borde', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['case', ['has', 'borde'], ['get', 'borde'], c.blanco], 'line-width': z([10, 7, 16, 13]) } },
        { id: 'ruta-linea', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 3.5, 16, 7]) } },
        { id: 'linea-borde', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'linea'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.blanco, 'line-width': z([10, 9, 16, 17]) } },
        { id: 'linea', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'linea'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': z([10, 5.5, 16, 11]) } },
        // cinta 3D: sube a lo largo del recorrido segun los minutos que lleva el bus
        { id: 'cinta', type: 'fill-extrusion', source: 'cinta',
          paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.72 } },
        { id: 'ruta-pie', type: 'line', source: 'ruta', filter: ['==', ['get', 'tipo'], 'pie'], layout: { 'line-cap': 'round' },
          paint: { 'line-color': c.pie, 'line-width': z([10, 2.5, 16, 4.5]), 'line-dasharray': [0.1, 1.8] } },

        texto('nombres-via', 'transportation_name', { minzoom: 12.5, filter: ['any', ['!=', ['get', 'class'], 'minor'], ['>=', ['zoom'], 15]],
          layout: { 'symbol-placement': 'line', 'text-size': z([13, 10.5, 17, 13.5]), 'text-letter-spacing': 0.02, 'symbol-spacing': 320, 'text-max-angle': 35 } }),
        texto('barrios', 'place', { minzoom: 12.2, maxzoom: 16.5,
          filter: ['any', ['==', ['get', 'class'], 'suburb'], ['all', clase(['quarter', 'neighbourhood', 'hamlet']), ['>=', ['zoom'], 14]]],
          layout: { 'text-font': ['Noto Sans Bold'], 'text-size': z([12, 10, 16, 12.5]), 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7 } }),
        texto('ciudades', 'place', { maxzoom: 12.2, filter: clase(['city', 'town', 'village']),
          layout: { 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'class'], 'city', 17, 'town', 13.5, 11.5] }, paint: { 'text-color': c.lugar } }),

        circulo('par-burbujas', 'paraderos', { minzoom: 12.3, maxzoom: 14.3, filter: ['has', 'point_count'], layout: visible(filtros.paraderos),
          paint: { 'circle-radius': ['step', ['get', 'point_count'], 9, 20, 11.5, 60, 14], 'circle-color': c.blanco, 'circle-stroke-color': '#1763c6', 'circle-stroke-width': 1.6, 'circle-opacity': 0.85, 'circle-stroke-opacity': 0.8 } }),
        { id: 'par-burbujas-n', type: 'symbol', source: 'paraderos', minzoom: 12.3, maxzoom: 14.3, filter: ['has', 'point_count'],
          layout: { visibility: filtros.paraderos ? 'visible' : 'none', 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-allow-overlap': true },
          paint: { 'text-color': '#1763c6' } },
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
        // trayectoria de cada bus cercano hasta tu paradero
        { id: 'trayectorias', type: 'line', source: 'trayectorias', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffd60a', 'line-width': z([10, 3, 16, 6]), 'line-dasharray': [0.2, 1.6] } },
        { id: 'buses-3d', type: 'fill-extrusion', source: 'buses3d', layout: visible(filtros.buses),
          paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.9 } },
        circulo('buses-halo', 'buses', { filter: ['==', ['get', 'nivel'], 2], layout: visible(filtros.buses),
          paint: { 'circle-radius': z([10, 13, 15, 22]), 'circle-color': '#ffd60a', 'circle-opacity': 0.45 } }),
        circulo('buses', 'buses', { paint: { 'circle-radius': ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['match', ['get', 'nivel'], 2, 7, 0, 4, 5.5], 15, ['match', ['get', 'nivel'], 2, 12.5, 0, 7, 10]], 'circle-color': ['match', ['get', 'nivel'], 0, '#8e8e93', '#e8850c'],
          'circle-opacity': ['match', ['get', 'nivel'], 0, 0.7, 1], 'circle-stroke-color': c.blanco, 'circle-stroke-width': 2.4, 'circle-stroke-opacity': ['match', ['get', 'nivel'], 0, 0.7, 1] } }),
        { id: 'buses-texto', type: 'symbol', source: 'buses', minzoom: 11,
          layout: { 'text-field': ['get', 'etq'], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'nivel'], 2, 13, 11], 'text-offset': [0, -1.6], 'text-anchor': 'bottom', 'text-allow-overlap': true },
          paint: { 'text-color': c.lugar, 'text-halo-color': c.halo, 'text-halo-width': 2 } }
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
    mapa = new maplibregl.Map({ container: 'mapa', style: estilo(temaOscuro()), center: [-74.09, 4.64], zoom: 10,
                                minZoom: 9.3, maxZoom: 18, maxBounds: CAJA, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
    mapa.touchZoomRotate.disableRotation();
    mapa.keyboard.disableRotation();
    mapa.on('error', function () { /* teselas fuera de la zona empaquetada: se usa la de menor detalle */ });
    mapa.on('load', function () {
      mapaListo = true; pintarLugares(); marcaYo();
      // vuelo de entrada: la camara baja desde la sabana hasta tu ubicacion o tu casa, inclinada
      var destinoVuelo = ubi.lat !== null ? [ubi.lon, ubi.lat] : (E.lugares[0] ? [E.lugares[0].lon, E.lugares[0].lat] : inicio);
      if (!activo && linea === null) {
        if (pocoMovimiento()) mapa.jumpTo({ center: destinoVuelo, zoom: 12.8, pitch: 45 });
        else mapa.flyTo({ center: destinoVuelo, zoom: 12.8, pitch: 45, duration: 2600, curve: 1.5 });
      }
      if (activo) dibujarTrayecto(activo.tr, activo.desde, activo.hasta, true, activo.v);
      else if (linea !== null && lineaInfo) dibujarLinea(linea, lineaInfo.sinServicio ? null : lineaInfo);
    });
    mapa.on('click', alTocarMapa);
    // relieve 3D solo en vista inclinada (en 2D no se nota y cuesta)
    var conTerreno = false;
    function revisarTerreno() {
      var quiere = mapa.getPitch() > 8;
      if (quiere === conTerreno || !mapa.getSource('relieve')) return;
      conTerreno = quiere;
      try { mapa.setTerrain(quiere ? { source: 'relieve', exaggeration: 1.25 } : null); } catch (e) { conTerreno = false; }
    }
    // fluidez: las animaciones se pausan mientras se mueve el mapa y se dibuja con menos pixeles
    var nitido = Math.min(window.devicePixelRatio || 1, 2), fluido = Math.min(nitido, esAncho() ? 1.5 : 1.25), esperaNitidez = 0, propio = false;
    function ponerNitidez(r) { if (!mapa.setPixelRatio || Math.abs(mapa.getPixelRatio() - r) < 0.01) return; propio = true; mapa.setPixelRatio(r); propio = false; }
    mapa.on('movestart', function () { if (propio) return; moviendoMapa = true; clearTimeout(esperaNitidez); if (nitido !== fluido) ponerNitidez(fluido); });
    mapa.on('moveend', function () {
      if (propio) return;
      moviendoMapa = false; revisarTerreno(); marcar3d();
      clearTimeout(esperaNitidez);
      if (nitido !== fluido) esperaNitidez = setTimeout(function () { if (!moviendoMapa) ponerNitidez(nitido); }, 250);
    });
    mapa.on('styledata', function () { if (conTerreno && !mapa.getTerrain()) { conTerreno = false; revisarTerreno(); } });
    // el cielo cambia con la hora del dia
    setInterval(function () { if (mapa.setSky && mapaListo) mapa.setSky(cielo(temaOscuro())); }, 5 * 60000);
    var oscuroAntes = temaOscuro();
    function revisarTema() {
      var o = temaOscuro();
      if (o === oscuroAntes) return;
      oscuroAntes = o;
      conTerreno = false;
      mapa.setStyle(estilo(o));
      mapa.once('styledata', revisarTerreno);
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

  function soloMapa() { return $('app').classList.contains('solo-mapa'); }
  function relleno() {
    if (soloMapa()) return { left: 50, top: 60, right: 70, bottom: 110 };
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

  function dibujarTrayecto(tr, a, b, sinMover, v) {
    if (linea !== null) salirDeLinea();
    activo = { tr: tr, desde: a, hasta: b, v: v || null };
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
        var props = { tipo: 'bus', color: COLOR_SIS[t.sis] };
        if (t.trafico) props.borde = COLOR_TRAFICO[t.trafico.nivel];
        lineas.push(trazo(coords, props));
        for (q = t.posSube; q <= t.posBaja; q++) {
          var extremo = q === t.posSube ? 'sube' : (q === t.posBaja ? 'baja' : '');
          paradas.push(punto([red.lon[p.s[q]], red.lat[p.s[q]]], { extremo: extremo, color: COLOR_SIS[t.sis], i: p.s[q],
            nombre: (extremo === 'sube' ? 'Sube: ' : extremo === 'baja' ? 'Baja: ' : '') + base.par.nom[p.s[q]] }));
        }
        coords.forEach(function (x) { limites.push(x); });
      });
      datosMapa.ruta = fc(lineas); datosMapa.rutaCompleta = fc(completas); datosMapa.rutaParadas = fc(paradas);
      ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas']);
      pintarSenales();
      if (!sinMover) encuadrar(limites);
      if (filtros.buses) refrescarBuses(true);
    }).catch(function () { tostada('No se pudo cargar el recorrido.'); });
  }
  function limpiarTrayecto() {
    if (linea !== null) salirDeLinea();
    activo = null; linea = null;
    datosMapa.ruta = datosMapa.rutaCompleta = datosMapa.rutaParadas = datosMapa.cinta = VACIO;
    ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas', 'cinta']);
    pararBuses();
    quitarSenales();
  }
  /* ----- senales tipo Waze sobre la ruta ----- */

  function quitarSenales() { senales.forEach(function (m) { m.remove(); }); senales = []; }
  function ponerSenal(lon, lat, texto, clase, nombreIcono) {
    if (!mapa || !mapaListo || !window.maplibregl) return;
    var globo = h('div', { class: 'senal s-' + (clase || 'neutra') }, h('span', { class: 'senal-i' }, icono(nombreIcono || 'bus')), h('span', { class: 'senal-t', text: texto }));
    senales.push(new maplibregl.Marker({ element: h('div', { class: 'senal-caja', 'aria-hidden': 'true' }, globo), anchor: 'bottom', offset: [0, -12] })
      .setLngLat([lon, lat]).addTo(mapa));
  }
  /* Lo que pasa en la ruta dibujada: donde subir, trafico, desvios, retrasos y donde bajar (maximo 6 globos) */
  function pintarSenales() {
    quitarSenales();
    if (!activo || !mapa || !mapaListo) return;
    if (activo.varios) {
      activo.varios.forEach(function (op, i) {
        var t = primerBus(op), p = red.pat[t.pat], medio = p.s[Math.round(t.posSube + (t.posBaja - t.posSube) * (i + 1) / (activo.varios.length + 1))];
        ponerSenal(red.lon[medio], red.lat[medio], (i + 1) + ' · ' + t.letrero + ' · ' + minutos(op.duracion), i === 0 ? 'fuerte' : 'neutra', 'bus');
      });
      return;
    }
    var tr = activo.tr, v = activo.v, lista = [];
    var buses = tr.tramos.filter(function (t) { return t.tipo === 'bus'; });
    var vivo = v && v.vivo && v.vivo.estado === 'listo' && Date.now() - v.vivo.en < 10 * 60000 ? v.vivo : null;
    if (v && v.alertas && v.alertas.lista) v.alertas.lista.forEach(function (al) {
      if (al.paraderos.length) lista.push([al.paraderos[0], al.efecto + (al.causa ? ': ' + al.causa.toLowerCase() : ''), 'roja', 'alerta']);
    });
    buses.forEach(function (t, i) {
      var p = red.pat[t.pat], texto = (i === 0 ? 'Sube: ' : 'Cambia a ') + t.letrero + ' · ' + hora12(t.sale), clase = 'neutra';
      if (i === 0 && vivo && vivo.ruta === t.ruta) {
        if (vivo.anomalia) { texto = t.letrero + ' va ' + minutos(vivo.retraso) + ' tarde'; clase = 'roja'; }
        else if (vivo.lista.length) {
          var min = Math.max(0, Math.round((vivo.lista[0].seg - servicio().seg) / 60));
          texto = t.letrero + (min <= 0 ? ' llegando' : ' en ' + min + ' min'); clase = 'verde';
        }
      }
      lista.push([t.sube, texto, clase, i === 0 ? 'bus' : 'cambiar']);
      if (t.trafico && t.trafico.nivel !== 'fluido') {
        lista.push([p.s[Math.round((t.posSube + t.posBaja) / 2)], NOMBRE_TRAFICO[t.trafico.nivel] + ' +' + Math.max(1, Math.round(t.trafico.extra / 60)) + ' min',
          t.trafico.nivel === 'pesado' ? 'roja' : 'naranja', 'trafico']);
      }
    });
    var ultimo = buses[buses.length - 1];
    if (ultimo) lista.push([ultimo.baja, 'Baja · ' + hora12(ultimo.llega), 'neutra', 'check']);
    lista.slice(0, 6).forEach(function (x) { ponerSenal(red.lon[x[0]], red.lat[x[0]], x[1], x[2], x[3]); });
  }

  /* ----- una ruta completa, en 3D ----- */

  /* Reparte los minutos de cada paradero entre los puntos del trazo (todo en posiciones sobre el recorrido) */
  function repartir(posParadas, acumulado, posPuntos) {
    var salida = [], k = 0, n = posParadas.length;
    posPuntos.forEach(function (x) {
      while (k < n - 2 && posParadas[k + 1] < x) k++;
      var a = posParadas[k], b = posParadas[k + 1], u = b > a ? Math.max(0, Math.min(1, (x - a) / (b - a))) : 0;
      salida.push(acumulado[k] + (acumulado[k + 1] - acumulado[k]) * u);
    });
    return salida;
  }
  function cintaDe(coords, tiempos, total, color) {
    var cinta = [], ancho = 140;  // metros a cada lado del recorrido (se ve bien desde la ciudad)
    for (var k = 0; k < coords.length - 1; k++) {
      var a = coords[k], b = coords[k + 1], kx = Math.cos(a[1] * Math.PI / 180) * 111320;
      var dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * 110574, largo = Math.sqrt(dx * dx + dy * dy);
      if (largo < 1) continue;
      var nx = -dy / largo * ancho / kx, ny = dx / largo * ancho / 110574;
      var alto = 60 + 1400 * ((tiempos[k] + tiempos[k + 1]) / 2) / total;
      cinta.push({ type: 'Feature', properties: { h: Math.round(alto), color: color }, geometry: { type: 'Polygon', coordinates: [[
        [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]] } });
    }
    return cinta;
  }
  function camaraLinea(coords) {
    if (!mapa || !coords.length) return;
    var a = [Infinity, Infinity], b = [-Infinity, -Infinity];
    coords.forEach(function (c) { a[0] = Math.min(a[0], c[0]); a[1] = Math.min(a[1], c[1]); b[0] = Math.max(b[0], c[0]); b[1] = Math.max(b[1], c[1]); });
    var cam = plano ? null : mapa.cameraForBounds([a, b], { padding: relleno(), maxZoom: 14 });
    if (!cam) { mapa.easeTo({ pitch: 0, bearing: 0, duration: 0 }); encuadrar(coords, 14); return; }
    mapa.easeTo({ center: cam.center, zoom: Math.max(9.5, cam.zoom - 0.35), pitch: 55, bearing: -14, duration: pocoMovimiento() ? 0 : 1100 });
  }
  function salirDeLinea() {
    linea = null; lineaInfo = null; lineaSel = null;
    datosMapa.cinta = VACIO; ponerDatos(['cinta']);
    quitarSenales();
    if (mapa && (mapa.getPitch() || mapa.getBearing())) mapa.easeTo({ pitch: 0, bearing: 0, duration: pocoMovimiento() ? 0 : 500 });
  }
  function dibujarLinea(ruta, info) {
    cargarFormas().then(function (lista) {
      if (linea !== ruta) return;
      var forma = formaDe(lista, ruta), color = COLOR_SIS[base.rut.sis[ruta]], p = null, q;
      if (info && info.pat !== undefined) p = red.pat[info.pat];
      if (!p) for (q = 0; q < red.pat.length; q++) if (red.pat[q].r === ruta) { p = red.pat[q]; break; }
      if (!p) return;
      // solo el sentido elegido: desde el paradero a hasta el paradero b del patron
      var a = info && info.ini !== undefined ? info.ini : 0, b = info && info.fin !== undefined ? info.fin : p.s.length - 1;
      var total = info && info.dur ? info.dur : 0, paradas = [];
      for (q = a; q <= b; q++) paradas.push(punto([red.lon[p.s[q]], red.lat[p.s[q]]], { extremo: q === a ? 'sube' : (q === b ? 'baja' : ''), color: color, i: p.s[q], nombre: base.par.nom[p.s[q]] }));
      var coords = paradas.map(function (x) { return x.geometry.coordinates; }), tiempos = total ? info.acumulado : null;
      if (forma.length > 1) {
        var pos = posDe(p, forma);
        if (pos[b] > pos[a]) {
          coords = P.tramoDeForma(forma, pos[a], pos[b]);
          var posPuntos = [pos[a]];
          for (var j = Math.floor(pos[a]) + 1; j <= Math.floor(pos[b]) && j < forma.length; j++) posPuntos.push(j);
          posPuntos.push(pos[b]);
          if (total) tiempos = repartir(pos.slice(a, b + 1), info.acumulado, posPuntos);
        }
      }
      activo = null;
      datosMapa.ruta = fc(coords.length > 1 ? [trazo(coords, { tipo: 'linea', color: color })] : []);
      datosMapa.rutaCompleta = VACIO; datosMapa.rutaParadas = fc(paradas);
      datosMapa.cinta = fc(tiempos && total && !plano ? cintaDe(coords, tiempos, total, color) : []);
      ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas', 'cinta']);
      quitarSenales();
      if (total) {
        ponerSenal(red.lon[p.s[a]], red.lat[p.s[a]], info.enServicio ? 'Sale ' + hora12(info.sale) : 'Sin servicio ahora', 'neutra', 'bus');
        [1 / 3, 2 / 3].forEach(function (f) {
          for (var k = a + 1; k < b; k++) if (info.acumulado[k - a] >= total * f) { ponerSenal(red.lon[p.s[k]], red.lat[p.s[k]], '+' + Math.round(info.acumulado[k - a] / 60) + ' min', 'tiempo', 'reloj'); break; }
        });
        ponerSenal(red.lon[p.s[b]], red.lat[p.s[b]], 'Recorrido completo ' + minutos(total), 'fuerte', 'check');
      }
      camaraLinea(coords);
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
    var burbuja = mapa.getLayer('par-burbujas') ? mapa.queryRenderedFeatures(caja, { layers: ['par-burbujas'] })[0] : null;
    if (burbuja) { mapa.easeTo({ center: burbuja.geometry.coordinates, zoom: Math.min(14.6, mapa.getZoom() + 2), duration: pocoMovimiento() ? 0 : 500 }); return; }
    var capas = ['buses', 'ruta-extremos', 'ruta-paradas', 'recargas', 'estaciones', 'par-zonal', 'par-alim'].filter(function (id) { return mapa.getLayer(id); });
    var hallados = mapa.queryRenderedFeatures(caja, { layers: capas });
    if (hallados.length) {
      var p = hallados[0].properties;
      if (hallados[0].layer.id === 'buses') { tostada('Bus ' + p.cod + (p.placa ? ' · ' + p.placa : '') + ''); return; }
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

  /* ---------- mi ubicacion ---------- */

  function enLaCiudad(lat, lon) { return lon > CAJA[0][0] && lon < CAJA[1][0] && lat > CAJA[0][1] && lat < CAJA[1][1]; }
  function marcaYo() {
    if (!mapa || !window.maplibregl || ubi.lat === null) return;
    if (!ubi.marca) {
      ubi.marca = new maplibregl.Marker({ element: h('div', { class: 'yo-caja', role: 'img', 'aria-label': 'Tu ubicación' }, h('i', { class: 'yo-halo' }), h('i', { class: 'yo-punto' })), anchor: 'center' })
        .setLngLat([ubi.lon, ubi.lat]).addTo(mapa);
    } else ubi.marca.setLngLat([ubi.lon, ubi.lat]);
    ubi.marca.getElement().classList.toggle('manual', ubi.manual);
  }
  function fijarUbicacion(lat, lon, precision, manual) {
    if (!enLaCiudad(lat, lon)) {
      ubi.estado = 'fuera';
      tostada('Tu ubicación está fuera de Bogotá. Puedes tocar el mapa donde estás.');
      pintarSiHoy();
      return;
    }
    var movio = ubi.lat === null || P.distancia(lat, lon, ubi.lat, ubi.lon) > 80;
    ubi.lat = lat; ubi.lon = lon; ubi.precision = precision; ubi.en = Date.now(); ubi.manual = !!manual; ubi.estado = 'ok';
    marcaYo();
    if (movio) pedirCerca();
    if (ubi.paraRuta) {           // se pidio "Mi ubicacion" al planear: se usa apenas llega
      var ctx = ubi.paraRuta; ubi.paraRuta = null;
      if (vista === 'ruta') { Q[ctx] = miPunto(); calcularRuta(); }
    }
    pintarSiHoy();
  }
  function ubicacionManual(motivo) {
    tostada((motivo ? motivo + ' ' : '') + 'Toca el mapa donde estás.');
    elegirEnMapa('Toca el mapa donde estás', function (lat, lon) { fijarUbicacion(lat, lon, null, true); ir('hoy'); if (!esAncho()) fijarPanel('medio'); });
  }
  /* La pagina usa la ubicacion del navegador. Si el visor o el navegador la bloquean, se marca tocando el mapa. */
  function pedirUbicacion(alPulsar) {
    if (!navigator.geolocation) { ubi.estado = 'error'; if (alPulsar) ubicacionManual('Este navegador no comparte la ubicación.'); pintarSiHoy(); return; }
    var primera = true;
    if (ubi.estado !== 'ok') { ubi.estado = 'buscando'; pintarSiHoy(); }
    function bien(pos) {
      fijarUbicacion(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false);
      if (primera && alPulsar && ubi.estado === 'ok') volar(ubi.lon, ubi.lat, 15.2);
      primera = false;
    }
    function mal(e) {
      if (ubi.vigia !== null) { try { navigator.geolocation.clearWatch(ubi.vigia); } catch (x) { /* nada */ } ubi.vigia = null; }
      if (ubi.estado === 'ok' && ubi.manual) return;
      ubi.estado = 'error';
      if (alPulsar) ubicacionManual(e && e.code === 1 ? 'La ubicación está bloqueada en esta vista.' : 'No se pudo leer la ubicación.');
      else pintarSiHoy();
    }
    try {
      if (ubi.vigia !== null) navigator.geolocation.clearWatch(ubi.vigia);
      ubi.vigia = navigator.geolocation.watchPosition(bien, mal, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    } catch (e) { mal(null); }
  }
  function dejarUbicacion() {
    if (ubi.vigia !== null) { try { navigator.geolocation.clearWatch(ubi.vigia); } catch (x) { /* nada */ } }
    if (ubi.marca) ubi.marca.remove();
    ubi = { estado: 'nada', lat: null, lon: null, precision: null, en: 0, marca: null, vigia: null, manual: false };
    cerca = { clave: '', en: 0, lista: null, pidiendo: false, vivo: null };
    pintar();
  }
  function iniciarUbicacion() {
    // si el permiso ya estaba dado arranca sola; si no, espera a que la persona la pida (sin ventanas al abrir)
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function (r) { if (r.state === 'granted') pedirUbicacion(false); }, function () { /* sin consulta de permisos */ });
      }
    } catch (e) { /* navegador sin permisos */ }
  }
  function miPunto() { return ubi.estado === 'ok' && ubi.lat !== null ? { tipo: 'punto', lat: ubi.lat, lon: ubi.lon, nombre: 'Mi ubicación', yo: true } : null; }

  /* Paraderos mas cercanos y sus proximos buses (horario oficial, no gasta creditos) */
  function pedirCerca() {
    if (!base || ubi.lat === null) return;
    var dia = servicio(), vistos = {}, lista = [];
    P.cercanos(red, ubi.lat, ubi.lon, 600).forEach(function (x) {
      var nombre = base.par.nom[x[0]];
      if (lista.length < 3 && !vistos[nombre]) { vistos[nombre] = 1; lista.push(x); }
    });
    var marca = cerca.marca = (cerca.marca || 0) + 1;
    cerca.en = Date.now(); cerca.pidiendo = true;
    if (!lista.length) { cerca.lista = []; cerca.pidiendo = false; pintarSiHoy(); return; }
    Promise.all(lista.map(function (x) { return motor.pedir({ orden: 'paradero', tipo: dia.tipo, paradero: x[0], t: dia.seg, cuantas: 3 }); })).then(function (r) {
      if (marca !== cerca.marca) return;
      cerca.lista = lista.map(function (x, i) { return { i: x[0], m: Math.round(x[1]), salidas: r[i] }; });
      cerca.pidiendo = false; pintarSiHoy();
    }, function () { cerca.pidiendo = false; cerca.lista = []; pintarSiHoy(); });
  }
  /* Buses en vivo alrededor del punto: una consulta, solo al pulsar. Se manda el punto redondeado (unos 100 m). */
  function busesCerca() {
    if (ubi.lat === null) return;
    cerca.vivo = { estado: 'cargando' }; pintar();
    llamar('transmilenio_vehicles', { latitude: Math.round(ubi.lat * 1000) / 1000, longitude: Math.round(ubi.lon * 1000) / 1000, radius_m: 1200, per_page: 80 }).then(function (d) {
      var feats = (d.vehicles || []).filter(function (x) { return typeof x.latitude === 'number' && typeof x.longitude === 'number'; }).map(function (x) {
        var r = base.rut.id.indexOf(String(x.route_id));
        return punto([x.longitude, x.latitude], { etq: x.route_code || (r >= 0 ? base.rut.cod[r] : ''), nivel: 1, cod: x.route_code || (r >= 0 ? base.rut.cod[r] : ''), placa: x.license_plate || '', va: x.stop_name || '' });
      });
      pararBuses();
      datosMapa.buses = fc(feats); ponerDatos(['buses']);
      if (!filtros.buses) { filtros.buses = true; pintarFiltros(); }
      cerca.vivo = { estado: 'listo', n: feats.length, seg: servicio().seg };
      tostada(feats.length ? feats.length + (feats.length === 1 ? ' bus' : ' buses') + ' a menos de 1,2 km. Están en el mapa.' : 'No hay buses reportando cerca ahora.');
      if (feats.length) encuadrar(feats.map(function (f) { return f.geometry.coordinates; }).concat([[ubi.lon, ubi.lat]]), 15.5);
      pintarSiHoy();
    }).catch(function (e) { cerca.vivo = { estado: 'error', error: textoError(e) }; pintarSiHoy(); });
  }

  /* ---------- entrada sin contrasena ---------- */

  function pintarEntrada() {
    var falta = !E.perfil.nombre && !nube.nombrePendiente;
    var caja = $('inicio');
    if (caja.hidden === !falta) return;
    caja.hidden = !falta;
    if (falta) { $('app').setAttribute('aria-hidden', 'true'); setTimeout(function () { try { $('inicio-nombre').focus(); } catch (e) { /* nada */ } }, 80); }
    else $('app').removeAttribute('aria-hidden');
  }
  function entrar(e) {
    if (e) e.preventDefault();
    var nombre = ($('inicio-nombre').value || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!nombre) { $('inicio-error').hidden = false; $('inicio-nombre').focus(); return; }
    $('inicio-error').hidden = true;
    if (nube.buscando) nube.nombrePendiente = nombre;
    else { E.perfil.nombre = nombre; guardar(); }
    var caja = $('inicio');
    caja.classList.add('saliendo');
    setTimeout(function () { caja.classList.remove('saliendo'); pintarEntrada(); }, pocoMovimiento() ? 0 : 260);
    if ($('inicio-nombre').blur) $('inicio-nombre').blur();
    if (vista !== 'destino') ir('hoy'); else pintar();
  }
  function cerrarSesion() {
    E.perfil.nombre = ''; nube.nombrePendiente = '';
    guardar();
    $('inicio-nombre').value = '';
    pintarEntrada();
    ir('hoy');
  }

  /* ---------- pantalla completa ---------- */

  function verSoloMapa(si) {
    $('app').classList.toggle('solo-mapa', si);
    $('mostrar-panel').hidden = !si;
    if (si) $('mostrar-panel').focus();
    else { fijarPanel(panelEstado === 'min' ? 'medio' : panelEstado); $('cerrar-panel').focus(); }
    if (mapa) mapa.resize();
    if (activo) dibujarTrayecto(activo.tr, activo.desde, activo.hasta, false, activo.v);
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
    $('app').setAttribute('data-panel', estado);
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

  /* Si con los transbordos elegidos no hay ruta, se prueba con uno mas y se avisa */
  function planearConRespaldo(m) {
    return motor.pedir(m).then(function (res) {
      if (res.trayectos.length || res.motivo !== 'sin_servicio' || m.consulta.transbordos >= 2) return res;
      var otra = { orden: m.orden, tipo: m.tipo, consulta: JSON.parse(JSON.stringify(m.consulta)) };
      otra.consulta.transbordos = m.consulta.transbordos + 1;
      return motor.pedir(otra).then(function (r2) {
        if (!r2.trayectos.length) return res;
        r2.ampliado = otra.consulta.transbordos;
        return r2;
      });
    });
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
    planearConRespaldo({ orden: 'planear', tipo: v.tipo, consulta: consulta(a, b, v.rutina.modo, t, v.tipo) }).then(function (res) {
      v.res = res; v.estado = 'listo'; v.tr = null;
      if (res.trayectos.length) {
        v.tr = res.trayectos[0];
        if (v.rutina.preferida) res.trayectos.forEach(function (x) { if (rutasDe(x) === v.rutina.preferida) v.tr = x; });
      }
      if (vista === 'hoy') { pintar(); if (!activo && linea === null && v === viajes[0] && v.tr) dibujarTrayecto(v.tr, a, b, false, v); }
    }, function (e) { v.estado = 'error'; v.error = e.message; if (vista === 'hoy') pintar(); });
  }
  function recalcularTarde(v) {
    var a = lugar(v.rutina.desde), b = lugar(v.rutina.hasta), s = servicio();
    if (v.fecha !== s.fecha || (v.tarde && v.tarde.pidiendo)) return;
    v.tarde = { pidiendo: true, en: Date.now(), tr: v.tarde ? v.tarde.tr : null, listo: !!(v.tarde && v.tarde.listo) };
    planearConRespaldo({ orden: 'planear', tipo: v.tipo, consulta: consulta(a, b, 'salir', s.seg, v.tipo) }).then(function (res) {
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
  /* Historial corto de lo medido y de los viajes registrados (los 20 mas recientes) */
  function anotar(entrada) {
    E.historial.unshift(entrada);
    if (E.historial.length > 20) E.historial.length = 20;
    guardar();
  }
  function quedanConsultas(n) { rotarConsumo(); return E.ajustes.topeDiario - E.consumo.vivoHoy >= n; }

  /* Alertas oficiales de las rutas de un viaje: desvios, cierres, retrasos, con su causa (accidente, obras...) */
  function claveEfecto(x) { return String(x || '').toLowerCase().replace(/[^a-z_]/g, ''); }
  function revisarAlertasViaje(v, automatico) {
    var plan = planVigente(v);
    if (!plan || !plan.bus) return;
    var buses = plan.tr.tramos.filter(function (t) { return t.tipo === 'bus'; }), rutas = [];
    buses.forEach(function (t) { if (rutas.indexOf(t.ruta) < 0) rutas.push(t.ruta); });
    rutas = rutas.slice(0, automatico ? 1 : 2);
    v.alertas = { estado: 'cargando', en: Date.now(), lista: v.alertas && v.alertas.lista ? v.alertas.lista : [], automatico: !!automatico };
    if (!automatico) tostada('Revisando alertas de tu ruta…');
    if (vista === 'hoy') pintar();
    Promise.all(rutas.map(function (r) {
      return llamar('transmilenio_alerts', { route: base.rut.cod[r] }).then(function (d) { return { r: r, alertas: d.alerts || [] }; });
    })).then(function (grupos) {
      var lista = [];
      grupos.forEach(function (g) {
        var tramo = buses.filter(function (t) { return t.ruta === g.r; })[0], p = red.pat[tramo.pat], propios = {};
        for (var q = tramo.posSube; q <= tramo.posBaja; q++) propios[base.par.id[p.s[q]]] = p.s[q];
        g.alertas.forEach(function (al) {
          var rutasAl = al.routes || [];
          if (rutasAl.length && !rutasAl.some(function (x) { return String(x.route_id) === base.rut.id[g.r]; })) return;
          var paraderos = [];
          (al.stops || []).forEach(function (st) { var i = propios[String(st.stop_id)]; if (i !== undefined && paraderos.indexOf(i) < 0) paraderos.push(i); });
          lista.push({ letrero: tramo.letrero, efecto: EFECTOS[claveEfecto(al.effect)] || 'Aviso', causa: CAUSAS[claveEfecto(al.cause)] || '',
                       titulo: String(al.header || '').slice(0, 140), texto: String(al.description || '').slice(0, 280), paraderos: paraderos, tocan: paraderos.length > 0 });
        });
      });
      lista.sort(function (a, b) { return (b.tocan ? 1 : 0) - (a.tocan ? 1 : 0); });
      v.alertas = { estado: 'listo', en: Date.now(), seg: servicio().seg, lista: lista, automatico: !!automatico };
      var grave = lista.filter(function (x) { return x.tocan; })[0];
      if (grave) tostada('Atención: ' + grave.efecto.toLowerCase() + ' en tu recorrido de la ' + grave.letrero + '.');
      else if (!automatico) tostada(lista.length ? 'Hay ' + lista.length + (lista.length === 1 ? ' aviso' : ' avisos') + ' en tus rutas, fuera de tu recorrido.' : 'Sin alertas en tus rutas.');
      if (activo && activo.v === v) pintarSenales();
      if (vista === 'hoy') pintar();
    }).catch(function (e) {
      v.alertas = { estado: 'error', en: Date.now(), error: textoError(e), lista: [], automatico: !!automatico };
      if (!automatico) tostada(textoError(e));
      if (vista === 'hoy') pintar();
    });
  }

  /* "Tome este bus": guarda el viaje, descuenta el pasaje y, si usa la misma ruta dos veces, la app la prefiere */
  function registrarViaje(v, plan) {
    var r = null, firma = rutasDe(plan.tr), texto = 'Viaje guardado.';
    E.rutinas.forEach(function (x) { if (x.id === v.rutina.id) r = x; });
    if (r) {
      r.usos = r.usos || {};
      r.usos[firma] = (r.usos[firma] || 0) + 1;
      if (r.usos[firma] >= 2 && r.preferida !== firma) { r.preferida = firma; texto = 'Listo. "' + r.nombre + '" usará esta ruta de ahora en adelante.'; }
    }
    if (E.saldo !== null) { E.saldo = Math.max(0, E.saldo - base.tarifa); texto += ' Saldo estimado: ' + pesos(E.saldo) + '.'; }
    v.registrado = true;
    anotar({ t: 'viaje', f: v.fecha, cod: plan.tr.tramos.filter(function (t) { return t.tipo === 'bus'; }).map(function (t) { return t.letrero; }).join(' + '), prog: plan.bus.sale, rutina: v.rutina.nombre });
    tostada(texto);
    pintar();
  }

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
        if (seg !== null) lista.push({ seg: seg, base: x.basis || '', bus: x.vehicle_label || '', ret: typeof x.delay_seconds === 'number' ? x.delay_seconds : null });
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
        // si Croma trae el retraso medido se usa ese; si no, la diferencia con el paso programado mas cercano
        var retraso = lista[0].ret !== null ? lista[0].ret : lista[0].seg - mejor;
        var sabe = aprendido(bus.ruta, v.tipo, mejor), normal = sabe ? Math.max(0, sabe.media) : 0;
        v.vivo.retraso = retraso; v.vivo.normal = normal;
        v.vivo.anomalia = retraso - normal >= 8 * 60;      // algo fuera de lo comun: accidente, trancon, desvio...
        aprender(bus.ruta, v.tipo, mejor, retraso);
        anotar({ t: 'medida', f: v.fecha, cod: bus.letrero, prog: mejor, real: mejor + retraso });
        if (v.vivo.anomalia) tostada('Algo pasa en la ' + bus.letrero + ': va ' + minutos(retraso) + ' más tarde de lo normal.');
        if (activo && activo.v === v) pintarSenales();
        if (vista === 'hoy') pintar();
      });
      if (activo && activo.v === v) pintarSenales();
    }).catch(function (e) {
      v.vivo = { estado: 'error', en: Date.now(), error: textoError(e), ruta: bus.ruta, paradero: bus.sube, automatico: !!automatico };
      if (vista === 'hoy') pintar();
    });
  }

  /* Buses en vivo: se consulta cada 2 minutos y, entre consultas, cada bus avanza sobre el recorrido
   * a su velocidad estimada para que el mapa se mueva sin gastar creditos. */
  var flota = { clave: '', rutas: [], buses: {}, reloj: null, anim: null, cuenta: 0, en: 0 };
  var metricas = {};
  function metricaDe(lista, ruta) {
    if (metricas[ruta]) return metricas[ruta];
    var forma = formaDe(lista, ruta), acum = [0];
    for (var k = 1; k < forma.length; k++) acum.push(acum[k - 1] + P.distancia(forma[k - 1][1], forma[k - 1][0], forma[k][1], forma[k][0]));
    return (metricas[ruta] = { forma: forma, acum: acum });
  }
  /* Metros recorridos sobre la forma del punto mas cercano a (lon, lat), buscando entre desde y hasta */
  function pegar(m, lon, lat, desde, hasta) {
    var mejor = null, kx = Math.cos(lat * Math.PI / 180) * 111320;
    for (var k = 0; k < m.forma.length - 1; k++) {
      if (m.acum[k + 1] < desde || m.acum[k] > hasta) continue;
      var a = m.forma[k], b = m.forma[k + 1], ax = (a[0] - lon) * kx, ay = (a[1] - lat) * 110574, dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * 110574;
      var l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0, ex = ax + dx * u, ey = ay + dy * u, d = Math.sqrt(ex * ex + ey * ey);
      if (!mejor || d < mejor.d) mejor = { d: d, s: m.acum[k] + (m.acum[k + 1] - m.acum[k]) * u };
    }
    return mejor;
  }
  function puntoEnMetros(m, metros) {
    var n = m.acum.length, lo = 0, hi = n - 1;
    metros = Math.max(0, Math.min(m.acum[n - 1], metros));
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (m.acum[mid] <= metros) lo = mid; else hi = mid; }
    var largo = m.acum[hi] - m.acum[lo], u = largo ? (metros - m.acum[lo]) / largo : 0, a = m.forma[lo], b = m.forma[hi];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  /* Las 3 opciones mas rapidas con rutas distintas, todas a la vez en el mapa con sus buses en vivo */
  function verVarios(trayectos, a, b) {
    var ops = [], vistas = {};
    trayectos.forEach(function (tr) { var t = primerBus(tr); if (t && !vistas[t.ruta] && ops.length < 3) { vistas[t.ruta] = 1; ops.push(tr); } });
    if (!ops.length) return;
    if (!mcp) { tostada(textoError({ code: 'sin_conector' })); return; }
    if (!quedanConsultas(ops.length)) { tostada('Necesitas ' + ops.length + ' consultas en vivo y tu tope de hoy no alcanza. Súbelo en Ajustes.'); return; }
    cargarFormas().then(function (lista) {
      if (linea !== null) salirDeLinea();
      var lineas = [], paradas = [], limites = [];
      ops.forEach(function (tr) {
        var t = primerBus(tr), p = red.pat[t.pat], forma = formaDe(lista, t.ruta), coords = [], q;
        if (forma.length > 1) { var pos = posDe(p, forma); coords = P.tramoDeForma(forma, pos[t.posSube], pos[t.posBaja]); }
        else for (q = t.posSube; q <= t.posBaja; q++) coords.push([red.lon[p.s[q]], red.lat[p.s[q]]]);
        var props = { tipo: 'bus', color: COLOR_SIS[t.sis] };
        if (t.trafico) props.borde = COLOR_TRAFICO[t.trafico.nivel];
        lineas.push(trazo(coords, props));
        paradas.push(punto([red.lon[t.sube], red.lat[t.sube]], { extremo: 'sube', color: COLOR_SIS[t.sis], i: t.sube, nombre: 'Sube: ' + base.par.nom[t.sube] }));
        coords.forEach(function (x) { limites.push(x); });
      });
      limites.push([a.lon, a.lat], [b.lon, b.lat]);
      activo = { tr: ops[0], desde: a, hasta: b, v: null, varios: ops };
      datosMapa.ruta = fc(lineas); datosMapa.rutaCompleta = VACIO; datosMapa.rutaParadas = fc(paradas);
      ponerDatos(['ruta', 'rutaCompleta', 'rutaParadas']);
      pintarSenales();
      encuadrar(limites);
      if (!esAncho()) fijarPanel('min');
      if (!filtros.buses) { filtros.buses = true; pintarFiltros(); }
      tostada('Buscando los buses de ' + ops.map(function (tr) { return primerBus(tr).letrero; }).join(', ') + '…');
      refrescarBuses(true);
    });
  }
  function pararBuses() {
    clearTimeout(flota.reloj); clearInterval(flota.anim);
    flota = { clave: '', rutas: [], buses: {}, reloj: null, anim: null, cuenta: 0, en: 0 };
    datosMapa.buses = datosMapa.buses3d = datosMapa.trayectorias = VACIO; ponerDatos(['buses', 'buses3d', 'trayectorias']);
    leyenda(false);
    if (mapa && mapa.getLayer('ruta-brillo')) mapa.setPaintProperty('ruta-brillo', 'line-opacity', 0);
  }
  /* Dibuja cada bus donde deberia ir ahora (ultima lectura + velocidad x tiempo, maximo 2,5 minutos) */
  function tramoMetros(m, s1, s2) {
    var salida = [puntoEnMetros(m, s1)];
    for (var k = 0; k < m.acum.length; k++) if (m.acum[k] > s1 && m.acum[k] < s2) salida.push(m.forma[k]);
    salida.push(puntoEnMetros(m, s2));
    return salida;
  }
  var latido = 0, moviendoMapa = false;
  function leyenda(si) {
    var e = $('leyenda-buses');
    if (!e) {
      e = h('div', { id: 'leyenda-buses', class: 'leyenda', 'aria-hidden': 'true' },
        h('span', {}, h('i', { style: 'background:#ffb000' }), 'Vienen cerca'), h('span', {}, h('i', { style: 'background:#e8850c' }), 'Vienen detrás'), h('span', {}, h('i', { style: 'background:#8e8e93' }), 'Ya pasaron'));
      $('app').appendChild(e);
    }
    e.hidden = !si;
  }
  /* Dibuja cada bus donde deberia ir ahora (ultima lectura + velocidad x tiempo, maximo 2,5 minutos).
   * Los 3 que vienen mas cerca de tu paradero se resaltan, con sus minutos y su trayectoria. */
  function moverBuses() {
    if (!flota.clave || document.hidden || moviendoMapa) return;
    var ahoraMs = Date.now(), lista = [], en3d = mapa && mapa.getPitch() > 5, hayLimite = false;
    Object.keys(flota.buses).forEach(function (id) {
      var b = flota.buses[id], c = [b.lon, b.lat], m = metricas[b.ruta], lim = flota.limite ? flota.limite[b.ruta] : undefined, sAhora = null, falta = null;
      var pasado = lim !== undefined && b.s !== null && b.s > lim;
      if (m && b.s !== null) { sAhora = b.s + b.v * Math.min(150, (ahoraMs - b.t) / 1000); c = puntoEnMetros(m, sAhora); }
      if (lim !== undefined && sAhora !== null) { hayLimite = true; falta = pasado ? null : Math.max(0, lim - 150 - sAhora); }
      lista.push({ b: b, c: c, m: m, s: sAhora, falta: falta, pasado: pasado, fin: lim === undefined ? null : lim - 150 });
    });
    var cercanos = lista.filter(function (x) { return x.falta !== null; }).sort(function (x, y) { return x.falta - y.falta; }).slice(0, 3);
    var puntos = [], cubos = [], trayectorias = [];
    leyenda(hayLimite);
    lista.forEach(function (x) {
      // 2: los 3 que vienen mas cerca; 1: vienen detras; 0: ya pasaron tu paradero
      var cerca = cercanos.indexOf(x) >= 0, nivel = x.pasado ? 0 : (cerca ? 2 : 1), cod = base.rut.cod[x.b.ruta], etq = cod;
      if (x.pasado) etq = cod + ' · ya pasó';
      else if (x.falta !== null) {
        var min = Math.round(x.falta / Math.max(1.5, x.b.v) / 60);
        etq = cod + (min <= 0 ? ' · llegando' : ' · a ' + min + ' min');
        if (cerca && x.falta > 30) trayectorias.push(trazo(tramoMetros(x.m, x.s, x.fin), {}));
      }
      puntos.push(punto(x.c, { cod: cod, etq: etq, nivel: nivel, placa: x.b.placa }));
      if (en3d) {
        var lado = cerca ? 60 : 45, dx = lado / (Math.cos(x.c[1] * Math.PI / 180) * 111320), dy = lado / 110574;
        cubos.push({ type: 'Feature', properties: { h: cerca ? 260 : (nivel === 0 ? 60 : 130), color: cerca ? '#ffb000' : (nivel === 0 ? '#8e8e93' : '#e8850c') },
          geometry: { type: 'Polygon', coordinates: [[[x.c[0] - dx, x.c[1] - dy], [x.c[0] + dx, x.c[1] - dy], [x.c[0] + dx, x.c[1] + dy], [x.c[0] - dx, x.c[1] + dy], [x.c[0] - dx, x.c[1] - dy]]] } });
      }
    });
    datosMapa.buses = fc(puntos); datosMapa.buses3d = fc(cubos); datosMapa.trayectorias = fc(trayectorias);
    ponerDatos(['buses', 'buses3d', 'trayectorias']);
    // la ruta late suave mientras se sigue en vivo
    latido = (latido + 1) % 2;
    if (mapa && mapa.getLayer('ruta-brillo')) mapa.setPaintProperty('ruta-brillo', 'line-opacity', pocoMovimiento() ? 0.45 : (latido ? 0.6 : 0.3));
  }
  function refrescarBuses(primera) {
    if (!filtros.buses) return;
    var rutas = [];
    if (linea !== null) rutas = [linea];
    else if (activo && activo.varios) activo.varios.forEach(function (op) { var t = primerBus(op); if (rutas.indexOf(t.ruta) < 0) rutas.push(t.ruta); });
    else if (activo) activo.tr.tramos.forEach(function (t) { if (t.tipo === 'bus' && rutas.indexOf(t.ruta) < 0 && rutas.length < 2) rutas.push(t.ruta); });
    var tope = activo && activo.varios ? 3 : 5, subidas = [];
    if (activo && linea === null) (activo.varios || [activo.tr]).forEach(function (op) { var t = primerBus(op); if (t) subidas.push(t); });
    if (!rutas.length) { tostada('Elige una ruta para ver sus buses en vivo.'); return; }
    var clave = rutas.join(',');
    if (primera && clave === flota.clave && Date.now() - flota.en < 110000) return;   // ya se esta siguiendo: no se gasta otra consulta
    clearTimeout(flota.reloj);
    if (primera && clave !== flota.clave) { clearInterval(flota.anim); flota = { clave: clave, rutas: rutas, buses: {}, reloj: null, anim: null, cuenta: 0, en: 0 }; }
    if (primera) flota.cuenta = 0;
    flota.en = Date.now();
    Promise.all([cargarFormas()].concat(rutas.map(function (r) {
      return llamar('transmilenio_vehicles', { route: base.rut.cod[r], per_page: 200 }).then(function (d) {
        return (d.vehicles || []).filter(function (x) { return String(x.route_id) === base.rut.id[r] && typeof x.latitude === 'number'; }).map(function (x) { x.r = r; return x; });
      });
    }))).then(function (res) {
      if (flota.clave !== clave) return;
      var lista = res[0], ahoraMs = Date.now(), nuevos = {}, vels = [], n = 0;
      // solo interesan los buses que aun no pasan por tu paradero de subida
      flota.limite = {};
      subidas.forEach(function (t) {
        var m = metricaDe(lista, t.ruta);
        if (m.forma.length < 2) return;
        var pos = posDe(red.pat[t.pat], m.forma)[t.posSube], k = Math.min(m.acum.length - 2, Math.floor(pos));
        flota.limite[t.ruta] = m.acum[k] + (m.acum[k + 1] - m.acum[k]) * (pos - k) + 150;
      });
      res.slice(1).forEach(function (grupo) { grupo.forEach(function (x, i) {
        var id = x.r + ':' + (x.license_plate || x.vehicle_label || i), antes = flota.buses[id], m = metricaDe(lista, x.r), s0 = null;
        var v = base.rut.sis[x.r] === 0 ? 7 : 4.5;      // metros por segundo tipicos: troncal y zonal
        if (m.forma.length > 1) {
          var cerca = antes && antes.s !== null ? pegar(m, x.longitude, x.latitude, antes.s - 300, antes.s + 4000) : null;
          if (!cerca || cerca.d > 150) cerca = pegar(m, x.longitude, x.latitude, -1, Infinity);
          if (cerca && cerca.d < 300) s0 = cerca.s;
        }
        // la lectura trae su hora: se descuenta lo que lleva de vieja
        var leida = Date.parse(x.reported_at || ''), tBus = isNaN(leida) ? ahoraMs : ahoraMs - Math.max(0, Math.min(180000, ahora().getTime() - leida));
        if (antes) {
          v = antes.v;
          var dt = (tBus - antes.t) / 1000;
          if (s0 !== null && antes.s !== null && dt > 40) {
            var medida = (s0 - antes.s) / dt;
            if (medida >= 0 && medida < 22) { v = Math.max(0.5, medida); vels.push(medida * 3.6); }
          }
        }
        nuevos[id] = { ruta: x.r, lon: x.longitude, lat: x.latitude, s: s0, v: v, t: tBus, placa: x.license_plate || '', va: x.stop_name || '' };
        n++;
      }); });
      flota.buses = nuevos; flota.cuenta++;
      moverBuses();
      if (!flota.anim) flota.anim = setInterval(moverBuses, 1000);
      if (vels.length) {
        vels.sort(function (a, b) { return a - b; });
        var kmh = Math.round(vels[Math.floor(vels.length / 2)]), nivel = kmh < 12 ? 'pesado' : (kmh < 20 ? 'moderado' : 'fluido');
        busesVivo.vel = { kmh: kmh, nivel: nivel, n: vels.length, en: ahoraMs };
        tostada('Los buses van a ' + kmh + ' km/h en promedio: ' + NOMBRE_TRAFICO[nivel].toLowerCase() + '.');
        if (vista === 'hoy') pintar();
      }
      if (primera) {
        tostada(n ? n + (n === 1 ? ' bus' : ' buses') + ' en el mapa. Se actualiza cada 2 minutos.' : 'No hay buses reportando en esta ruta ahora.');
        if (n && mapa && linea === null) {      // acerca la camara a la ruta, inclinada
          var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          datosMapa.ruta.features.forEach(function (f) { f.geometry.coordinates.forEach(function (c) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }); });
          var cam = x0 < Infinity ? mapa.cameraForBounds([[x0, y0], [x1, y1]], { padding: relleno(), maxZoom: 15 }) : null;
          if (cam) mapa.easeTo({ center: cam.center, zoom: cam.zoom - 0.3, pitch: 50, duration: pocoMovimiento() ? 0 : 900 });
          else mapa.easeTo({ pitch: 50, duration: pocoMovimiento() ? 0 : 700 });
        }
      }
      if (flota.cuenta < tope) flota.reloj = setTimeout(function () { if (document.hidden) pararBuses(); else refrescarBuses(false); }, 120000);
      else { tostada('Buses en vivo en pausa para ahorrar créditos. Toca "Buses en vivo" para seguir.'); filtros.buses = false; pintarFiltros(); pararBuses(); }
    }).catch(function (e) {
      tostada(textoError(e));
      filtros.buses = false; pintarFiltros(); pararBuses();
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
    ver('par-zonal', filtros.paraderos); ver('par-alim', filtros.paraderos); ver('par-burbujas', filtros.paraderos); ver('par-burbujas-n', filtros.paraderos);
    ver('estaciones', filtros.estaciones); ver('recargas', filtros.recargas); ver('recargas-signo', filtros.recargas);
    ver('buses', filtros.buses); ver('buses-texto', filtros.buses); ver('buses-3d', filtros.buses); ver('buses-halo', filtros.buses);
  }
  function alternarFiltro(id) {
    filtros[id] = !filtros[id];
    try { localStorage.setItem(CLAVE_FILTROS, JSON.stringify({ paraderos: filtros.paraderos, estaciones: filtros.estaciones, recargas: filtros.recargas })); } catch (e) { /* sin almacenamiento */ }
    pintarFiltros();
    if (id === 'buses') { if (filtros.buses) refrescarBuses(true); else { pararBuses(); if (mapa && linea === null && mapa.getPitch()) mapa.easeTo({ pitch: 0, duration: pocoMovimiento() ? 0 : 500 }); } }
    if (id === 'paraderos' && filtros.paraderos && mapa && mapa.getZoom() < 14.3) tostada('Acerca el mapa para ver los paraderos.');
    if (id === 'recargas' && filtros.recargas) tostada('Se recarga en las taquillas de estaciones y portales.');
  }

  /* ---------- vistas ---------- */

  var relojEntrada = null;
  function ir(nombre) {
    var cambia = vista !== nombre, c = $('contenido');
    vista = nombre;
    if (nombre === 'hoy' || nombre === 'rutinas' || nombre === 'ajustes') pestana = nombre;
    pintar();
    c.scrollTop = 0;
    if (cambia && !pocoMovimiento()) {        // el contenido nuevo entra con un deslizamiento corto
      c.classList.remove('entra'); void c.offsetWidth; c.classList.add('entra');
      clearTimeout(relojEntrada); relojEntrada = setTimeout(function () { c.classList.remove('entra'); }, 520);
    }
    if (!esAncho() && panelEstado === 'min' && !eligiendo) fijarPanel('medio');
  }
  function volverAHoy() { seleccion = null; marcarPunto(); ir('hoy'); dibujarPrimero(); }
  function dibujarPrimero() {
    var v = viajes[0];
    if (activo || linea !== null || !v || !v.tr) return;
    dibujarTrayecto(v.tr, lugar(v.rutina.desde), lugar(v.rutina.hasta), true, v);
  }

  function pintar() {
    var c = $('contenido'), arriba = c.scrollTop;
    c.textContent = '';
    Array.prototype.forEach.call($('pestanas').children, function (b) {
      if (b.getAttribute('data-pestana') === pestana) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!base) { c.appendChild(cabecera('A Tiempo')); c.appendChild(espera('Cargando la red de transporte…')); return; }
    ({ hoy: vistaHoy, ruta: vistaRuta, toque: vistaToque, buscar: vistaBuscar, rutinas: vistaRutinas, rutina: vistaRutina,
       ajustes: vistaAjustes, lugar: vistaLugar, linea: vistaLinea, rutas: vistaRutas, destino: vistaDestino, jarvis: vistaJarvis }[vista] || vistaHoy)(c);
    c.scrollTop = arriba;
  }

  function nombreDia(v) {
    var b = new Date(ahora().getTime() - 5 * 3600000);   // calendario de Bogota
    var hoy = b.getUTCFullYear() + '-' + dos(b.getUTCMonth() + 1) + '-' + dos(b.getUTCDate());
    if (v.fecha === hoy || (v.dias === 0 && v.fecha < hoy)) return 'Hoy';
    return v.fecha === sumarDias(hoy, 1) ? 'Mañana' : DIAS[diaSemana(v.fecha)];
  }

  function datosViejos() {
    var p = partes(base.generado), q = partes(servicio().fecha);
    return (Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 86400000 > 30;
  }
  function aviso(color, nombreIcono, titulo, texto, extra) {
    return h('div', { class: 'aviso ' + (color ? 'a-' + color : ''), role: 'status' }, icono(nombreIcono),
      h('div', { class: 'crece' }, h('div', { class: 'fuerte', text: titulo }), texto ? h('div', { class: 'mini', text: texto }) : null, extra || null));
  }
  function atajo(nombreIcono, texto, alPulsar, gris) {
    return h('button', { type: 'button', class: 'atajo', onclick: alPulsar },
      h('span', { class: 'icono-lugar' + (gris ? ' gris' : '') }, icono(nombreIcono)), h('span', { class: 'corta', text: texto }));
  }
  function abrirRutas() { rutasFiltro.texto = ''; ir('rutas'); if (!esAncho()) fijarPanel('max'); }

  /* ---------- Jarvis: controla tus rutas conversando (capacidades sample, dictation y tts) ---------- */

  var muestra = null, dictado = null, voz = null;
  var charla = { turnos: [], ocupado: false, ctl: null, parcial: '', estado: '', borrador: '', escuchando: false, dictadoBase: '', burbuja: null, hablar: false };
  try { charla.hablar = localStorage.getItem('atiempo.voz') === '1'; } catch (e) { /* sin almacenamiento */ }
  function iniciarJarvis() {
    if (!window.claude || !window.claude.use) return;
    window.claude.use('sample').then(function (s) { muestra = s; $('c-jarvis').hidden = !s; }, function () { /* sin Claude */ });
    window.claude.use('tts').then(function (t) { voz = t; }, function () { /* sin voz */ });
    window.claude.use('dictation').then(function (d) {
      dictado = d;
      if (!d) return;
      function escribir(texto) { charla.borrador = texto; var e = $('jarvis-texto'); if (e) e.value = texto; }
      d.onPartial(function (x) { escribir((charla.dictadoBase ? charla.dictadoBase + ' ' : '') + x.text); });
      d.onFinal(function (x) { charla.dictadoBase = ((charla.dictadoBase || '') + ' ' + x.text).trim(); escribir(charla.dictadoBase); });
      d.onState(function (x) {
        var antes = charla.escuchando;
        charla.escuchando = x.state === 'listening';
        if (antes && !charla.escuchando) {          // al terminar de hablar se envia solo
          var texto = (charla.dictadoBase || '').trim();
          charla.dictadoBase = '';
          if (texto) { charla.borrador = ''; preguntarJarvis(texto); return; }
        }
        if (vista === 'jarvis') pintar();
      });
    }, function () { /* sin dictado */ });
  }
  function abrirJarvis() { ir('jarvis'); if (!esAncho()) fijarPanel('max'); }
  function alternarDictado() {
    if (!dictado) return;
    if (charla.escuchando) { dictado.stop().catch(function () { /* nada */ }); return; }
    charla.dictadoBase = (charla.borrador || '').trim();
    dictado.start().catch(function (e) { charla.escuchando = false; if (e && e.code === 'not_granted') dictado = null; if (vista === 'jarvis') pintar(); });
  }
  function progreso(texto) { charla.estado = texto; var e = $('jarvis-estado'); if (e) e.textContent = texto; }
  function esperar(condicion, ms) {
    return new Promise(function (listo) {
      var ini = Date.now();
      (function mirar() { if (condicion()) listo(true); else if (Date.now() - ini > ms) listo(false); else setTimeout(mirar, 300); })();
    });
  }
  /* Lugar guardado, "mi ubicacion", estacion o paradero a partir de un nombre */
  function refLugar(texto) {
    var q = sinTildes(String(texto || '').trim());
    if (!q) return null;
    if (/(mi ubicacion|aqui|donde estoy)/.test(q)) return miPunto();
    var sinon = { u: ['u', 'la u', 'universidad'], casa: ['casa', 'mi casa'], trabajo: ['trabajo', 'el trabajo', 'oficina'] }, i;
    for (i = 0; i < E.lugares.length; i++) {
      var l = E.lugares[i], n = sinTildes(l.nombre);
      if (n === q || q.indexOf(n) >= 0 || (q.length > 3 && n.indexOf(q) >= 0) || (sinon[l.id] && sinon[l.id].indexOf(q) >= 0)) return { tipo: 'lugar', id: l.id };
    }
    var x = refParadero(q);
    if (!x) return null;
    if (x.e !== undefined) return { tipo: 'punto', lat: base.est.lat[x.e] / 1e5, lon: base.est.lon[x.e] / 1e5, nombre: base.est.nom[x.e] };
    return { tipo: 'punto', lat: red.lat[x.i], lon: red.lon[x.i], nombre: base.par.nom[x.i] };
  }
  function refParadero(texto) {
    var q = sinTildes(String(texto || '').trim()), mejor = null;
    if (q.length < 2) return null;
    for (var i = 0; i < indice.length; i++) {
      var x = indice[i];
      if (x.tipo === 'ruta' || x.t.indexOf(q) < 0) continue;
      var p = x.t.indexOf(q) === 0 ? 0 : 1;
      if (!mejor || p < mejor.p || (p === mejor.p && x.tipo === 'estacion' && mejor.x.tipo !== 'estacion')) mejor = { p: p, x: x };
      if (mejor.p === 0 && mejor.x.tipo === 'estacion') break;
    }
    return mejor ? mejor.x : null;
  }
  function rutaPorCodigo(cod) {
    var q = String(cod || '').trim().toUpperCase().replace(/\s+/g, ''), r;
    for (r = 0; r < base.rut.cod.length; r++) if (String(base.rut.cod[r]).toUpperCase() === q) return r;
    for (r = 0; r < base.rut.cod.length; r++) if (String(base.rut.c1[r]).toUpperCase() === q || String(base.rut.c2[r]).toUpperCase() === q) return r;
    return -1;
  }
  function resumenOpcion(tr) {
    var buses = tr.tramos.filter(function (t) { return t.tipo === 'bus'; }), traf = resumenTrafico(tr);
    return { sale: hora12(tr.sale), llega: hora12(tr.llega), minutos: Math.round(tr.duracion / 60), rutas: buses.map(function (t) { return t.letrero; }),
             sube_en: buses[0] ? base.par.nom[buses[0].sube] : null, transbordos: tr.transbordos, caminata_min: Math.round(tr.caminataSeg / 60),
             trafico: traf ? traf.nivel + (traf.extra >= 60 ? ' +' + Math.round(traf.extra / 60) + ' min' : '') : null };
  }
  function mostrarRuta(r) {
    if (linea !== r) pararBuses();
    if (activo) { activo = null; quitarSenales(); }
    linea = r; lineaSel = null; lineaInfo = null;
    var dia = servicio();
    return motor.pedir({ orden: 'resumen', tipo: dia.tipo, ruta: r, t: dia.seg }).then(function (info) {
      info.tipo = dia.tipo; lineaInfo = info; lineaSel = info.clave;
      dibujarLinea(r, info.sinServicio ? null : info);
      return info;
    });
  }
  function herramientasJarvis() {
    var texto = { type: 'string' };
    return [
      { name: 'proximos_viajes', description: 'Los próximos viajes de las rutinas de la persona: a qué hora salir, en qué ruta, a qué hora llega y si hay algo fuera de lo común. Gratis.',
        execute: function () {
          return viajes.slice(0, 4).map(function (v) {
            var plan = v.estado === 'listo' ? planVigente(v) : null, ok = plan && !plan.sinBus;
            return { rutina: v.rutina.nombre, dia: nombreDia(v), meta: (v.rutina.modo === 'llegar' ? 'llegar ' : 'salir ') + hora12(v.objetivo),
                     estado: !plan ? (v.estado || 'calculando') : (plan.sinBus ? 'ya no hay bus' : 'listo'), sal_a_las: ok ? hora12(plan.sale) : null,
                     faltan_min: ok ? Math.round(plan.falta / 60) : null, llegas: ok ? hora12(plan.llega) : null, no_llega_a_tiempo: ok && v.rutina.modo === 'llegar' && plan.llega > v.objetivo,
                     opcion: ok ? resumenOpcion(plan.tr) : null, datos: ok ? (plan.fuente === 'vivo' ? 'en vivo' : 'horario oficial') : null,
                     aviso: v.vivo && v.vivo.anomalia ? 'el bus va ' + Math.round(v.vivo.retraso / 60) + ' min tarde, fuera de lo normal' : null };
          });
        } },
      { name: 'planear_viaje', description: 'Calcula las mejores opciones en bus entre dos lugares y dibuja la mejor en el mapa. Gratis.',
        inputSchema: { type: 'object', properties: { hasta: { type: 'string', description: 'Destino: lugar guardado (Casa, Universidad, Trabajo), estación o paradero' },
          desde: { type: 'string', description: 'Origen; si se omite, la ubicación del dispositivo o Casa' }, hora: { type: 'string', description: 'HH:MM en 24 horas; si se omite, ahora' },
          modo: { type: 'string', enum: ['salir', 'llegar'] } }, required: ['hasta'] },
        execute: function (x) {
          var hRef = refLugar(x && x.hasta);
          if (!hRef) throw new Error('No encontré "' + (x && x.hasta) + '". Usa un lugar guardado, una estación o un paradero.');
          var dRef = x.desde ? refLugar(x.desde) : origenPorDefecto();
          if (!dRef) throw new Error('No encontré el origen "' + x.desde + '".');
          var a = resolver(dRef), b = resolver(hRef), s = servicio(), modo = x.modo === 'llegar' ? 'llegar' : 'salir', t = s.seg;
          if (x.hora && /^\d{1,2}:\d{2}$/.test(String(x.hora).trim())) { t = hhmmASeg(String(x.hora).trim()); if (t < 3 * 3600) t += 86400; }
          progreso('Buscando la mejor ruta…');
          return planearConRespaldo({ orden: 'planear', tipo: s.tipo, consulta: consulta(a, b, modo, modo === 'llegar' ? t - E.ajustes.margen * 60 : t, s.tipo) }).then(function (res) {
            if (res.trayectos[0]) dibujarTrayecto(res.trayectos[0], a, b);
            return { desde: a.nombre, hasta: b.nombre, opciones: res.trayectos.slice(0, 3).map(resumenOpcion), sin_ruta_directa: !!res.ampliado,
                     motivo_sin_ruta: res.trayectos.length ? null : (res.motivo === 'sin_paraderos' ? 'no hay paraderos cerca' : 'no hay servicio a esa hora') };
          });
        } },
      { name: 'ver_ruta', description: 'Muestra una ruta completa en el mapa en 3D y dice cuánto tarda, primera y última salida y cada cuánto pasa. Gratis.',
        inputSchema: { type: 'object', properties: { codigo: texto }, required: ['codigo'] },
        execute: function (x) {
          var r = rutaPorCodigo(x && x.codigo);
          if (r < 0) throw new Error('No hay una ruta con el código ' + (x && x.codigo) + '.');
          progreso('Abriendo la ruta ' + base.rut.cod[r] + '…');
          return mostrarRuta(r).then(function (info) {
            if (info.sinServicio) return { ruta: base.rut.cod[r], nombre: base.rut.nom[r], sin_servicio_hoy: true };
            return { ruta: base.rut.cod[r], nombre: base.rut.nom[r], hacia: base.par.nom[info.paraderos[info.paraderos.length - 1]], minutos: Math.round(info.dur / 60),
                     primera: info.primera !== null ? hora12(info.primera) : null, ultima: info.ultima !== null ? hora12(info.ultima) : null,
                     pasa_cada_min: info.cada ? Math.round(info.cada / 60) : null, paraderos: info.paraderos.length };
          });
        } },
      { name: 'buses_en_vivo', description: 'Ubica en el mapa los buses de una ruta en tiempo real y los sigue cada 2 minutos. Gasta una consulta de Croma.',
        inputSchema: { type: 'object', properties: { codigo: texto }, required: ['codigo'] },
        execute: function (x) {
          var r = rutaPorCodigo(x && x.codigo);
          if (r < 0) throw new Error('No hay una ruta con el código ' + (x && x.codigo) + '.');
          if (!mcp) throw new Error('El conector de Croma no está disponible en esta vista.');
          if (!quedanConsultas(1)) throw new Error('Se acabó el tope de consultas en vivo de hoy (se cambia en Ajustes).');
          progreso('Buscando los buses de la ' + base.rut.cod[r] + '…');
          return mostrarRuta(r).then(function () {
            if (!filtros.buses) { filtros.buses = true; pintarFiltros(); }
            refrescarBuses(true);
            return esperar(function () { return flota.clave === String(r) && flota.cuenta > 0; }, 12000);
          }).then(function (ok) {
            if (!ok) throw new Error('Croma no respondió a tiempo.');
            var vel = busesVivo.vel && Date.now() - busesVivo.vel.en < 90000 ? busesVivo.vel.kmh : null;
            return { ruta: base.rut.cod[r], buses_reportando: Object.keys(flota.buses).length, velocidad_media_kmh: vel, nota: 'Quedan en el mapa y se actualizan cada 2 minutos.' };
          });
        } },
      { name: 'alertas_ruta', description: 'Desvíos, cierres y retrasos oficiales vigentes de una ruta, con su causa. Gasta una consulta de Croma.',
        inputSchema: { type: 'object', properties: { codigo: texto }, required: ['codigo'] },
        execute: function (x) {
          var r = rutaPorCodigo(x && x.codigo);
          if (r < 0) throw new Error('No hay una ruta con el código ' + (x && x.codigo) + '.');
          progreso('Revisando alertas de la ' + base.rut.cod[r] + '…');
          return llamar('transmilenio_alerts', { route: base.rut.cod[r] }).then(function (d) {
            var lista = (d.alerts || []).filter(function (al) { var rs = al.routes || []; return !rs.length || rs.some(function (y) { return String(y.route_id) === base.rut.id[r]; }); });
            return { ruta: base.rut.cod[r], alertas: lista.slice(0, 5).map(function (al) {
              return { efecto: EFECTOS[claveEfecto(al.effect)] || 'Aviso', causa: CAUSAS[claveEfecto(al.cause)] || null, titulo: String(al.header || '').slice(0, 140), detalle: String(al.description || '').slice(0, 200) };
            }) };
          }, function (e) { throw new Error(textoError(e)); });
        } },
      { name: 'llegadas_paradero', description: 'Qué buses llegan en los próximos minutos a un paradero o estación, en vivo. Gasta una consulta de Croma.',
        inputSchema: { type: 'object', properties: { paradero: texto }, required: ['paradero'] },
        execute: function (x) {
          var p = refParadero(x && x.paradero), i;
          if (!p) throw new Error('No encontré el paradero "' + (x && x.paradero) + '".');
          if (p.e !== undefined) { for (i = 0; i < base.par.est.length; i++) if (base.par.est[i] === p.e) break; } else i = p.i;
          if (i === undefined || i >= base.par.id.length) throw new Error('Ese lugar no tiene paraderos.');
          progreso('Consultando llegadas en ' + base.par.nom[i] + '…');
          resaltar(red.lon[i], red.lat[i]); volar(red.lon[i], red.lat[i], 15.5);
          return llamar('transmilenio_stop_arrivals', { stop_id: base.par.id[i], limit: 10 }).then(function (d) {
            return { paradero: base.par.nom[i], llegadas: (d.arrivals || []).slice(0, 8).map(function (a) { return { ruta: a.route_code || '', destino: a.route_name || '', en_min: a.minutes_away }; }) };
          }, function (e) { throw new Error(textoError(e)); });
        } }
    ];
  }
  function instruccionesJarvis(pregunta) {
    var s = servicio(), l = [];
    l.push('Eres Jarvis, el asistente de la app A Tiempo para moverse en SITP y TransMilenio en Bogotá. Tu único trabajo es ayudar a la persona a controlar sus rutas.');
    l.push('Responde en español claro y directo, sin emojis, en máximo 4 frases. Escribe las horas en formato de 12 horas, como 5:20 p. m.');
    l.push('Usa las herramientas para tener datos reales; nunca inventes horarios, rutas ni buses. Si una herramienta falla, dilo en una frase.');
    l.push('buses_en_vivo, alertas_ruta y llegadas_paradero gastan créditos: úsalas solo si la persona pide algo en vivo. Para saber a qué hora salir usa proximos_viajes o planear_viaje.');
    l.push('Ahora: ' + textoReloj() + ', ' + fechaLarga(s.fecha) + ' (' + (s.tipo === 'habil' ? 'día hábil' : s.tipo === 'sabado' ? 'sábado' : 'domingo o festivo') + ').');
    l.push('Lugares guardados: ' + (E.lugares.map(function (x) { return x.nombre; }).join(', ') || 'ninguno') + '.');
    l.push('Rutinas: ' + (E.rutinas.map(function (r) {
      return r.nombre + ' (' + ((lugar(r.desde) || {}).nombre || '?') + ' a ' + ((lugar(r.hasta) || {}).nombre || '?') + ', ' + (r.modo === 'llegar' ? 'llegar ' : 'salir ') + hora12(hhmmASeg(r.hora)) + ', ' + textoDias(r.dias) + ')';
    }).join('; ') || 'ninguna') + '.');
    l.push('Ubicación del dispositivo: ' + (miPunto() ? 'activa' : 'no disponible; el origen por defecto es Casa') + '. Consultas en vivo que quedan hoy: ' + Math.max(0, E.ajustes.topeDiario - E.consumo.vivoHoy) + '.');
    var hist = charla.turnos.slice(-7, -1).map(function (t) { return (t.quien === 'yo' ? 'Persona: ' : 'Jarvis: ') + t.texto; });
    if (hist.length) l.push('\nConversación reciente:\n' + hist.join('\n'));
    l.push('\nPregunta de la persona: ' + pregunta);
    return l.join('\n');
  }
  function preguntarJarvis(texto) {
    texto = String(texto || '').trim();
    if (!texto || charla.ocupado || !muestra) return;
    if (vista !== 'jarvis') abrirJarvis();
    charla.turnos.push({ quien: 'yo', texto: texto });
    charla.ocupado = true; charla.parcial = ''; charla.estado = ''; charla.borrador = '';
    charla.ctl = new AbortController();
    pintar();
    muestra(instruccionesJarvis(texto), { cache: false, modelTier: 'quick', signal: charla.ctl.signal, tools: herramientasJarvis(),
      onText: function (x) { charla.parcial = x.text; if (charla.burbuja) charla.burbuja.textContent = x.text; }
    }).then(function (r) {
      var t = (r && r.text || '').trim() || 'No tengo respuesta para eso.';
      charla.turnos.push({ quien: 'j', texto: t });
      if (charla.hablar && voz) voz.speak(t.slice(0, 2000)).catch(function () { /* sin voz */ });
    }).catch(function (e) {
      var codigo = e && e.code, t;
      if (codigo === 'not_granted') { t = 'Para usar Jarvis, permite que esta página use Claude.'; }
      else if (codigo === 'cancelled') t = (e.text || '').trim() || 'Detenido.';
      else if (codigo === 'rate_limited') t = 'Jarvis está ocupado o llegaste a tu límite de uso. Intenta en un momento.';
      else t = ((e && e.text) ? e.text.trim() + '\n\n' : '') + 'Jarvis no pudo terminar la respuesta. Intenta de nuevo.';
      charla.turnos.push({ quien: 'j', texto: t });
    }).then(function () {
      charla.ocupado = false; charla.parcial = ''; charla.estado = ''; charla.burbuja = null; charla.ctl = null;
      if (vista === 'jarvis') pintar();
    });
  }
  function vistaJarvis(c) {
    c.appendChild(cabecera('Jarvis', volverAHoy));
    c.appendChild(h('p', { class: 'sub', text: muestra ? 'Pregúntale por tus viajes, rutas y buses en vivo. Usa tu cuenta de Claude; lo vivo gasta créditos de Croma.' : 'Jarvis no está disponible en esta vista.' }));
    var lista = h('div', { class: 'charla' });
    if (!charla.turnos.length) {
      lista.appendChild(h('div', { class: 'sugerencias' }, ['¿A qué hora salgo para mi próximo viaje?', '¿Dónde viene la Z8?', '¿Hay desvíos en mi ruta de hoy?', 'Llévame a la universidad para llegar a las 6:00 p. m.'].map(function (t) {
        return h('button', { type: 'button', class: 'sugerencia', text: t, onclick: function () { preguntarJarvis(t); } });
      })));
    }
    charla.turnos.forEach(function (t) { lista.appendChild(h('div', { class: 'msg ' + (t.quien === 'yo' ? 'yo' : 'j'), text: t.texto })); });
    if (charla.ocupado) {
      charla.burbuja = h('div', { class: 'msg j pensando', text: charla.parcial || 'Pensando…' });
      lista.appendChild(charla.burbuja);
      lista.appendChild(h('div', { class: 'mini', id: 'jarvis-estado', text: charla.estado }));
    }
    c.appendChild(lista);
    var entrada = h('input', { class: 'entrada', id: 'jarvis-texto', type: 'text', autocomplete: 'off', enterkeyhint: 'send', placeholder: charla.escuchando ? 'Te escucho…' : 'Escribe o habla', value: charla.borrador,
      oninput: function (e) { charla.borrador = e.target.value; } });
    c.appendChild(h('form', { class: 'chat-form', onsubmit: function (e) { e.preventDefault(); preguntarJarvis(entrada.value); } },
      entrada,
      dictado && !charla.ocupado ? h('button', { type: 'button', class: 'redondo' + (charla.escuchando ? ' escuchando' : ''), 'aria-label': charla.escuchando ? 'Dejar de escuchar' : 'Hablar', onclick: alternarDictado }, icono('mic')) : null,
      charla.ocupado ? h('button', { type: 'button', class: 'boton claro chico', onclick: function () { if (charla.ctl) charla.ctl.abort(); } }, 'Detener')
        : h('button', { type: 'submit', class: 'boton principal chico', disabled: !muestra }, 'Enviar')));
    if (voz) c.appendChild(h('label', { class: 'fila mini', style: 'margin-top:8px' }, h('input', { type: 'checkbox', checked: charla.hablar, onchange: function (e) {
      charla.hablar = e.target.checked;
      try { localStorage.setItem('atiempo.voz', charla.hablar ? '1' : '0'); } catch (x) { /* sin almacenamiento */ }
      if (!charla.hablar) voz.stop();
    } }), 'Leer las respuestas en voz alta'));
    setTimeout(function () { var k = $('contenido'); k.scrollTop = k.scrollHeight; if (esAncho() && !charla.ocupado) { try { entrada.focus(); } catch (e) { /* nada */ } } }, 0);
  }

  /* ---------- Waze, 3D y vuelo de entrada ---------- */

  function enlaceWaze(lon, lat) {
    return h('a', { class: 'boton claro chico', href: 'https://www.waze.com/ul?ll=' + lat.toFixed(5) + '%2C' + lon.toFixed(5) + '&zoom=14', target: '_blank', rel: 'noopener noreferrer' }, icono('trafico'), 'Tráfico en Waze');
  }
  function centroTramo(t) { var p = red.pat[t.pat], q = p.s[Math.round((t.posSube + t.posBaja) / 2)]; return [red.lon[q], red.lat[q]]; }
  function alternar3d() {
    if (!mapa) return;
    var en3d = mapa.getPitch() > 5;
    mapa.easeTo({ pitch: en3d ? 0 : 50, bearing: 0, duration: pocoMovimiento() ? 0 : 700 });
  }
  function marcar3d() { var b = $('c-3d'); if (b && mapa) { var en3d = mapa.getPitch() > 5; b.firstChild.textContent = en3d ? '2D' : '3D'; b.setAttribute('aria-label', en3d ? 'Ver el mapa plano' : 'Ver el mapa en 3D'); } }
  function vivoDeViaje(v) {
    var plan = planVigente(v);
    if (!plan || !plan.tr) { tostada('Ese viaje aún no tiene ruta.'); return; }
    var a = lugar(v.rutina.desde), b = lugar(v.rutina.hasta), conBuses = quedanConsultas(2);
    consultarVivo(v, false);
    if (!conBuses) { tostada('Tu tope de hoy solo alcanza para las llegadas. Súbelo en Ajustes para ver los buses en el mapa.'); return; }
    if (!filtros.buses) { filtros.buses = true; pintarFiltros(); }
    if (activo && activo.v === v && !activo.varios) refrescarBuses(true); else dibujarTrayecto(plan.tr, a, b, false, v);
    if (!esAncho()) fijarPanel('min');
  }

  /* ----- pantalla "A donde vas?" al abrir la app ----- */

  // Casa si existe; si no, el primer lugar guardado
  function origenCasa() { return lugar('casa') || E.lugares[0] || null; }
  // Origen por defecto: tu ubicacion si esta activa; si no, Casa
  function origenPorDefecto() {
    var yo = miPunto();
    if (yo) return yo;
    var c = origenCasa();
    return c ? { tipo: 'lugar', id: c.id } : null;
  }
  function vistaDestino(c) {
    var yo = miPunto(), origen = origenPorDefecto(), desdeTexto = 'Elige el origen';
    if (yo) desdeTexto = 'Mi ubicación';
    else if (origen && lugar(origen.id)) desdeTexto = lugar(origen.id).nombre;
    c.appendChild(h('h2', { class: 'destino-titulo', text: '¿A dónde vas?' }));
    c.appendChild(h('button', { type: 'button', class: 'a-donde', onclick: function () { abrirBuscador('hasta', 'destino'); } },
      icono('buscar'), h('span', { class: 'crece', text: 'Paradero, estación, ruta o lugar' })));
    c.appendChild(h('button', { type: 'button', class: 'punto-b', style: 'margin-top:10px', onclick: function () { abrirBuscador('desde', 'destino'); } },
      h('small', { text: 'Desde' }), h('b', { class: 'corta', text: desdeTexto }), icono('cambiar')));
    c.appendChild(h('p', { class: 'mini', style: 'margin:6px 2px 0', text: yo ? 'Sale desde donde estás. Toca Desde si vas desde otro lugar.' : 'Sale desde tu casa. Toca Desde para cambiarlo o activa tu ubicación.' }));
    var atajos = h('div', { class: 'atajos' });
    E.lugares.forEach(function (l) {
      if (origen && origen.id === l.id) return;
      atajos.appendChild(atajo(l.icono || 'pin', l.nombre, function () { abrirRuta(origen, { tipo: 'lugar', id: l.id }, {}); }));
    });
    c.appendChild(atajos);
    c.appendChild(h('div', { class: 'botones' },
      boton('Elegir en el mapa', 'claro chico', function () {
        elegirEnMapa('Toca el mapa: a dónde vas', function (lat, lon) {
          var cerca = P.cercanos(red, lat, lon, 400)[0];
          abrirRuta(origen, { tipo: 'punto', lat: lat, lon: lon, nombre: cerca ? 'Cerca de ' + base.par.nom[cerca[0]] : 'Punto en el mapa' }, {});
        });
      }, 'mapa'),
      boton('Todas las rutas', 'claro chico', abrirRutas, 'bus')));
    c.appendChild(h('div', { class: 'botones' }, boton('Ver mi próximo viaje', 'principal chico', function () { ir('hoy'); }, 'reloj')));
  }
  function buscarDestino() { prepararRuta(null, null, {}); abrirBuscador('hasta'); }

  function vistaHoy(c) {
    var s = servicio(), nombre = E.perfil.nombre || nube.nombrePendiente || '';
    var saldo = h('button', { type: 'button', class: 'sello ' + (E.saldo !== null && E.saldo < base.tarifa * 2 ? 'naranja' : ''), onclick: function () { ir('ajustes'); },
      text: E.saldo === null ? 'Anotar saldo' : 'Saldo ' + pesos(E.saldo) });
    c.appendChild(cabecera(nombre ? 'Hola, ' + nombre : 'A Tiempo', null, saldo));
    c.appendChild(h('p', { class: 'sub reloj' }, h('i', { class: 'punto ' + (reloj.estado === 'ok' ? 'p-verde' : (reloj.estado === 'sin' ? 'p-rojo' : '')) }),
      h('span', { class: 'num', text: textoReloj() + ' · ' + fechaLarga(s.fecha) + (s.tipo === 'festivo' && diaSemana(s.fecha) !== 0 ? ' · festivo' : '') })));
    if (datosViejos()) c.appendChild(aviso('naranja', 'alerta', 'El horario de la app tiene más de 30 días', 'Algunas rutas pudieron cambiar. Lo vivo sí está al día.'));

    // como en Uber: buscar a donde vas y atajos a tus lugares
    c.appendChild(h('button', { type: 'button', class: 'a-donde', onclick: buscarDestino }, icono('buscar'), h('span', { class: 'crece', text: '¿A dónde vas?' }),
      h('span', { class: 'ahora' }, icono('reloj'), 'Ahora')));
    var atajos = h('div', { class: 'atajos' });
    E.lugares.forEach(function (l) { atajos.appendChild(atajo(l.icono || 'pin', l.nombre, function () { abrirRuta(null, { tipo: 'lugar', id: l.id }, {}); })); });
    atajos.appendChild(atajo('mas', 'Agregar lugar', function () { nuevoLugar('', 'pin'); }, true));
    atajos.appendChild(atajo('bus', 'Todas las rutas', abrirRutas, true));
    c.appendChild(atajos);

    if (!E.lugares.length && nube.buscando) { c.appendChild(espera('Cargando tus lugares y rutinas…')); return; }
    if (!E.lugares.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: 'Guarda tu casa y a dónde vas' }),
        h('p', { class: 'sub', text: 'Con tus lugares y una rutina, la app te dice qué ruta tomar y a qué hora salir.' }),
        h('div', { class: 'botones' }, boton('Agregar mi casa', 'principal chico', function () { nuevoLugar('Casa', 'casa'); }, 'casa'))));
    } else if (!E.rutinas.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: 'Crea tu primera rutina' }),
        h('p', { class: 'sub', text: 'Dile a la app a qué hora debes llegar o salir y qué días. Ella calcula el resto.' }),
        h('div', { class: 'botones' }, boton('Nueva rutina', 'principal chico', function () { nuevaRutina(); }, 'calendario'))));
    } else if (!viajes.length) {
      c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fuerte', text: 'No tienes viajes en los próximos días' }),
        h('p', { class: 'sub', text: 'Revisa los días de tus rutinas.' })));
    }
    if (viajes.length) c.appendChild(h('div', { class: 'seccion', text: viajes[0].dias > 0 ? 'Tu próximo viaje · ' + nombreDia(viajes[0]).toLowerCase() : 'Tus viajes de hoy' }));
    viajes.forEach(function (v) { c.appendChild(tarjetaViaje(v)); });

    seccionCerca(c);

    if (E.lugares.length) {
      c.appendChild(h('div', { class: 'seccion', text: 'Mis lugares' }));
      var lista = h('div', { class: 'lista' });
      E.lugares.forEach(function (l) {
        lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { seleccionar({ tipo: 'lugar', id: l.id }); } },
          h('span', { class: 'icono-lugar' }, icono(l.icono || 'pin')), h('span', { class: 'crece t corta', text: l.nombre }), icono('derecha')));
      });
      c.appendChild(lista);
    }
  }

  function seccionCerca(c) {
    c.appendChild(h('div', { class: 'seccion', text: 'Cerca de ti' }));
    if (ubi.estado !== 'ok') {
      var titulo = ubi.estado === 'buscando' ? 'Buscando tu ubicación…' : 'Paraderos y buses cerca de ti';
      var sub = ubi.estado === 'error' ? 'Esta vista no deja leer la ubicación. Marca en el mapa dónde estás.'
        : (ubi.estado === 'fuera' ? 'Tu ubicación está fuera de Bogotá. Marca en el mapa dónde estás.' : 'Usa tu ubicación para ver el próximo bus y las rutas más rápidas desde donde estás.');
      c.appendChild(h('div', { class: 'tarjeta fila' }, h('span', { class: 'icono-lugar azul' }, icono('ubicacion')),
        h('span', { class: 'crece' }, h('div', { class: 'fuerte', text: titulo }), h('div', { class: 'mini', text: sub })),
        ubi.estado === 'buscando' ? null : boton(ubi.estado === 'nada' ? 'Usar' : 'Marcar', 'principal chico', function () {
          if (ubi.estado === 'nada') pedirUbicacion(true); else ubicacionManual('');
        })));
      return;
    }
    if (!cerca.lista) { c.appendChild(espera('Buscando paraderos cerca…')); return; }
    if (!cerca.lista.length) { c.appendChild(h('div', { class: 'vacio', text: 'No hay paraderos a menos de 600 m de tu ubicación.' })); return; }
    var ahoraSeg = servicio().seg, lista = h('div', { class: 'lista' });
    cerca.lista.forEach(function (x) {
      var salidas = h('div', { class: 'salidas-cerca' });
      if (!x.salidas.length) salidas.appendChild(h('span', { text: 'Sin más salidas hoy' }));
      x.salidas.forEach(function (sx) {
        var n = P.nombreTramo(red, { pat: sx.pat, posSube: sx.pos }), min = Math.round((sx.sale - ahoraSeg) / 60);
        salidas.appendChild(h('span', {}, chip(n.sis, n.letrero), min <= 0 ? 'ahora' : minutos(sx.sale - ahoraSeg)));
      });
      lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { seleccionar({ tipo: 'paradero', i: x.i }); } },
        h('span', { class: 'crece' }, h('div', { class: 't corta', text: base.par.nom[x.i] }), h('div', { class: 'mini', text: 'A ' + x.m + ' m' + (ubi.manual ? ' del punto que marcaste' : '') }), salidas),
        icono('derecha')));
    });
    c.appendChild(lista);
    var estado = null;
    if (cerca.vivo && cerca.vivo.estado === 'cargando') estado = espera('Buscando buses cerca…');
    else if (cerca.vivo && cerca.vivo.estado === 'listo') estado = h('p', { class: 'mini', text: 'A las ' + hora12(cerca.vivo.seg) + ': ' + cerca.vivo.n + (cerca.vivo.n === 1 ? ' bus' : ' buses') + ' a menos de 1,2 km, en el mapa.' });
    else if (cerca.vivo && cerca.vivo.estado === 'error') estado = h('p', { class: 'mini rojo', text: cerca.vivo.error });
    if (estado) c.appendChild(estado);
    c.appendChild(h('div', { class: 'botones' },
      boton('Buses cerca en vivo', 'claro chico', busesCerca, 'vivo'),
      boton(ubi.manual ? 'Usar mi ubicación' : 'Marcar otro punto', 'claro chico', function () { if (ubi.manual) pedirUbicacion(true); else ubicacionManual(''); }, 'ubicacion')));
    c.appendChild(h('p', { class: 'mini', text: 'Los horarios no gastan créditos. "Buses cerca en vivo" usa una consulta de Croma y le envía tu punto aproximado.' }));
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
  /* El peor trafico de los tramos en bus y los minutos de mas que suma */
  function resumenTrafico(tr) {
    var orden = { fluido: 0, moderado: 1, pesado: 2 }, peor = null, extra = 0;
    tr.tramos.forEach(function (t) {
      if (t.tipo !== 'bus' || !t.trafico) return;
      extra += t.trafico.extra;
      if (!peor || orden[t.trafico.nivel] > orden[peor]) peor = t.trafico.nivel;
    });
    return peor ? { nivel: peor, extra: extra } : null;
  }
  function selloTrafico(tr) {
    var t = resumenTrafico(tr);
    if (!t) return null;
    if (t.nivel === 'fluido') return sello('Tráfico fluido', 'verde');
    return sello(NOMBRE_TRAFICO[t.nivel] + ' +' + minutos(t.extra), t.nivel === 'pesado' ? 'rojo' : 'naranja');
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
    t.appendChild(h('div', { class: 'fila', style: 'margin-top:8px' }, resumenTramos(tr)));
    t.appendChild(h('p', { class: 'sub num', text: 'Pasa ' + hora12(plan.fuente === 'vivo' ? v.vivo.elegido.seg : bus.sale) + ' · llegas ' + hora12(plan.llega) +
      (v.rutina.modo === 'llegar' ? (noLlega ? ' (' + minutos(plan.llega - limite) + ' tarde)' : '') : '') }));

    var sellos = h('div', { class: 'sellos', style: 'margin-top:8px' });
    sellos.appendChild(sello(plan.fuente === 'vivo' ? 'En vivo' : 'Horario oficial', plan.fuente === 'vivo' ? 'verde' : ''));
    agregar(sellos, selloTrafico(tr));
    if (esPico(v.tipo, plan.sale)) sellos.appendChild(sello('Hora pico', 'naranja'));
    var vel = busesVivo.vel;
    if (vel && Date.now() - vel.en < 6 * 60000 && activo && activo.v === v) sellos.appendChild(sello('Buses a ' + vel.kmh + ' km/h', vel.nivel === 'pesado' ? 'rojo' : (vel.nivel === 'moderado' ? 'naranja' : 'verde')));
    if (v.res && v.res.ampliado) sellos.appendChild(sello('Con transbordo: no hay ruta directa', 'azul'));
    if (bus.ultimo !== null && bus.ultimo - bus.sale < 60) sellos.appendChild(sello('Último bus del día', 'naranja'));
    else if (bus.ultimo !== null && bus.ultimo - bus.sale < 45 * 60) sellos.appendChild(sello('Último a las ' + hora12(bus.ultimo), 'naranja'));
    var sabe = aprendido(bus.ruta, v.tipo, bus.sale);
    if (sabe && sabe.n >= 2 && Math.abs(sabe.media) >= 90) sellos.appendChild(sello('Suele pasar ' + minutos(Math.abs(sabe.media)) + (sabe.media > 0 ? ' tarde' : ' antes'), 'azul'));
    if (E.saldo !== null && E.saldo < base.tarifa) sellos.appendChild(sello('Saldo insuficiente', 'rojo'));
    if (v.registrado) sellos.appendChild(sello('Viaje registrado', 'verde'));
    t.appendChild(sellos);

    // lo que esta pasando: algo fuera de lo comun, desvios y avisos oficiales
    if (v.vivo && v.vivo.estado === 'listo' && v.vivo.anomalia) {
      t.appendChild(aviso('rojo', 'alerta', 'Algo fuera de lo común en la ' + bus.letrero,
        'Va ' + minutos(v.vivo.retraso) + ' tarde' + (v.vivo.normal >= 90 ? '; lo normal es ' + minutos(v.vivo.normal) : '; normalmente pasa a tiempo') +
        '. Puede ser un accidente o un trancón. Mira otras opciones o la moto.'));
    }
    if (v.alertas && v.alertas.lista && v.alertas.lista.length) {
      v.alertas.lista.slice(0, 2).forEach(function (al) {
        t.appendChild(aviso(al.tocan ? 'rojo' : 'naranja', 'alerta', al.efecto + ' en la ' + al.letrero + (al.causa ? ' · ' + al.causa : ''),
          (al.titulo || al.texto || '') + (al.tocan ? ' Afecta tu recorrido.' : ' No toca tus paraderos.')));
      });
    } else if (v.alertas && v.alertas.estado === 'listo') {
      t.appendChild(h('div', { class: 'fila mini', style: 'margin-top:8px' }, icono('check'), h('span', { text: 'Sin alertas en tu ruta (revisado a las ' + hora12(v.alertas.seg) + ').' })));
    } else if (v.alertas && v.alertas.estado === 'cargando') t.appendChild(espera('Revisando alertas…'));
    else if (v.alertas && v.alertas.estado === 'error' && !v.alertas.automatico) t.appendChild(h('p', { class: 'mini rojo', style: 'margin:8px 0 0', text: v.alertas.error }));

    if (v.vivo) {
      if (v.vivo.estado === 'cargando') t.appendChild(espera('Consultando en vivo…'));
      else if (v.vivo.estado === 'error') t.appendChild(h('p', { class: 'mini rojo', style: 'margin:8px 0 0', text: v.vivo.error }));
      else {
        var lista = v.vivo.lista.slice(0, 3).map(function (x) { return Math.max(0, Math.round((x.seg - servicio().seg) / 60)); });
        var texto = lista.length ? bus.letrero + ' pasa en ' + lista.join(', ') + ' min' : 'No hay buses de la ' + bus.letrero + ' reportando ahora';
        if (v.vivo.retraso !== null && v.vivo.retraso !== undefined && Math.abs(v.vivo.retraso) >= 60) texto += ' · va ' + minutos(Math.abs(v.vivo.retraso)) + (v.vivo.retraso > 0 ? ' tarde' : ' adelantado');
        t.appendChild(h('div', { class: 'fila mini', style: 'margin-top:8px' }, icono('vivo'), h('span', { class: 'crece', text: 'A las ' + hora12(v.vivo.seg) + ': ' + texto + '.' })));
      }
    }
    var anomalia = v.vivo && v.vivo.anomalia;
    if (noLlega || plan.tarde || anomalia) t.appendChild(lineaMoto(a, b, servicio().seg, v.tipo, plan.llega - plan.sale, noLlega || anomalia));

    t.appendChild(h('div', { class: 'botones' },
      boton('Mapa', 'principal chico', function () { dibujarTrayecto(tr, a, b, false, v); if (!esAncho()) fijarPanel('min'); }, 'mapa'),
      boton('En vivo', 'claro chico', function () { vivoDeViaje(v); }, 'vivo'),
      boton(v.abierto ? 'Menos' : 'Más', 'claro chico', function () { v.abierto = !v.abierto; pintar(); })));
    if (v.abierto) {
      if (plan.fuente === 'vivo') t.appendChild(h('p', { class: 'mini', style: 'margin:12px 0 -4px', text: 'El detalle de abajo sigue el horario oficial.' }));
      t.appendChild(detalleTrayecto(tr, a, b));
      t.appendChild(lineaMoto(a, b, tr.sale, v.tipo, tr.duracion, false));
      t.appendChild(h('div', { class: 'botones' },
        boton('Otras opciones', 'claro chico', function () { abrirRuta({ tipo: 'lugar', id: a.id }, { tipo: 'lugar', id: b.id }, { modo: v.rutina.modo, hora: v.rutina.hora, rutina: v.rutina.id, fecha: v.fecha, tipo: v.tipo }); }),
        boton('Alertas de la ruta', 'claro chico', function () { revisarAlertasViaje(v, false); }, 'alerta'),
        boton('Buses que me sirven', 'claro chico', function () { verVarios(v.res.trayectos, a, b); }, 'vivo'),
        (function () { var cw = centroTramo(bus); return enlaceWaze(cw[0], cw[1]); })(),
        v.registrado ? null : boton('Tomé este bus', 'claro chico', function () { registrarViaje(v, plan); }, 'check')));
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

  /* ----- planear ----- */

  function resolver(ref) {
    if (!ref) return null;
    if (ref.tipo === 'lugar') { var l = lugar(ref.id); return l ? { lat: l.lat, lon: l.lon, nombre: l.nombre, id: l.id } : null; }
    return { lat: ref.lat, lon: ref.lon, nombre: ref.nombre || 'Punto en el mapa' };
  }
  /* Prepara un viaje; si no se dice de donde, sale de tu ubicacion (o de tu primer lugar guardado) */
  function prepararRuta(desde, hasta, op) {
    var yo = miPunto();
    if (!desde && yo && !(hasta && hasta.yo)) desde = yo;
    else if (!desde && origenCasa() && !(hasta && hasta.tipo === 'lugar' && hasta.id === origenCasa().id)) desde = { tipo: 'lugar', id: origenCasa().id };
    Q.desde = desde; Q.hasta = hasta; Q.modo = op.modo || 'ahora';
    Q.hora = op.hora || segAHhmm(servicio().seg); Q.rutina = op.rutina || null;
    Q.fecha = op.fecha || null; Q.tipo = op.tipo || null;
    Q.res = null; Q.sel = 0; Q.estado = '';
    seleccion = null; marcarPunto();
  }
  function abrirRuta(desde, hasta, op) {
    prepararRuta(desde, hasta, op);
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
    planearConRespaldo({ orden: 'planear', tipo: Q.tipoUsado, consulta: consulta(a, b, modo, modo === 'llegar' ? t - E.ajustes.margen * 60 : t, Q.tipoUsado) }).then(function (res) {
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
    if (res.ampliado) c.appendChild(aviso('', 'cambiar', 'No hay ruta directa', 'Te muestro opciones con ' + res.ampliado + (res.ampliado === 1 ? ' transbordo' : ' transbordos') + '. El transbordo no se cobra.'));
    c.appendChild(h('div', { class: 'seccion', text: 'Las opciones más rápidas' }));
    c.appendChild(h('div', { class: 'botones', style: 'margin:0 0 4px' }, boton('Buses que me sirven, en vivo', 'claro chico', function () { verVarios(res.trayectos, a, b); }, 'vivo')));
    res.trayectos.forEach(function (tr, i) {
      var elegida = i === Q.sel;
      var t = h('button', { type: 'button', class: 'tarjeta opcion', 'aria-pressed': String(elegida), onclick: function () { Q.sel = i; pintar(); dibujarTrayecto(tr, a, b); } },
        h('div', { class: 'entre' }, h('span', { class: 'fuerte num', text: hora12(tr.sale) + ' → ' + hora12(tr.llega) }), h('span', { class: 'mini num', text: minutos(tr.duracion) })),
        resumenTramos(tr),
        h('div', { class: 'sellos' }, tr.etiquetas.map(function (e, j) { return sello(e, i === 0 && j === 0 ? 'verde' : ''); }), selloTrafico(tr),
          esPico(Q.tipoUsado, tr.sale) ? sello('Hora pico', 'naranja') : null));
      c.appendChild(t);
      if (elegida) {
        var d = h('div', { style: 'margin:-2px 2px 14px' }, detalleTrayecto(tr, a, b));
        var acciones = h('div', { class: 'botones' }, boton('Mapa', 'principal chico', function () { dibujarTrayecto(tr, a, b); if (!esAncho()) fijarPanel('min'); }, 'mapa'));
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
    c.appendChild(cabecera(titulo, function () { if (linea !== null) { seleccion = null; datosMapa.toque = VACIO; ponerDatos(['toque']); ir('linea'); } else volverAHoy(); }));
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

  var rutaTexto = [];
  function prepararBusqueda() {
    var i;
    indice = [];
    for (i = 0; i < base.est.id.length; i++) indice.push({ t: sinTildes(base.est.nom[i]), tipo: 'estacion', e: i });
    rutaTexto = [];
    for (i = 0; i < base.rut.id.length; i++) {
      indice.push({ t: sinTildes(base.rut.cod[i] + ' ' + base.rut.c1[i] + ' ' + base.rut.c2[i]), tipo: 'ruta', r: i });
      rutaTexto.push(sinTildes([base.rut.cod[i], base.rut.c1[i], base.rut.c2[i], base.rut.nom[i], base.rut.d1[i], base.rut.d2[i]].join(' ')));
    }
    for (i = 0; i < base.par.id.length; i++) if (base.par.est[i] < 0) indice.push({ t: sinTildes(base.par.nom[i] + ' ' + base.par.cod[i]), tipo: 'paradero', i: i });
  }
  function abrirBuscador(contexto, volver) { busqueda = { contexto: contexto, texto: '', volver: volver || null }; ir('buscar'); if (!esAncho()) fijarPanel('max'); }
  function elegirResultado(ref, punto0) {
    var ctx = busqueda.contexto;
    if (ctx === 'desde' || ctx === 'hasta') { Q[ctx] = ref; ir('ruta'); if (!esAncho()) fijarPanel('medio'); calcularRuta(); return; }
    if (!esAncho()) fijarPanel('medio');
    if (ref.tipo === 'lugar') { seleccionar({ tipo: 'lugar', id: ref.id }); return; }
    seleccionar(punto0);
  }
  function vistaBuscar(c) {
    var ctx = busqueda.contexto, enRuta = ctx === 'desde' || ctx === 'hasta';
    c.appendChild(cabecera(ctx === 'desde' ? '¿Desde dónde?' : (ctx === 'hasta' ? '¿A dónde vas?' : 'Buscar'), function () { if (busqueda.volver) ir(busqueda.volver); else if (enRuta) ir('ruta'); else volverAHoy(); if (!esAncho()) fijarPanel('medio'); }));
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
      if (enRuta && !q) {
        var yo = miPunto();
        lista.appendChild(fila('ubicacion', 'Mi ubicación', yo ? (ubi.manual ? 'El punto que marcaste' : 'Donde estás ahora') : 'Usar la ubicación de este dispositivo', function () {
          if (yo) { Q[ctx] = yo; ir('ruta'); if (!esAncho()) fijarPanel('medio'); calcularRuta(); }
          else { ubi.paraRuta = ctx; ir('ruta'); pedirUbicacion(true); }
        }, true));
      }
      if (!enRuta && !q) lista.appendChild(fila('bus', 'Todas las rutas', 'Busca un bus por código o destino y míralo en 3D', abrirRutas, true));
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
          else lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { abrirLinea(r.r); } },
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
  /* ----- todas las rutas y una ruta completa ----- */

  var GRUPOS = [[-1, 'Todas'], [0, 'TransMilenio'], [3, 'SITP'], [1, 'Alimentador'], [2, 'Dual'], [6, 'Cable'], [9, 'Otras']];
  var ORDEN_GRUPO = { 0: 0, 2: 1, 1: 2, 3: 3, 6: 4, 9: 5 };
  function grupoDe(r) { var sis = base.rut.sis[r]; return sis === 4 || sis === 5 ? 9 : sis; }
  function vistaRutas(c) {
    c.appendChild(cabecera('Todas las rutas', function () { volverAHoy(); if (!esAncho()) fijarPanel('medio'); }));
    var entrada = h('input', { class: 'entrada', id: 'rutas-texto', type: 'search', autocomplete: 'off', placeholder: 'Código o destino: B16, Portal Norte…', value: rutasFiltro.texto,
      oninput: function (e) { rutasFiltro.texto = e.target.value; llenar(); } });
    var grupos = h('div', { class: 'filtros grupos', role: 'group', 'aria-label': 'Sistema' });
    GRUPOS.forEach(function (g) {
      grupos.appendChild(h('button', { type: 'button', class: 'filtro', 'aria-pressed': String(rutasFiltro.sis === g[0]), text: g[1], onclick: function () { rutasFiltro.sis = g[0]; pintar(); } }));
    });
    var res = h('div');
    c.appendChild(entrada); c.appendChild(grupos); c.appendChild(res);
    function llenar() {
      res.textContent = '';
      var q = sinTildes(rutasFiltro.texto.trim()), lista = [], r, vistas = {};
      for (r = 0; r < base.rut.id.length; r++) {
        if (rutasFiltro.sis !== -1 && grupoDe(r) !== rutasFiltro.sis) continue;
        if (q && rutaTexto[r].indexOf(q) < 0) continue;
        // variantes con el mismo codigo y destinos se muestran una vez
        var clave = base.rut.cod[r] + '|' + base.rut.d1[r] + '|' + base.rut.d2[r];
        if (vistas[clave]) continue;
        vistas[clave] = 1;
        lista.push(r);
      }
      lista.sort(function (a, b) {
        return (ORDEN_GRUPO[grupoDe(a)] - ORDEN_GRUPO[grupoDe(b)]) || String(base.rut.cod[a]).localeCompare(String(base.rut.cod[b]), 'es', { numeric: true });
      });
      res.appendChild(h('p', { class: 'mini', style: 'margin:10px 0 0', text: lista.length + (lista.length === 1 ? ' ruta' : ' rutas') + ' · horario oficial del ' + base.generado.split('-').reverse().join('/') }));
      if (!lista.length) { res.appendChild(h('div', { class: 'vacio', text: 'Ninguna ruta con ese código o destino.' })); return; }
      var MAX = 150, grupo = null, caja = null;
      lista.slice(0, MAX).forEach(function (r) {
        if (grupoDe(r) !== grupo) {
          grupo = grupoDe(r);
          res.appendChild(h('div', { class: 'seccion', text: grupo === 9 ? 'Otras rutas' : NOMBRE_SIS[grupo] }));
          caja = h('div', { class: 'lista' }); res.appendChild(caja);
        }
        var destinos = [base.rut.d1[r], base.rut.d2[r]].filter(function (x) { return x; }).join(' · ');
        caja.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { abrirLinea(r); } }, chip(base.rut.sis[r], base.rut.cod[r]),
          h('span', { class: 'crece' }, h('div', { class: 't corta', text: base.rut.nom[r] }), destinos ? h('div', { class: 'mini corta', text: destinos }) : null), icono('derecha')));
      });
      if (lista.length > MAX) res.appendChild(h('p', { class: 'mini', style: 'text-align:center', text: 'Se ven ' + MAX + ' de ' + lista.length + '. Escribe un código o destino para encontrar la tuya.' }));
    }
    llenar();
  }

  function abrirLinea(r, sel) {
    if (linea !== r) pararBuses();
    if (activo) { activo = null; quitarSenales(); }
    linea = r; lineaSel = sel === undefined ? null : sel; lineaInfo = null;
    seleccion = null; marcarPunto();
    ir('linea');
    if (!esAncho()) fijarPanel('medio');
    var dia = servicio();
    motor.pedir({ orden: 'resumen', tipo: dia.tipo, ruta: r, t: dia.seg, sel: lineaSel }).then(function (info) {
      if (linea !== r) return;
      info.tipo = dia.tipo; lineaInfo = info; lineaSel = info.clave;
      if (vista === 'linea') pintar();
      dibujarLinea(r, info.sinServicio ? null : info);
    }, function () { tostada('No se pudo cargar la ruta.'); });
  }
  /* Donde vienen los buses de una ruta, en vivo (una consulta) */
  function busesDeRuta(r) {
    tostada('Buscando los buses de la ' + base.rut.cod[r] + '…');
    if (!filtros.buses) { filtros.buses = true; pintarFiltros(); }
    refrescarBuses(true);
  }
  function vistaLinea(c) {
    if (linea === null) { vistaHoy(c); return; }
    var r = linea, info = lineaInfo;
    c.appendChild(cabecera('Ruta ' + base.rut.cod[r], function () { limpiarTrayecto(); volverAHoy(); planearViajes(); }, chip(base.rut.sis[r], base.rut.cod[r])));
    c.appendChild(h('p', { class: 'sub', text: base.rut.nom[r] + ' · ' + NOMBRE_SIS[base.rut.sis[r]] }));
    if (!info) { c.appendChild(espera('Calculando cuánto tarda…')); return; }
    if (info.sinServicio) { c.appendChild(h('div', { class: 'vacio', text: 'Esta ruta no tiene servicio hoy (' + (info.tipo === 'festivo' ? 'domingo o festivo' : info.tipo === 'sabado' ? 'sábado' : 'día hábil') + '). El mapa muestra su recorrido.' })); return; }
    if (info.sentidos.length > 1) {
      var seg = h('div', { class: 'segmentado', style: 'margin-top:10px' });
      info.sentidos.forEach(function (x) {
        seg.appendChild(h('button', { type: 'button', class: 'corta', 'aria-pressed': String(x.clave === info.clave), text: 'Hacia ' + base.par.nom[x.hasta], onclick: function () { abrirLinea(r, x.clave); } }));
      });
      c.appendChild(seg);
    }
    c.appendChild(h('div', { class: 'grande hora', style: 'margin-top:12px', text: minutos(info.dur) }));
    c.appendChild(h('p', { class: 'sub', text: 'De principio a fin, ' + (info.enServicio ? 'saliendo a las ' + hora12(info.sale) : 'en el primer viaje (ahora no hay servicio)') + '; el mapa la muestra en 3D: la cinta sube con los minutos.' }));
    var extra = info.durMin ? info.dur - info.durMin : 0, nivel = !info.durMin ? null : (extra < Math.max(120, info.durMin * 0.12) ? 'fluido' : (extra < Math.max(300, info.durMin * 0.3) ? 'moderado' : 'pesado'));
    var sellos = h('div', { class: 'sellos', style: 'margin-top:8px' });
    if (nivel) sellos.appendChild(nivel === 'fluido' ? sello('Tráfico fluido', 'verde') : sello(NOMBRE_TRAFICO[nivel] + ' +' + minutos(extra), nivel === 'pesado' ? 'rojo' : 'naranja'));
    if (info.enServicio && esPico(info.tipo, info.sale)) sellos.appendChild(sello('Hora pico', 'naranja'));
    c.appendChild(sellos);
    c.appendChild(h('div', { class: 'datos' },
      h('div', { class: 'dato' }, h('small', { text: 'Primera salida' }), h('b', { text: info.primera !== null ? hora12(info.primera) : '—' })),
      h('div', { class: 'dato' }, h('small', { text: 'Última salida' }), h('b', { text: info.ultima !== null ? hora12(info.ultima) : '—' })),
      h('div', { class: 'dato' }, h('small', { text: 'Pasa cada' }), h('b', { text: info.cada ? minutos(info.cada) : '—' })),
      h('div', { class: 'dato' }, h('small', { text: 'Paraderos' }), h('b', { text: String(info.paraderos.length) }))));
    c.appendChild(h('div', { class: 'botones' },
      boton(plano ? 'Ver en 3D' : 'Vista plana', 'claro chico', function () { plano = !plano; dibujarLinea(r, info); pintar(); }, plano ? '3d' : 'mapa'),
      boton('Buses en vivo', 'claro chico', function () { busesDeRuta(r); }, 'vivo'),
      (function () { var q = info.paraderos[Math.floor(info.paraderos.length / 2)]; return enlaceWaze(red.lon[q], red.lat[q]); })()));
    c.appendChild(h('div', { class: 'seccion', text: 'Paraderos y minutos desde el inicio' }));
    var lista = h('div', { class: 'lista' });
    info.paraderos.forEach(function (i, q) {
      lista.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { seleccionar({ tipo: 'paradero', i: i }); } },
        h('span', { class: 'minutos', text: q === 0 ? 'Inicio' : '+' + Math.round(info.acumulado[q] / 60) + ' min' }),
        h('span', { class: 'crece' }, h('div', { class: 't corta', text: base.par.nom[i] }), base.par.cod[i] ? h('div', { class: 'mini', text: base.par.cod[i] }) : null), icono('derecha')));
    });
    c.appendChild(lista);
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
          h('div', { class: 'mini', text: textoDias(r.dias) + ' · sin festivos' })), icono('derecha')));
    });
    c.appendChild(lista);
    vistaAprendido(c);
  }

  /* ----- lo que he aprendido ----- */

  /* Mejor ruta y trafico por hora de una rutina (se calcula una vez y queda en memoria) */
  function datosRutina(r) {
    var clave = [r.id, r.desde, r.hasta, r.modo, r.hora, r.preferida || '', E.ajustes.transbordos, E.ajustes.maxCaminata, E.ajustes.ritmo].join('|');
    if (perfiles[clave]) return perfiles[clave];
    var d = perfiles[clave] = { estado: 'calculando' }, a = lugar(r.desde), b = lugar(r.hasta);
    var tipo = r.dias.some(function (x) { return x >= 1 && x <= 5; }) ? 'habil' : (r.dias.indexOf(6) >= 0 ? 'sabado' : 'festivo');
    function listo() { if (vista === 'rutinas') pintar(); }
    if (!a || !b) { d.estado = 'error'; return d; }
    var t = hhmmASeg(r.hora);
    if (t < 3 * 3600) t += 86400;
    planearConRespaldo({ orden: 'planear', tipo: tipo, consulta: consulta(a, b, r.modo, r.modo === 'llegar' ? t - E.ajustes.margen * 60 : t, tipo) }).then(function (res) {
      var tr = res.trayectos[0] || null;
      if (r.preferida) res.trayectos.forEach(function (x) { if (rutasDe(x) === r.preferida) tr = x; });
      d.tr = tr; d.tipo = tipo; d.ampliado = res.ampliado;
      if (!tr) { d.estado = 'listo'; listo(); return null; }
      var largo = null;
      tr.tramos.forEach(function (x) { if (x.tipo === 'bus' && (!largo || x.llega - x.sale > largo.llega - largo.sale)) largo = x; });
      d.tramo = largo;
      return motor.pedir({ orden: 'perfil', tipo: tipo, pat: largo.pat, posSube: largo.posSube, posBaja: largo.posBaja }).then(function (perfil) { d.perfil = perfil; d.estado = 'listo'; listo(); });
    }).catch(function () { d.estado = 'error'; listo(); });
    return d;
  }
  function barrasTrafico(perfil, horaTuya) {
    var con = perfil.filter(function (x) { return x.seg; });
    if (!con.length) return null;
    var max = Math.max.apply(null, con.map(function (x) { return x.seg; })), min = Math.min.apply(null, con.map(function (x) { return x.seg; }));
    var barras = h('div', { class: 'barras', role: 'img', 'aria-label': 'Minutos del tramo en bus según la hora, de 5 a. m. a 11 p. m.' });
    perfil.forEach(function (x) {
      var clase = !x.seg ? 'b-vacia' : ((x.seg - min) / min < 0.12 ? '' : ((x.seg - min) / min < 0.3 ? 'b-naranja' : 'b-rojo'));
      if (x.h === horaTuya) clase += ' b-tuya';
      barras.appendChild(h('i', { class: clase, title: (x.h > 12 ? x.h - 12 : x.h) + (x.h < 12 ? ' a. m.' : ' p. m.') + (x.seg ? ': ' + Math.round(x.seg / 60) + ' min' : ': sin servicio'),
        style: 'height:' + (x.seg ? Math.max(10, Math.round(x.seg / max * 100)) : 6) + '%' }));
    });
    return barras;
  }
  function vistaAprendido(c) {
    c.appendChild(h('div', { class: 'seccion', text: 'Lo que he aprendido' }));
    if (!E.rutinas.length) { c.appendChild(h('p', { class: 'mini', text: 'Cuando tengas rutinas, aquí verás tu mejor ruta, cuánto tardas y cómo cambia el tráfico.' })); return; }
    E.rutinas.forEach(function (r) {
      var d = datosRutina(r), t = h('div', { class: 'tarjeta' });
      t.appendChild(h('div', { class: 'entre' }, h('span', { class: 'fuerte corta', text: r.nombre }), h('span', { class: 'mini', text: (r.modo === 'llegar' ? 'llegar ' : 'salir ') + hora12(hhmmASeg(r.hora)) })));
      if (d.estado === 'calculando') { t.appendChild(espera('Calculando…')); c.appendChild(t); return; }
      if (!d.tr) { t.appendChild(h('p', { class: 'sub', text: 'No hay ruta en bus para este viaje a esa hora.' })); c.appendChild(t); return; }
      var usos = 0, propia = rutasDe(d.tr);
      if (r.usos) usos = r.usos[propia] || 0;
      t.appendChild(h('div', { class: 'fila', style: 'margin-top:6px' }, resumenTramos(d.tr)));
      t.appendChild(h('p', { class: 'sub num', text: 'Puerta a puerta ' + minutos(d.tr.duracion) + ' · sales ' + hora12(d.tr.sale) + ', llegas ' + hora12(d.tr.llega) }));
      var sellos = h('div', { class: 'sellos', style: 'margin-top:6px' });
      sellos.appendChild(sello(r.preferida ? 'La ruta que usas' : 'La que más conviene', r.preferida ? 'azul' : 'verde'));
      if (usos) sellos.appendChild(sello('La tomaste ' + usos + (usos === 1 ? ' vez' : ' veces'), ''));
      if (d.ampliado) sellos.appendChild(sello('Con transbordo', 'azul'));
      agregar(sellos, selloTrafico(d.tr));
      t.appendChild(sellos);
      if (d.perfil && d.tramo) {
        var con = d.perfil.filter(function (x) { return x.seg; });
        var rapido = con.reduce(function (m, x) { return !m || x.seg < m.seg ? x : m; }, null), lento = con.reduce(function (m, x) { return !m || x.seg > m.seg ? x : m; }, null);
        var tuya = Math.floor((d.tramo.sale % 86400) / 3600);
        t.appendChild(h('div', { class: 'mini', style: 'margin-top:12px', text: 'Tráfico típico en la ' + d.tramo.letrero + ' según la hora (la barra marcada es la tuya)' }));
        agregar(t, barrasTrafico(d.perfil, tuya));
        t.appendChild(h('div', { class: 'barras-eje' }, h('span', { text: '5 a. m.' }), h('span', { text: '12 m.' }), h('span', { text: '11 p. m.' })));
        if (rapido && lento) t.appendChild(h('p', { class: 'mini', style: 'margin:6px 0 0', text: 'Más rápido a las ' + hora12(rapido.h * 3600) + ' (' + minutos(rapido.seg) + '), más lento a las ' + hora12(lento.h * 3600) + ' (' + minutos(lento.seg) + ').' }));
      }
      c.appendChild(t);
    });

    c.appendChild(h('div', { class: 'seccion', text: 'Medido en vivo' }));
    var claves = Object.keys(E.aprendizaje), total = 0;
    claves.forEach(function (k) { total += E.aprendizaje[k].n || 0; });
    if (!total && !E.historial.length) {
      c.appendChild(h('p', { class: 'mini', text: 'Aún no hay mediciones. Toca "En vivo" antes de salir o marca "Tomé este bus" en el viaje: la app aprende cuánto se retrasa cada ruta y cuál usas de verdad.' }));
      return;
    }
    c.appendChild(h('p', { class: 'mini', text: total + (total === 1 ? ' medición' : ' mediciones') + ' en vivo. Así suelen pasar tus buses:' }));
    var lista = h('div', { class: 'lista' });
    claves.sort(function (x, y) { return (E.aprendizaje[y].n || 0) - (E.aprendizaje[x].n || 0); }).slice(0, 6).forEach(function (k) {
      var p = k.split('|'), r = base.rut.id.indexOf(p[0]), a = E.aprendizaje[k], franja = (+p[2]) * 1800, m = a.media;
      var texto = Math.abs(m) < 60 ? 'a tiempo' : minutos(Math.abs(m)) + (m > 0 ? ' tarde' : ' antes');
      lista.appendChild(h('div', { class: 'item' }, r >= 0 ? chip(base.rut.sis[r], base.rut.cod[r]) : chip(3, '?'),
        h('span', { class: 'crece' }, h('div', { class: 't', text: 'Suele pasar ' + texto }),
          h('div', { class: 'mini', text: (p[1] === 'habil' ? 'Día hábil' : p[1] === 'sabado' ? 'Sábado' : 'Domingo o festivo') + ', ' + hora12(franja) + ' a ' + hora12(franja + 1800) + ' · ' + a.n + (a.n === 1 ? ' vez' : ' veces') }))));
    });
    if (lista.children.length) c.appendChild(lista);
    if (E.historial.length) {
      c.appendChild(h('div', { class: 'seccion', text: 'Últimos registros' }));
      var hist = h('div', { class: 'lista' });
      E.historial.forEach(function (x) {
        var dia = DIAS[diaSemana(x.f)].slice(0, 3) + ' ' + partes(x.f)[2];
        if (x.t === 'viaje') hist.appendChild(h('div', { class: 'item' }, h('span', { class: 'icono-lugar' }, icono('check')),
          h('span', { class: 'crece' }, h('div', { class: 't corta', text: 'Tomaste ' + x.cod }), h('div', { class: 'mini', text: dia + ' · ' + (x.rutina || '') + ' · ' + hora12(x.prog) }))));
        else {
          var dif = Math.round((x.real - x.prog) / 60);
          hist.appendChild(h('div', { class: 'item' }, h('span', { class: 'icono-lugar gris' }, icono('vivo')),
            h('span', { class: 'crece' }, h('div', { class: 't corta', text: x.cod + ': ' + (dif === 0 ? 'a tiempo' : (dif > 0 ? '+' : '') + dif + ' min') }),
              h('div', { class: 'mini', text: dia + ' · programado ' + hora12(x.prog) + ', pasó ' + hora12(x.real) }))));
        }
      });
      c.appendChild(hist);
    }
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

    c.appendChild(h('div', { class: 'seccion', text: 'Tu sesión' }));
    c.appendChild(h('div', { class: 'tarjeta' },
      h('div', { class: 'fila' }, h('span', { class: 'icono-lugar' }, icono('estrella')), h('span', { class: 'crece' },
        h('div', { class: 'fuerte', text: E.perfil.nombre || 'Sin nombre' }), h('div', { class: 'mini', text: 'Entraste sin contraseña. Tus datos están en tu espacio privado de Claude.' }))),
      h('div', { class: 'botones' },
        boton('Cambiar nombre', 'claro chico', function () { $('inicio-nombre').value = E.perfil.nombre; E.perfil.nombre = ''; pintarEntrada(); }, 'editar'),
        boton('Cerrar sesión', 'claro chico', cerrarSesion, 'salir'))));

    c.appendChild(h('div', { class: 'seccion', text: 'Ubicación y hora' }));
    var textoUbi = ubi.estado === 'ok' ? (ubi.manual ? 'Usando el punto que marcaste en el mapa.' : 'Usando la ubicación de este dispositivo.' + (ubi.precision ? ' Precisión: unos ' + Math.round(ubi.precision) + ' m.' : ''))
      : (ubi.estado === 'error' ? 'Esta vista no deja leer la ubicación. Puedes marcarla en el mapa.' : 'Sin ubicación. La app planea desde tus lugares guardados.');
    c.appendChild(h('div', { class: 'tarjeta' }, h('div', { class: 'fila' }, icono('ubicacion'), h('span', { class: 'crece', text: textoUbi })),
      h('div', { class: 'botones' },
        boton('Usar mi ubicación', 'claro chico', function () { pedirUbicacion(true); }, 'ubicacion'),
        boton('Marcar en el mapa', 'claro chico', function () { ubicacionManual(''); }, 'mapa'),
        ubi.estado === 'ok' ? boton('Dejar de usar', 'claro chico', dejarUbicacion, 'cerrar') : null),
      h('p', { class: 'mini', style: 'margin:10px 0 0', text: 'Tu ubicación no se guarda. Solo se envía a Croma, aproximada, cuando pides "Buses cerca en vivo".' })));
    c.appendChild(h('div', { class: 'tarjeta fila' }, icono('reloj'), h('span', { class: 'crece' },
      h('div', { class: 'fuerte num', text: textoReloj() }),
      h('div', { class: 'mini', text: reloj.estado === 'ok' ? 'Sincronizada con internet' + (reloj.corr ? ' (tu dispositivo va ' + minutos(Math.abs(reloj.corr) / 1000) + (reloj.corr > 0 ? ' atrasado)' : ' adelantado)') : '') + '. Se revisa cada 10 minutos.'
        : 'Sin conexión: se usa la hora del dispositivo, siempre en hora de Bogotá.' }))));

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

    c.appendChild(h('div', { class: 'seccion', text: 'Datos de la ciudad' }));
    c.appendChild(h('div', { class: 'tarjeta' },
      h('div', { class: 'fuerte', text: 'Horario oficial del ' + base.generado.split('-').reverse().join('/') }),
      h('div', { class: 'mini', text: base.rut.id.length + ' rutas · ' + base.par.id.length + ' paraderos · ' + base.est.id.length + ' estaciones. Fuente: datos abiertos de TransMilenio S.A.' }),
      datosViejos() ? h('div', { class: 'mini naranja', style: 'margin-top:4px', text: 'Tiene más de 30 días: pide a Claude que lo actualice.' }) : null,
      h('div', { class: 'mini', style: 'margin-top:4px', text: 'Llegadas, buses y alertas en vivo: Croma, al minuto.' })));

    c.appendChild(h('div', { class: 'seccion', text: 'Acerca de' }));
    c.appendChild(h('p', { class: 'mini', text: 'Mapa: OpenStreetMap, OpenMapTiles y OpenFreeMap. Las alertas son las oficiales de TransMilenio; el tráfico se calcula con el horario y con los buses en vivo.' }));
    c.appendChild(h('p', { class: 'mini', text: 'La app no puede leer la tarjeta por NFC ni avisar cuando está cerrada. Tus lugares y rutinas se guardan en tu espacio privado.' }));
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
      // en hora pico: alertas oficiales de la ruta desde media hora antes de salir, cada 20 minutos,
      // solo si quedan al menos 2 consultas del dia para lo demas
      if (E.ajustes.vivoAuto && mcp && esPico(v.tipo, v.tr.sale) && falta < 30 * 60 && falta > -15 * 60 && quedanConsultas(2) &&
          (!v.alertas || (v.alertas.estado !== 'cargando' && Date.now() - v.alertas.en > 20 * 60000))) revisarAlertasViaje(v, true);
    });
    if (ubi.estado === 'ok' && Date.now() - cerca.en > 60000) pedirCerca();
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
    $('inicio-form').addEventListener('submit', entrar);
    $('cerrar-panel').addEventListener('click', function () { verSoloMapa(true); });
    $('mostrar-panel').addEventListener('click', function () { verSoloMapa(false); });
    $('c-yo').addEventListener('click', function () {
      if (ubi.estado === 'ok') { volar(ubi.lon, ubi.lat, 15.5); if (!ubi.manual) pedirUbicacion(false); }
      else pedirUbicacion(true);
    });
    $('c-jarvis').addEventListener('click', abrirJarvis);
    $('c-3d').addEventListener('click', alternar3d);
    // atajos: J Jarvis, V en vivo del proximo viaje, R todas las rutas, Esc volver
    document.addEventListener('keydown', function (e) {
      var t = e.target, escribiendo = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === 'Escape') { if (soloMapa()) verSoloMapa(false); else if (base && vista !== 'hoy' && vista !== 'destino') volverAHoy(); return; }
      if (escribiendo || e.ctrlKey || e.metaKey || e.altKey || !$('inicio').hidden || !base) return;
      var k = String(e.key || '').toLowerCase();
      if (k === 'j' && muestra) { e.preventDefault(); abrirJarvis(); }
      else if (k === 'r') { e.preventDefault(); abrirRutas(); }
      else if (k === 'v' && viajes[0] && viajes[0].tr) { e.preventDefault(); vivoDeViaje(viajes[0]); }
    });
    window.addEventListener('online', sincronizarHora);
    window.addEventListener('offline', function () { reloj.estado = 'sin'; pintarSiHoy(); });
    $('elegir-cancelar').addEventListener('click', function () { eligiendo = null; $('elegir').hidden = true; $('arriba').hidden = false; fijarPanel('medio'); });
    $('c-mas').addEventListener('click', function () { if (mapa) mapa.zoomIn(); });
    $('c-menos').addEventListener('click', function () { if (mapa) mapa.zoomOut(); });
    $('c-centrar').addEventListener('click', function () {
      if (activo) { dibujarTrayecto(activo.tr, activo.desde, activo.hasta, false, activo.v); return; }
      if (linea !== null && lineaInfo) { dibujarLinea(linea, lineaInfo.sinServicio ? null : lineaInfo); return; }
      if (E.lugares.length) encuadrar(E.lugares.map(function (l) { return [l.lon, l.lat]; }), 13.5);
      else if (mapa) mapa.easeTo({ center: [-74.085, 4.66], zoom: 11.2 });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (Date.now() - reloj.en > 120000) sincronizarHora(); tic(); } });
    conectarPanel();
  }

  function iniciar() {
    E = normalizar(leerLocal());
    pintarEntrada();
    sincronizarHora();
    setInterval(sincronizarHora, 10 * 60000);
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
      // al abrir la app aparece la pantalla "A donde vas?" (una vez por sesion)
      if (!destinoVisto) { destinoVisto = true; vista = 'destino'; if (!esAncho()) fijarPanel('max'); }
      pintar();
      iniciarNube();
      iniciarVivo();
      iniciarJarvis();
      iniciarUbicacion();
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
    fijarAhora: function (iso) { desfase = iso ? new Date(iso).getTime() - Date.now() - reloj.corr : 0; planearViajes(true); pintar(); if (mapa && mapa.setSky && mapaListo) mapa.setSky(cielo(temaOscuro())); },
    cargar: function (datos) { E = normalizar(datos); pintarEntrada(); pintarLugares(); planearViajes(true); pintar(); },
    ubicar: function (lat, lon) { fijarUbicacion(lat, lon, 20, false); },
    jarvis: function (t) { preguntarJarvis(t); },
    camara: function (c, z, p) { if (mapa) mapa.jumpTo({ center: c, zoom: z, pitch: p || 0 }); },
    charla: function () { return { turnos: charla.turnos.slice(), ocupado: charla.ocupado, hay: !!muestra, dictado: !!dictado, voz: !!voz }; },
    estado: function () { return { vista: vista, viajes: viajes.map(function (v) { return { estado: v.estado, sale: v.tr && v.tr.sale, llega: v.tr && v.tr.llega }; }), historial: E.historial.length, aprendizaje: Object.keys(E.aprendizaje).length, ubicacion: ubi.estado, buses: Object.keys(flota.buses).length, bus0: datosMapa.buses.features[0] ? datosMapa.buses.features[0].geometry.coordinates : null, cubos: datosMapa.buses3d.features.length, enMapa: datosMapa.buses.features.length, terreno: !!(mapa && mapa.getTerrain && mapa.getTerrain()), cielo: mapa && mapa.getSky ? (mapa.getSky() || {})['horizon-color'] : null, sol: Math.round(elevacionSol(ahora())), etiquetas: datosMapa.buses.features.map(function (f) { return f.properties.etq + '/' + f.properties.nivel; }), trayectorias: datosMapa.trayectorias.features.length, lineas: datosMapa.ruta.features.length, inclinacion: mapa ? Math.round(mapa.getPitch()) : null, cinta: datosMapa.cinta.features.length, saldo: E.saldo }; }
  };

  iniciar();
})();
