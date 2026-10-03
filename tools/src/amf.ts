/**
 * Escritura de modulos AMF (fichero SQLite).
 *
 * EL ARCHIVO ES LA API. Un lector abre el `.amod` y consulta con SQL. No hay
 * adaptadores por tipo de recurso, asi que este modulo tiene que garantizar
 * que lo escrito es consultable con las sentencias que el spec fija.
 *
 * DETERMINISMO
 * ------------
 * El spec exige que dos construcciones del mismo input den el mismo sha256.
 * SQLite no lo da por su cuenta: el orden de insercion de las filas cambia el
 * binario aunque el contenido logico sea identico. Medido en este repositorio
 * antes de escribir esta linea:
 *
 *     insertando en orden inverso -> sha256 ee75cc2e...b1ba972
 *     insertando en orden normal  -> sha256 14c00a79...c28e064b
 *
 * Asique aqui se inserta SIEMPRE en orden de clave primaria, en una sola
 * transaccion, con los pragmas fijados explicitamente. Nada de esto es
 * cosmetico: es lo unico que hace el artefacto verificable.
 *
 * TIMESTAMPS: NO HAY NINGUNO
 * --------------------------
 * Ni una columna de fecha, ni una tabla de build, ni un pragma con hora. El
 * spec lo prohibe y por algo: un timestamp dentro del artefacto hace que dos
 * builds del mismo input den hashes distintos, y entonces el hash deja de
 * servir para detectar que el contenido no ha cambiado.
 */

import { Database } from "bun:sqlite";
import { statSync } from "node:fs";

import { evaluar, type Info } from "./gate.ts";
import { sha256DeFichero } from "./hash.ts";
import { contentHashDeTablas, type Fila, type TablaVolcada } from "./contentHash.ts";

/** Version del esquema logico. Va en `info.schema_version` y en `user_version`. */
export const SCHEMA_VERSION = "3";

/**
 * `PRAGMA application_id`, para identificar un fichero AMF sin abrirlo entero.
 * 0x41 4d 46 = "AMF"; el byte bajo es la version mayor del esquema.
 */
export const APPLICATION_ID = 0x414d4603;

/** Tamano de pagina. Fijo, para que el layout del arbol B no dependa del equipo. */
export const PAGE_SIZE = 4096;

/**
 * Clave de `info` que guarda el hash de contenido.
 *
 * Se excluye del volcado que genera el hash, porque un hash no puede
 * contenerse a si mismo: si `contentHash` formara parte de su propia entrada,
 * el valor que se verifica no seria el que se publico. Queda definida como
 * excepcion y no como caso especial disperso, y el verificador la aplica
 * igual que el escritor.
 */
export const CLAVE_CONTENT_HASH = "content_hash";

export type TipoColumna = "TEXT" | "INTEGER";

export type Columna = {
  nombre: string;
  tipo: TipoColumna;
};

export type DefinicionTabla = {
  nombre: string;
  columnas: Columna[];
  /**
   * Columnas de la clave primaria, en orden. Fijan el orden de insercion y el
   * orden del volcado canonico.
   */
  clavePrimaria: string[];
  /**
   * Indices adicionales, mas alla de los que la clave primaria ya provee.
   *
   * Con `WITHOUT ROWID` la clave primaria ES un indice. Un indice declarado
   * aqui solo tiene sentido si empieza por columnas distintas de las de la
   * clave primaria; repetirla costaria espacio y escritura sin aportar nada.
   */
  indices?: { nombre: string; columnas: string[] }[];
};

export type Esquema = {
  tablas: DefinicionTabla[];
};

/**
 * `info` es una tabla de pares nombre-valor, no donde va el contenido.
 * Cada clave es su propia clave primaria: dos filas con la misma clave no
 * pueden existir, y no hay orden de entrada que importar.
 */
const TABLA_INFO: DefinicionTabla = {
  nombre: "info",
  columnas: [
    { nombre: "key", tipo: "TEXT" },
    { nombre: "value", tipo: "TEXT" },
  ],
  clavePrimaria: ["key"],
};

