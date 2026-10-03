/**
 * Empaquetado de modulos en un bundle.
 *
 * POR QUE UN ZIP CON CONTENIDO ZSTD Y NO UN ZIP COMPRIMIDO
 * ------------------------------------------------------
 * Un zip normal se comprime con deflate, porque es lo que todos los
 * descompresores saben leer sin preguntar nada: el Explorador de Windows, la
 * Archiver del Finder, `unzip`, y las librerias de cualquier plataforma.
 *
 * El metodo 93 (zstd) del formato zip existe, pero solo en ZIP 6.3 y necesita
 * zip64 o escritura por stream. Un archivo con el aplica casi ningun
 * descompresor del mundo, y un catalogo que solo sabe abrir su propio
 * software no es un catalogo: es un archivo opaco.
 *
 * Asi que el zip se usa como lo que es buenamente, un CONTENEDOR con entradas
 * STORED, y cada modulo va dentro comprimido con zstd (que es lo que pide el
 * spec y lo que comprime 4-5x un texto biblico). Un `unzip` normal extrae los
 * `.amod.zst` y la app los infla. Las dos partes son entendibles por separado.
 *
 * Comprimir dos veces con dos algoritmos distintos no aporta nada: el segundo
 * formato solo encuentra bytes que el primero ya no puede quitar.
 *
 * DETERMINISMO
 * ------------
 * La fecha de modificacion de cada entrada se fija a una constante. Sin eso,
 * dos bundles del mismo contenido darian hashes distintos, y el bundle volveria
 * a ser imposible de verificar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { zstdCompressSync, zstdDecompressSync } from "bun:zlib";

import { SCHEMA_VERSION } from "./amf.ts";

/**
 * Version del formato de bundle. Va en `bundle.json`.
 */
export const VERSION_BUNDLE = "1";

/**
 * Fecha fija de las entradas del zip: 1980-01-01 00:00:00, el minimo del
 * formato DOS. Una constante, no `new Date()`: si esto fuera la hora actual,
 * el bundle no seria reproducible.
 */
const FECHA_DOS = 0x0000;
const HORA_DOS = 0x0000;

export type EntradaBundle = {
  /** Nombre dentro del zip. */
  nombre: string;
  /** Contenido sin comprimir. */
  datos: Buffer;
};

export type Manifiesto = {
  schema_version: string;
  bundle_version: string;
  compression: "zstd";
  /** Modulos incluidos, en orden de nombre. */
  modules: {
    id: string;
    type: string;
    name: string;
    language: string;
    /** sha256 del `.amod` sin comprimir: el hash de transporte. */
    sha256: string;
    /** contentHash del modulo: el hash de reproducibilidad. */
    contentHash: string;
    /** Tamano del `.amod` sin comprimir, en bytes. */
    bytes: number;
    /** Tamano dentro del bundle, ya comprimido con zstd. */
    bytes_comprimido: number;
    /** Nombre de la entrada dentro del zip. */
    entrada: string;
    /** Numero de defectos de la fuente que el modulo declara. */
    defects_count: number;
  }[];
};

