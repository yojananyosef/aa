/**
 * Construccion de modulos: fuentes USFM -> `.amod`.
 *
 * El build es la UNICA puerta por la que el texto entra en el catalogo. Por eso
 * aqui viven las dos decisiones que separan un catalogo util de uno que no:
 *
 *  1. No se inventa texto. Un versiculo que la fuente declara y no trae queda
 *     registrado como defecto y NO se rellena. El build falla salvo que se
 *     pase `--allow-defects`, y entonces el defecto queda grabado en el
 *     modulo para que el lector avise.
 *
 *  2. No se pierde marcado. El parser conserva el USFM verbatim en `raw`, y
 *     aqui se comprueba que de verdad se conserva: si un versiculo llega al
 *     modulo sin su `raw`, el build falla en vez de publicar una Biblia que
 *     ha perdido informacion.
 *
 * Las dos comprobaciones son tests de camino, no de resultado: si un cambio
 * futuro las dejara pasar, el catalogo seguiria pareciendo verde y estaria
 * mintiendo.
 */

import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import {
  escribirAmf,
  ESQUEMA_BIBLIA,
  ESQUEMA_COMENTARIO,
  ErrorAmf,
  nombreDeFichero,
  SCHEMA_VERSION,
  type ContenidoTabla,
  type EntradaAmf,
  type ResultadoAmf,
} from "./amf.ts";
import { LIBROS, LIBROS_CANON, VERSICULOS_CANON, type Libro } from "./libros.ts";
import { parseUsfm, type Defecto, type Versiculo } from "./usfm.ts";

export type TipoConstruccion = "bible" | "commentary";

/** Metadatos que el modulo declara y el gate exige. */
export type InfoDeclarada = {
  id: string;
  type: TipoConstruccion;
  name: string;
  language: string;
  license: string;
  license_evidence: string;
  copyright: string;
  attribution: string;
  versification: string;
  source: string;
  origin: string;
};

export type OpcionesBuild = {
  /** Permite construir con defectos de la fuente. Sin esto, el build falla. */
  allowDefects?: boolean;
};

export class ErrorBuild extends Error {
  constructor(
    mensaje: string,
    readonly defectos: Defecto[] = [],
  ) {
    super(mensaje);
    this.name = "ErrorBuild";
  }
}

/** Referencia legible de un defecto: `Job 38:39`. */
export function referencia(d: { libro: string; chapter: number; verse: number }): string {
  return `${d.libro} ${d.chapter}:${d.verse}`;
}

/**
 * Metadatos completos que salen hacia `info`.
 *
 * `schema_version` la pone el build y no el declarante: es el build quien sabe
 * que version del esquema esta escribiendo. Si la exigiera al declarante,
 * cada modulo podria declarar una version que no es la suya, que es
 * precisamente el dato que un lector necesita para interpretar el fichero.
 */
function infoCompleta(declarada: InfoDeclarada): Record<string, string> {
  return { schema_version: SCHEMA_VERSION, ...declarada } as Record<string, string>;
}

/**
 * Convierte una lista de versiculos en filas, ordenadas por clave primaria.
 *
 * El orden se fija aqui y no en el escritor, para que el `contentHash` y el
 * `sha256` no dependan de en que orden llegaran las fuentes.
 */
function filasDeVersiculos(versiculos: Versiculo[]): ContenidoTabla["filas"] {
  return versiculos
    .map((v) => ({ clave: [v.book, v.chapter, v.verse], celdas: [v.text, v.raw] }))
    .sort((a, b) => {
      if (a.clave[0] !== b.clave[0]) return a.clave[0] < b.clave[0] ? -1 : 1;
      return (a.clave[1] as number) - (b.clave[1] as number) || (a.clave[2] as number) - (b.clave[2] as number);
    });
}

/** Filas de comentario: la clave primaria incluye `seq`. */
function filasDeComentario(notas: (Versiculo & { seq: number })[]): ContenidoTabla["filas"] {
  return notas
    .map((v) => ({
      clave: [v.book, v.chapter, v.verse, v.seq],
      celdas: [v.text, v.raw],
    }))
    .sort((a, b) => {
      const c = String(a.clave[0]).localeCompare(String(b.clave[0]));
      if (c !== 0) return c;
      const n =
        (a.clave[1] as number) - (b.clave[1] as number) ||
        (a.clave[2] as number) - (b.clave[2] as number) ||
        (a.clave[3] as number) - (b.clave[3] as number);
      return n;
    });
}