/**
 * Biblia: versiculos en versificacion KJV.
 *
 * `WITHOUT ROWID` porque la clave primaria (book, chapter, verse) es
 * exactamente el patron de busqueda, y como tabla sin rowid la clave ES el
 * indice. Se cumple el requisito del spec (indice sobre esas tres columnas)
 * sin pagar un indice duplicado, y ademas la tabla ocupa menos, que en 31.102
 * filas no es trivial.
 *
 * `raw` conserva el fragmento USFM verbatim para poder reconstruirlo; `text` es
 * la version legible. Nada de lo que aporta el marcado se pierde, porque `raw`
 * lo tiene.
 */
const TABLA_VERSES: DefinicionTabla = {
  nombre: "verses",
  columnas: [
    { nombre: "book", tipo: "TEXT" },
    { nombre: "chapter", tipo: "INTEGER" },
    { nombre: "verse", tipo: "INTEGER" },
    { nombre: "text", tipo: "TEXT" },
    { nombre: "raw", tipo: "TEXT" },
  ],
  clavePrimaria: ["book", "chapter", "verse"],
};

/**
 * Comentario: varios articulos por versiculo.
 *
 * `seq` forma parte de la clave primaria y no es opcional. Un versiculo con
 * dos notas es el caso normal en Clarke y en Wesley, no la excepcion.
 *
 * Lo que pasa sin `seq` NO es que la segunda nota se pierda en silencio:
 * SQLite rechaza la clave duplicada con SQLITE_CONSTRAINT_PRIMARYKEY, se
 * haga como se haga. El problema real es que la segunda nota NO SE PUEDE
 * GUARDAR. El build falla entero y no hay forma de publicar el comentario,
 * que en la practica significa renunciar al comentario o recortarlo a una nota
 * por versiculo. Un comentario al que le faltan notas sin que la fuente lo
 * diga es peor que no publicarlo.
 *
 * Como `seq` va al final de la clave, un indice sobre (book, chapter, verse) la
 * cubre por prefijo: la consulta del spec sigue indiceada sin duplicarlo.
 */
const TABLA_COMMENTARY: DefinicionTabla = {
  nombre: "commentary",
  columnas: [
    { nombre: "book", tipo: "TEXT" },
    { nombre: "chapter", tipo: "INTEGER" },
    { nombre: "verse", tipo: "INTEGER" },
    { nombre: "seq", tipo: "INTEGER" },
    { nombre: "text", tipo: "TEXT" },
    { nombre: "raw", tipo: "TEXT" },
  ],
  clavePrimaria: ["book", "chapter", "verse", "seq"],
};

export const ESQUEMA_BIBLIA: Esquema = { tablas: [TABLA_INFO, TABLA_VERSES] };
export const ESQUEMA_COMENTARIO: Esquema = { tablas: [TABLA_INFO, TABLA_COMMENTARY] };

export class ErrorAmf extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorAmf";
  }
}

export type ContenidoTabla = { tabla: string; filas: Fila[] };

export type DefectoFuente = {
  libro: string;
  chapter: number;
  verse: number;
  tipo: string;
};

export type EntradaAmf = {
  /** Nombre logico del modulo, sin extension: `RVR1909_bible`. */
  nombre: string;
  tipo: "bible" | "commentary";
  esquema: Esquema;
  info: Info;
  contenido: ContenidoTabla[];
  /** Defectos de la FUENTE, no del build. Se graban en `info`. */
  defectos?: DefectoFuente[];
};

export type ResultadoAmf = {
  ruta: string;
  sha256: string;
  contentHash: string;
  filas: number;
  bytes: number;
  defectos: number;
};

