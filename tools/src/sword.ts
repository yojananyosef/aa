/**
 * Lector de modulos SWORD (`ModDrv=zText`, `ModDrv=zCom`).
 *
 * POR QUE ESTA AQUI
 * -----------------
 * Los comentarios en dominio publico que existen (Clarke, Wesley, Barnes,
 * Calvin) solo se distribuyen en formato SWORD, no en USFM. Es la unica via
 * para tenerlos sin depender de una transcripcion ajena.
 *
 * POR QUE NO SE USA NINGUNA BIBLIOTECA
 * ------------------------------------
 * El formato esta documentado aqui porque es corto y porque depender de
 * `pysword` para leer un fichero de la fuente traeria un Python al proyecto
 * entero a cambio de unas 60 lineas. El proyecto es Bun/TypeScript con cero
 * dependencias, y esto mantiene esa promesa: lo que entra al repositorio es el
 * USFM ya extraido, y el extractor es una herramienta de `tools/`.
 *
 * EL FORMATO
 * ----------
 * SWORD reparte el contenido en TRES ficheros acompanantes, no en uno solo. El
 * error clasico es tratarlos como uno:
 *
 *   `<t>.bzs`  indice de BLOQUES.  12 bytes por bloque, `<III>` little-endian:
 *              offset en .bzz, tamano comprimido, tamano sin comprimir.
 *   `<t>.bzv`  indice de VERSOS.   10 bytes por verso, `<IIH>`:
 *              inicio dentro del bloque, longitud, numero de bloque.
 *   `<t>.bzz`  los BLOQUES, comprimidos con zlib, concatenados.
 *
 * Los dos indices NO tienen el mismo tamano de registro, que es la trampa: 12
 * para bloques y 10 para versos. Con 12 en los dos, el recuento de registros
 * sale fraccionario y el error que se ve es "no es multiplo de 12", que no
 * senala nada sobre cual de los dos ficheros esta mal.
 *
 * Para leer un verso: se toma su registro de `.bzv`, se localiza el bloque en
 * `.bzs`, se leen `size` bytes de `.bzz` a partir de `offset`, se infla con
 * zlib, y se recorta `[inicio, inicio+longitud]`.
 *
 * Esa ultima operacion es la clave y la que no se puede saltarse: los bytes
 * son del BLOQUE descomprimido, no del fichero. Sin recortar, se devolveria
 * el bloque entero y cada verso traeria el comentario de los 40 versiculos
 * siguientes.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";

export type Bloque = {
  indice: number;
  offset: number;
  comprimido: number;
  sinComprimir: number;
};

export type RegistroVerso = {
  bloque: number;
  inicio: number;
  longitud: number;
};

export class ErrorSword extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorSword";
  }
}

/** Lee el indice de bloques de `<base>.bzs`. */
export function leerBloques(base: string): Bloque[] {
  const buf = leerSiExiste(base + ".bzs");
  if (!buf) return [];
  if (buf.length % TAMANO_REGISTRO_BLOQUE !== 0) {
    throw new ErrorSword(
      `${base}.bzs mide ${buf.length} bytes, que no es multiplo de ` +
        `${TAMANO_REGISTRO_BLOQUE}; el indice de bloques son registros de 12 bytes`,
    );
  }
  const bloques: Bloque[] = [];
  for (let i = 0; i + TAMANO_REGISTRO_BLOQUE <= buf.length; i += TAMANO_REGISTRO_BLOQUE) {
    bloques.push({
      indice: i / TAMANO_REGISTRO_BLOQUE,
      offset: buf.readUInt32LE(i),
      comprimido: buf.readUInt32LE(i + 4),
      sinComprimir: buf.readUInt32LE(i + 8),
    });
  }
  return bloques;
}

/** TAMANO_REGISTRO_BLOQUE: 12 bytes, `<III>`. */
export const TAMANO_REGISTRO_BLOQUE = 12;
/** TAMANO_REGISTRO_VERSO: 10 bytes, `<IIH>`. */
export const TAMANO_REGISTRO_VERSO = 10;

/** Lee el indice de versos de `<base>.bzv`. */
export function leerVersos(base: string): RegistroVerso[] {
  const buf = leerSiExiste(base + ".bzv");
  if (!buf) return [];
  if (buf.length % TAMANO_REGISTRO_VERSO !== 0) {
    throw new ErrorSword(
      `${base}.bzv mide ${buf.length} bytes, que no es multiplo de ` +
        `${TAMANO_REGISTRO_VERSO}; el indice de versos son registros de ` +
        `${TAMANO_REGISTRO_VERSO} bytes, no de ${TAMANO_REGISTRO_BLOQUE}`,
    );
  }
  const versos: RegistroVerso[] = [];
  for (let i = 0; i + TAMANO_REGISTRO_VERSO <= buf.length; i += TAMANO_REGISTRO_VERSO) {
    versos.push({
      bloque: buf.readUInt32LE(i),
      inicio: buf.readUInt32LE(i + 4),
      longitud: buf.readUInt16LE(i + 8),
    });
  }
  return versos;
}

/** Bloques descomprimidos, cacheados: descomprimir dos veces el mismo bloque es tirar CPU. */
export class LectorSword {
  private readonly bloques: Bloque[];
  private readonly cache = new Map<number, Buffer>();

  constructor(private readonly base: string) {
    this.bloques = leerBloques(base);
  }

  get nBloques(): number {
    return this.bloques.length;
  }

  /** Bloque descomprimido. `zlib.decompress` y no `inflateRawSync`: SWORD usa cabecera zlib. */
  bloque(i: number): Buffer {
    const guardado = this.cache.get(i);
    if (guardado) return guardado;

    const b = this.bloques[i];
    if (!b) throw new ErrorSword(`bloque ${i} fuera de rango (hay ${this.bloques.length})`);

    const datos = leerSiExiste(this.base + ".bzz");
    if (!datos) throw new ErrorSword(`falta ${this.base}.bzz`);
    if (b.offset + b.comprimido > datos.length) {
      throw new ErrorSword(
        `el bloque ${i} declara ${b.offset}+${b.comprimido} bytes pero ` +
          `${this.base}.bzz solo tiene ${datos.length}`,
      );
    }

    const bruto = datos.subarray(b.offset, b.offset + b.comprimido);
    let inflado: Buffer;
    try {
      inflado = inflateSync(bruto);
    } catch {
      // Algunos modulos usan deflate sin cabecera zlib.
      inflado = inflateRawSync(bruto);
    }
    this.cache.set(i, inflado);
    return inflado;
  }

  /** Texto del verso `indice`, recortado dentro de su bloque. */
  verso(indice: number, registro: RegistroVerso): string {
    const bloque = this.bloque(registro.bloque);
    const fin = registro.inicio + registro.longitud;
    if (fin > bloque.length) {
      throw new ErrorSword(
        `el verso ${indice} pide los bytes ${registro.inicio}..${fin} de un bloque ` +
          `de ${bloque.length}; el indice no cuadra con los datos`,
      );
    }
    return bloque.subarray(registro.inicio, fin).toString("utf8");
  }
}

function leerSiExiste(ruta: string): Buffer | null {
  try {
    return readFileSync(ruta);
  } catch {
    return null;
  }
}

export { REGLAS as _REGLAS };