/**
 * Comprueba que cada versiculo conserva su USFM en `raw`.
 *
 * Sin esta comprobacion, un cambio futuro del parser podria empezar a
 * perder marcado y el catalogo seguiria verde. El texto plano se puede
 * recalcular desde `raw`; al reves no, y una vez publicado no hay vuelta.
 */
function exigirRawIntacto(versiculos: Versiculo[]): void {
  const perdidos = versiculos.filter((v) => !v.raw || v.raw.trim() === "");
  if (perdidos.length > 0) {
    const muestra = perdidos
      .slice(0, 5)
      .map((v) => referencia(v))
      .join(", ");
    throw new ErrorBuild(
      `versiculos sin USFM original en \`raw\`: ${perdidos.length} de ` +
        `${versiculos.length} (muestra: ${muestra}). El parser no debe emitir ` +
        `un versiculo sin su fragmento verbatim: el marcado se perderia para ` +
        `siempre y no habria forma de recuperarlo.`,
    );
  }

  // El texto plano no puede ser mas rico que su fuente. Si lo fuera, el parser
  // estaria inventando caracteres que el USFM no tiene.
  const sospechosos = versiculos.filter((v) => {
    const plano = v.text.replace(/\s+/g, "");
    const crudo = v.raw.replace(/\\[a-z0-9]+\*?|\||¶/gi, "").replace(/\s+/g, "");
    return plano.length > crudo.length;
  });
  if (sospechosos.length > 0) {
    const muestra = sospechosos.slice(0, 5).map((v) => referencia(v)).join(", ");
    throw new ErrorBuild(
      `el texto plano de ${sospechosos.length} versiculo(s) es mas largo que su ` +
        `USFM de origen (muestra: ${muestra}). Eso significa que el parser anade ` +
        `caracteres que la fuente no tiene.`,
    );
  }
}

/**
 * Cuenta capitulos y versiculos por libro, y comprueba contra la tabla canonica
 * KJV.
 *
 * Solo avisa: una fuente puede traer mas capitulos de los canonicos por
 * VARIANTES textuales (los capítulos interlunares de los hebreos, o el
 * capitulo 3 de 2 Juan), y eso no es un defecto sino una diferencia de
 * tradicion. Lo que si es un fallo es que falten, porque entonces el usuario
 * pierde texto sin saberlo.
 */
function auditarCobertura(versiculos: Versiculo[]): {
  faltantes: { libro: string; capitulos: number; esperado: number }[];
  extra: { libro: string; capitulos: number }[];
  total: number;
} {
  const vistos = new Map<string, Set<number>>();
  for (const v of versiculos) {
    if (!vistos.has(v.book)) vistos.set(v.book, new Set());
    vistos.get(v.book)!.add(v.chapter);
  }

  const faltantes: { libro: string; capitulos: number; esperado: number }[] = [];
  const extra: { libro: string; capitulos: number }[] = [];
  for (const l of LIBROS) {
    const hay = vistos.get(l.id)?.size ?? 0;
    if (hay < l.capitulos) {
      faltantes.push({ libro: l.id, capitulos: hay, esperado: l.capitulos });
    } else if (hay > l.capitulos) {
      // Capitulos de MAS no es un defecto: las variantes textuales numeran
      // distinto (capitulos interlunares hebreos, 2 Juan 3). Se reporta para
      // que quede a la vista y no para que corte el build.
      extra.push({ libro: l.id, capitulos: hay - l.capitulos });
    }
  }
  return { faltantes, extra, total: versiculos.length };
}

export type FuenteBuild = {
  /** Ruta al fichero USFM. */
  ruta: string;
  /** Id canonico KJV del libro, si el caller lo sabe. */
  libro?: string;
};

export type ResultadoBuild = {
  amod: ResultadoAmf;
  entrada: EntradaAmf;
  versiculos: number;
  advertencias: string[];
  defectos: Defecto[];
  cobertura: { faltantes: number; esperado: number };
};

