/* Planificador de rutas de A Tiempo.
 *
 * Trabaja sobre la red compacta que arma herramientas/red.py a partir del GTFS oficial:
 *   - patrones: secuencia de paraderos de una ruta con el tiempo de un viaje de referencia;
 *   - viajes: hora de salida y duracion de cada viaje, por tipo de dia.
 * El GTFS reparte el tiempo de cada viaje en proporcion fija entre paraderos, asi que la hora
 * de paso por un paradero es  salida + tiempoReferencia(paradero) * duracion / duracionReferencia.
 *
 * La busqueda es por rondas (RAPTOR): la ronda k encuentra a que hora se llega a cada paradero
 * usando como maximo k buses. Corre igual en el navegador y en Node (pruebas).
 */
(function (raiz) {
  'use strict';

  var RAD = Math.PI / 180;
  var CELDA = 0.004;            // tamano de la rejilla espacial, en grados (unos 440 m)
  var RADIO_TRANSBORDO = 250;   // metros maximos a pie entre dos paraderos para cambiar de bus
  var FACTOR_CAMINATA = 1.3;    // la calle no es linea recta

  function distancia(lat1, lon1, lat2, lon2) {
    var k = Math.cos((lat1 + lat2) * 0.5 * RAD);
    var dx = (lon2 - lon1) * 111320 * k;
    var dy = (lat2 - lat1) * 110574;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function segundosCaminando(metros, velocidad) {
    return Math.round(metros * FACTOR_CAMINATA / velocidad * 60);
  }

  /* ---------- red ---------- */

  function crearRed(base) {
    var n = base.par.id.length;
    var lat = new Float64Array(n), lon = new Float64Array(n);
    var i, j;
    for (i = 0; i < n; i++) { lat[i] = base.par.lat[i] / 1e5; lon[i] = base.par.lon[i] / 1e5; }

    var pat = base.pat.map(function (p, indice) {
      var s = Int32Array.from(p[3]);
      var o = new Int32Array(s.length);
      var suma = 0;
      for (var q = 0; q < s.length; q++) { suma += p[4][q]; o[q] = suma; }
      return { i: indice, r: p[0], D: p[1] || 1, k: p[2], s: s, o: o };
    });

    // indice paradero -> (patron, posicion)
    var cuenta = new Int32Array(n + 1);
    for (i = 0; i < pat.length; i++) for (j = 0; j < pat[i].s.length; j++) cuenta[pat[i].s[j] + 1]++;
    for (i = 0; i < n; i++) cuenta[i + 1] += cuenta[i];
    var pIni = cuenta.slice();
    var cursor = cuenta.slice(0, n);
    var pPat = new Int32Array(pIni[n]), pPos = new Int32Array(pIni[n]);
    for (i = 0; i < pat.length; i++) {
      for (j = 0; j < pat[i].s.length; j++) {
        var c = cursor[pat[i].s[j]]++;
        pPat[c] = i; pPos[c] = j;
      }
    }

    var rejilla = new Map();
    for (i = 0; i < n; i++) {
      var clave = claveCelda(lat[i], lon[i]);
      var lista = rejilla.get(clave);
      if (!lista) rejilla.set(clave, lista = []);
      lista.push(i);
    }

    return { base: base, n: n, lat: lat, lon: lon, pat: pat, pIni: pIni, pPat: pPat, pPos: pPos,
             rejilla: rejilla, viajes: {}, vecinos: new Map() };
  }

  function claveCelda(lat, lon) {
    return Math.floor((lat - 4) / CELDA) * 4096 + Math.floor((lon + 75) / CELDA);
  }

  /* Paraderos a menos de `radio` metros de un punto, del mas cercano al mas lejano: [[paradero, metros], ...] */
  function cercanos(red, lat, lon, radio) {
    var alcance = Math.ceil(radio / (CELDA * 110574)) + 1;
    var fila = Math.floor((lat - 4) / CELDA), col = Math.floor((lon + 75) / CELDA);
    var salida = [];
    for (var a = -alcance; a <= alcance; a++) {
      for (var b = -alcance; b <= alcance; b++) {
        var lista = red.rejilla.get((fila + a) * 4096 + (col + b));
        if (!lista) continue;
        for (var q = 0; q < lista.length; q++) {
          var d = distancia(lat, lon, red.lat[lista[q]], red.lon[lista[q]]);
          if (d <= radio) salida.push([lista[q], d]);
        }
      }
    }
    salida.sort(function (x, y) { return x[1] - y[1]; });
    return salida;
  }

  /* Paraderos a los que se puede caminar para cambiar de bus (cerca o en la misma estacion) */
  function vecinosDe(red, s) {
    var v = red.vecinos.get(s);
    if (v) return v;
    v = [];
    var est = red.base.par.est[s];
    var cerca = cercanos(red, red.lat[s], red.lon[s], est >= 0 ? 600 : RADIO_TRANSBORDO);
    for (var q = 0; q < cerca.length; q++) {
      var otro = cerca[q][0];
      if (otro === s) continue;
      if (cerca[q][1] <= RADIO_TRANSBORDO || (est >= 0 && red.base.par.est[otro] === est)) v.push([otro, Math.max(cerca[q][1], 40)]);
    }
    red.vecinos.set(s, v);
    return v;
  }

  function cargarViajes(red, tipo, datos) {
    var lista = new Array(red.pat.length);
    for (var i = 0; i < red.pat.length; i++) {
      var crudo = datos.p[i];
      var frec = datos.frec && datos.frec[String(i)];
      if (!crudo && !frec) { lista[i] = null; continue; }
      var v = { ini: null, dur: null, frec: frec || null };
      if (crudo) {
        var m = crudo[0].length, ini = new Int32Array(m), dur = new Int32Array(m), a = 0, b = 0;
        for (var q = 0; q < m; q++) { a += crudo[0][q]; b += crudo[1][q]; ini[q] = a; dur[q] = b; }
        v.ini = ini; v.dur = dur;
      }
      lista[i] = v;
    }
    red.viajes[tipo] = lista;
  }

  function pasoPor(p, pos, ini, dur) {
    return ini + Math.round(p.o[pos] * dur / p.D);
  }

  /* Primer viaje del patron que pasa por la posicion `pos` a partir de la hora t. Devuelve {ini, dur, sale} o null. */
  function salidaEn(red, tipo, p, pos, t) {
    var v = red.viajes[tipo] && red.viajes[tipo][p.i];
    if (!v) return null;
    var mejor = null;
    if (v.ini) {
      var ini = v.ini, dur = v.dur, lo = 0, hi = ini.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (pasoPor(p, pos, ini[mid], dur[mid]) >= t) hi = mid; else lo = mid + 1;
      }
      // los viajes casi nunca se adelantan entre si; por si acaso se miran los vecinos
      for (var j = Math.max(0, lo - 2); j < Math.min(ini.length, lo + 3); j++) {
        var sale = pasoPor(p, pos, ini[j], dur[j]);
        if (sale >= t && (!mejor || sale < mejor.sale)) mejor = { ini: ini[j], dur: dur[j], sale: sale };
      }
    }
    if (v.frec) {
      for (var f = 0; f < v.frec.length; f++) {
        var w = v.frec[f];
        var desfase = Math.round(p.o[pos] * w[3] / p.D);
        if (t <= w[1] + desfase) {
          var s2 = Math.max(t, w[0] + desfase);
          if (!mejor || s2 < mejor.sale) mejor = { ini: s2 - desfase, dur: w[3], sale: s2 };
          break;
        }
      }
    }
    return mejor;
  }

  /* Proximas `cuantas` horas de paso de un patron por una posicion, desde la hora t */
  function proximas(red, tipo, p, pos, t, cuantas) {
    var salida = [], desde = t;
    for (var q = 0; q < cuantas; q++) {
      var c = salidaEn(red, tipo, p, pos, desde);
      if (!c) break;
      salida.push(c.sale);
      desde = c.sale + 1;
    }
    return salida;
  }

  /* Ultima hora de paso del dia de un patron por una posicion (o null) */
  function ultima(red, tipo, p, pos) {
    var v = red.viajes[tipo] && red.viajes[tipo][p.i];
    if (!v) return null;
    var mejor = null;
    if (v.ini) for (var j = Math.max(0, v.ini.length - 4); j < v.ini.length; j++) {
      var sale = pasoPor(p, pos, v.ini[j], v.dur[j]);
      if (mejor === null || sale > mejor) mejor = sale;
    }
    if (v.frec && v.frec.length) {
      var w = v.frec[v.frec.length - 1];
      var s2 = w[1] + Math.round(p.o[pos] * w[3] / p.D);
      if (mejor === null || s2 > mejor) mejor = s2;
    }
    return mejor;
  }

  /* ---------- trafico segun el horario ---------- */

  /* El horario oficial trae cuanto tarda cada viaje segun la hora: en hora pico los buses van mas lento.
   * Se compara lo que tarda un tramo a una hora con lo mas rapido del dia para ese mismo recorrido. */
  function duracionMinima(red, tipo, p) {
    var cache = red.minimos || (red.minimos = {});
    var lista = cache[tipo] || (cache[tipo] = {});
    if (lista[p.i] !== undefined) return lista[p.i];
    var v = red.viajes[tipo] && red.viajes[tipo][p.i], m = null, q;
    if (v && v.dur) for (q = 0; q < v.dur.length; q++) if (v.dur[q] > 0 && (m === null || v.dur[q] < m)) m = v.dur[q];
    if (v && v.frec) for (q = 0; q < v.frec.length; q++) if (v.frec[q][3] > 0 && (m === null || v.frec[q][3] < m)) m = v.frec[q][3];
    lista[p.i] = m;
    return m;
  }
  function segTramo(p, posSube, posBaja, dur) { return Math.round((p.o[posBaja] - p.o[posSube]) * dur / p.D); }

  /* Trafico tipico de un tramo en bus que pasa por posSube a la hora t: { nivel, extra, seg, segMin } o null */
  function traficoTipico(red, tipo, pat, posSube, posBaja, t) {
    var p = red.pat[pat], v = salidaEn(red, tipo, p, posSube, t), m = duracionMinima(red, tipo, p);
    if (!v || !m || posBaja <= posSube) return null;
    var seg = segTramo(p, posSube, posBaja, v.dur), segMin = segTramo(p, posSube, posBaja, m), extra = Math.max(0, seg - segMin);
    var nivel = extra < Math.max(120, segMin * 0.12) ? 'fluido' : (extra < Math.max(300, segMin * 0.3) ? 'moderado' : 'pesado');
    return { nivel: nivel, extra: extra, seg: seg, segMin: segMin };
  }

  /* Lo que tarda un tramo segun la hora del dia, de 5 a. m. a 11 p. m.: [{ h, seg }] (seg null si no hay servicio) */
  function perfilTrafico(red, tipo, pat, posSube, posBaja) {
    var p = red.pat[pat], salida = [];
    for (var hh = 5; hh <= 23; hh++) {
      var v = salidaEn(red, tipo, p, posSube, hh * 3600);
      salida.push({ h: hh, seg: v && v.sale < (hh + 1) * 3600 ? segTramo(p, posSube, posBaja, v.dur) : null });
    }
    return salida;
  }

  /* Cuantos viajes tiene un patron en un tipo de dia (para elegir el sentido principal de una ruta) */
  function viajesDelPatron(red, tipo, p) {
    var v = red.viajes[tipo] && red.viajes[tipo][p.i];
    if (!v) return 0;
    var n = v.ini ? v.ini.length : 0;
    if (v.frec) v.frec.forEach(function (w) { n += Math.max(1, Math.round((w[1] - w[0]) / Math.max(60, w[2]))); });
    return n;
  }

  /* Resumen de una ruta para mostrarla completa: sentidos, duracion a la hora t, primera y ultima salida,
   * cada cuanto pasa y minutos acumulados en cada paradero. Muchas rutas del SITP vienen como un solo recorrido
   * circular (ida y regreso juntos): se parten en el punto de giro `k`. `sel` ('patron:inicio') elige el sentido. */
  function resumenRuta(red, tipo, ruta, t, sel) {
    var variantes = [];
    for (var i = 0; i < red.pat.length; i++) {
      var p0 = red.pat[i];
      if (p0.r !== ruta) continue;
      var n = viajesDelPatron(red, tipo, p0), ultimo = p0.s.length - 1;
      if (!n) continue;
      var cortes = p0.k > 0 && p0.k < ultimo ? [[0, p0.k], [p0.k, ultimo]] : [[0, ultimo]];
      cortes.forEach(function (c) {
        variantes.push({ clave: i + ':' + c[0], pat: i, ini: c[0], fin: c[1], n: n, desde: p0.s[c[0]], hasta: p0.s[c[1]], paradas: c[1] - c[0] + 1 });
      });
    }
    variantes.sort(function (a, b) { return b.n - a.n || a.ini - b.ini; });
    // un sentido por destino: se quitan variantes que terminan donde otra mas usada
    var vistos = {}, sentidos = [];
    variantes.forEach(function (x) { if (!vistos[x.hasta] && sentidos.length < 3) { vistos[x.hasta] = 1; sentidos.push(x); } });
    if (!sentidos.length) return { ruta: ruta, sentidos: [], sinServicio: true };
    var elegido = sentidos[0];
    sentidos.forEach(function (x) { if (x.clave === sel) elegido = x; });
    var p = red.pat[elegido.pat], a = elegido.ini, b = elegido.fin;
    var ahora = salidaEn(red, tipo, p, a, t), primera = salidaEn(red, tipo, p, a, 0), ult = ultima(red, tipo, p, a);
    var ref = ahora || primera;
    var horas = proximas(red, tipo, p, a, ahora ? ahora.sale : 0, 7), saltos = [];
    for (var q = 1; q < horas.length; q++) saltos.push(horas[q] - horas[q - 1]);
    saltos.sort(function (x, y) { return x - y; });
    var acumulado = [];
    for (q = a; q <= b; q++) acumulado.push(ref ? segTramo(p, a, q, ref.dur) : 0);
    var m = duracionMinima(red, tipo, p);
    return { ruta: ruta, clave: elegido.clave, pat: elegido.pat, ini: a, fin: b, sentidos: sentidos,
             paraderos: Array.prototype.slice.call(p.s, a, b + 1), acumulado: acumulado,
             dur: ref ? segTramo(p, a, b, ref.dur) : null, durMin: m ? segTramo(p, a, b, m) : null, enServicio: !!ahora, sale: ahora ? ahora.sale : null,
             primera: primera ? primera.sale : null, ultima: ult, cada: saltos.length ? saltos[Math.floor(saltos.length / 2)] : null };
  }

  /* Tablero de un paradero: proximas salidas de todas las rutas que pasan */
  function salidasParadero(red, tipo, paradero, t, cuantas) {
    var salida = [];
    for (var c = red.pIni[paradero]; c < red.pIni[paradero + 1]; c++) {
      var p = red.pat[red.pPat[c]], pos = red.pPos[c];
      if (pos >= p.s.length - 1) continue;
      var horas = proximas(red, tipo, p, pos, t, 2);
      for (var q = 0; q < horas.length; q++) salida.push({ pat: p.i, pos: pos, sale: horas[q] });
    }
    salida.sort(function (x, y) { return x.sale - y.sale; });
    return salida.slice(0, cuantas);
  }

  /* ---------- busqueda por rondas ---------- */

  function buscar(red, tipo, accesos, egresos, t, op) {
    var n = red.n, rondas = op.transbordos + 1;
    var tau = [new Float64Array(n).fill(Infinity)];
    var padre = [new Array(n)];
    var marcados = [];
    accesos.forEach(function (seg, s) {
      tau[0][s] = t + seg;
      padre[0][s] = { tipo: 'pie', desde: -1, seg: seg, r: 0 };
      marcados.push(s);
    });
    var mejorDestino = Infinity, hallazgos = [];

    for (var k = 1; k <= rondas && marcados.length; k++) {
      var antes = tau[k - 1], ahora = antes.slice(), previas = padre[k - 1], etiquetas = previas.slice();
      tau.push(ahora); padre.push(etiquetas);

      var cola = new Map();
      for (var m = 0; m < marcados.length; m++) {
        var sm = marcados[m];
        if (antes[sm] >= mejorDestino) continue;   // desde aqui ya no se puede mejorar la llegada
        for (var c = red.pIni[sm]; c < red.pIni[sm + 1]; c++) {
          var ip = red.pPat[c];
          if (op.vetados && op.vetados.has(red.pat[ip].r)) continue;
          var previa = cola.get(ip);
          if (previa === undefined || red.pPos[c] < previa) cola.set(ip, red.pPos[c]);
        }
      }

      var nuevos = [];
      cola.forEach(function (pos0, ip) {
        var p = red.pat[ip], viaje = null, posSube = -1, tSube = 0;
        for (var pos = pos0; pos < p.s.length; pos++) {
          var s = p.s[pos], pasa = viaje ? pasoPor(p, pos, viaje.ini, viaje.dur) : Infinity;
          if (viaje && pos > posSube && pasa < ahora[s] && pasa < mejorDestino) {
            if (ahora[s] === antes[s] || etiquetas[s].r !== k) nuevos.push(s);
            ahora[s] = pasa;
            etiquetas[s] = { tipo: 'bus', p: ip, ini: viaje.ini, dur: viaje.dur, posSube: posSube, pos: pos, tSube: tSube, r: k };
          }
          if (antes[s] < mejorDestino && pos < p.s.length - 1) {
            // en el primer paradero se llega con el colchon pedido; en un transbordo basta un margen corto
            var listo = antes[s] + (previas[s].desde === -1 ? op.colchon : op.colchonTransbordo);
            if (!viaje || listo <= pasa) {
              var cand = salidaEn(red, tipo, p, pos, listo);
              if (cand && (!viaje || cand.sale < pasa)) { viaje = cand; posSube = pos; tSube = cand.sale; }
            }
          }
        }
      });

      // caminar a paraderos vecinos para el siguiente bus
      var siguientes = nuevos.slice();
      for (var q = 0; q < nuevos.length; q++) {
        var s1 = nuevos[q];
        if (etiquetas[s1].tipo !== 'bus' || etiquetas[s1].r !== k) continue;
        var vec = vecinosDe(red, s1);
        for (var w = 0; w < vec.length; w++) {
          var s2 = vec[w][0], seg = segundosCaminando(vec[w][1], op.velocidad), llega = ahora[s1] + seg;
          if (llega < ahora[s2] && llega < mejorDestino) {
            if (!(etiquetas[s2] && etiquetas[s2].r === k)) siguientes.push(s2);
            ahora[s2] = llega;
            etiquetas[s2] = { tipo: 'pie', desde: s1, seg: seg, r: k };
          }
        }
      }

      var mejorRonda = null;
      egresos.forEach(function (seg, s) {
        if (ahora[s] === Infinity || !etiquetas[s] || etiquetas[s].r !== k) return;
        var total = ahora[s] + seg;
        if (!mejorRonda || total < mejorRonda.llega) mejorRonda = { k: k, paradero: s, llega: total };
      });
      if (mejorRonda) {
        hallazgos.push(mejorRonda);
        if (mejorRonda.llega < mejorDestino) mejorDestino = mejorRonda.llega;
      }
      marcados = siguientes;
    }
    return { tau: tau, padre: padre, hallazgos: hallazgos };
  }

  function reconstruir(red, resultado, hallazgo, egresos) {
    var tramos = [], s = hallazgo.paradero, r = hallazgo.k, guarda = 0;
    tramos.push({ tipo: 'pie', desde: s, hasta: -2, seg: egresos.get(s) });
    while (guarda++ < 20) {
      var e = resultado.padre[r][s];
      if (!e) return null;
      if (e.tipo === 'pie') {
        tramos.push({ tipo: 'pie', desde: e.desde, hasta: s, seg: e.seg });
        if (e.desde === -1) break;
        s = e.desde; r = e.r;
      } else {
        var p = red.pat[e.p];
        tramos.push({ tipo: 'bus', pat: e.p, ini: e.ini, dur: e.dur, posSube: e.posSube, posBaja: e.pos,
                      sube: p.s[e.posSube], baja: s, sale: e.tSube, llega: pasoPor(p, e.pos, e.ini, e.dur) });
        s = p.s[e.posSube]; r = e.r - 1;
      }
    }
    tramos.reverse();
    return tramos;
  }

  /* ---------- trayectos ---------- */

  function nombreTramo(red, tramo) {
    var b = red.base, p = red.pat[tramo.pat], r = p.r;
    var ida = tramo.posSube < p.k || !b.rut.c2[r];
    return { ruta: r, cod: b.rut.cod[r], letrero: ida ? b.rut.c1[r] : b.rut.c2[r],
             destino: ida ? b.rut.d1[r] : b.rut.d2[r], sis: b.rut.sis[r] };
  }

  function armarTrayecto(red, tipo, tramos, consulta, op) {
    var b = red.base, salida = [], caminata = 0, buses = 0, primero = null, llega = 0, i, t;
    // hora real de salida: se sale justo para alcanzar el primer bus con el colchon pedido
    for (i = 0; i < tramos.length; i++) if (tramos[i].tipo === 'bus') { primero = tramos[i]; break; }
    var reloj = primero ? primero.sale - op.colchon - tramos[0].seg : consulta.t;
    var sale = reloj;
    for (i = 0; i < tramos.length; i++) {
      t = tramos[i];
      if (t.tipo === 'pie') {
        var ultimoTramo = salida[salida.length - 1];
        caminata += t.seg;
        if (ultimoTramo && ultimoTramo.tipo === 'pie') {   // dos caminatas seguidas se muestran como una
          ultimoTramo.hasta = t.hasta; ultimoTramo.seg += t.seg; ultimoTramo.llega += t.seg;
          ultimoTramo.m = Math.round(ultimoTramo.seg / 60 * op.velocidad);
        } else {
          salida.push({ tipo: 'pie', desde: t.desde, hasta: t.hasta, seg: t.seg, m: Math.round(t.seg / 60 * op.velocidad), sale: reloj, llega: reloj + t.seg });
        }
        reloj += t.seg;
      } else {
        var nom = nombreTramo(red, t), p = red.pat[t.pat];
        buses++;
        salida.push({ tipo: 'bus', pat: t.pat, ruta: nom.ruta, cod: nom.cod, letrero: nom.letrero, destino: nom.destino, sis: nom.sis,
                      sube: t.sube, baja: t.baja, posSube: t.posSube, posBaja: t.posBaja, paradas: t.posBaja - t.posSube,
                      sale: t.sale, llega: t.llega, ini: t.ini, dur: t.dur,
                      siguientes: proximas(red, tipo, p, t.posSube, t.sale + 1, 3), ultimo: ultima(red, tipo, p, t.posSube),
                      trafico: traficoTipico(red, tipo, t.pat, t.posSube, t.posBaja, t.sale) });
        reloj = t.llega;
      }
      llega = reloj;
    }
    return { sale: sale, llega: llega, duracion: llega - sale, caminataSeg: caminata, transbordos: Math.max(0, buses - 1),
             buses: buses, tramos: salida, tarifa: buses ? b.tarifa : 0,
             firma: salida.filter(function (x) { return x.tipo === 'bus'; }).map(function (x) { return x.ruta + ':' + x.sube + ':' + x.baja; }).join('|') };
  }

  function opcionesPorDefecto(consulta) {
    return {
      velocidad: consulta.velocidad || 80,              // metros por minuto
      maxCaminata: consulta.maxCaminata || 700,         // metros hasta el paradero
      transbordos: consulta.transbordos == null ? 1 : consulta.transbordos,
      colchon: consulta.colchon == null ? 180 : consulta.colchon,   // segundos de espera en el primer paradero
      colchonTransbordo: 90,
      vetados: null
    };
  }

  function accesosDe(red, punto, op) {
    var radio = op.maxCaminata, cerca = cercanos(red, punto.lat, punto.lon, radio);
    if (cerca.length < 3) cerca = cercanos(red, punto.lat, punto.lon, radio * 2);
    var mapa = new Map();
    for (var q = 0; q < cerca.length && q < 60; q++) mapa.set(cerca[q][0], segundosCaminando(cerca[q][1], op.velocidad));
    return mapa;
  }

  function costo(tr, consulta) {
    var base = consulta.modo === 'llegar' ? (consulta.t - tr.sale) : (tr.llega - consulta.t);
    return base + tr.transbordos * 300 + tr.caminataSeg * 0.5;
  }

  /* Trayectos que salen a partir de la hora t, variando la primera ruta para dar alternativas */
  function trayectosDesde(red, tipo, accesos, egresos, consulta, op, t, cuantas) {
    var vistos = new Map(), vetados = new Set();
    for (var vuelta = 0; vuelta < cuantas; vuelta++) {
      op.vetados = vetados.size ? vetados : null;
      var res = buscar(red, tipo, accesos, egresos, t, op);
      if (!res.hallazgos.length) break;
      var agregados = 0;
      for (var h = 0; h < res.hallazgos.length; h++) {
        var tramos = reconstruir(red, res, res.hallazgos[h], egresos);
        if (!tramos) continue;
        var tr = armarTrayecto(red, tipo, tramos, { t: t }, op);
        if (!tr.buses) continue;
        if (!vistos.has(tr.firma)) { vistos.set(tr.firma, tr); agregados++; }
        vetados.add(tr.tramos.filter(function (x) { return x.tipo === 'bus'; })[0].ruta);
      }
      if (!agregados && vuelta > 0) break;
    }
    op.vetados = null;
    return Array.from(vistos.values());
  }

  function mejorLlegada(red, tipo, accesos, egresos, op, t) {
    var res = buscar(red, tipo, accesos, egresos, t, op), mejor = Infinity;
    for (var h = 0; h < res.hallazgos.length; h++) if (res.hallazgos[h].llega < mejor) mejor = res.hallazgos[h].llega;
    return mejor;
  }

  /* Consulta principal.
   * consulta = { desde:{lat,lon}, hasta:{lat,lon}, modo:'salir'|'llegar', t:segundos del dia, tipo:'habil'|'sabado'|'festivo',
   *              velocidad, maxCaminata, transbordos, colchon, alternativas }
   * Devuelve { trayectos:[...], aPie:{seg,m}|null, motivo:null|'sin_paraderos'|'sin_servicio' } */
  function planear(red, consulta) {
    var op = opcionesPorDefecto(consulta), tipo = consulta.tipo, cuantas = consulta.alternativas || 4;
    var recta = distancia(consulta.desde.lat, consulta.desde.lon, consulta.hasta.lat, consulta.hasta.lon);
    var aPie = recta <= 1500 ? { m: Math.round(recta * FACTOR_CAMINATA), seg: segundosCaminando(recta, op.velocidad) } : null;
    var accesos = accesosDe(red, consulta.desde, op), egresos = accesosDe(red, consulta.hasta, op);
    if (!accesos.size || !egresos.size) return { trayectos: [], aPie: aPie, motivo: 'sin_paraderos' };

    var lista = [];
    if (consulta.modo === 'llegar') {
      var limite = consulta.t, lo = limite - 4 * 3600, hi = limite;
      if (mejorLlegada(red, tipo, accesos, egresos, op, lo) > limite) return { trayectos: [], aPie: aPie, motivo: 'sin_servicio' };
      while (hi - lo > 60) {          // la salida mas tardia que todavia llega a tiempo
        var mid = Math.floor((lo + hi) / 2);
        if (mejorLlegada(red, tipo, accesos, egresos, op, mid) <= limite) lo = mid; else hi = mid;
      }
      var vistos = new Map();
      [0, 360, 780, 1500].forEach(function (atras) {
        trayectosDesde(red, tipo, accesos, egresos, consulta, op, lo - atras, atras ? 2 : cuantas).forEach(function (tr) {
          if (tr.llega > limite) return;
          var previo = vistos.get(tr.firma);
          if (!previo || tr.sale > previo.sale) vistos.set(tr.firma, tr);
        });
      });
      lista = Array.from(vistos.values());
    } else {
      lista = trayectosDesde(red, tipo, accesos, egresos, consulta, op, consulta.t, cuantas)
        .filter(function (tr) { return tr.llega - consulta.t < 5 * 3600; });
    }
    if (!lista.length) return { trayectos: [], aPie: aPie, motivo: 'sin_servicio' };

    lista.forEach(function (tr) { tr.costo = costo(tr, consulta); });
    lista.sort(function (a, b) { return a.costo - b.costo; });
    // una sola opcion por combinacion de rutas
    var porRutas = new Map();
    lista.forEach(function (tr) {
      var clave = tr.tramos.filter(function (x) { return x.tipo === 'bus'; }).map(function (x) { return x.ruta; }).join('|');
      if (!porRutas.has(clave)) porRutas.set(clave, tr);
    });
    lista = Array.from(porRutas.values()).slice(0, cuantas + 1);

    var rapida = lista.reduce(function (a, b) { return b.duracion < a.duracion ? b : a; });
    var pocaCaminata = lista.reduce(function (a, b) { return b.caminataSeg < a.caminataSeg ? b : a; });
    lista.forEach(function (tr, i) {
      tr.etiquetas = [];
      if (i === 0) tr.etiquetas.push('Mejor opción');
      if (tr === rapida && lista.length > 1) tr.etiquetas.push('Más rápida');
      if (tr === pocaCaminata && lista.length > 1 && tr.caminataSeg < lista[0].caminataSeg) tr.etiquetas.push('Menos caminata');
      if (tr.transbordos === 0 && lista.some(function (x) { return x.transbordos > 0; })) tr.etiquetas.push('Sin transbordos');
    });
    return { trayectos: lista, aPie: aPie, motivo: null };
  }

  /* Horas programadas a las que una ruta pasa por un paradero entre dos horas (para comparar con lo vivo) */
  function pasosDeRuta(red, tipo, ruta, paradero, desde, hasta) {
    var salida = [];
    for (var c = red.pIni[paradero]; c < red.pIni[paradero + 1]; c++) {
      var p = red.pat[red.pPat[c]];
      if (p.r !== ruta) continue;
      var t = desde;
      for (var q = 0; q < 40; q++) {
        var v = salidaEn(red, tipo, p, red.pPos[c], t);
        if (!v || v.sale > hasta) break;
        salida.push(v.sale);
        t = v.sale + 1;
      }
    }
    salida.sort(function (x, y) { return x - y; });
    return salida;
  }

  /* Ordenes que atiende el proceso en segundo plano (o la pagina, si no hay proceso) */
  function atender(red, m) {
    if (m.orden === 'planear') return planear(red, m.consulta);
    if (m.orden === 'paradero') return salidasParadero(red, m.tipo, m.paradero, m.t, m.cuantas || 12);
    if (m.orden === 'paraderos') {
      var todo = [];
      m.paraderos.forEach(function (s) { todo = todo.concat(salidasParadero(red, m.tipo, s, m.t, 8)); });
      todo.sort(function (x, y) { return x.sale - y.sale; });
      return todo.slice(0, m.cuantas || 14);
    }
    if (m.orden === 'pasos') return pasosDeRuta(red, m.tipo, m.ruta, m.paradero, m.desde, m.hasta);
    if (m.orden === 'resumen') return resumenRuta(red, m.tipo, m.ruta, m.t, m.sel);
    if (m.orden === 'perfil') return perfilTrafico(red, m.tipo, m.pat, m.posSube, m.posBaja);
    if (m.orden === 'proximas') {
      var p = red.pat[m.pat];
      return { horas: proximas(red, m.tipo, p, m.pos, m.t, m.cuantas || 4), ultimo: ultima(red, m.tipo, p, m.pos) };
    }
    return null;
  }

  /* ---------- calendario ---------- */

  var DESFASE_BOGOTA = 5 * 3600 * 1000;   // Bogota va siempre 5 horas detras de UTC (sin horario de verano)

  function tipoDeFecha(base, texto) {
    var p = texto.split('-');
    var dia = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return (dia === 0 || base.festivos.indexOf(texto) >= 0) ? 'festivo' : (dia === 6 ? 'sabado' : 'habil');
  }

  /* Tipo de dia de servicio y segundos desde la medianoche (hora de Bogota) de ese dia.
   * Antes de las 3:00 se cuenta como el final del dia anterior (el GTFS numera 24:30, 25:10...). */
  function diaServicio(base, instante) {
    var b = new Date(instante.getTime() - DESFASE_BOGOTA);
    var seg = b.getUTCHours() * 3600 + b.getUTCMinutes() * 60 + b.getUTCSeconds();
    if (seg < 3 * 3600) { b = new Date(b.getTime() - 86400000); seg += 86400; }
    var texto = b.getUTCFullYear() + '-' + String(b.getUTCMonth() + 1).padStart(2, '0') + '-' + String(b.getUTCDate()).padStart(2, '0');
    return { tipo: tipoDeFecha(base, texto), seg: seg, fecha: texto, diaSemana: b.getUTCDay() };
  }

  /* Instante real de un segundo del dia de servicio `fecha` (AAAA-MM-DD, hora de Bogota) */
  function instanteDe(fecha, seg) {
    var p = fecha.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + DESFASE_BOGOTA + seg * 1000);
  }

  /* ---------- recorridos ---------- */

  function decodificar(texto) {
    var puntos = [], i = 0, lat = 0, lon = 0;
    while (i < texto.length) {
      for (var eje = 0; eje < 2; eje++) {
        var resultado = 0, corrimiento = 0, b;
        do { b = texto.charCodeAt(i++) - 63; resultado |= (b & 0x1f) << corrimiento; corrimiento += 5; } while (b >= 0x20);
        var delta = (resultado & 1) ? ~(resultado >> 1) : (resultado >> 1);
        if (eje === 0) lat += delta; else lon += delta;
      }
      puntos.push([lon / 1e5, lat / 1e5]);
    }
    return puntos;
  }

  /* Ubica cada paradero del patron sobre el recorrido, en orden. Devuelve posiciones fraccionarias (indice.fraccion). */
  function ubicarEnForma(red, p, forma) {
    var posiciones = new Float64Array(p.s.length), desde = 0;
    for (var q = 0; q < p.s.length; q++) {
      var la = red.lat[p.s[q]], lo = red.lon[p.s[q]];
      var mejor = Infinity, mejorPos = desde, lejos = 0;
      for (var j = Math.floor(desde); j < forma.length - 1; j++) {
        var a = forma[j], b = forma[j + 1];
        var k = Math.cos(la * RAD) * 111320, ax = (a[0] - lo) * k, ay = (a[1] - la) * 110574, bx = (b[0] - lo) * k, by = (b[1] - la) * 110574;
        var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        var u = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
        if (j + u < desde) u = desde - j;
        var ex = ax + dx * u, ey = ay + dy * u, d = Math.sqrt(ex * ex + ey * ey);
        if (d < mejor) { mejor = d; mejorPos = j + u; lejos = 0; }
        else if (mejor < 80) { lejos += Math.sqrt(l2); if (lejos > 400) break; }
      }
      posiciones[q] = mejorPos;
      desde = mejorPos;
    }
    return posiciones;
  }

  function puntoEnForma(forma, pos) {
    var j = Math.min(forma.length - 2, Math.floor(pos)), u = pos - j;
    return [forma[j][0] + (forma[j + 1][0] - forma[j][0]) * u, forma[j][1] + (forma[j + 1][1] - forma[j][1]) * u];
  }

  /* Trozo del recorrido entre dos posiciones fraccionarias */
  function tramoDeForma(forma, desde, hasta) {
    if (hasta < desde) { var x = desde; desde = hasta; hasta = x; }
    var salida = [puntoEnForma(forma, desde)];
    for (var j = Math.floor(desde) + 1; j <= Math.floor(hasta) && j < forma.length; j++) salida.push(forma[j]);
    salida.push(puntoEnForma(forma, hasta));
    return salida;
  }

  var api = { distancia: distancia, segundosCaminando: segundosCaminando, crearRed: crearRed, cargarViajes: cargarViajes,
              cercanos: cercanos, salidaEn: salidaEn, proximas: proximas, ultima: ultima, salidasParadero: salidasParadero,
              pasosDeRuta: pasosDeRuta, atender: atender, traficoTipico: traficoTipico, perfilTrafico: perfilTrafico, resumenRuta: resumenRuta, planear: planear, diaServicio: diaServicio, tipoDeFecha: tipoDeFecha, instanteDe: instanteDe, nombreTramo: nombreTramo, pasoPor: pasoPor,
              decodificar: decodificar, ubicarEnForma: ubicarEnForma, puntoEnForma: puntoEnForma, tramoDeForma: tramoDeForma,
              FACTOR_CAMINATA: FACTOR_CAMINATA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Planificador = api;
})(typeof self !== 'undefined' ? self : this);
