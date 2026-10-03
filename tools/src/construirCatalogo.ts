/**
 * Construye todos los modulos declarados en `modulos.ts` y escribe el catalogo.
 *
 * El recorrido completo: fuentes USFM -> `.amod` -> `catalog.json`. Todo lo
 * que falla aqui es un fallo del catalogo, no del usuario.
 *
 * El orden importa: un modulo se construye DESPUES de que el gate haya
 * aceptado sus metadatos, y el catalogo se escribe DESPUES de que todos los
 * modulos esten en disco con su hash calculado. Un catalogo que declara un
 * artefacto que no existe es peor que no tener catalogo.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { construirBiblia, construirComentario, type InfoDeclarada, type ResultadoBuild } from "./build.ts";
import { nombreDeFichero } from "./amf.ts";
import { sha256DeFichero } from "./hash.ts";
import {
  declaracion,
  FORMATO_CATALOGO,
  MIN_READER_VERSION,
  MODULOS,
  ORIGEN,
  type DeclaracionModulo,
} from "./modulos.ts";
import type { Catalogo, EntradaCatalogo } from "./catalog.ts";
import { SCHEMA_VERSION } from "./amf.ts";

export type OpcionesConstruir = {
  raiz?: string;
  destino?: string;
  allowDefects?: boolean;
  /** Silencia el informe por modulo. */
  silencioso?: boolean;
  /**
   * Etiqueta del release. Es UNA para todo el catalogo, no una por modulo: el
   * cliente descarga `latest.json`, ve la etiqueta y descarga desde ahi. Si
   * cada modulo tuviera su propio tag, un cliente tendria que resolver una
   * combinacion de versiones sin ningun criterio para elegir entre ellas.
   */
  etiqueta?: string;
};

/**
 * Etiqueta por defecto del release.
 *
 * Es la version del CATALOGO, no la de ningun modulo: dice que este conjunto
 * de modulos es coherente entre si. Es lo que hace que `latest.json` tenga
 * sentido como puntero flotante.
 */
export const ETIQUETA_POR_DEFECTO = "v0.1.0";

export type ResultadoGlobal = {
  modulos: {
    id: string;
    ruta: string;
    sha256: string;
    contentHash: string;
    versiculos: number;
    defectos: number;
    advertencias: string[];
  }[];
  catalogo: Catalogo;
  problemas: string[];
};

/** Ficheros USFM de una fuente. */
function fuentesDe(dir: string, prefijo: string): string[] {
  if (!existsSync(dir)) {
    throw new Error(`no existe el directorio de fuentes: ${dir}`);
  }
  const encontrados = readdirSync(dir).filter((f) => f.endsWith(".usfm")).sort();
  if (encontrados.length === 0) {
    throw new Error(`no hay ficheros .usfm en ${dir}`);
  }
  return encontrados.map((f) => join(dir, f));
}

function infoDe(d: DeclaracionModulo): InfoDeclarada {
  return {
    id: d.id,
    type: d.type,
    name: d.name,
    language: d.language,
    license: d.license,
    license_evidence: d.license_evidence,
    copyright: d.copyright,
    attribution: d.attribution,
    versification: d.versification,
    source: d.source,
    origin: d.origin,
  };
}

/**
 * Construye un modulo.
 *
 * El subdirectorio de la fuente se decide por el NOMBRE, no por el `id`: los
 * ficheros de KJV se llaman `NN-BOOKeng-kjv2006.usfm` y los de Clarke
 * `BOOK.usfm`. Se distinguen porque viven en directorios distintos, que es
 * donde se separan de verdad.
 */
async function construirUno(
  d: DeclaracionModulo,
  raiz: string,
  destino: string,
  opciones: OpcionesBuild,
): Promise<ResultadoBuild> {
  const dirFuente = join(raiz, "modules", "source", d.fuente);
  const rutas = fuentesDe(dirFuente, d.fuente);
  const salida = join(destino, nombreDeFichero(d.id, d.type));
  const fuentes = rutas.map((ruta) => ({ ruta }));

  if (d.type === "bible") {
    return construirBiblia(fuentes, infoDe(d), salida, opciones);
  }
  return construirComentario(fuentes, infoDe(d), salida, opciones);
}

/**
 * Construye el catalogo entero.
 *
 * Devuelve tambien la lista de problemas en vez de lanzar, para que quien
 * llama pueda reportarlos todos juntos. Un modulo que falla no impide que se
 * reporte el siguiente.
 */
