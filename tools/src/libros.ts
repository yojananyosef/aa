/**
 * Tabla canonica de libros (versificacion KJV, 66 libros).
 *
 * El id de libro NUNCA es texto libre. Sale de aqui. Es lo que permite
 * comparar una Biblia en espanol con un comentario en ingles: ambos apuntan
 * a 'John', no a 'Juan' ni a 'Jn'.
 *
 * `idUsfm` es el identificador de 3 letras que usan USFM y SWORD en el
 * marcador \id y en el nombre de fichero.
 *
 * `capitulos` es el numero de capitulos; `versiculos` el total de versiculos
 * del libro en versificacion KJV. Juntos permiten validar que una Biblia
 * entrante esta completa: un capitulo sin el numero esperado de versiculos
 * es un bug de la fuente, no una tradaccion mas corta.
 */

export type Libro = {
  /** Id canonico, en ingles, sin espacios ni puntuacion: '1Corinthians'. */
  id: string;
  /** Nombre legible en espanol. Solo para mostrar; nunca para indexar. */
  nombre: string;
  /** Nombre en ingles. */
  nombreEn: string;
  /** Id USFM/SWORD de 3 letras: 'JHN'. */
  idUsfm: string;
  capitulos: number;
  versiculos: number;
};

export const LIBROS: readonly Libro[] = [
  // --- Antiguo Testamento ---
  { id: "Genesis", nombre: "Génesis", nombreEn: "Genesis", idUsfm: "GEN", capitulos: 50, versiculos: 1533 },
  { id: "Exodus", nombre: "Éxodo", nombreEn: "Exodus", idUsfm: "EXO", capitulos: 40, versiculos: 1213 },
  { id: "Leviticus", nombre: "Levítico", nombreEn: "Leviticus", idUsfm: "LEV", capitulos: 27, versiculos: 859 },
  { id: "Numbers", nombre: "Números", nombreEn: "Numbers", idUsfm: "NUM", capitulos: 36, versiculos: 1288 },
  { id: "Deuteronomy", nombre: "Deuteronomio", nombreEn: "Deuteronomy", idUsfm: "DEU", capitulos: 34, versiculos: 959 },
  { id: "Joshua", nombre: "Josué", nombreEn: "Joshua", idUsfm: "JOS", capitulos: 24, versiculos: 658 },
  { id: "Judges", nombre: "Jueces", nombreEn: "Judges", idUsfm: "JDG", capitulos: 21, versiculos: 618 },
  { id: "Ruth", nombre: "Rut", nombreEn: "Ruth", idUsfm: "RUT", capitulos: 4, versiculos: 85 },
  { id: "1Samuel", nombre: "1 Samuel", nombreEn: "1 Samuel", idUsfm: "1SA", capitulos: 31, versiculos: 810 },
  { id: "2Samuel", nombre: "2 Samuel", nombreEn: "2 Samuel", idUsfm: "2SA", capitulos: 24, versiculos: 695 },
  { id: "1Kings", nombre: "1 Reyes", nombreEn: "1 Kings", idUsfm: "1KI", capitulos: 22, versiculos: 816 },
  { id: "2Kings", nombre: "2 Reyes", nombreEn: "2 Kings", idUsfm: "2KI", capitulos: 25, versiculos: 719 },
  { id: "1Chronicles", nombre: "1 Crónicas", nombreEn: "1 Chronicles", idUsfm: "1CH", capitulos: 29, versiculos: 942 },
  { id: "2Chronicles", nombre: "2 Crónicas", nombreEn: "2 Chronicles", idUsfm: "2CH", capitulos: 36, versiculos: 822 },
  { id: "Ezra", nombre: "Esdras", nombreEn: "Ezra", idUsfm: "EZR", capitulos: 10, versiculos: 280 },
  { id: "Nehemiah", nombre: "Nehemías", nombreEn: "Nehemiah", idUsfm: "NEH", capitulos: 13, versiculos: 406 },
  { id: "Esther", nombre: "Ester", nombreEn: "Esther", idUsfm: "EST", capitulos: 10, versiculos: 167 },
  { id: "Job", nombre: "Job", nombreEn: "Job", idUsfm: "JOB", capitulos: 42, versiculos: 1070 },
  { id: "Psalms", nombre: "Salmos", nombreEn: "Psalms", idUsfm: "PSA", capitulos: 150, versiculos: 2461 },
  { id: "Proverbs", nombre: "Proverbios", nombreEn: "Proverbs", idUsfm: "PRO", capitulos: 31, versiculos: 915 },
  { id: "Ecclesiastes", nombre: "Eclesiastés", nombreEn: "Ecclesiastes", idUsfm: "ECC", capitulos: 12, versiculos: 222 },
  { id: "SongOfSolomon", nombre: "Cantares", nombreEn: "Song of Solomon", idUsfm: "SNG", capitulos: 8, versiculos: 117 },
  { id: "Isaiah", nombre: "Isaías", nombreEn: "Isaiah", idUsfm: "ISA", capitulos: 66, versiculos: 1292 },
  { id: "Jeremiah", nombre: "Jeremías", nombreEn: "Jeremiah", idUsfm: "JER", capitulos: 52, versiculos: 1364 },
  { id: "Lamentations", nombre: "Lamentaciones", nombreEn: "Lamentations", idUsfm: "LAM", capitulos: 5, versiculos: 154 },
  { id: "Ezekiel", nombre: "Ezequiel", nombreEn: "Ezekiel", idUsfm: "EZK", capitulos: 48, versiculos: 1273 },
  { id: "Daniel", nombre: "Daniel", nombreEn: "Daniel", idUsfm: "DAN", capitulos: 12, versiculos: 357 },
  { id: "Hosea", nombre: "Oseas", nombreEn: "Hosea", idUsfm: "HOS", capitulos: 14, versiculos: 197 },
  { id: "Joel", nombre: "Joel", nombreEn: "Joel", idUsfm: "JOL", capitulos: 3, versiculos: 73 },
  { id: "Amos", nombre: "Amós", nombreEn: "Amos", idUsfm: "AMO", capitulos: 9, versiculos: 146 },
  { id: "Obadiah", nombre: "Abdías", nombreEn: "Obadiah", idUsfm: "OBA", capitulos: 1, versiculos: 21 },
  { id: "Jonah", nombre: "Jonás", nombreEn: "Jonah", idUsfm: "JON", capitulos: 4, versiculos: 48 },
  { id: "Micah", nombre: "Miqueas", nombreEn: "Micah", idUsfm: "MIC", capitulos: 7, versiculos: 105 },
  { id: "Nahum", nombre: "Nahum", nombreEn: "Nahum", idUsfm: "NAM", capitulos: 3, versiculos: 47 },
  { id: "Habakkuk", nombre: "Habacuc", nombreEn: "Habakkuk", idUsfm: "HAB", capitulos: 3, versiculos: 56 },
  { id: "Zephaniah", nombre: "Sofonías", nombreEn: "Zephaniah", idUsfm: "ZEP", capitulos: 3, versiculos: 53 },
  { id: "Haggai", nombre: "Hageo", nombreEn: "Haggai", idUsfm: "HAG", capitulos: 2, versiculos: 38 },
  { id: "Zechariah", nombre: "Zacarías", nombreEn: "Zechariah", idUsfm: "ZEC", capitulos: 14, versiculos: 211 },
  { id: "Malachi", nombre: "Malaquías", nombreEn: "Malachi", idUsfm: "MAL", capitulos: 4, versiculos: 55 },
  // --- Nuevo Testamento ---
  { id: "Matthew", nombre: "Mateo", nombreEn: "Matthew", idUsfm: "MAT", capitulos: 28, versiculos: 1071 },
  { id: "Mark", nombre: "Marcos", nombreEn: "Mark", idUsfm: "MRK", capitulos: 16, versiculos: 678 },
  { id: "Luke", nombre: "Lucas", nombreEn: "Luke", idUsfm: "LUK", capitulos: 24, versiculos: 1151 },
  { id: "John", nombre: "Juan", nombreEn: "John", idUsfm: "JHN", capitulos: 21, versiculos: 879 },
  { id: "Acts", nombre: "Hechos", nombreEn: "Acts", idUsfm: "ACT", capitulos: 28, versiculos: 1007 },
  { id: "Romans", nombre: "Romanos", nombreEn: "Romans", idUsfm: "ROM", capitulos: 16, versiculos: 433 },
  { id: "1Corinthians", nombre: "1 Corintios", nombreEn: "1 Corinthians", idUsfm: "1CO", capitulos: 16, versiculos: 437 },
  { id: "2Corinthians", nombre: "2 Corintios", nombreEn: "2 Corinthians", idUsfm: "2CO", capitulos: 13, versiculos: 257 },
  { id: "Galatians", nombre: "Gálatas", nombreEn: "Galatians", idUsfm: "GAL", capitulos: 6, versiculos: 149 },
  { id: "Ephesians", nombre: "Efesios", nombreEn: "Ephesians", idUsfm: "EPH", capitulos: 6, versiculos: 155 },
  { id: "Philippians", nombre: "Filipenses", nombreEn: "Philippians", idUsfm: "PHP", capitulos: 4, versiculos: 104 },
  { id: "Colossians", nombre: "Colosenses", nombreEn: "Colossians", idUsfm: "COL", capitulos: 4, versiculos: 95 },
  { id: "1Thessalonians", nombre: "1 Tesalonicenses", nombreEn: "1 Thessalonians", idUsfm: "1TH", capitulos: 5, versiculos: 89 },
  { id: "2Thessalonians", nombre: "2 Tesalonicenses", nombreEn: "2 Thessalonians", idUsfm: "2TH", capitulos: 3, versiculos: 47 },
  { id: "1Timothy", nombre: "1 Timoteo", nombreEn: "1 Timothy", idUsfm: "1TI", capitulos: 6, versiculos: 113 },
  { id: "2Timothy", nombre: "2 Timoteo", nombreEn: "2 Timothy", idUsfm: "2TI", capitulos: 4, versiculos: 83 },
  { id: "Titus", nombre: "Tito", nombreEn: "Titus", idUsfm: "TIT", capitulos: 3, versiculos: 46 },
  { id: "Philemon", nombre: "Filemón", nombreEn: "Philemon", idUsfm: "PHM", capitulos: 1, versiculos: 25 },
  { id: "Hebrews", nombre: "Hebreos", nombreEn: "Hebrews", idUsfm: "HEB", capitulos: 13, versiculos: 303 },
  { id: "James", nombre: "Santiago", nombreEn: "James", idUsfm: "JAS", capitulos: 5, versiculos: 108 },
  { id: "1Peter", nombre: "1 Pedro", nombreEn: "1 Peter", idUsfm: "1PE", capitulos: 5, versiculos: 105 },
  { id: "2Peter", nombre: "2 Pedro", nombreEn: "2 Peter", idUsfm: "2PE", capitulos: 3, versiculos: 61 },
  { id: "1John", nombre: "1 Juan", nombreEn: "1 John", idUsfm: "1JN", capitulos: 5, versiculos: 105 },
  { id: "2John", nombre: "2 Juan", nombreEn: "2 John", idUsfm: "2JN", capitulos: 1, versiculos: 13 },
  { id: "3John", nombre: "3 Juan", nombreEn: "3 John", idUsfm: "3JN", capitulos: 1, versiculos: 14 },
  { id: "Jude", nombre: "Judas", nombreEn: "Jude", idUsfm: "JUD", capitulos: 1, versiculos: 25 },
  { id: "Revelation", nombre: "Apocalipsis", nombreEn: "Revelation", idUsfm: "REV", capitulos: 22, versiculos: 404 },
] as const;

