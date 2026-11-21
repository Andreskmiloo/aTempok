"""Convierte el GTFS oficial de TransMilenio en la red compacta que carga la app.

Uso:  python red.py <carpeta_gtfs_descomprimido> <carpeta_salida>

Escribe en la carpeta de salida:
  base.json            paraderos, estaciones, rutas, patrones (secuencias y tiempos), festivos y tarifa
  viajes-habil.json    viajes de lunes a viernes
  viajes-sabado.json   viajes de sabado
  viajes-festivo.json  viajes de domingo y festivo
  formas.json          recorrido simplificado de cada ruta (polilinea codificada)

El GTFS reparte el tiempo de cada viaje en proporcion fija entre paraderos, asi que
basta guardar, por patron, los tiempos de un viaje de referencia y, por viaje, su
hora de salida y su duracion. El script comprueba ese supuesto e informa el error.
"""
import json
import math
import os
import re
import sys
import time

import duckdb

SISTEMAS = ["troncal", "alimentador", "dual", "zonal", "complementario", "especial", "cable"]
AGENCIA_A_SISTEMA = {"1": 0, "2": 1, "6": 2, "3": 3, "4": 4, "5": 5, "7": 6}
TIPO_DIA = {"1": "habil", "2": "sabado", "4": "festivo"}
TOLERANCIA_M = 4.0


def distancia_m(lat1, lon1, lat2, lon2):
    k = math.cos(math.radians((lat1 + lat2) / 2))
    dx = (lon2 - lon1) * 111320.0 * k
    dy = (lat2 - lat1) * 110574.0
    return math.hypot(dx, dy)


def simplificar(puntos, tolerancia):
    """Douglas-Peucker iterativo sobre [(lat, lon)] con tolerancia en metros."""
    n = len(puntos)
    if n < 3:
        return list(puntos)
    lat0 = puntos[0][0]
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110574.0
    xs = [p[1] * kx for p in puntos]
    ys = [p[0] * ky for p in puntos]
    conservar = [False] * n
    conservar[0] = conservar[n - 1] = True
    pila = [(0, n - 1)]
    tol2 = tolerancia * tolerancia
    while pila:
        a, b = pila.pop()
        if b <= a + 1:
            continue
        ax, ay, bx, by = xs[a], ys[a], xs[b], ys[b]
        dx, dy = bx - ax, by - ay
        largo2 = dx * dx + dy * dy
        peor, indice = -1.0, -1
        for i in range(a + 1, b):
            px, py = xs[i] - ax, ys[i] - ay
            if largo2 == 0:
                d2 = px * px + py * py
            else:
                t = (px * dx + py * dy) / largo2
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                ex, ey = px - t * dx, py - t * dy
                d2 = ex * ex + ey * ey
            if d2 > peor:
                peor, indice = d2, i
        if peor > tol2:
            conservar[indice] = True
            pila.append((a, indice))
            pila.append((indice, b))
    return [p for p, c in zip(puntos, conservar) if c]


def polilinea(puntos):
    """Polilinea codificada (algoritmo de Google, precision 5) de [(lat, lon)]."""
    salida = []
    antes_lat = antes_lon = 0
    for lat, lon in puntos:
        ilat, ilon = int(round(lat * 1e5)), int(round(lon * 1e5))
        for delta in (ilat - antes_lat, ilon - antes_lon):
            v = ~(delta << 1) if delta < 0 else (delta << 1)
            while v >= 0x20:
                salida.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            salida.append(chr(v + 63))
        antes_lat, antes_lon = ilat, ilon
    return "".join(salida)


def limpiar(texto):
    return re.sub(r"\s+", " ", (texto or "").strip())


def partes_nombre(corto, largo):
    """Devuelve [(codigo, destino)] para la primera y la segunda mitad del recorrido."""
    numeros = re.findall(r"\d+", corto or "")
    partes = [limpiar(p) for p in (largo or "").split("||")]
    salida = []
    for parte in partes[:2]:
        m = re.match(r"^([A-Z]{1,2}\d+[A-Z]?)\s+(.+)$", parte)
        if m and any(n in m.group(1) for n in numeros):
            salida.append((m.group(1), m.group(2)))
        else:
            salida.append((corto, parte))
    if not salida:
        salida = [(corto, "")]
    return salida


