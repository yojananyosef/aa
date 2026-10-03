/**
 * Importador de modulos SWORD de comentario (`ModDrv=zCom`) a USFM.
 *
 * QUE HACE Y POR QUE EXISTE
 * -------------------------
 * Los comentarios en dominio publico que existen para catalogo serio (Clarke,
 * Wesley, Barnes, Calvino) solo se distribuyen en formato SWORD. No hay USFM
 * de ellos. Este modulo convierte ese formato a USFM para que el resto del
 * pipeline, que solo entiende USFM, no sepa nada de SWORD.
 *
 * LA ESTRUCTURA QUE HAY DENTRO, MEDIDA Y NO SUPUESTA
 * --------------------------------------------------
 * El bloque de datos de un `zCom` es una secuencia de ENTRADAS, cada una con su
 * offset en el indice de versos. Mirando las entradas de Clarke:
 *
 *   <div canonical="true" osisID="Matt" sID="gen35969" type="book"/>
 *   <chapter n="1" osisID="Matt.1" sID="Matt.1"/>
 *   <div .../> Preface to the Gospel of St. Matthew ...        <- introduccion
 *   <hi type="bold">Verse 11</hi> <div .../> Josias begat ...   <- nota, Mt 1:11
 *   <hi type="bold">Verse 16</hi> <div .../> Jesus, who is ...  <- nota, Mt 1:16
 *
 * O sea: NO hay marcadores de versiculo por entrada. El libro y el capitulo
 * los fijan los hitos que van delante, y el versiculo lo anuncia un encabezado
 * en negrita dentro del texto de la nota. De ahi que la conversion sea
 * sensible al orden y por que se valida en vez de confiar.
 *
 * Lo que NO se hace aqui, ni en ninguna parte del proyecto: rellenar. Si una
 * nota no trae versiculo reconocible, se cuenta como descartada y se reporta.
 * Un comentario descolocado en el versiculo equivocado es peor que un
 * comentario ausente.
 */

import { LectorSword, leerVersos } from "./sword.ts";

export type NotaImportada = {
  libro: string;
  chapter: number;
  verse: number;
  texto: string;
};

export type ResultadoImportacion = {
  notas: NotaImportada[];
  introducciones: { libro: string; texto: string }[];
  /** Entradas que no se pudieron anclar a ningun versiculo. */
  sinAnclar: { indice: number; motivo: string; muestra: string }[];
  /** Capitulos vistos por libro, para validar el recorrido. */
  cobertura: Map<string, Set<number>>;
};

/** `osisID="Matt.1"` -> `["Matt", "1"]`. */
function hitoDeSigilado(sigilado: string): { id: string; capitulo: number } | null {
  const m = /^(.+)\.(\d+)$/.exec(sigilado.trim());
  if (!m) return null;
  return { id: m[1], capitulo: parseInt(m[2], 10) };
}

/**
 * Quita el marcado OSIS dejando el texto legible.
 *
 * Se conservan los `<reference osisRef="...">` porque su texto visible ("Luk
 * 1:36") es lo que el usuario lee; solo se elimina el atributo.
 */
