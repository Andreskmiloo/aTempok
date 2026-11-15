# app-tm-personal
ayuda para usar tm de una mejor manera y mejorar tiempos y ver en tiempo real las rutas de mis buses

## A Tiempo

App para moverse en SITP y TransMilenio en Bogotá:

- Entrada sin contraseña (solo tu nombre por ahora) y pantalla de inicio tipo Uber.
- Mapa real de Bogotá y Soacha con filtros de paraderos, estaciones y recargas, y vista de pantalla completa.
- Mi ubicación: paraderos cercanos, próximos buses y rutas desde donde estás (si el navegador la permite).
- Pantalla de inicio «¿A dónde vas?»: eliges el destino (buscar, lugares guardados o el mapa); sale desde tu ubicación o desde Casa.
- Recomienda la mejor ruta de ida y de vuelta entre dos puntos, con transbordos; si no hay ruta directa, lo dice.
- Rutinas por día: dice a qué hora salir para llegar al paradero unos minutos antes del bus.
- Tráfico estimado con el horario oficial por hora y con los buses en vivo; alertas oficiales en hora pico.
- Lo que he aprendido: mejor ruta por rutina, tráfico típico por franja y mediciones en vivo.
- Todas las rutas, con una vista 3D de cuánto tarda cada una y sus paraderos.
- Horarios, próximas salidas y último bus de cada ruta.
- Datos en vivo (llegadas, buses y alertas) con el conector de Croma, con tope de consultas para cuidar los créditos.
- Comparación con moto y saldo estimado de la tarjeta.

La app es una página que se publica como artifact privado de Claude. No lleva llaves ni datos personales:
los lugares y rutinas de cada persona se guardan en su espacio privado de la base del artifact y en su navegador.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura, estilos, iconos y logo |
| `app.js` | Interfaz: mapa, tarjeta de hoy, planear, paraderos, rutinas, ajustes, en vivo |
| `planificador.js` | Búsqueda de rutas por rondas sobre la red compacta (corre en navegador y en Node) |
| `trabajador.js` | Corre el planificador en segundo plano |
| `red/` | Red de transporte compacta: paraderos, rutas, secuencias, viajes por tipo de día y recorridos |
| `mapa/` | Mapa base empaquetado: teselas vectoriales y letras |
| `herramientas/` | Scripts que arman `red/` y `mapa/` |
| `pruebas/` | Pruebas del planificador |

## Cómo se arman los datos

Requiere Python 3 con `duckdb` y `mapbox-vector-tile`.

```bash
# 1. Red de transporte, desde el GTFS oficial de TransMilenio
curl -L -o GTFS.zip https://gtfs.transmilenio.gov.co/GTFS.zip
mkdir gtfs && unzip -q GTFS.zip -d gtfs
python herramientas/red.py gtfs red

# 2. Mapa base (baja unas 270 teselas de Bogotá, las adelgaza y las empaqueta)
python herramientas/teselas.py teselas-crudas mapa red/base.json
```

El GTFS y las teselas crudas no se guardan en el repositorio.

## Pruebas

```bash
node pruebas/planificador.prueba.js
```

## En vivo

La app usa el conector de Croma de quien la abre. En esta instalación el conector se llama `api tm`
(constante `SERVIDOR` en `app.js`). Herramientas que llama: `transmilenio_stop_arrivals`,
`transmilenio_vehicles` y `transmilenio_alerts`. Planear rutas y ver horarios no gasta créditos.

## Fuentes

- Horarios y recorridos: datos abiertos de TransMilenio S.A. (GTFS).
- En vivo: Croma.
- Mapa: © OpenStreetMap, OpenMapTiles y OpenFreeMap. Dibujado con MapLibre GL JS.