def deltas(valores):
    salida, antes = [], 0
    for v in valores:
        salida.append(v - antes)
        antes = v
    return salida


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    gtfs, destino = sys.argv[1], sys.argv[2]
    os.makedirs(destino, exist_ok=True)
    inicio = time.time()
    con = duckdb.connect()
    for tabla in ["agency", "routes", "stops", "trips", "calendar_dates", "shapes", "frequencies", "feed_info", "fare_attributes"]:
        con.execute(f"CREATE TABLE {tabla} AS SELECT * FROM read_csv('{gtfs}/{tabla}.txt', header=true, all_varchar=true)")
    con.execute(f"""CREATE TABLE st AS
        SELECT trip_id, stop_id, CAST(stop_sequence AS INTEGER) seq,
               CAST(substr(arrival_time,1,2) AS INTEGER)*3600 + CAST(substr(arrival_time,4,2) AS INTEGER)*60
               + CAST(substr(arrival_time,7,2) AS INTEGER) AS t
        FROM read_csv('{gtfs}/stop_times.txt', header=true, all_varchar=true)""")
    con.execute("""CREATE TABLE tp AS
        SELECT s.trip_id, tr.route_id, tr.service_id, s.stops, s.times, s.n,
               md5(array_to_string(s.stops, ',')) pkey, s.times[1] t0, s.times[s.n] t1
        FROM (SELECT trip_id, list(stop_id ORDER BY seq) stops, list(t ORDER BY seq) times, count(*) n
              FROM st GROUP BY trip_id) s JOIN trips tr USING (trip_id)""")
    print("cargado en", round(time.time() - inicio, 1), "s")

    # ---------- paraderos y estaciones ----------
    usados = {r[0] for r in con.execute("SELECT DISTINCT stop_id FROM st").fetchall()}
    filas = con.execute("SELECT stop_id, stop_code, stop_name, stop_lat, stop_lon, parent_station, location_type FROM stops").fetchall()
    por_id = {f[0]: f for f in filas}
    estaciones_id = sorted({f[5] for f in filas if f[0] in usados and f[5]}, key=lambda x: (len(x), x))
    est_indice = {e: i for i, e in enumerate(estaciones_id)}
    paraderos_id = sorted(usados, key=lambda x: (len(x), x))
    par_indice = {p: i for i, p in enumerate(paraderos_id)}

    # ---------- rutas ----------
    rutas = con.execute("SELECT route_id, route_short_name, route_long_name, agency_id FROM routes ORDER BY route_id").fetchall()
    rut_indice = {r[0]: i for i, r in enumerate(rutas)}

    # ---------- patrones ----------
    patrones = con.execute("""
        SELECT route_id, pkey, arg_max(stops, t1 - t0) stops, arg_max(times, t1 - t0) times, count(*) n
        FROM tp GROUP BY route_id, pkey ORDER BY route_id, n DESC, pkey""").fetchall()
    pat_indice = {(p[0], p[1]): i for i, p in enumerate(patrones)}
    print("patrones", len(patrones))

    # comprobacion del reparto proporcional
    con.execute("""CREATE TEMP TABLE ref AS
        SELECT route_id, pkey, arg_max(times, t1 - t0) rt, max(t1 - t0) rd FROM tp GROUP BY route_id, pkey""")
    error = con.execute("""
        SELECT max(e), avg(e), quantile_cont(e, 0.999), sum(CASE WHEN e > 30 THEN 1 ELSE 0 END), count(*) FROM (
          SELECT abs(c.t - (c.t0 + (r.rt[c.i] - r.rt[1]) * 1.0 * (c.t1 - c.t0) / r.rd)) e
          FROM (SELECT route_id, pkey, t0, t1, unnest(times) t, generate_subscripts(times, 1) i FROM tp) c
          JOIN ref r USING (route_id, pkey))""").fetchone()
    print("error del modelo proporcional (s): max %.1f, medio %.2f, p99.9 %.1f, filas >30 s: %s de %s" % error)

    # sentido por patron: indice donde empieza la segunda mitad (regreso)
    coord = {pid: (float(por_id[pid][3]), float(por_id[pid][4])) for pid in paraderos_id}
    principal = {}
    for p in patrones:
        if p[0] not in principal:
            principal[p[0]] = p  # el de mas viajes por el ORDER BY

    def corte_lazo(stops):
        a, b = coord[stops[0]], coord[stops[-1]]
        if distancia_m(a[0], a[1], b[0], b[1]) > 600:
            return len(stops)
        lejos, indice = -1.0, len(stops)
        for i, s in enumerate(stops):
            d = distancia_m(a[0], a[1], coord[s][0], coord[s][1])
            if d > lejos:
                lejos, indice = d, i
        return indice + 1

    corte_principal = {r: corte_lazo(p[2]) for r, p in principal.items()}

    def corte_variante(ruta, stops):
        base = principal[ruta][2]
        k = corte_principal[ruta]
        if stops == base:
            return k
        pos, hallados, primero_regreso = 0, 0, None
        for i, s in enumerate(stops):
            try:
                j = base.index(s, pos)
            except ValueError:
                continue
            hallados += 1
            pos = j + 1
            if j >= k and primero_regreso is None:
                primero_regreso = i
        if hallados < len(stops) * 0.6:
            return corte_lazo(stops)
        return len(stops) if primero_regreso is None else primero_regreso

    sis_paradero = [0] * len(paraderos_id)
    pat_salida = []
    for p in patrones:
        ruta, _, stops, times, _ = p
        r = rut_indice[ruta]
        sis = AGENCIA_A_SISTEMA.get(rutas[r][3], 3)
        indices = [par_indice[s] for s in stops]
        for i in indices:
            sis_paradero[i] |= 1 << sis
        offs = [t - times[0] for t in times]
        pat_salida.append([r, offs[-1], corte_variante(ruta, stops), indices, deltas(offs)])

    # ---------- viajes por tipo de dia ----------
    frecuencias = {}
    for trip_id, ini, fin, cada in con.execute("SELECT trip_id, start_time, end_time, headway_secs FROM frequencies").fetchall():
        def seg(c):
            h, m, s = c.split(":")
            return int(h) * 3600 + int(m) * 60 + int(s)
        frecuencias.setdefault(trip_id, []).append([seg(ini), seg(fin), int(cada)])
    viajes = {t: [[[], []] for _ in patrones] for t in TIPO_DIA.values()}
    frec = {t: {} for t in TIPO_DIA.values()}
    conteo = {t: 0 for t in TIPO_DIA.values()}
    for trip_id, ruta, servicio, pkey, t0, t1 in con.execute(
            "SELECT trip_id, route_id, service_id, pkey, t0, t1 FROM tp ORDER BY route_id, pkey, t0, t1").fetchall():
        tipo = TIPO_DIA.get(servicio)
        if tipo is None:
            continue
        i = pat_indice[(ruta, pkey)]
        if trip_id in frecuencias:
            for ini, fin, cada in frecuencias[trip_id]:
                frec[tipo].setdefault(str(i), []).append([ini, fin, cada, t1 - t0])
            continue
        viajes[tipo][i][0].append(t0)
        viajes[tipo][i][1].append(t1 - t0)
        conteo[tipo] += 1
    for tipo in viajes:
        for i, (salidas, duraciones) in enumerate(viajes[tipo]):
            viajes[tipo][i] = [deltas(salidas), deltas(duraciones)] if salidas else 0
        for lista in frec[tipo].values():
            lista.sort()
    print("viajes", conteo)

    # ---------- recorridos ----------
    formas = [""] * len(rutas)
    forma_de_ruta = dict(con.execute("SELECT route_id, any_value(shape_id) FROM trips GROUP BY route_id").fetchall())
    puntos_antes = puntos_despues = 0
    datos = con.execute("""SELECT shape_id, list(CAST(shape_pt_lat AS DOUBLE) ORDER BY CAST(shape_pt_sequence AS INTEGER)),
                                  list(CAST(shape_pt_lon AS DOUBLE) ORDER BY CAST(shape_pt_sequence AS INTEGER))
                           FROM shapes GROUP BY shape_id""").fetchall()
    por_forma = {d[0]: list(zip(d[1], d[2])) for d in datos}
    for ruta, forma in forma_de_ruta.items():
        puntos = por_forma.get(forma)
        if not puntos:
            continue
        simple = simplificar(puntos, TOLERANCIA_M)
        puntos_antes += len(puntos)
        puntos_despues += len(simple)
        formas[rut_indice[ruta]] = polilinea(simple)
    print("puntos de recorrido", puntos_antes, "->", puntos_despues)

    # ---------- calendario y tarifa ----------
    festivos = [f"{d[:4]}-{d[4:6]}-{d[6:]}" for (d,) in con.execute(
        "SELECT DISTINCT date FROM calendar_dates WHERE service_id = '4' AND exception_type = '1' ORDER BY 1").fetchall()]
    info = con.execute("SELECT feed_start_date, feed_end_date FROM feed_info").fetchone()
    tarifa = con.execute("SELECT price, transfer_duration FROM fare_attributes LIMIT 1").fetchone()

    rut = {"id": [], "cod": [], "nom": [], "sis": [], "c1": [], "d1": [], "c2": [], "d2": []}
    for ruta_id, corto, largo, agencia in rutas:
        partes = partes_nombre(corto, largo)
        rut["id"].append(ruta_id)
        rut["cod"].append(corto)
        rut["nom"].append(limpiar(largo))
        rut["sis"].append(AGENCIA_A_SISTEMA.get(agencia, 3))
        rut["c1"].append(partes[0][0])
        rut["d1"].append(partes[0][1])
        rut["c2"].append(partes[1][0] if len(partes) > 1 else "")
        rut["d2"].append(partes[1][1] if len(partes) > 1 else "")

    base = {
        "version": 1,
        "generado": time.strftime("%Y-%m-%d"),
        "vigencia": [f"{info[0][:4]}-{info[0][4:6]}-{info[0][6:]}", f"{info[1][:4]}-{info[1][4:6]}-{info[1][6:]}"],
        "tarifa": int(float(tarifa[0])),
        "ventanaTransbordo": int(float(tarifa[1])),
        "festivos": festivos,
        "sistemas": SISTEMAS,
        "est": {
            "id": estaciones_id,
            "nom": [limpiar(por_id[e][2]) for e in estaciones_id],
            "lat": [int(round(float(por_id[e][3]) * 1e5)) for e in estaciones_id],
            "lon": [int(round(float(por_id[e][4]) * 1e5)) for e in estaciones_id],
        },
        "par": {
            "id": paraderos_id,
            "cod": [(por_id[p][1] or "").replace("_TM", "") for p in paraderos_id],
            "nom": [limpiar(por_id[p][2]) for p in paraderos_id],
            "lat": [int(round(coord[p][0] * 1e5)) for p in paraderos_id],
            "lon": [int(round(coord[p][1] * 1e5)) for p in paraderos_id],
            "est": [est_indice.get(por_id[p][5], -1) if por_id[p][5] else -1 for p in paraderos_id],
            "sis": sis_paradero,
        },
        "rut": rut,
        "pat": pat_salida,
    }

    def guardar(nombre, objeto):
        ruta_archivo = os.path.join(destino, nombre)
        with open(ruta_archivo, "w", encoding="utf-8") as f:
            json.dump(objeto, f, ensure_ascii=False, separators=(",", ":"))
        print("%-22s %8.1f KB" % (nombre, os.path.getsize(ruta_archivo) / 1024))

    guardar("base.json", base)
    for tipo in viajes:
        guardar(f"viajes-{tipo}.json", {"tipo": tipo, "p": viajes[tipo], "frec": frec[tipo]})
    guardar("formas.json", {"f": formas})
    print("paraderos", len(paraderos_id), "estaciones", len(estaciones_id), "rutas", len(rutas), "total s", round(time.time() - inicio, 1))


if __name__ == "__main__":
    main()