// --- CRC32, necesario para las entradas STORED de un zip ---

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) {
    c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// --- Escritura del zip, sin dependencias ---

type EntradaEscrita = {
  crc: number;
  comprimido: number;
  sinComprimir: number;
  desplazamiento: number;
  marcaTiempo: number;
};

function escribirZip(entradas: EntradaBundle[]): Buffer {
  const trozos: Buffer[] = [];
  const registro: EntradaEscrita[] = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, "utf8");
    const crc = crc32(e.datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma de cabecera local
    local.writeUInt16LE(20, 4); // version necesaria
    local.writeUInt16LE(0x0800, 6); // banderas: nombre en UTF-8
    local.writeUInt16LE(0, 8); // metodo 0 = STORED
    local.writeUInt16LE(HORA_DOS, 10);
    local.writeUInt16LE(FECHA_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.datos.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);

    trozos.push(local, nombre, e.datos);
    registro.push({
      crc,
      comprimido: e.datos.length,
      sinComprimir: e.datos.length,
      desplazamiento,
      marcaTiempo: (FECHA_DOS << 16) | HORA_DOS,
    });
    desplazamiento += local.length + nombre.length + e.datos.length;
  }

  const inicioCentral = desplazamiento;
  for (const [i, e] of entradas.entries()) {
    const r = registro[i];
    const nombre = Buffer.from(e.nombre, "utf8");
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // firma de directorio central
    central.writeUInt16LE(20, 4); // version que creo
    central.writeUInt16LE(20, 6); // version necesaria
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); // STORED
    central.writeUInt16LE(HORA_DOS, 12);
    central.writeUInt16LE(FECHA_DOS, 14);
    central.writeUInt32LE(r.crc, 16);
    central.writeUInt32LE(r.comprimido, 20);
    central.writeUInt32LE(r.sinComprimir, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentario
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // atributos internos
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(r.desplazamiento, 42);
    trozos.push(central, nombre);
    desplazamiento += central.length + nombre.length;
  }

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); // firma de fin de directorio central
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(desplazamiento - inicioCentral, 12);
  fin.writeUInt32LE(inicioCentral, 16);
  fin.writeUInt16LE(0, 20);
  trozos.push(fin);

  return Buffer.concat(trozos);
}

/** Lee el directorio central de un zip STORED. */
export function leerZip(buf: Buffer): Map<string, Buffer> {
  // Se localiza la firma de fin de directorio central, que esta al final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("bundle: no se encuentra el fin del directorio central");

  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const salida = new Map<string, Buffer>();

  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`bundle: entrada ${i} no es una cabecera de directorio central`);
    }
    const metodo = buf.readUInt16LE(p + 10);
    // Offset 20 = tamano COMPRIMIDO, offset 24 = tamano SIN comprimir. Con
    // entradas STORED son el mismo numero, asi que leer el equivocado no se
    // nota hasta que hay una entrada comprimida de verdad. El tamano que hace
    // falta para saltar al siguiente elemento es el comprimido.
    const tam = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComent = buf.readUInt16LE(p + 32);
    const desplazamiento = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString("utf8");

    if (buf.readUInt32LE(desplazamiento) !== 0x04034b50) {
      throw new Error(`bundle: la entrada "${nombre}" no apunta a una cabecera local valida`);
    }
    const largoNombreLocal = buf.readUInt16LE(desplazamiento + 26);
    const largoExtraLocal = buf.readUInt16LE(desplazamiento + 28);
    const inicio = desplazamiento + 30 + largoNombreLocal + largoExtraLocal;
    const datos = buf.subarray(inicio, inicio + tam);

    if (metodo === 0) {
      salida.set(nombre, Buffer.from(datos));
    } else if (metodo === 8) {
      // Aceptado por tolerancia: un zip de otra herramienta puede venir con
      // deflate. Se infla en vez de fallar, porque el dato es el mismo.
      salida.set(nombre, inflateRawSync(datos));
    } else {
      throw new Error(`bundle: metodo de compresion ${metodo} no soportado en "${nombre}"`);
    }

    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return salida;
}

export type ModuloParaBundle = {
  id: string;
  type: string;
  name: string;
  language: string;
  sha256: string;
  contentHash: string;
  defects_count: number;
  /** Ruta del `.amod` ya construido. */
  ruta: string;
};

export type ResultadoBundle = {
  ruta: string;
  sha256: string;
  bytes: number;
  bytesSinComprimir: number;
  modulos: number;
  manifiesto: Manifiesto;
};

export type OpcionesBundle = {
  /** Nivel de zstd. 19 es el maximo util; 22 wastea tiempo para texto biblico. */
  nivel?: number;
};

/**
 * Empaqueta modulos en un bundle.
 *
 * El manifiesto va PRIMERO en el zip, para que un cliente pueda leerlo sin
 * descargarse el resto: es el indice que dice que hay dentro y con que hash.
 */
