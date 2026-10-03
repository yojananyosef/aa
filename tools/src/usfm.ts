/**
 * Parser USFM -> estructura intermedia.
 *
 * Principio: `raw` es la verdad, `text` es para leer.
 *
 * Un build que pierde marcado en silencio es peor que uno que falla. Por eso
 * el parser nunca descarta lo que no sabe interpretar: lo conserva en `raw` y
 * lo reporta como advertencia. En RVR1909 los 66 libros tienen marcado \add
 * (48.776 apariciones), asi que esto no es teorico.
 */

import { canonicoDesdeUsfm, buscarPorUsfm, type Libro } from "./libros.ts";

export type Versiculo = {
  /** Id canonico KJV: 'John', no 'Juan' ni 'Jn'. */
  book: string;
  chapter: number;
  verse: number;
  /** Texto plano legible, sin marcas USFM. */
  text: string;
  /** Fragmento USFM original, verbatim. */
  raw: string;
};

export type Defecto = {
  libro: string;
  chapter: number;
  verse: number;
  tipo: "versiculo_vacio";
};

export type ResultadoParseo = {
  libro: Libro;
  capitulos: number;
  versiculos: Versiculo[];
  /** Marcadores que el parser no conoce. No son errores, pero se reportan. */
  advertencias: string[];
  /**
   * Defectos de la FUENTE, no del parser: versiculos que el fichero USFM
   * declara pero no trae texto.
   *
   * Se registran en vez de ignorarse. Un build que los ignora produce una
   * Biblia con huecos que nadie sabe que estan ahi.
   */
  defectos: Defecto[];
};

/**
 * Marcadores que son separadores de estructura, no contenido del versiculo.
 * Se recortan de `raw` porque delimitan el verso, no lo componen.
 */
const ESTRUCTURA = new Set([
  "p", "m", "b", "po", "pc", "cls", "pr", "pi", "mi", "nb",
  "q", "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8",
  "qc", "qm", "qm1", "qm2", "qm3", "qa", "sp", "n", "n\n",
]);

/** Marcadores de encabezado: no son contenido. */
const ENCABEZADO = new Set([
  "h", "toc1", "toc2", "toc3", "toc4", "mt", "mt1", "mt2", "mt3", "mt4",
  "s", "s1", "s2", "s3", "s4", "r", "d", "ide", "rem", "sts", "sr",
  "pb", "ph", "pc", "pr",
]);

/** Marcadores envolventes con cierre `*`: se conserva su contenido. */
const ENVOLVENTE = new Set(["w", "wj", "add", "addsl", "q", "q1", "q2", "q3"]);

export class ErrorParseoUsfm extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorParseoUsfm";
  }
}

/** Localiza el id USFM del libro en el marcador \id. */
function extraerIdUsfm(contenido: string): string {
  const m = contenido.match(/\\id\s+([A-Za-z0-9]+)/);
  if (!m) {
    throw new ErrorParseoUsfm(
      "el fichero no tiene marcador \\id; no se puede identificar el libro",
    );
  }
  return m[1];
}

/** Quita los marcadores de estructura del principio y del final. */
function recortarEstructura(bruto: string): string {
  let t = bruto.trim();

  const soloEstructura = (s: string): boolean => {
    // True si `s` solo contiene marcadores de estructura y espacios.
    const limpio = s
      .replace(/\\[a-z0-9]+(\*?)/gi, (mm) => {
        const nombre = mm.slice(1).replace(/\*$/, "").toLowerCase();
        return ESTRUCTURA.has(nombre) ? "" : mm;
      })
      .replace(/¶/g, "")
      .replace(/\s+/g, "");
    return limpio === "";
  };

  // Recorta por delante mientras quede solo estructura.
  for (let i = 0; i < 40; i++) {
    const m = t.match(/^(\\[a-z0-9]+\*?[ \t]*\n?)+/i);
    if (!m) break;
    if (!soloEstructura(m[0])) break;
    t = t.slice(m[0].length).trim();
  }
  // Recorta por detras.
  for (let i = 0; i < 40; i++) {
    const m = t.match(/(\n?[ \t]*\\[a-z0-9]+\*?[ \t]*)+$/i);
    if (!m) break;
    if (!soloEstructura(m[0])) break;
    t = t.slice(0, t.length - m[0].length).trim();
  }
  return t;
}

