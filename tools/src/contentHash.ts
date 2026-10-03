/**
 * Hash de contenido reproducible.
 *
 * POR QUE HAY DOS HASHES
 * ---------------------
 * `sha256` (ver hash.ts) mide el fichero tal cual esta en disco. Es lo que
 * verifica el transporte: que el `.amod` que descarga el cliente sea
 * byte a byte el que subimos.
 *
 * Ese hash NO puede usarse para comprobar que dos builds dan el mismo modulo.
 * Los bytes 96-99 de la cabecera de SQLite guardan `SQLITE_VERSION_NUMBER`.
 * Compilar el mismo contenido con SQLite 3.53.2 y con 3.51.0 produce ficheros
 * distintos con el mismo texto. Igual pasa con el orden de escritura de las
 * paginas de indices.
 *
 * `contentHash` mide el CONTENIDO: un volcado canonico, ordenado, sin
 * metadatos de SQLite. Dos builds con el mismo contenido dan el mismo
 * `contentHash` aunque el binario difiera. Eso es lo que permite afirmar
 * "el modulo no ha cambiado" en vez de "el fichero no ha cambiado".
 *
 * Se usa `node:crypto`, no una implementacion propia: es runtime, no una
 * dependencia, y una primitiva de hash escrita a mano en una herramienta de
 * catalogo seria un riesgo sin contrapartida.
 *
 * REGLAS DEL VOLCADO
 * ------------------
 *  1. Una tabla por linea de cabecera, luego sus filas, en orden de clave
 *     primaria ASC. El orden es parte del formato: sin el, no seria canonico.
 *  2. Numeros como enteros decimales. Sin flotantes: su impresion no es
 *     estable entre maquinas y no hay dato numerico con decimales en el
 *     esquema.
 *  3. Los campos de texto se escapan, para que un tabulador o un salto de
 *     linea dentro del texto no pueda colarse como separador.
 *  4. Cabecera con la version del formato. Cambiar el formato cambia el
 *     hash, y tiene que cambiar.
 *
 * El escapado es lo unico aqui que no es trivial, y es lo unico que evita
 * un fallo silencioso: un versiculo que contenga un tabulador real
 * produciria dos filas con la misma clave primaria.
 */

/** Version del formato de volcado. Cambiarlo invalida todos los hashes. */
import { sha256DeTexto } from "./hash.ts";

export const VERSION_VOLCADO = "1";

/** Separador de campos dentro de una fila. No puede aparecer escapado. */
const SEP = "\u001f";

/**
 * Escapa un valor de texto para el volcado canonico.
 *
 * De una pasada, de izquierda a derecha. Encadenar cinco `.replace()` seria
 * mas corto pero esta mal: una barra invertida ya escapada volveria a ser
 * reinterpretada por el escape siguiente. El caso que lo delata es un texto
 * que acaba en barra invertida seguida de `u`: `\\u` es barra escapada mas
 * letra `u`, pero con replaces encadenados `\\n` se leeria como un salto de
 * linea. El volcado no tendria entonces ida y vuelta.
 *
 * Se escapan tambien los tabuladores, que no rompen el formato pero si hacen
 * el volcado ilegible en cualquier visor de texto.
 */
export function escapar(valor: string): string {
  let salida = "";
  for (const caracter of valor) {
    switch (caracter) {
      case "\u001f": salida += "\\u"; break;
      case "\r": salida += "\\r"; break;
      case "\n": salida += "\\n"; break;
      case "\t": salida += "\\t"; break;
      case "\\": salida += "\\\\"; break;
      default: salida += caracter;
    }
  }
  return salida;
}

/**
 * Revertir `escapar`. Simetrico de `escapar`, tambien de una pasada.
 *
 * Una barra invertida seguida de una letra de escape se interpreta como
 * escape; sola, se toma literalmente. Es la unica lectura que hace la
 * transformacion invertible.
 */
export function desescapar(valor: string): string {
  let salida = "";
  for (let i = 0; i < valor.length; i++) {
    if (valor[i] === "\\" && i + 1 < valor.length) {
      const siguiente = valor[i + 1];
      switch (siguiente) {
        case "u": salida += "\u001f"; i++; continue;
        case "r": salida += "\r"; i++; continue;
        case "n": salida += "\n"; i++; continue;
        case "t": salida += "\t"; i++; continue;
        case "\\": salida += "\\"; i++; continue;
      }
    }
    salida += valor[i];
  }
  return salida;
}

/** Valor de una celda: entero o texto. Nunca flotante, nunca null. */
export type Celda = string | number;

/**
 * Fila con su clave primaria explicita: el orden canonico depende de ella, no
 * de la posicion en que el llamante construyo la fila.
 */
export type Fila = {
  clave: (string | number)[];
  celdas: Celda[];
};

export type TablaVolcada = {
  nombre: string;
  filas: Fila[];
};

/**
 * Compara dos claves primarias.
 *
 * Numeros numericamente, texto por punto de codigo. Mezclar tipos en una
 * misma columna daria un orden dependiente de la implementacion de
 * Array.sort, y el hash con el.
 */
function compararClaves(a: (string | number)[], b: (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else if (typeof x === "string" && typeof y === "string") {
      if (x !== y) return x < y ? -1 : 1;
    } else {
      // Tipos distintos: los enteros van antes que las cadenas. Total y
      // determinista, que es lo unico que hace falta.
      if (typeof x === "number") return -1;
      if (typeof y === "number") return 1;
    }
  }
  return a.length - b.length;
}

/** Fila -> linea de volcado. */
function filaALinea(nombre: string, fila: Fila): string {
  const partes = [
    nombre,
    ...fila.clave.map((c) => escapar(String(c))),
    ...fila.celdas.map((c) => escapar(typeof c === "number" ? String(Math.trunc(c)) : c)),
  ];
  return partes.join(SEP) + "\n";
}

/**
 * Genera el volcado canonico.
 *
 * Las tablas se emiten en el orden dado por `tablas`, no en orden alfabetico:
 * quien llama conoce la estructura y su orden es el canon. Dentro de cada
 * tabla las filas se ordenan por clave primaria.
 */
export function volcar(tablas: TablaVolcada[]): string {
  let salida = `amf-volcado\t${VERSION_VOLCADO}\n`;
  for (const t of tablas) {
    salida += `tabla\t${escapar(t.nombre)}\n`;
    const ordenadas = [...t.filas].sort((a, b) => compararClaves(a.clave, b.clave));
    let anterior: (string | number)[] | null = null;
    for (const f of ordenadas) {
      // Claves primarias duplicadas en la misma tabla son un defecto del
      // llamante, no algo que se pueda volcar. Se hace visible en vez de
      // emitir dos filas indistinguibles.
      if (anterior && compararClaves(anterior, f.clave) === 0) {
        throw new Error(
          `volcado: clave primaria duplicada en "${t.nombre}": ` +
            f.clave.map((c) => String(c)).join(SEP),
        );
      }
      anterior = f.clave;
      salida += filaALinea(t.nombre, f);
    }
  }
  return salida;
}

/**
 * contentHash de un conjunto de tablas: volcar y hashear.
 *
 * Es la funcion que el build llama una vez escrito el modulo. Deliberadamente
 * no recibe el fichero ni la conexion SQLite: si dependiera del binario, el
 * hash dejaria de ser reproducible entre maquinas, que es su unico trabajo.
 */
export function contentHashDeTablas(tablas: TablaVolcada[]): string {
  return sha256DeTexto(volcar(tablas));
}