export async function construirTodo(opciones: OpcionesConstruir = {}): Promise<ResultadoGlobal> {
  const raiz = opciones.raiz ?? process.cwd();
  const destino = opciones.destino ?? join(raiz, "modules", "build");
  mkdirSync(destino, { recursive: true });

  const etiqueta = opciones.etiqueta ?? ETIQUETA_POR_DEFECTO;
  const problemas: string[] = [];
  const modulos: ResultadoGlobal["modulos"] = [];

  for (const d of MODULOS) {
    if (!opciones.silencioso) {
      console.log(`\n== ${d.id} (${d.type}) ==`);
      console.log(`   fuente: modules/source/${d.fuente}`);
      console.log(`   licencia: ${d.license}`);
    }
    try {
      const r = await construirUno(d, raiz, destino, {
        allowDefects: opciones.allowDefects,
      });
      const advertenciaDefectos =
        r.defectos.length > 0 ? `DEFECTOS: ${r.defectos.length}` : "defectos: 0";
      if (!opciones.silencioso) {
        console.log(`   ${nombreDeFichero(d.id, d.type)}`);
        console.log(`   notas/versiculos: ${r.versiculos} | ${advertenciaDefectos}`);
        console.log(`   sha256:        ${r.amod.sha256}`);
        console.log(`   contentHash:   ${r.amod.contentHash}`);
        console.log(`   bytes:         ${r.amod.bytes}`);
        for (const a of r.advertencias.slice(0, 6)) console.log(`   aviso: ${a}`);
        if (r.advertencias.length > 6) {
          console.log(`   aviso: (+${r.advertencias.length - 6} mas)`);
        }
      }
      modulos.push({
        id: d.id,
        ruta: r.amod.ruta,
        sha256: r.amod.sha256,
        contentHash: r.amod.contentHash,
        versiculos: r.versiculos,
        defectos: r.defectos.length,
        advertencias: r.advertencias,
      });
    } catch (e) {
      const mensaje = (e as Error).message;
      problemas.push(`${d.id}: ${mensaje}`);
      if (!opciones.silencioso) console.log(`   FALLA: ${mensaje}`);
    }
  }

  // El catalogo solo incluye lo que se construyo con exito. Declarar en el
  // catalogo un artefacto ausente seria peor que no declararlo.
  const entradas: EntradaCatalogo[] = [];
  for (const m of modulos) {
    const d = declaracion(m.id);
    const nombre = nombreDeFichero(m.id, d.type);
    entradas.push({
      id: m.id,
      type: d.type,
      name: d.name,
      language: d.language,
      license: d.license,
      license_evidence: d.license_evidence,
      version: d.version,
      schemaVersion: Number(SCHEMA_VERSION),
      minReaderVersion: MIN_READER_VERSION,
      sizeBytes: statSync(m.ruta).size,
      sha256: m.sha256,
      // La etiqueta del release es del CATALOGO, no del modulo: el cliente
      // baja `latest.json` y descarga todo desde ahi. Usar `d.version`
      // produciria una URL que el release no tiene.
      downloadUrl: `${ORIGEN}/${etiqueta}/${nombre}`,
      // Ruta RELATIVA a la raiz del repositorio. Una absoluta haria que el
      // mismo catalogo fuese valido en una maquina y no en otra.
      path: relative(raiz, m.ruta),
    });
  }

  const catalogo: Catalogo = {
    format: FORMATO_CATALOGO,
    version: etiqueta,
    modules: entradas,
  };

  return { modulos, catalogo, problemas };
}

/** Escribe `catalog.json` y su `latest.json`. */
export async function escribirCatalogo(
  destino: string,
  resultado: ResultadoGlobal,
  etiqueta: string,
): Promise<{ catalogo: string; sha256: string }> {
  const cuerpo = JSON.stringify(resultado.catalogo, null, 2) + "\n";
  const rutaCatalogo = join(destino, "catalog.json");
  writeFileSync(rutaCatalogo, cuerpo, "utf8");

  const sha256 = await sha256DeFichero(rutaCatalogo);
  const latest = {
    tag: etiqueta,
    url: `${ORIGEN}/${etiqueta}/catalog.json`,
    catalogSha256: sha256,
  };
  writeFileSync(join(destino, "latest.json"), JSON.stringify(latest, null, 2) + "\n", "utf8");
  return { catalogo: rutaCatalogo, sha256 };
}