/**
 * Convierte USFM a texto plano.
 *
 * Reglas:
 *  - `\w texto|atributos\w*`  -> `texto`   (los atributos se pierden del
 *    plano, pero siguen intactos en `raw`)
 *  - `\+w texto|atributos\+w*` -> `texto`
 *  - `\add texto\add*`          -> `texto`  (el texto Added SI va al plano)
 *  - `\wj ... \wj*`             -> contenido
 *  - `\f clave`                 -> se elimina (la nota vive aparte)
 *  - marcadores de estructura   -> salto de linea
 *  - `¶`                        -> se elimina (marca de poema)
 *  - `\*`                       -> escape: el `*` siguiente es literal
 *  - marcador desconocido       -> se conserva su contenido y se avisa
 *
 * RECORTE SOLO EN LA CAPA DE FUERA
 * -------------------------------
 * Las llamadas recursivas usan `convertir`, que normaliza espacios pero NO
 * recorta. Si recortaran tambien, un marcador envolvente cuyo contenido acaba en
 * espacio perderia ese espacio al concatenarse con lo que viene despues:
 *
 *     \addsl En el principio \addsl*creo Dios
 *     -> "En el principio" + "creo Dios" = "En el principiocreo Dios"
 *
 * Ese es un cambio de texto biblico por un detalle de implementacion, y es
 * justo el tipo de fallo que el round-trip con `raw` no detecta por si solo
 * (el USFM sigue intacto; lo que se altera es la lectura). Por eso el recorte
 * se hace una sola vez, arriba del todo.
 */
export function usfmAPlano(raw: string, advertencias?: string[]): string {
  return convertir(raw, advertencias).trim();
}

function convertir(raw: string, advertencias?: string[]): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let salida = "";
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === "\\") {
      const m = /^\\(\+?[a-z0-9]+)(\*?)/i.exec(raw.slice(i));
      if (!m) {
        // Escape: \* \*  -> asterisco literal. \* \[ \] -> corchete literal.
        const sig = raw[i + 1];
        if (sig === "*" || sig === "[" || sig === "]") {
          salida += sig;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      const nombre = m[1].toLowerCase();
      const iTras = i + m[0].length;

      // Escape: \* es un asterisco literal.
      if (nombre === "*") {
        if (raw[iTras] === "*") salida += "*";
        i = iTras + 1;
        continue;
      }

      const sinMas = nombre.replace(/^\+/, "");

      // Marcadores SIN cierre: se resuelven antes de buscar uno, porque si no
      // se comerian el resto del versiculo hasta el final.
      //   \f no tiene cierre: su "contenido" es solo la clave.
      //   \p, \n, \q1, \b... son de bloque: lo que sigue es texto normal.
      if (sinMas === "f") {
        const clave = /^[ \t]*[^\s\\]*/.exec(raw.slice(iTras));
        i = iTras + (clave ? clave[0].length : 0);
        continue;
      }
      if (ESTRUCTURA.has(sinMas)) {
        salida += " ";
        i = iTras;
        continue;
      }
      if (ENCABEZADO.has(sinMas)) {
        i = iTras;
        continue;
      }

      // Marcador CON cierre: buscar el cierre EXACTO. \w no cierra con \+w*.
      const cierre = new RegExp(`\\\\${esc(nombre)}\\*`, "i").exec(raw.slice(iTras));
      const finCuerpo = cierre ? iTras + cierre.index : raw.length;
      const cuerpo = raw.slice(iTras, finCuerpo);
      const iDespues = cierre ? finCuerpo + cierre[0].length : raw.length;

      if (ENVOLVENTE.has(sinMas)) {
        // Hoja (\w, \+w, \add): sin marcadores dentro, se quitan los atributos.
        // Envoltura (\wj, \q1): puede traer marcadores anidados, se procesa
        // recursivamente y NO se cortan los atributos aqui.
        const esHoja = cuerpo.indexOf("\\") === -1;
        const entrada = esHoja ? cuerpo.split("|")[0] : cuerpo;
        salida += convertir(entrada, advertencias);
        i = iDespues;
        continue;
      }

      if (m[2] === "*") {
        i = iDespues;
        continue;
      }

      // Desconocido: se reporta y se conserva el contenido.
      advertencias?.push(`marcador desconocido \\${nombre}; conservado en raw`);
      salida += convertir(cuerpo, advertencias);
      i = iDespues;
      continue;
    }

    if (ch === "\u00b6") {
      i += 1;
      continue;
    }

    salida += ch;
    i += 1;
  }

  // Solo se colapsan espacios. El recorte lo hace `usfmAPlano`.
  return salida.replace(/\s+/g, " ");
}