export function osisAPlano(frag: string): string {
  return frag
    .replace(/<reference osisRef="[^"]*">/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#?[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El encabezado `<hi type="bold">Verse 11</hi>` al principio de la entrada. */
function versoDelEncabezado(frag: string): number | null {
  const m = /<hi[^>]*>\s*Verse\s+(\d+)\s*<\/hi>/i.exec(frag.slice(0, 120));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Convierte todas las entradas de un modulo `zCom` a notas con referencia.
 *
 * `base` es el prefijo comun de los tres ficheros, p.ej.
 * `.../zcom/clarke/nt` para el Nuevo Testamento.
 */
export function importarZCom(base: string): ResultadoImportacion {
  const lector = new LectorSword(base);
  const registros = leerVersos(base);

  const notas: NotaImportada[] = [];
  const introducciones: { libro: string; texto: string }[] = [];
  const sinAnclar: { indice: number; motivo: string; muestra: string }[] = [];
  const cobertura = new Map<string, Set<number>>();

  let libroActual: string | null = null;
  let capituloActual: number | null = null;
  let ultimoVersiculo = 0;

  for (let i = 0; i < registros.length; i++) {
    const r = registros[i];
    if (r.longitud === 0) continue;

    let frag: string;
    try {
      frag = lector.verso(i, r);
    } catch (e) {
      sinAnclar.push({
        indice: i,
        motivo: `no se pudo leer el bloque: ${(e as Error).message}`,
        muestra: "",
      });
      continue;
    }

    // Un hito con `type="book"` fija el libro; uno `chapter`, el capitulo.
    const hitoLibro = /<div[^>]*canonical="true"[^>]*osisID="([^"]+)"/i.exec(frag);
    if (hitoLibro) {
      libroActual = hitoLibro[1];
      capituloActual = null;
      continue;
    }

    const hitoCapitulo = /<chapter[^>]*osisID="([^"]+)"/i.exec(frag);
    if (hitoCapitulo) {
      const h = hitoDeSigilado(hitoCapitulo[1]);
      if (h) {
        if (h.id !== libroActual) libroActual = h.id;
        capituloActual = h.capitulo;
        ultimoVersiculo = 0;
        if (!cobertura.has(h.id)) cobertura.set(h.id, new Set());
        cobertura.get(h.id)!.add(h.capitulo);
      }
      continue;
    }

    const verso = versoDelEncabezado(frag);
    if (verso === null) {
      // Sin encabezado de versiculo: es una introduccion, no una nota.
      const plano = osisAPlano(frag);
      if (plano.length > 200 && libroActual) {
        introducciones.push({ libro: libroActual, texto: plano });
      } else if (plano.length > 0) {
        sinAnclar.push({
          indice: i,
          motivo: `ni nota ni introduccion (${plano.length} caracteres)`,
          muestra: plano.slice(0, 60),
        });
      }
      continue;
    }

    if (libroActual === null || capituloActual === null) {
      sinAnclar.push({
        indice: i,
        motivo: "nota sin libro o capitulo previos",
        muestra: frag.slice(0, 60),
      });
      continue;
    }

    const plano = osisAPlano(frag.replace(/<hi[^>]*>\s*Verse\s+\d+\s*<\/hi>/i, ""));

    // El recorrido de un comentario avanza. Retroceder a un versiculo ANTERIOR
    // significa que la lectura se descoloco, y anclar la nota ahi seria peor
    // que descartarla: el usuario leeria una nota sobre el versiculo que no le
    // corresponde.
    //
    // Pero REPETIR el versiculo es legitimo y frecuente: Clarke anota a veces
    // dos veces el mismo versiculo. Es exactamente el caso de `seq`, asi que
    // se admite y se numeran en orden de lectura.
    if (verso < ultimoVersiculo) {
      sinAnclar.push({
        indice: i,
        motivo: `retrocede: versiculo ${verso} tras ${ultimoVersiculo}`,
        muestra: plano.slice(0, 60),
      });
      continue;
    }

    notas.push({
      libro: libroActual,
      chapter: capituloActual,
      verse: verso,
      texto: plano,
    });
    ultimoVersiculo = verso;
  }

  return { notas, introducciones, sinAnclar, cobertura };
}

/** Nombre canonico KJV a partir del id USFM/SWORD (`JHN` -> `John`). */
export type ResolverLibro = (idUsfm: string) => string | null;

/**
 * Escribe las notas como USFM, un fichero por libro.
 *
 * El formato es el que el resto del pipeline ya consume: `\id`, `\c`, `\v`.
 * Se emiten VARIOS `\v` con el mismo numero cuando hay varias notas sobre el
 * mismo versiculo, que es el caso normal en Clarke. `construirComentario` las
 * numera con `seq`.
 */
export function aUsfm(
  notas: NotaImportada[],
  resolver: ResolverLibro,
): { nombre: string; contenido: string; notas: number }[] {
  const porLibro = new Map<string, Map<number, Map<number, string[]>>>();

  for (const n of notas) {
    const canonico = resolver(n.libro);
    if (!canonico) continue;
    if (!porLibro.has(canonico)) porLibro.set(canonico, new Map());
    const caps = porLibro.get(canonico)!;
    if (!caps.has(n.chapter)) caps.set(n.chapter, new Map());
    const versos = caps.get(n.chapter)!;
    if (!versos.has(n.verse)) versos.set(n.verse, []);
    versos.get(n.verse)!.push(n.texto);
  }

  const salida: { nombre: string; contenido: string; notas: number }[] = [];
  for (const [libro, caps] of porLibro) {
    const capitulos = [...caps.keys()].sort((a, b) => a - b);
    let total = 0;
    const partes: string[] = [`\\id ${libro} CLARKE\n`];
    for (const c of capitulos) {
      partes.push(`\\c ${c}\n`);
      const versos = [...caps.get(c)!.keys()].sort((a, b) => a - b);
      for (const v of versos) {
        for (const texto of caps.get(c)!.get(v)!) {
          // Una linea por nota: una sola nota que contenga un \n partiria el
          // versiculo en dos al parsear.
          partes.push(`\\v ${v} ${texto.replace(/\s+/g, " ").trim()}\n`);
          total++;
        }
      }
    }
    salida.push({ nombre: `${libro}.usfm`, contenido: partes.join(""), notas: total });
  }
  return salida;
}