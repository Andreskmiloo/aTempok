---
name: a-tiempo
description: Mantener y publicar "A Tiempo", la app de SITP/TransMilenio de este repositorio (artifact privado de Claude). Usar al cambiar la app, actualizar horarios, probarla o publicarla.
---

# A Tiempo: guía rápida

## Qué es
- App de una página publicada como artifact privado: https://claude.ai/artifact/6tQouZVB9NQ9d2wk3U7tHk
- Rama de trabajo: `a-tiempo`. No crear PR si no lo piden.
- Archivos: `index.html` (fragmento: estilos, iconos, estructura), `app.js` (interfaz), `planificador.js` (rutas, tráfico, resumen de ruta; corre en navegador y Node), `trabajador.js`, `red/` (horario compacto), `mapa/` (teselas y letras), `herramientas/`, `pruebas/`.

## Preferencias del usuario
- Español claro y directo, sin emojis. Todo simple.
- Gastar pocos tokens: cambios puntuales, no releer archivos grandes.
- Probar y auditar antes de publicar; publicar solo con su visto bueno.

## Reglas de privacidad
- La llave de Croma nunca en chat, navegador ni repositorio. La app usa el conector `api tm`.
- Direcciones y lugares del usuario solo en su documento privado, nunca en el código ni en pruebas (usar puntos públicos).
- No mandar direcciones a servicios externos.

## Tareas comunes
- **Probar:** `node pruebas/planificador.prueba.js` y `node --check app.js`.
- **Actualizar horario:** bajar `https://gtfs.transmilenio.gov.co/GTFS.zip`, descomprimir y `python herramientas/red.py <gtfs> red` (requiere `duckdb`). Cambia a diario.
- **Publicar:** herramienta Artifact con `url` del enlace, `file_path` `index.html`, `root` el repositorio y en `files` solo lo que cambió. Sin `capabilities` (se conservan `mcp`, `db`, `user`).
- **Datos del usuario:** ArtifactData, colección `data/users/me`, documento `datos`. Leer antes de escribir y usar `update` con `if_version`. Campos: `lugares`, `rutinas`, `ajustes`, `perfil`, `historial`, `aprendizaje`, `consumo`, `saldo`.
- **Editar código:** parches con Python que comprueban que el texto a reemplazar aparece una sola vez; buscar con `grep -n` en vez de leer todo `app.js`.

## Revisar en el visor (skill artifact-emulator)
- Copiar los archivos publicables a una carpeta de prueba y servir esa carpeta.
- Banderas: `--caps user,db,mcp`, `--cap-config mcp='{"servers":[{"server":"api tm","tools":[...]}]}'`, `--knob mcpFixtures=<json>`, `--knob consent=granted`.
- Guion por stdin (nunca archivo guardado). Clics con `element.click()` dentro del marco; la ventana real es baja y los clics de ratón se pierden.
- Ganchos de prueba: `window.ATiempo.cargar(datos)`, `.fijarAhora(iso)`, `.ubicar(lat, lon)`, `.estado()`.
- Revisar celular (390x844) y escritorio (1280x800), claro y oscuro, y que no haya errores de consola.

## Tropiezos ya resueltos
- El visor no sirve binarios: teselas y letras van como base64+gzip dentro de JSON.
- `[hidden]{display:none!important}` es necesario.
- Muchas rutas del SITP son circulares en un solo patrón: se parten en el punto de giro `k` (`resumenRuta`).
- Si no hay ruta con los transbordos elegidos, `planearConRespaldo` prueba con uno más y lo avisa.
- El repositorio solo sigue `main`: tras subir, `git fetch origin +refs/heads/a-tiempo:refs/remotes/origin/a-tiempo`.
- OpenFreeMap exige un User-Agent propio y honesto; no falsificarlo.
- Cada consulta en vivo cuesta 10 créditos de Croma: siempre al pulsar o con tope diario.
- Sin GPS garantizado, sin NFC y sin avisos con la app cerrada; la ubicación tiene respaldo manual tocando el mapa.
