/**
 * Declaracion de los modulos del catalogo.
 *
 * Aqui vive TODO lo que el gate no puede deducir por si solo: de donde viene
 * cada texto y por que es libre. El gate decide, pero solo sobre esto.
 *
 * La regla que atraviesa el archivo: `license_evidence` no es decorativa. Sin
 * una URL que sostenga la declaracion de licencia, el modulo no se publica,
 * y con razon: un "PublicDomain" sin pruebas es una afirmacion, no un dato.
 *
 * La version de cada modulo es la de la FUENTE, no la del build. Si el build
 * cambiara, el `contentHash` cambiaria y se veria sin tocar la version.
 */

/** Version minima de lector que este catalogo necesita. */
export const MIN_READER_VERSION = 1;

/** Version del formato de `catalog.json`. */
export const FORMATO_CATALOGO = "aa-catalog/1";

/**
 * Origen de los ficheros publicados: GitHub Releases.
 *
 * El tag es inmutable y `latest.json` es el puntero flotante. Es la alternativa
 * a un servicio de alojamiento con cuota: sin coste, sin servidor, y con
 * historial. Cuando el catalogo crece lo bastante se migra el binario, pero el
 * formato del `.amod` no cambia, asi que la migracion es solo esta constante.
 *
 * La URL se deriva del repositorio, no se escribe a mano, para que cambiar de
 * cuenta o de organizacion sea editar una linea y no buscar el texto dentro
 * de un JSON.
 */
export const REPOSITORIO = "yojananyosef/aa";
export const ORIGEN = `https://github.com/${REPOSITORIO}/releases/download`;

export type DeclaracionModulo = {
  id: string;
  type: "bible" | "commentary";
  name: string;
  language: string;
  version: string;
  license: string;
  license_evidence: string;
  copyright: string;
  attribution: string;
  versification: string;
  source: string;
  origin: string;
  /** Prefijo de los ficheros USFM en modules/source. */
  fuente: string;
  /** Commentarios, texto que se imprime al usuario en el informe de build. */
  nota?: string;
};

export const MODULOS: DeclaracionModulo[] = [
  {
    id: "KJV2006",
    type: "bible",
    name: "King James Version (2006)",
    language: "eng",
    version: "2006.11",
    license: "PublicDomain",
    license_evidence: "https://ebible.org/Scriptures/eng-kjv2006/copr.htm",
    copyright: "Dominio publico. El texto de la Version King James (1611) y sus ediciones son de dominio publico.",
    attribution: "eBible.org (eng-kjv2006). Dominio publico.",
    versification: "KJV",
    source: "https://ebible.org/Scriptures/eng-kjv2006_usfm.zip",
    origin: "https://ebible.org",
    fuente: "eng-kjv2006",
    nota:
      "Elegida como primera Biblia por ser la unica fuente disponible que es a la " +
      "vez completa, de dominio publico y coherente con la versificacion KJV. " +
      "Se verifico contra la tabla canonica: 66 libros, 1189 capitulos, " +
      "31.102 versiculos, cero defectos. No es el espanol del catalogo: es el " +
      "namespace de referencia contra el que cualquier otra Biblia se alinea.",
  },
  {
    id: "CLARKE",
    type: "commentary",
    name: "Comentario de Adam Clarke (1832)",
    language: "eng",
    version: "2.0",
    license: "PublicDomain",
    license_evidence: "https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/Clarke.zip",
    copyright:
      "Dominio publico. Adam Clarke (1760-1832). El comentario se publico en " +
      "1832, mas de un siglo y medio antes de que expirara la proteccion en " +
      "cualquier pais de su aplicacion.",
    attribution: "Adam Clarke. Modulo SWORD distribuido por CrossWire. Dominio publico.",
    versification: "KJV",
    source:
      "https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/Clarke.zip " +
      "(fuente original: en.wikisource.org/wiki/Commentary_and_critical_notes_on_the_Bible)",
    origin: "https://crosswire.org",
    fuente: "clarke",
    nota:
      "Primer comentario del catalogo, y el primero que ejercita `seq`: Clarke " +
      "anotaMt 23:13 con dos entradas. Viene en formato SWORD, no USFM, asi que " +
      "lo convierte tools/scripts/generar-comentario-sword.ts. El script declara " +
      "el `.conf` del modulo (ModDrv, DistributionLicense, TextSource) en el " +
      "informe, para que la procedencia no dependa de la memoria de nadie.",
  },
];

/** Declaracion de un modulo por id, o error si no existe. */
export function declaracion(id: string): DeclaracionModulo {
  const m = MODULOS.find((x) => x.id === id);
  if (!m) {
    throw new Error(
      `modulo no declarado: "${id}". Declarados: ${MODULOS.map((x) => x.id).join(", ")}`,
    );
  }
  return m;
}