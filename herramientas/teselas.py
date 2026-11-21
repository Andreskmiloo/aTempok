"""Descarga, adelgaza y empaqueta el mapa base de Bogota y Soacha.

Uso:  python teselas.py <carpeta_crudas> <carpeta_mapa> <red/base.json>

Fuente: teselas vectoriales de OpenFreeMap (esquema OpenMapTiles, datos de OpenStreetMap).
El visor de la app no puede pedir mapas a otros sitios, por eso cada tesela se guarda
junto a la app como un archivo JSON con el contenido comprimido (gzip) en base64.

Para que pesen poco se quitan capas y atributos que la app no dibuja (numeros de puerta,
puntos de interes, traducciones de nombres, senderos). Los edificios se conservan solo en z14
con su altura, para dibujarlos en volumen.

Relieve: teselas Terrarium de AWS Terrain Tiles (z9-12) guardadas como PNG en base64
(mapa/r/), para que la vista inclinada muestre los cerros.
"""
import base64
import gzip
import json
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from mapbox_vector_tile.Mapbox import vector_tile_pb2 as pb

TILEJSON = "https://tiles.openfreemap.org/planet"
FUENTES = "https://tiles.openfreemap.org/fonts/{}/{}.pbf"
LETRAS = ["Noto Sans Regular", "Noto Sans Bold"]
RANGOS = ["0-255"]
CAJA = (-74.245, 4.42, -73.985, 4.845)  # oeste, sur, este, norte
# El servicio permite bajar una zona para uso sin conexion si cada descarga tiene como maximo
# 3.000 teselas, usa hasta 4 pedidos a la vez y se identifica con un nombre propio.
IDENTIFICACION = "mapa-offline-transporte-bogota/1.0"
ZMIN, ZMAX = 9, 14

VIAS_SIEMPRE = {"motorway", "trunk", "primary", "secondary", "tertiary", "busway", "bus_guideway", "rail", "transit"}
VIAS_DETALLE = VIAS_SIEMPRE | {"minor"}
USOS = {"school", "university", "college", "hospital", "cemetery", "stadium", "pitch", "military", "industrial", "commercial", "retail"}
LUGARES = {"city", "town", "village", "suburb", "quarter", "neighbourhood", "hamlet"}


def regla_transporte(z, p):
    clase = p.get("class", "")
    if clase.endswith("_construction"):
        return False
    if clase == "path":
        return z >= 14 and p.get("subclass") == "pedestrian"
    if p.get("brunnel") == "tunnel" and clase in ("rail", "transit"):
        return False
    return clase in (VIAS_DETALLE if z >= 13 else VIAS_SIEMPRE)


# capa -> (filtro(z, propiedades), atributos que se conservan)
REGLAS = {
    "water": (lambda z, p: p.get("class") != "swimming_pool", ["class"]),
    "waterway": (lambda z, p: p.get("class") in ("river", "canal") and p.get("brunnel") != "tunnel", ["class"]),
    "landcover": (lambda z, p: p.get("class") in ("grass", "wood", "wetland"), ["class", "subclass"]),
    "landuse": (lambda z, p: p.get("class") in USOS, ["class"]),
    "park": (lambda z, p: True, ["class"]),
    "aeroway": (lambda z, p: True, ["class"]),
    "transportation": (regla_transporte, ["class", "subclass", "brunnel", "ramp"]),
    "transportation_name": (lambda z, p: bool(p.get("name")) and (z >= 13 or p.get("class") != "minor"), ["name", "class", "ref"]),
    "place": (lambda z, p: p.get("class") in LUGARES and bool(p.get("name")), ["name", "class", "rank"]),
    "aerodrome_label": (lambda z, p: bool(p.get("name")), ["name", "iata"]),
    "building": (lambda z, p: z >= 14, ["render_height", "render_min_height"]),
}
RELIEVE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZRELIEVE = range(9, 13)