export function empaquetar(
  modulos: ModuloParaBundle[],
  destino: string,
  opciones: OpcionesBundle = {},
): ResultadoBundle {
  if (modulos.length === 0) {
    throw new Error("bundle: no hay modulos que empaquetar");
  }
  const nivel = opciones.nivel ?? 19;

  // Orden por id: el manifiesto y las entradas del zip tienen que salir
  // siempre en el mismo orden, o dos bundles del mismo contenido no tendrian
  // el mismo hash.
  const ordenados = [...modulos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const idsVistos = new Set<string>();
  const entradas: { entrada: EntradaBundle; ficha: Manifiesto["modules"][number] }[] = [];
  let bytesSinComprimir = 0;

  for (const m of ordenados) {
    if (idsVistos.has(m.id)) {
      throw new Error(`bundle: modulo duplicado "${m.id}"; el manifiesto seria ambiguo`);
    }
    idsVistos.add(m.id);

    const amod = readFileSyncBuffer(m.ruta);
    bytesSinComprimir += amod.length;

    const comprimido = zstdCompressSync(amod, { params: { [100]: nivel } });
    const nombre = `${m.id}_${m.type}.amod.zst`;

    entradas.push({
      entrada: { nombre, datos: comprimido },
      ficha: {
        id: m.id,
        type: m.type,
        name: m.name,
        language: m.language,
        sha256: m.sha256,
        contentHash: m.contentHash,
        bytes: amod.length,
        bytes_comprimido: comprimido.length,
        entrada: nombre,
        defects_count: m.defects_count,
      },
    });
  }

  const manifiesto: Manifiesto = {
    schema_version: SCHEMA_VERSION,
    bundle_version: VERSION_BUNDLE,
    compression: "zstd",
    modules: entradas.map((e) => e.ficha),
  };

  // El manifiesto va primero, sin comprimir: es el indice que un cliente lee
  // para saber que hay dentro y con que hash, y no debería tener que inflar
  // nada para obtenerlo.
  const entradasZip: EntradaBundle[] = [
    {
      nombre: "bundle.json",
      datos: Buffer.from(JSON.stringify(manifiesto, null, 2) + "\n", "utf8"),
    },
    ...entradas.map((e) => e.entrada),
  ];

  const zip = escribirZip(entradasZip);
  writeFileSyncBuffer(destino, zip);

  return {
    ruta: destino,
    sha256: sha256Buffer(zip),
    bytes: zip.length,
    bytesSinComprimir,
    modulos: entradas.length,
    manifiesto,
  };
}

/** Extrae un bundle y devuelve el manifiesto y los modulos ya inflados. */
export function abrirBundle(
  ruta: string,
): { manifiesto: Manifiesto; modulos: Map<string, Buffer> } {
  const zip = readFileSyncBuffer(ruta);
  const entradas = leerZip(zip);

  const manifiestoCrudo = entradas.get("bundle.json");
  if (!manifiestoCrudo) {
    throw new Error("bundle: falta bundle.json; no es un bundle de este catalogo");
  }
  const manifiesto = JSON.parse(manifiestoCrudo.toString("utf8")) as Manifiesto;
  if (manifiesto.compression !== "zstd") {
    throw new Error(`bundle: compresion no soportada "${manifiesto.compression}"`);
  }

  const modulos = new Map<string, Buffer>();
  for (const m of manifiesto.modules) {
    const bruto = entradas.get(m.entrada);
    if (!bruto) {
      throw new Error(
        `bundle: el manifiesto declara "${m.entrada}" pero no esta en el archivo`,
      );
    }
    const inflado = zstdDecompressSync(bruto);
    if (sha256Buffer(inflado) !== m.sha256) {
      throw new Error(
        `bundle: "${m.entrada}" no coincide con su sha256 declarado; el bundle esta ` +
          `corrupto o manipulado`,
      );
    }
    modulos.set(m.id, inflado);
  }
  return { manifiesto, modulos };
}

// --- IO local, en un solo sitio ---
//
// Las funciones de arriba describen el FORMATO del bundle, no como se tocan
// ficheros. Separar las dos cosas permite razonar sobre el formato sin ruido,
// y deja claro que no hay ningun otro acceso a disco.

function readFileSyncBuffer(ruta: string): Buffer {
  return readFileSync(ruta);
}

function writeFileSyncBuffer(ruta: string, datos: Buffer): void {
  writeFileSync(ruta, datos);
}

function sha256Buffer(datos: Buffer): string {
  return createHash("sha256").update(datos).digest("hex");
}

export { deflateRawSync as _deflateRawSync };