export async function construirBiblia(
  fuentes: FuenteBuild[],
  declarada: InfoDeclarada,
  destino: string,
  opciones: OpcionesBuild = {},
): Promise<ResultadoBuild> {
  const versiculos: Versiculo[] = [];
  const defectos: Defecto[] = [];
  const advertencias: string[] = [];

  for (const f of fuentes) {
    const contenido = readFileSync(f.ruta, "utf8");
    const r = parseUsfm(contenido, basename(f.ruta));
    versiculos.push(...r.versiculos);
    defectos.push(...r.defectos);
    for (const a of r.advertencias) {
      advertencias.push(`${basename(f.ruta)}: ${a}`);
    }
  }

  // Una clave repetida entre fuentes distintas se resolveria en silencio:
  // el INSERT fallaria, o peor, una fuente pisaria a la otra.
  const vistos = new Set<string>();
  for (const v of versiculos) {
    const k = `${v.book} ${v.chapter}:${v.verse}`;
    if (vistos.has(k)) {
      throw new ErrorBuild(
        `versiculo duplicado entre fuentes: ${k}. Dos fuentes traen el mismo ` +
          `versiculo y el build no puede saber cual es el bueno.`,
      );
    }
    vistos.add(k);
  }

  exigirRawIntacto(versiculos);

  const { faltantes, extra, total } = auditarCobertura(versiculos);
  for (const f of faltantes) {
    advertencias.push(
      `cobertura incompleta en ${f.libro}: ${f.capitulos} capitulos de ${f.esperado}`,
    );
  }
  for (const e of extra) {
    advertencias.push(
      `${e.libro} tiene ${e.capitulos} capitulo(s) mas que la versificacion KJV; ` +
        `probable variante textual, no es un defecto`,
    );
  }
  if (total !== VERSICULOS_CANON) {
    advertencias.push(
      `total de versiculos ${total}, canon KJV ${VERSICULOS_CANON} ` +
        `(diferencia ${total - VERSICULOS_CANON})`,
    );
  }

  if (defectos.length > 0 && !opciones.allowDefects) {
    const muestra = defectos.slice(0, 20).map((d) => referencia(d)).join(", ");
    const mas = defectos.length > 20 ? ` (+${defectos.length - 20} mas)` : "";
    throw new ErrorBuild(
      `la fuente tiene ${defectos.length} versiculo(s) declarado(s) sin texto: ` +
        `${muestra}${mas}.\n` +
        `Un versiculo vacio no se rellena por inferencia: se registraria como ` +
        `defecto y el usuario no tendria forma de saber que le falta texto.\n` +
        `Para publicar con los defectos declarados, pasa --allow-defects.`,
      defectos,
    );
  }

  const entrada: EntradaAmf = {
    nombre: nombreDeFichero(declarada.id, declarada.type).replace(/\.amod$/, ""),
    tipo: "bible",
    esquema: ESQUEMA_BIBLIA,
    info: infoCompleta(declarada),
    contenido: [{ tabla: "verses", filas: filasDeVersiculos(versiculos) }],
    defectos: defectos.map((d) => ({
      libro: d.libro,
      chapter: d.chapter,
      verse: d.verse,
      tipo: d.tipo,
    })),
  };

  const amod = await escribirAmf(destino, entrada);
  return {
    amod,
    entrada,
    versiculos: versiculos.length,
    advertencias: [...new Set(advertencias)],
    defectos,
    cobertura: {
      faltantes: faltantes.reduce((n, f) => n + (f.esperado - f.capitulos), 0),
      esperado: LIBROS_CANON,
    },
  };
}

/**
 * Un comentario NO tiene capitulos ni versiculos obligatorios.
 *
 * Un comentario puede cubrir un libro entero o dispersarse en varios ficheros
 * (Clarke viene en 6 tomos), asi que se indexa por lo que cada versiculo
 * anota. Por eso NO se exige cobertura canonica aqui, y por eso un comentario
 * con un solo versiculo es valido.
 */