def tesela_de(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def valor_python(v):
    for campo in ("string_value", "float_value", "double_value", "int_value", "uint_value", "sint_value", "bool_value"):
        if v.HasField(campo):
            return getattr(v, campo)
    return None


def adelgazar(crudo, z):
    entrada = pb.tile()
    entrada.ParseFromString(crudo)
    salida = pb.tile()
    for capa in entrada.layers:
        regla = REGLAS.get(capa.name)
        if regla is None:
            continue
        filtro, atributos = regla
        claves = list(capa.keys)
        valores = list(capa.values)
        valores_py = [valor_python(v) for v in valores]
        nueva = pb.tile.layer()
        nueva.name = capa.name
        nueva.version = capa.version
        nueva.extent = capa.extent
        mapa_claves, mapa_valores = {}, {}
        for elemento in capa.features:
            etiquetas = list(elemento.tags)
            props = {claves[etiquetas[i]]: etiquetas[i + 1] for i in range(0, len(etiquetas), 2)}
            props_py = {k: valores_py[i] for k, i in props.items()}
            if not filtro(z, props_py):
                continue
            n = nueva.features.add()
            n.type = elemento.type
            n.geometry.extend(elemento.geometry)
            for clave in atributos:
                if clave not in props:
                    continue
                if clave not in mapa_claves:
                    mapa_claves[clave] = len(mapa_claves)
                    nueva.keys.append(clave)
                iv = props[clave]
                if iv not in mapa_valores:
                    mapa_valores[iv] = len(mapa_valores)
                    nueva.values.add().CopyFrom(valores[iv])
                n.tags.extend([mapa_claves[clave], mapa_valores[iv]])
        if len(nueva.features):
            salida.layers.add().CopyFrom(nueva)
    return salida.SerializeToString()


def bajar(url):
    pedido = urllib.request.Request(url, headers={"Accept-Encoding": "gzip", "User-Agent": IDENTIFICACION})
    with urllib.request.urlopen(pedido, timeout=60) as r:
        datos = r.read()
        if r.headers.get("Content-Encoding") == "gzip" or datos[:2] == b"\x1f\x8b":
            datos = gzip.decompress(datos)
        return datos


def empaquetar(datos):
    return base64.b64encode(gzip.compress(datos, 9, mtime=0)).decode("ascii")


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    crudas, mapa, base_json = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(crudas, exist_ok=True)
    os.makedirs(os.path.join(mapa, "t"), exist_ok=True)

    with open(base_json, encoding="utf-8") as f:
        base = json.load(f)
    paraderos = list(zip(base["par"]["lon"], base["par"]["lat"]))

    # teselas: todas las de la caja hasta z12; en z13 y z14 solo donde hay paraderos (y sus vecinas)
    lista = []
    for z in range(ZMIN, ZMAX + 1):
        x0, y1 = tesela_de(CAJA[0], CAJA[1], z)
        x1, y0 = tesela_de(CAJA[2], CAJA[3], z)
        caja = {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
        if z >= 13:
            con_paraderos = set()
            for lon, lat in paraderos:
                x, y = tesela_de(lon / 1e5, lat / 1e5, z)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        con_paraderos.add((x + dx, y + dy))
            caja &= con_paraderos
        lista += [(z, x, y) for x, y in sorted(caja)]
    print("teselas", len(lista), {z: sum(1 for t in lista if t[0] == z) for z in range(ZMIN, ZMAX + 1)})

    plantilla = json.loads(bajar(TILEJSON))["tiles"][0]
    print("fuente", plantilla)

    def obtener(t):
        z, x, y = t
        ruta = os.path.join(crudas, f"{z}-{x}-{y}.pbf")
        if os.path.exists(ruta) and os.path.getsize(ruta) > 0:
            return 0
        datos = b""
        for intento in range(3):
            try:
                datos = bajar(plantilla.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)))
                break
            except Exception as e:  # reintenta fallos de red
                error = e
        else:
            print("fallo", t, error)
            return 0
        with open(ruta, "wb") as f:
            f.write(datos)
        return 1

    with ThreadPoolExecutor(4) as grupo:
        nuevas = sum(grupo.map(obtener, lista))
    print("descargadas ahora", nuevas)

    indice = {str(z): [] for z in range(ZMIN, ZMAX + 1)}
    crudo_total = fino_total = empaquetado_total = 0
    por_zoom = {}
    for z, x, y in lista:
        ruta = os.path.join(crudas, f"{z}-{x}-{y}.pbf")
        if not os.path.exists(ruta):
            continue
        with open(ruta, "rb") as f:
            crudo = f.read()
        fino = adelgazar(crudo, z)
        if not fino:
            continue
        texto = empaquetar(fino)
        with open(os.path.join(mapa, "t", f"{z}-{x}-{y}.json"), "w", encoding="ascii") as f:
            json.dump(texto, f)
        indice[str(z)].append(f"{x}-{y}")
        crudo_total += len(crudo)
        fino_total += len(fino)
        empaquetado_total += len(texto)
        a = por_zoom.setdefault(z, [0, 0, 0])
        a[0] += 1
        a[1] += len(texto)
        a[2] = max(a[2], len(texto))
    for z, (n, total, mayor) in sorted(por_zoom.items()):
        print(f"z{z}: {n} teselas, {total / 1024:.0f} KB, media {total / n / 1024:.0f} KB, mayor {mayor / 1024:.0f} KB")
    print(f"crudo {crudo_total / 1e6:.1f} MB -> fino {fino_total / 1e6:.1f} MB -> empaquetado {empaquetado_total / 1e6:.1f} MB")

    # relieve: PNG Terrarium (ya comprimidos), en base64 sin gzip
    os.makedirs(os.path.join(mapa, "r"), exist_ok=True)
    indice_relieve, relieve_total = {}, 0
    for z in ZRELIEVE:
        x0, y1 = tesela_de(CAJA[0], CAJA[1], z)
        x1, y0 = tesela_de(CAJA[2], CAJA[3], z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                ruta = os.path.join(crudas, f"r-{z}-{x}-{y}.png")
                if not os.path.exists(ruta):
                    try:
                        with open(ruta, "wb") as f:
                            f.write(bajar(RELIEVE.format(z=z, x=x, y=y)))
                    except Exception as e:
                        print("sin relieve", z, x, y, e)
                        continue
                with open(ruta, "rb") as f:
                    texto = base64.b64encode(f.read()).decode("ascii")
                with open(os.path.join(mapa, "r", f"{z}-{x}-{y}.json"), "w", encoding="ascii") as f:
                    json.dump(texto, f)
                indice_relieve.setdefault(str(z), []).append(f"{x}-{y}")
                relieve_total += len(texto)
    print("relieve", {z: len(v) for z, v in indice_relieve.items()}, f"{relieve_total / 1e6:.1f} MB")

    letras = {}
    for nombre in LETRAS:
        for rango in RANGOS:
            try:
                letras[f"{nombre}/{rango}"] = empaquetar(bajar(FUENTES.format(nombre.replace(" ", "%20"), rango)))
            except Exception as e:
                print("sin letra", nombre, rango, e)
    with open(os.path.join(mapa, "letras.json"), "w", encoding="ascii") as f:
        json.dump(letras, f, separators=(",", ":"))
    with open(os.path.join(mapa, "indice.json"), "w", encoding="ascii") as f:
        json.dump({"zmin": ZMIN, "zmax": ZMAX, "caja": CAJA, "t": indice, "r": indice_relieve,
                   "atribucion": "© OpenStreetMap, OpenMapTiles, OpenFreeMap"}, f, separators=(",", ":"))
    print("letras", {k: len(v) // 1024 for k, v in letras.items()}, "KB")


if __name__ == "__main__":
    main()