/** Nombre de fichero `<ID>_<type>.amod`, tal como fija el spec. */
export function nombreDeFichero(id: string, tipo: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(id)) {
    throw new ErrorAmf(
      `id no admisible para nombre de fichero: "${id}"; solo letras, digitos y guion bajo`,
    );
  }
  if (!/^[a-z][a-z_]*$/.test(tipo)) {
    throw new ErrorAmf(`tipo no admisible: "${tipo}"`);
  }
  return `${id}_${tipo}.amod`;
}

function sentenciaCreate(t: DefinicionTabla): string {
  const cols = t.columnas.map((c) => `${c.nombre} ${c.tipo}`).join(", ");
  return `CREATE TABLE ${t.nombre} (${cols}, PRIMARY KEY (${t.clavePrimaria.join(", ")})) WITHOUT ROWID`;
}

/** Compara claves primarias: enteros numericos, texto por punto de codigo. */
function comparar(a: (string | number)[], b: (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/**
 * Valida que cada fila encaje con la definicion de su tabla.
 *
 * Falla aqui, y no dejandoselo a SQLite, porque una fila con celdas de mas o
 * con un tipo equivocado produce un error de SQLite opaco que no nombra la
 * tabla, o peor, un `INSERT` que acepta lo que le catera sin decir nada.
 *
 * La comprobacion que mas importa es la ultima: que la clave declarada
 * coincida con las celdas. La clave es la que fija el orden canonico; si
 * mentia, el orden del volcado no seria el del contenido y el `contentHash`
 * mediria una cosa distinta de la que dice medir.
 */
/**
 * Cuantas celdas lleva una fila: las que NO son clave primaria.
 *
 * Una fila declara su clave aparte porque es lo que fija el orden canonico.
 * Si las columnas de clave se repitieran en `celdas`, el volcado llevaria cada
 * clave dos veces y habria que mantener la duplicacion sincronizada, que es
 * justo el tipo de cosa que se desincroniza.
 */
export function celdasEsperadas(def: DefinicionTabla): number {
  return def.columnas.length - def.clavePrimaria.length;
}

/**
 * Valores de una fila en el orden de las columnas de la tabla.
 *
 * Reconstruye la fila completa a partir de clave + celdas, intercalando cada
 * valor de clave en su columna. Asi el `INSERT` no depende de que las columnas
 * de clave salgan delante ni en el mismo orden que la declaracion.
 */
function valoresEnOrden(def: DefinicionTabla, f: Fila): (string | number)[] {
  return def.columnas.map((col, i) => {
    const pos = def.clavePrimaria.indexOf(col.nombre);
    return pos === -1 ? f.celdas[i - def.clavePrimaria.length] : f.clave[pos];
  });
}

function comprobarFilas(esquema: Esquema, contenido: ContenidoTabla[]): void {
  const porNombre = new Map(esquema.tablas.map((t) => [t.nombre, t]));
  const vistos = new Set<string>();

  for (const c of contenido) {
    const def = porNombre.get(c.tabla);
    if (!def) {
      throw new ErrorAmf(
        `tabla "${c.tabla}" no existe en el esquema; declaradas: ` +
          esquema.tablas.map((t) => t.nombre).join(", "),
      );
    }

    const posClave = def.clavePrimaria.map((k) =>
      def.columnas.findIndex((x) => x.nombre === k),
    );
    for (const [k, kc] of def.clavePrimaria.entries()) {
      if (posClave[k] === -1) {
        throw new ErrorAmf(
          `clave primaria de "${c.tabla}" menciona "${kc}", que no es columna de la tabla`,
        );
      }
    }

    const nEsperadas = celdasEsperadas(def);

    for (const f of c.filas) {
      if (f.celdas.length !== nEsperadas) {
        throw new ErrorAmf(
          `fila de "${c.tabla}" con ${f.celdas.length} celdas; se esperan ` +
            `${nEsperadas} (las columnas que no son clave primaria): ` +
            def.columnas.map((x) => x.nombre).join(", "),
        );
      }
      if (f.clave.length !== def.clavePrimaria.length) {
        throw new ErrorAmf(
          `fila de "${c.tabla}" con clave de ${f.clave.length} elementos; la ` +
            `clave primaria es (${def.clavePrimaria.join(", ")})`,
        );
      }

      // Tipo y nulidad se comprueban sobre la fila COMPLETA, clave incluida.
      // book/chapter/verse tambien son columnas tipadas, y una clave con un
      // 16.5 dentro llegaria hasta SQLite y se guardaria como entero
      // truncado: el modulo declararia un versiculo que no existe.
      valoresEnOrden(def, f).forEach((celda, i) => {
        const col = def.columnas[i];
        if (celda === null || celda === undefined) {
          throw new ErrorAmf(
            `columna nula en "${c.tabla}.${col.nombre}". El esquema no admite ` +
              `nulos: un valor ausente se escribe como cadena vacia.`,
          );
        }
        if (col.tipo === "INTEGER") {
          if (typeof celda !== "number") {
            throw new ErrorAmf(
              `columna "${c.tabla}.${col.nombre}" es INTEGER y recibe ${typeof celda}`,
            );
          }
          if (!Number.isInteger(celda)) {
            throw new ErrorAmf(
              `columna "${c.tabla}.${col.nombre}" es INTEGER y recibe ` +
                `${celda}, que no es entero`,
            );
          }
        } else if (typeof celda !== "string") {
          throw new ErrorAmf(
            `columna "${c.tabla}.${col.nombre}" es TEXT y recibe ${typeof celda}`,
          );
        }
      });

      const marca = `${c.tabla}:${JSON.stringify(f.clave)}`;
      if (vistos.has(marca)) {
        throw new ErrorAmf(`fila duplicada en "${c.tabla}": clave ${marca}`);
      }
      vistos.add(marca);
    }
  }
}

/** Anade los metadatos que el build calcula, a los que declara el modulo. */
function infoDeModulo(entrada: EntradaAmf): Info {
  const info: Info = { ...entrada.info };
  info.schema_version = entrada.info.schema_version ?? SCHEMA_VERSION;

  // Dos claves, dos cosas distintas: `defects_count` es un numero que un
  // lector puede comparar sin parsear, y `defects` es la lista. Grabar el
  // JSON en las dos haria que el contador fuera ilegible como numero.
  const defectos = entrada.defectos ?? [];
  info.defects_count = String(defectos.length);
  info.defects = defectos.length === 0 ? "" : JSON.stringify(defectos);
  return info;
}

/** `info` tiene PK (key), asi que las celdas son solo el valor. */
function filasDeInfo(info: Info): Fila[] {
  return Object.keys(info).map((key) => ({ clave: [key], celdas: [info[key]] }));
}

/**
 * Tablas para el volcado canonico: en el orden del esquema, filas ordenadas.
 *
 * Deliberadamente sin `info.content_hash`. El hash se calcula sobre el
 * contenido logico; incluir el hash dentro del material que se hashea daria
 * un valor que no se puede verificar contra el fichero que lo contiene.
 */
function tablasParaVolcado(entrada: EntradaAmf, info: Info): TablaVolcada[] {
  const porNombre = new Map(entrada.contenido.map((c) => [c.tabla, c.filas]));

  return entrada.esquema.tablas.map((def) => {
    if (def.nombre === "info") {
      // Se omite content_hash, por lo dicho arriba.
      const infoSinHash: Info = { ...info };
      delete infoSinHash[CLAVE_CONTENT_HASH];
      return { nombre: "info", filas: filasDeInfo(infoSinHash) };
    }
    const filas = porNombre.get(def.nombre) ?? [];
    return {
      nombre: def.nombre,
      filas: [...filas].sort((a, b) => comparar(a.clave, b.clave)),
    };
  });
}

function comprobarEntrada(entrada: EntradaAmf): void {
  const veredicto = evaluar(entrada.info);
  if (!veredicto.ok) {
    throw new ErrorAmf(
      `el gate de licencia rechaza "${entrada.nombre}":\n` +
        veredicto.violaciones.map((v) => `  [${v.campo}] ${v.motivo}`).join("\n"),
    );
  }
  if (entrada.tipo !== "bible" && entrada.tipo !== "commentary") {
    throw new ErrorAmf(`tipo de modulo no soportado: "${entrada.tipo}"`);
  }
  if (entrada.info.type !== entrada.tipo) {
    throw new ErrorAmf(
      `info.type ("${entrada.info.type}") no coincide con el tipo declarado ` +
        `("${entrada.tipo}"); el modulo no sabria como leerse a si mismo`,
    );
  }
  comprobarFilas(entrada.esquema, entrada.contenido);
}

/**
 * Escribe un `.amod`.
 *
 * Orden de operaciones, y por que en este orden:
 *  1. validar con el gate y con el esquema, ANTES de tocar disco. Un modulo
 *     que no pasa no debe existir ni siquiera como fichero.
 *  2. calcular el `contentHash` del contenido logico, antes de escribir.
 *  3. escribir con los pragmas fijados, filas ordenadas, una sola transaccion.
 *  4. hashear el fichero ya cerrado, para el hash de transporte.
 */
export async function escribirAmf(destino: string, entrada: EntradaAmf): Promise<ResultadoAmf> {
  comprobarEntrada(entrada);

  const info = infoDeModulo(entrada);
  const contentHash = contentHashDeTablas(tablasParaVolcado(entrada, info));

  const db = new Database(destino, { create: true });
  try {
    db.run(`PRAGMA application_id = ${APPLICATION_ID}`);
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.run(`PRAGMA page_size = ${PAGE_SIZE}`);
    // MEMORY y no WAL: el modo WAL deja ficheros -wal y -shm al lado, y un
    // artefacto de distribucion con tres ficheros es un artefacto roto.
    db.run("PRAGMA journal_mode = MEMORY");

    db.transaction(() => {
      for (const def of entrada.esquema.tablas) db.run(sentenciaCreate(def));
      for (const def of entrada.esquema.tablas) {
        for (const idx of def.indices ?? []) {
          db.run(
            `CREATE INDEX ${idx.nombre} ON ${def.nombre} (${idx.columnas.join(", ")})`,
          );
        }
      }

      for (const def of entrada.esquema.tablas) {
        const columnas = def.columnas.map((c) => c.nombre).join(", ");
        const insercion = db.prepare(
          `INSERT INTO ${def.nombre} (${columnas}) VALUES ` +
            `(${def.columnas.map(() => "?").join(", ")})`,
        );
        const filas =
          def.nombre === "info"
            ? filasDeInfo({ ...info, [CLAVE_CONTENT_HASH]: contentHash })
            : [...(entrada.contenido.find((c) => c.tabla === def.nombre)?.filas ?? [])].sort(
                (a, b) => comparar(a.clave, b.clave),
              );
        for (const f of filas) insercion.run(...valoresEnOrden(def, f));
      }
    })();
  } finally {
    db.close();
  }

  return {
    ruta: destino,
    sha256: await sha256DeFichero(destino),
    contentHash,
    filas: entrada.contenido.reduce((n, c) => n + c.filas.length, 0),
    bytes: statSync(destino).size,
    defectos: entrada.defectos?.length ?? 0,
  };
}

export type InfoLeida = Record<string, string>;

/**
 * Lee `info` de un `.amod`.
 *
 * Devuelve el veredicto del gate en vez de lanzar, para que un listado pueda
 * marcar los modulos que no pasan en lugar de morir en el primero malo.
 */
export function leerInfo(
  ruta: string,
): { info: InfoLeida; veredicto: ReturnType<typeof evaluar> } {
  const db = new Database(ruta, { readonly: true });
  try {
    const info: InfoLeida = {};
    for (const f of db.prepare("SELECT key, value FROM info").all() as {
      key: string;
      value: string;
    }[]) {
      info[f.key] = f.value;
    }
    return { info, veredicto: evaluar(info) };
  } finally {
    db.close();
  }
}

/**
 * Lee columnas y clave primaria de una sentencia CREATE TABLE.
 *
 * El verificador reconstruye el volcado desde el fichero ya escrito, sin
 * consultar el esquema de origen: si alguien altera la forma del modulo y el
 * hash no cambia, tiene que notarse. Por eso deduce la forma del SQL guardado.
 */
export function esquemaDeSql(sql: string): { columnas: string[]; clavePrimaria: string[] } {
  const columnas: string[] = [];
  const dentro = /^\s*CREATE\s+TABLE\s+[^\s(]+\s*\(([\s\S]*)\)\s*(?:WITHOUT\s+ROWID)?\s*;?\s*$/i.exec(
    sql ?? "",
  );
  if (dentro) {
    // Separar por comas de primer nivel: una coma dentro de un tipo con
    // parentesis (DECIMAL(10,2)) no corta columna.
    let nivel = 0;
    let actual = "";
    const partes: string[] = [];
    for (const c of dentro[1]) {
      if (c === "(") nivel++;
      else if (c === ")") nivel--;
      if (c === "," && nivel === 0) {
        partes.push(actual);
        actual = "";
        continue;
      }
      actual += c;
    }
    partes.push(actual);

    for (const parte of partes) {
      const m = /^\s*["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|VARCHAR)\b/i.exec(
        parte,
      );
      if (m) columnas.push(m[1]);
    }
  }

  const pk = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(sql ?? "");
  const clavePrimaria = pk
    ? pk[1].split(",").map((s) => s.trim().replace(/^["`\[]|["`\]]$/g, ""))
    : [];
  return { columnas, clavePrimaria };
}

/**
 * Tablas del `.amod` tal como las ve un lector, listas para verificar.
 *
 * Es el counterpart exacto de `tablasParaVolcado`: mismo orden, mismas
 * exclusiones. Si el verificador y el escritor no coinciden, la verificacion
 * de `contentHash` daria falso positivo y no valdria para nada.
 */
export function tablasParaVerificar(ruta: string): TablaVolcada[] {
  const db = new Database(ruta, { readonly: true });
  try {
    const salida: TablaVolcada[] = [];
    for (const t of db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string; sql: string }[]) {
      const definicion = esquemaDeSql(t.sql);
      const clavePrimaria = definicion.clavePrimaria;

      let filas: Fila[] = [];
      if (t.name === "info") {
        const info: InfoLeida = {};
        for (const f of db.prepare("SELECT key, value FROM info").all() as {
          key: string;
          value: string;
        }[]) {
          info[f.key] = f.value;
        }
        delete info[CLAVE_CONTENT_HASH];
        filas = filasDeInfo(info);
      } else {
        const todas = db.prepare(`SELECT * FROM ${t.name}`).all() as Record<
          string,
          string | number | null
        >[];
        // Misma convencion que el escritor: la clave aparte, y las celdas son
        // las columnas que NO son clave primaria. El orden de columnas sale
        // del CREATE TABLE, no de Object.values, que no lo garantiza.
        filas = todas.map((r) => ({
          clave: clavePrimaria.map((k) => r[k] as string | number),
          celdas: definicion.columnas
            .filter((c) => !clavePrimaria.includes(c))
            .map((c) => (r[c] === null ? "" : (r[c] as string | number))),
        }));
      }
      salida.push({ nombre: t.name, filas });
    }
    return salida;
  } finally {
    db.close();
  }
}

/** `contentHash` declarado dentro de un `.amod`. */
export function contentHashDeclarado(ruta: string): string {
  const db = new Database(ruta, { readonly: true });
  try {
    const f = db.prepare("SELECT value FROM info WHERE key = ?").get(CLAVE_CONTENT_HASH) as
      | { value: string }
      | null;
    return f?.value ?? "";
  } finally {
    db.close();
  }
}