export async function construirComentario(
  fuentes: FuenteBuild[],
  declarada: InfoDeclarada,
  destino: string,
  opciones: OpcionesBuild = {},
): Promise<ResultadoBuild> {
  const notas: (Versiculo & { seq: number })[] = [];
  const advertencias: string[] = [];

  // Varios articulos por versiculo: se numeran en el orden en que aparecen, que
  // es el orden de lectura del comentario. Dos notas sobre el mismo versiculo
  // son el caso normal en Clarke y en Wesley.
  //
  // El contador vive FUERA del bucle de ficheros a proposito. Clarke viene en
  // seis tomos y un mismo versiculo puede aparecer en dos de ellos; si el
  // contador se reiniciara por fichero, las dos notas cairian en el mismo `seq`
  // y la segunda chocaria con la primera en la clave primaria. Perder un tomo
  // entero de comentario por un `seq` mal puesto es justo el fallo que este
  // esquema evita.
  const seqPor = new Map<string, number>();
  for (const f of fuentes) {
    const contenido = readFileSync(f.ruta, "utf8");
    const r = parseUsfm(contenido, basename(f.ruta));
    for (const v of r.versiculos) {
      const k = `${v.book} ${v.chapter}:${v.verse}`;
      const seq = seqPor.get(k) ?? 0;
      seqPor.set(k, seq + 1);
      notas.push({ ...v, seq });
    }
    for (const a of r.advertencias) advertencias.push(`${basename(f.ruta)}: ${a}`);
  }

  exigirRawIntacto(notas);

  const duplicados = new Set<string>();
  for (const n of notas) {
    const k = `${n.book} ${n.chapter}:${n.verse}#${n.seq}`;
    if (duplicados.has(k)) throw new ErrorBuild(`nota duplicada: ${k}`);
    duplicados.add(k);
  }

  const entrada: EntradaAmf = {
    nombre: nombreDeFichero(declarada.id, declarada.type).replace(/\.amod$/, ""),
    tipo: "commentary",
    esquema: ESQUEMA_COMENTARIO,
    info: infoCompleta(declarada),
    contenido: [{ tabla: "commentary", filas: filasDeComentario(notas) }],
  };

  const amod = await escribirAmf(destino, entrada);
  return {
    amod,
    entrada,
    versiculos: notas.length,
    advertencias: [...new Set(advertencias)],
    defectos: [],
    cobertura: { faltantes: 0, esperado: 0 },
  };
}

/** Sources de USFM de un directorio, filtradas por prefijo de fichero. */
export function fuentesDe(dir: string, prefijo: string): FuenteBuild[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".usfm") && f.includes(prefijo))
    .sort()
    .map((f) => ({ ruta: join(dir, f) }));
}

/**
 * El prefijo de idioma de un nombre de fuente USFM.
 *
 * `02-GENeng-kjv2006.usfm` -> `eng`, `02-GENspaRV1909.usfm` -> `spa`.
 *
 * El idioma va en minusculas y despues viene la parte de la traduccion, que
 * puede llevar mayusculas y digitos (`RV1909`, `NT`, `2006`). Por eso el
 * segundo grupo es "minusculas hasta el primer guion", no "minusculas enteras":
 * con el patron ingenuo, `spaRV1909` no casaba y devolvia cadena vacia, que es
 * el peor resultado posible: un prefijo vacio no da error, simplemente no
 * encuentra ninguna fuente y el build se queda sin Biblia.
 */
export function prefijoDeFuente(nombreFichero: string): string {
  const m = /^\d+-[A-Z0-9]+([a-z]+)/.exec(basename(nombreFichero));
  return m ? m[1] : "";
}

/**
 * Libro canonico a partir del nombre de fichero de la fuente.
 *
 * `02-GENeng-kjv2006.usfm` -> `GEN` -> `Genesis`. El prefijo de dos o tres
 * letras se resuelve contra la tabla, y no contra una suposicion: si el
 * nombre no se puede resolver, se falla, porque un libro equivocado en el
 * modulo es un error silencioso que el usuario no podria ver.
 */
export function libroDeFuente(nombreFichero: string): Libro | null {
  const m = /^\d+-([A-Z0-9]+)/.exec(basename(nombreFichero));
  if (!m) return null;
  return LIBROS.find((l) => l.idUsfm === m[1]) ?? null;
}

/** Crea el directorio destino si hace falta, y devuelve la ruta del `.amod`. */
export function rutaDeSalida(directorio: string, id: string, tipo: string): string {
  mkdirSync(directorio, { recursive: true });
  return join(directorio, nombreDeFichero(id, tipo));
}

export { ErrorAmf };