/**
 * Parsea un fichero USFM de Biblia.
 *
 * Falla, en vez de producir un modulo incompleto, cuando el texto no lleva
 * marcas de versiculo: un modulo biblico sin versiculos no es una Biblia
 * utilizable y un build parcial no sirve de nada.
 */
export function parseUsfm(contenido: string, nombreFichero: string): ResultadoParseo {
  const idUsfm = extraerIdUsfm(contenido);
  const libro = buscarPorUsfm(idUsfm);
  if (!libro) {
    throw new ErrorParseoUsfm(
      `libro desconocido "${idUsfm}" en ${nombreFichero}; ` +
        `debe existir en la tabla canonica KJV`,
    );
  }

  const advertencias: string[] = [];
  const defectos: Defecto[] = [];
  const versiculos: Versiculo[] = [];

  let capitulo = 0;
  let capitulosVistos = 0;

  // Posiciones de \c y \v en todo el fichero.
  const posiciones: { tipo: "c" | "v"; n: number; ini: number; fin: number }[] = [];
  const re = /\\(c|v)[ \t]+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido)) !== null) {
    posiciones.push({
      tipo: m[1] as "c" | "v",
      n: parseInt(m[2], 10),
      ini: m.index,
      fin: re.lastIndex,
    });
  }

  const nVersiculos = posiciones.filter((x) => x.tipo === "v").length;
  if (nVersiculos === 0) {
    throw new ErrorParseoUsfm(
      `${nombreFichero} no contiene marcadores \\v; ` +
        `se requiere USFM con versiculos marcados`,
    );
  }

  for (let k = 0; k < posiciones.length; k++) {
    const p = posiciones[k];

    if (p.tipo === "c") {
      capitulo = p.n;
      capitulosVistos++;
      continue;
    }

    // p es un versiculo. Su raw llega hasta el siguiente marcador \c o \v.
    const siguiente = posiciones[k + 1];
    const finRaw = siguiente ? siguiente.ini : contenido.length;
    const raw = recortarEstructura(contenido.slice(p.fin, finRaw));

    if (raw === "") {
      // No es un fallo del parser: es un defecto de la fuente. Se registra y
      // el build decide. Un fallo aqui abortaria el build entero y esconderia
      // el resto de los problemas.
      defectos.push({ libro: libro.id, chapter: capitulo, verse: p.n, tipo: "versiculo_vacio" });
      continue;
    }

    versiculos.push({
      book: libro.id,
      chapter: capitulo,
      verse: p.n,
      text: usfmAPlano(raw, advertencias),
      raw,
    });
  }

  if (capitulo === 0) {
    throw new ErrorParseoUsfm(`${nombreFichero} no contiene ningun marcador \\c`);
  }

  return {
    libro,
    capitulos: capitulosVistos,
    versiculos,
    advertencias: [...new Set(advertencias)],
    defectos,
  };
}