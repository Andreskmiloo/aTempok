/* Pruebas del planificador con puntos publicos de Bogota.
 * Uso:  node pruebas/planificador.prueba.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../planificador.js');

const raiz = path.join(__dirname, '..', 'red');
const leer = (nombre) => JSON.parse(fs.readFileSync(path.join(raiz, nombre), 'utf8'));
const base = leer('base.json');
const red = P.crearRed(base);
['habil', 'sabado', 'festivo'].forEach((tipo) => P.cargarViajes(red, tipo, leer('viajes-' + tipo + '.json')));

const hora = (h, m) => h * 3600 + (m || 0) * 60;
const reloj = (s) => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0');

const UNICENTRO = { lat: 4.7024, lon: -74.0412 };
const U_NACIONAL = { lat: 4.6367, lon: -74.0834 };
const PORTAL_NORTE = { lat: 4.7546, lon: -74.0460 };
const MUSEO_NACIONAL = { lat: 4.6155, lon: -74.0686 };
const PARAISO = { lat: 4.5534, lon: -74.1588 };
const USAQUEN = { lat: 4.6947, lon: -74.0308 };

function describir(tr) {
  return reloj(tr.sale) + '-' + reloj(tr.llega) + ' ' + tr.tramos.map((t) => t.tipo === 'pie'
    ? 'pie ' + Math.round(t.seg / 60) + 'm'
    : t.letrero + ' [' + base.par.nom[t.sube] + ' ' + reloj(t.sale) + ' > ' + base.par.nom[t.baja] + ' ' + reloj(t.llega) + ']').join(' | ') +
    '  (' + (tr.etiquetas || []).join(', ') + ')';
}

function revisarTrayecto(tr, colchon) {
  let t = tr.sale;
  assert(tr.tramos.length >= 3, 'un trayecto en bus tiene caminata, bus y caminata');
  tr.tramos.forEach((tramo, i) => {
    assert(tramo.llega >= tramo.sale, 'cada tramo termina despues de empezar');
    if (tramo.tipo === 'bus') {
      assert(tramo.sale >= t + (i === 1 ? colchon : 0) - 1, 'el bus sale despues de llegar al paradero, con colchon en el primero');
      assert(tramo.posBaja > tramo.posSube, 'se baja despues de subirse');
      assert(tramo.ultimo >= tramo.sale, 'el ultimo bus del dia no es anterior al que se toma');
    } else {
      assert(Math.abs(tramo.sale - t) <= 1, 'la caminata empieza donde termino el tramo anterior');
    }
    t = tramo.llega;
  });
  assert.strictEqual(t, tr.llega);
}

let pruebas = 0;
function prueba(nombre, f) { f(); pruebas++; console.log('ok  ' + nombre); }

prueba('salir a las 17:00 en dia habil (troncal)', () => {
  const r = P.planear(red, { desde: PORTAL_NORTE, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(17), tipo: 'habil' });
  assert(r.trayectos.length >= 1, 'hay trayectos');
  r.trayectos.forEach((tr) => { assert(tr.sale >= hora(17)); revisarTrayecto(tr, 180); });
  assert(r.trayectos[0].etiquetas.includes('Mejor opción'));
  console.log('    ' + describir(r.trayectos[0]));
});

prueba('llegar a las 18:00 devuelve salidas que si llegan', () => {
  const r = P.planear(red, { desde: UNICENTRO, hasta: U_NACIONAL, modo: 'llegar', t: hora(18), tipo: 'habil' });
  assert(r.trayectos.length >= 1, 'hay trayectos');
  r.trayectos.forEach((tr) => { assert(tr.llega <= hora(18), 'llega a tiempo'); revisarTrayecto(tr, 180); });
  const mejor = r.trayectos[0];
  assert(hora(18) - mejor.llega < 40 * 60, 'no llega exageradamente temprano');
  // saliendo 10 minutos despues de la mejor salida ya no se alcanza a llegar con ninguna opcion mas tardia
  const tarde = P.planear(red, { desde: UNICENTRO, hasta: U_NACIONAL, modo: 'salir', t: Math.max.apply(null, r.trayectos.map((x) => x.sale)) + 600, tipo: 'habil' });
  assert(tarde.trayectos.every((tr) => tr.llega > hora(18)), 'no existe una salida mas tardia que llegue a tiempo');
  r.trayectos.forEach((tr) => console.log('    ' + describir(tr)));
});

prueba('sabado y festivo tienen servicio', () => {
  ['sabado', 'festivo'].forEach((tipo) => {
    const r = P.planear(red, { desde: UNICENTRO, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(10), tipo });
    assert(r.trayectos.length >= 1, tipo);
    r.trayectos.forEach((tr) => revisarTrayecto(tr, 180));
  });
});

prueba('un trayecto que necesita transbordo', () => {
  const sin = P.planear(red, { desde: PARAISO, hasta: USAQUEN, modo: 'salir', t: hora(9), tipo: 'habil', transbordos: 0 });
  const con = P.planear(red, { desde: PARAISO, hasta: USAQUEN, modo: 'salir', t: hora(9), tipo: 'habil', transbordos: 2 });
  assert(con.trayectos.length >= 1, 'con transbordos hay trayecto');
  if (!sin.trayectos.length) assert(con.trayectos[0].transbordos >= 1);
  con.trayectos.forEach((tr) => revisarTrayecto(tr, 180));
  console.log('    directo: ' + (sin.trayectos[0] ? describir(sin.trayectos[0]) : 'no hay'));
  console.log('    ' + describir(con.trayectos[0]));
});

prueba('sin servicio de madrugada y sin paraderos fuera de la ciudad', () => {
  const noche = P.planear(red, { desde: UNICENTRO, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(26, 30), tipo: 'habil' });
  assert.strictEqual(noche.trayectos.length, 0);
  assert.strictEqual(noche.motivo, 'sin_servicio');
  const lejos = P.planear(red, { desde: UNICENTRO, hasta: { lat: 4.20, lon: -74.40 }, modo: 'salir', t: hora(9), tipo: 'habil' });
  assert.strictEqual(lejos.motivo, 'sin_paraderos');
});

prueba('de noche avisa el ultimo bus', () => {
  const r = P.planear(red, { desde: MUSEO_NACIONAL, hasta: PORTAL_NORTE, modo: 'salir', t: hora(22), tipo: 'habil' });
  assert(r.trayectos.length >= 1);
  const bus = r.trayectos[0].tramos.find((t) => t.tipo === 'bus');
  assert(bus.ultimo >= bus.sale);
  console.log('    ' + bus.letrero + ' sale ' + reloj(bus.sale) + ', ultimo ' + reloj(bus.ultimo));
});

prueba('hora de salida: bus menos caminata menos colchon', () => {
  const r = P.planear(red, { desde: UNICENTRO, hasta: MUSEO_NACIONAL, modo: 'llegar', t: hora(18), tipo: 'habil', colchon: 180 });
  const tr = r.trayectos[0], pie = tr.tramos[0], bus = tr.tramos[1];
  assert.strictEqual(tr.sale, bus.sale - 180 - pie.seg);
});

prueba('calendario: festivos, sabados y madrugada', () => {
  const en = (iso) => P.diaServicio(base, new Date(iso));
  assert.strictEqual(en('2026-11-16T10:00:00-05:00').tipo, 'festivo');   // lunes festivo
  assert.strictEqual(en('2026-11-14T10:00:00-05:00').tipo, 'sabado');
  assert.strictEqual(en('2026-11-17T10:00:00-05:00').tipo, 'habil');
  const madrugada = en('2026-11-15T01:30:00-05:00');                      // domingo 1:30 = fin del sabado
  assert.strictEqual(madrugada.tipo, 'sabado');
  assert.strictEqual(madrugada.seg, 25 * 3600 + 1800);
  assert.strictEqual(P.instanteDe('2026-11-14', madrugada.seg).toISOString(), new Date('2026-11-15T01:30:00-05:00').toISOString());
});

prueba('los paraderos de un patron caen sobre su recorrido, en orden', () => {
  const formas = leer('formas.json').f;
  let revisados = 0, lejos = 0, total = 0;
  for (let i = 0; i < red.pat.length; i += 37) {
    const p = red.pat[i], forma = P.decodificar(formas[p.r]);
    if (forma.length < 2) continue;
    const pos = P.ubicarEnForma(red, p, forma);
    for (let q = 0; q < pos.length; q++) {
      if (q) assert(pos[q] >= pos[q - 1], 'posiciones en orden');
      const pt = P.puntoEnForma(forma, pos[q]);
      total++;
      if (P.distancia(red.lat[p.s[q]], red.lon[p.s[q]], pt[1], pt[0]) > 120) lejos++;
    }
    revisados++;
  }
  assert(revisados > 20);
  assert(lejos / total < 0.03, 'casi todos los paraderos quedan a menos de 120 m del recorrido: ' + lejos + ' de ' + total);
  console.log('    patrones revisados ' + revisados + ', paraderos lejos del recorrido ' + lejos + ' de ' + total);
});

prueba('trafico tipico: la hora pico tarda mas que la madrugada', () => {
  const r = P.planear(red, { desde: PORTAL_NORTE, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(17, 30), tipo: 'habil' });
  const bus = r.trayectos[0].tramos.find((t) => t.tipo === 'bus');
  assert(bus.trafico, 'cada tramo en bus trae su trafico');
  assert(['fluido', 'moderado', 'pesado'].includes(bus.trafico.nivel));
  assert(bus.trafico.seg >= bus.trafico.segMin && bus.trafico.extra === bus.trafico.seg - bus.trafico.segMin);
  const perfil = P.perfilTrafico(red, 'habil', bus.pat, bus.posSube, bus.posBaja);
  assert.strictEqual(perfil.length, 19);
  const con = perfil.filter((x) => x.seg);
  assert(con.length >= 12, 'hay servicio casi todo el dia');
  const min = Math.min.apply(null, con.map((x) => x.seg));
  assert(min >= bus.trafico.segMin - 1, 'el perfil no baja de lo mas rapido del dia');
  const temprano = P.traficoTipico(red, 'habil', bus.pat, bus.posSube, bus.posBaja, hora(5, 10));
  if (temprano) assert(temprano.extra <= bus.trafico.extra, 'de madrugada no hay mas trafico que en la tarde');
  console.log('    ' + bus.letrero + ' a las 5:30 p. m.: ' + bus.trafico.nivel + ' +' + Math.round(bus.trafico.extra / 60) + ' min; por hora: ' +
    perfil.map((x) => x.h + 'h ' + (x.seg ? Math.round(x.seg / 60) : '-')).join(', '));
});

prueba('resumen de una ruta: sentidos, salidas y minutos acumulados', () => {
  const r = P.planear(red, { desde: PORTAL_NORTE, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(9), tipo: 'habil' });
  const ruta = r.trayectos[0].tramos.find((t) => t.tipo === 'bus').ruta;
  const s = P.resumenRuta(red, 'habil', ruta, hora(9));
  assert(s.sentidos.length >= 1 && s.enServicio);
  assert(s.dur > 0 && s.primera <= s.sale && s.sale <= s.ultima);
  assert.strictEqual(s.acumulado.length, s.paraderos.length);
  assert.strictEqual(s.acumulado[0], 0);
  for (let q = 1; q < s.acumulado.length; q++) assert(s.acumulado[q] >= s.acumulado[q - 1], 'los minutos solo crecen');
  assert(Math.abs(s.acumulado[s.acumulado.length - 1] - s.dur) <= 1, 'el ultimo paradero llega a la duracion total');
  if (s.sentidos.length > 1) {
    const otro = P.resumenRuta(red, 'habil', ruta, hora(9), s.sentidos[1].clave);
    assert.strictEqual(otro.clave, s.sentidos[1].clave);
  }
  // una ruta circular del SITP (ida y regreso en un solo recorrido) se parte en dos sentidos razonables
  const z8 = base.rut.cod.indexOf('Z8');
  const ida = P.resumenRuta(red, 'habil', z8, hora(9));
  assert(ida.sentidos.length === 2, 'la Z8 tiene ida y regreso');
  const vuelta = P.resumenRuta(red, 'habil', z8, hora(9), ida.sentidos[1].clave);
  assert(ida.paraderos.length + vuelta.paraderos.length === 198, 'los dos sentidos comparten el paradero de giro');
  assert(ida.dur > 0 && vuelta.dur > 0 && vuelta.acumulado[0] === 0, 'cada sentido tiene su duracion y empieza en cero');
  console.log('    Z8: hacia ' + base.par.nom[ida.sentidos[0].hasta] + ' ' + Math.round(ida.dur / 60) + ' min, hacia ' + base.par.nom[ida.sentidos[1].hasta] + ' ' + Math.round(vuelta.dur / 60) + ' min');
  const noche = P.resumenRuta(red, 'habil', ruta, hora(27));
  assert(!noche.enServicio && noche.dur > 0, 'fuera de servicio igual muestra cuanto tarda');
  console.log('    ' + base.rut.cod[ruta] + ': ' + s.sentidos.length + ' sentidos, ' + Math.round(s.dur / 60) + ' min, primera ' + reloj(s.primera) +
    ', ultima ' + reloj(s.ultima) + ', cada ' + (s.cada ? Math.round(s.cada / 60) + ' min' : '?'));
});

prueba('bus perdido: compara quedarse y caminar sin volver a ofrecer el viaje perdido', () => {
  const consulta = { desde: PORTAL_NORTE, hasta: MUSEO_NACIONAL, modo: 'salir', t: hora(17), tipo: 'habil' };
  const perdido = P.planear(red, consulta).trayectos[0].tramos.find(t => t.tipo === 'bus');
  const desde = { lat: red.lat[perdido.sube], lon: red.lon[perdido.sube] };
  const { trayectos } = P.planear(red, { ...consulta, desde, t: perdido.sale - 180, perdido });
  assert.strictEqual(trayectos.length, 2);
  const buses = trayectos.map(tr => tr.tramos.find(t => t.tipo === 'bus'));
  assert(buses.some(t => t.sube === perdido.sube));
  assert(buses.some(t => t.sube !== perdido.sube));
  assert(buses.every(t => t.pat !== perdido.pat || t.ini !== perdido.ini));
});

console.log(pruebas + ' pruebas pasaron');
