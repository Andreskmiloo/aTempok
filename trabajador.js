/* Proceso en segundo plano: carga la red y responde consultas del planificador sin trabar la pantalla. */
importScripts('planificador.js');

var red = null;
var cargas = {};

function leer(nombre) {
  return fetch(nombre).then(function (r) {
    if (!r.ok) throw new Error('No se pudo cargar ' + nombre + ' (' + r.status + ')');
    return r.json();
  });
}

var lista = leer('red/base.json').then(function (base) { red = Planificador.crearRed(base); });

function viajes(tipo) {
  if (!cargas[tipo]) {
    cargas[tipo] = lista.then(function () { return leer('red/viajes-' + tipo + '.json'); })
      .then(function (datos) { Planificador.cargarViajes(red, tipo, datos); });
  }
  return cargas[tipo];
}

onmessage = function (e) {
  var m = e.data;
  viajes(m.tipo).then(function () {
    postMessage({ id: m.id, ok: true, r: Planificador.atender(red, m) });
  }).catch(function (error) {
    postMessage({ id: m.id, ok: false, error: String((error && error.message) || error) });
  });
};