const POR_ID = new Map(LIBROS.map((l) => [l.id, l]));
const POR_USFM = new Map(LIBROS.map((l) => [l.idUsfm, l]));

/**
 * Totales del canon KJV: los tres invariantes del formato.
 *
 * Estos numeros se verificaron contra el texto KJV de referencia
 * (eBible eng-kjv2006, dominio publico) libro por libro, NO de memoria.
 * Una fuente que se aparte de ellos tiene un problema, no es una
 * traduccion mas corta.
 */
export const LIBROS_CANON = LIBROS.length;
export const CAPITULOS_CANON = LIBROS.reduce((n, l) => n + l.capitulos, 0);
export const VERSICULOS_CANON = LIBROS.reduce((n, l) => n + l.versiculos, 0);

export function buscarPorId(id: string): Libro | undefined {
  return POR_ID.get(id);
}

export function buscarPorUsfm(idUsfm: string): Libro | undefined {
  return POR_USFM.get(idUsfm.trim().toUpperCase());
}

/**
 * Traduce un id USFM al id canonico.
 *
 * Lanza si no existe: un libro desconocido es un dato invalido, no algo que
 * se deba descartar en silencio. Un \$id desconocido significa que el parser
 * esta leyendo mal el fichero, y eso debe ser visible.
 */
export function canonicoDesdeUsfm(idUsfm: string): Libro {
  const libro = buscarPorUsfm(idUsfm);
  if (!libro) {
    throw new Error(
      `libro desconocido: "${idUsfm}". ` +
        `El id debe existir en la tabla canonica KJV (66 libros).`,
    );
  }
  return libro;
}

/** Nombre del fichero USFM de eBible: '73-JHNspaRV1909.usfm' -> 'JHN'. */
export function idUsfmDesdeNombreFichero(nombre: string): string {
  const m = nombre.match(/^(\d{2})-([A-Z0-9]{3})/);
  if (!m) throw new Error(`nombre de fichero USFM no reconocido: "${nombre}"`);
  return m[2];
}