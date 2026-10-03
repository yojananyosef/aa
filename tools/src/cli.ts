#!/usr/bin/env bun
/**
 * Linea de ordenes del catalogo.
 *
 * Por que existe: construir el catalogo son cuatro pasos (build, gate,
 * validate, bundle) y el orden importa. Pedirlos de memoria en un orden
 * equivocado produce un catalogo que parece valido y no lo es. Ademas, quien
 * llegue al repositorio sin saber Bun tendra que ejecutar ALGO, y ese algo
 * tiene que tener un `--help` que le diga que.
 *
 * Uso:
 *   bun run tools/src/cli.ts <orden> [opciones]
 *
 *   build       construye los modulos y escribe catalog.json
 *   validate    comprueba el catalogo contra disco
 *   gate        tests + integridad + licencias. Sale != 0 si algo falla
 *   bundle      empaqueta los modulos construidos
 *   info        muestra el estado del catalogo
 *
 * Opciones comunes:
 *   --allow-defects   construye aunque la fuente tenga versiculos sin texto
 *   --destino <dir>   donde escribir (por defecto modules/build)
 *   --tag <etiqueta>  etiqueta del release (por defecto v0.1.0)
 *   --json            salida en JSON, para consumidores
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { construirTodo, escribirCatalogo, ETIQUETA_POR_DEFECTO } from "./construirCatalogo.ts";
import { abrirBundle } from "./bundle.ts";
import { empaquetar, type ModuloParaBundle } from "./bundle.ts";
import { evaluar, formatear } from "./gate.ts";
import { leerCatalogo, leerLatest, validarCatalogo } from "./catalog.ts";
import { leerInfo } from "./amf.ts";
import { sha256DeFichero } from "./hash.ts";

const AYUDA = `Catalogo de recursos biblicos de dominio publico.

Ordenes:
  build       Construye los modulos declarados y escribe catalog.json
  validate    Comprueba el catalogo contra los artefactos de disco
  gate        Ejecuta tests, integridad y licencias. Sale != 0 si falla
  bundle      Empaqueta los modulos construidos en un .bundle
  info        Muestra el estado del catalogo

Opciones:
  --allow-defects   Permite construir con versiculos vacios en la fuente
  --destino <dir>   Directorio de salida (por defecto modules/build)
  --tag <etiqueta>  Etiqueta del release (por defecto ${ETIQUETA_POR_DEFECTO})
  --json            Salida en JSON
  -h, --help        Esta ayuda

Ejemplos:
  bun run tools/src/cli.ts build
  bun run tools/src/cli.ts gate
  bun run tools/src/cli.ts info --json
`;

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tiene = (nombre: string) => process.argv.includes(`--${nombre}`);
const raiz = process.cwd();
const destino = opcion("destino") ?? join(raiz, "modules", "build");
const etiqueta = opcion("tag") ?? ETIQUETA_POR_DEFECTO;
const comoJson = tiene("json");

async function ordenBuild(): Promise<number> {
  const r = await construirTodo({
    raiz,
    destino,
    allowDefects: tiene("allow-defects"),
    silencioso: comoJson,
    etiqueta,
  });

  if (r.problemas.length > 0) {
    for (const p of r.problemas) console.error(`FALLA ${p}`);
    console.error(`\n${r.problemas.length} modulo(s) sin construir.`);
    return 1;
  }

  const escrito = await escribirCatalogo(destino, r, etiqueta);
  if (!comoJson) {
    console.log(`\ncatalog.json: ${escrito.catalogo}`);
    console.log(`sha256:       ${escrito.sha256}`);
  } else {
    console.log(
      JSON.stringify(
        {
          catalogo: escrito.catalogo,
          catalogSha256: escrito.sha256,
          modulos: r.modulos,
        },
        null,
        2,
      ),
    );
  }
  return 0;
}

async function ordenValidate(): Promise<number> {
  const rutaCatalogo = join(destino, "catalog.json");
  if (!existsSync(rutaCatalogo)) {
    console.error(`no existe ${rutaCatalogo}; ejecuta antes: bun run build`);
    return 1;
  }

  const catalogo = leerCatalogo(rutaCatalogo);
  const resultado = await validarCatalogo(catalogo, raiz);

  const rutaLatest = join(destino, "latest.json");
  if (existsSync(rutaLatest)) {
    const latest = leerLatest(rutaLatest);
    if (!latest.tag) {
      console.error("latest.json no declara etiqueta");
      return 1;
    }
    const sha = await sha256DeFichero(rutaCatalogo);
    if (latest.catalogSha256 && latest.catalogSha256 !== sha) {
      console.error(
        `latest.json declara catalogSha256 ${latest.catalogSha256} pero el ` +
          `catalogo actual es ${sha}: el puntero flotante no apunta a este catalogo.`,
      );
      return 1;
    }
  } else {
    console.error("falta latest.json: sin el, un cliente no sabe que catalogo es el actual");
    return 1;
  }

  if (comoJson) {
    console.log(JSON.stringify(resultado, null, 2));
  } else {
    for (const m of catalogo.modules) {
      console.log(`${m.id.padEnd(12)} ${m.type.padEnd(11)} ${m.sha256.slice(0, 16)}...`);
    }
  }

  if (!resultado.ok) {
    for (const p of resultado.problemas) {
      console.error(`FALLA ${JSON.stringify(p)}`);
    }
    return 1;
  }
  if (!comoJson) console.log(`\n${catalogo.modules.length} modulo(s) validos.`);
  return 0;
}

/**
 * El gate: la unica orden que tiene que pasar siempre.
 *
 * Tres comprobaciones independientes, y las tres tienen que estar verdes:
 * los tests (que incluyen los negativos), la integridad de los artefactos, y
 * las licencias. Anyadir una cuarta aqui es un cambio de OpenSpec.
 */
async function ordenGate(): Promise<number> {
  const problemas: string[] = [];

  console.log("1/3 tests");
  const tests = Bun.spawnSync(["bun", "test"], { cwd: raiz, stdout: "pipe", stderr: "pipe" });
  const salidaTests = tests.stdout.toString() + tests.stderr.toString();
  const resumen = /(\d+) pass.*?\n.*?(\d+) fail/.exec(salidaTests);
  const lineaResumen = /Ran (\d+) tests across (\d+) files/.exec(salidaTests);
  if (tests.exitCode !== 0) {
    problemas.push("los tests fallan");
    const fallas = salidaTests.split("\n").filter((l) => l.startsWith("(fail)"));
    for (const f of fallas.slice(0, 20)) console.error(`  ${f}`);
    if (fallas.length > 20) console.error(`  (+${fallas.length - 20} mas)`);
  } else if (lineaResumen) {
    console.log(`     ${lineaResumen[1]} tests en ${lineaResumen[2]} ficheros`);
  }
  void resumen;

  console.log("2/3 integridad y licencias de los modulos construidos");
  const rutaCatalogo = join(destino, "catalog.json");
  if (!existsSync(rutaCatalogo)) {
    problemas.push(`no existe ${rutaCatalogo}: ejecuta antes \`bun run build\``);
  } else {
    const catalogo = leerCatalogo(rutaCatalogo);
    const validacion = await validarCatalogo(catalogo, raiz);
    if (!validacion.ok) {
      problemas.push(`${validacion.problemas.length} problema(s) de integridad`);
      for (const p of validacion.problemas.slice(0, 20)) {
        console.error(`  ${JSON.stringify(p)}`);
      }
    }
    for (const m of catalogo.modules) {
      const ruta = m.path ?? join(destino, `${m.id}_${m.type}.amod`);
      if (!existsSync(ruta)) {
        problemas.push(`modulo ausente en disco: ${m.id}`);
        continue;
      }
      const { info, veredicto } = leerInfo(ruta);
      console.log(`     ${formatear(m.id, veredicto)}`);
      if (!veredicto.ok) problemas.push(`licencia de ${m.id} rechazada`);
      if (info.content_hash) {
        console.log(`     ${"".padEnd(12)} contentHash ${info.content_hash.slice(0, 16)}...`);
      }
      if (Number(info.defects_count ?? "0") > 0) {
        console.log(`     ${"".padEnd(12)} ${info.defects_count} defecto(s) de la fuente`);
      }
    }
  }

  console.log("3/3 ninguna tabla guarda fecha ni hora");
  if (existsSync(destino)) {
    for (const f of readdirSync(destino).filter((x) => x.endsWith(".amod"))) {
      const db = new Database(join(destino, f), { readonly: true });
      for (const t of db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]) {
        for (const c of db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]) {
          if (/date|time|created|built|timestamp|fecha|hora/i.test(c.name)) {
            problemas.push(`${f}: ${t.name}.${c.name} parece un timestamp`);
          }
        }
      }
      db.close();
    }
    console.log(`     ${readdirSync(destino).filter((x) => x.endsWith(".amod")).length} modulo(s) sin timestamps`);
  }

  if (problemas.length > 0) {
    console.error(`\nGATE FALLIDO (${problemas.length}):`);
    for (const p of problemas) console.error(`  - ${p}`);
    return 1;
  }
  console.log("\nGATE OK");
  return 0;
}

async function ordenBundle(): Promise<number> {
  const rutaCatalogo = join(destino, "catalog.json");
  if (!existsSync(rutaCatalogo)) {
    console.error(`no existe ${rutaCatalogo}; ejecuta antes: bun run build`);
    return 1;
  }
  const catalogo = leerCatalogo(rutaCatalogo);
  const modulos: ModuloParaBundle[] = [];

  for (const m of catalogo.modules) {
    const ruta = m.path ?? join(destino, `${m.id}_${m.type}.amod`);
    const { info } = leerInfo(ruta);
    modulos.push({
      id: m.id,
      type: m.type,
      name: m.name,
      language: m.language,
      sha256: m.sha256,
      contentHash: info.content_hash ?? "",
      defects_count: Number(info.defects_count ?? "0"),
      ruta,
    });
  }

  const salida = join(destino, `${etiqueta}.bundle`);
  const r = empaquetar(modulos, salida);

  // Se abre lo que se acaba de escribir: un bundle que no se puede abrir es
  // peor que no empaquetar, porque parece que se publico.
  const abierto = abrirBundle(salida);

  if (!comoJson) {
    console.log(`bundle: ${salida}`);
    console.log(`  modulos:  ${r.modulos}`);
    console.log(`  bytes:    ${r.bytes} (sin comprimir: ${r.bytesSinComprimir})`);
    console.log(`  ratio:    ${(r.bytesSinComprimir / r.bytes).toFixed(2)}x`);
    console.log(`  sha256:   ${r.sha256}`);
    console.log(`  verificado al abrir: ${abierto.modulos.size} modulo(s)`);
  } else {
    console.log(JSON.stringify({ ...r, verificados: abierto.modulos.size }, null, 2));
  }
  return 0;
}

function ordenInfo(): Promise<number> {
  const rutaCatalogo = join(destino, "catalog.json");
  if (!existsSync(rutaCatalogo)) {
    console.error(`no existe ${rutaCatalogo}; ejecuta antes: bun run build`);
    return Promise.resolve(1);
  }
  const catalogo = leerCatalogo(rutaCatalogo);
  const modulos = catalogo.modules.map((m) => {
    const ruta = m.path ?? join(destino, `${m.id}_${m.type}.amod`);
    const existe = existsSync(ruta);
    let info: Record<string, string> = {};
    let notas = 0;
    if (existe) {
      const leido = leerInfo(ruta);
      info = leido.info;
      const db = new Database(ruta, { readonly: true });
      const tabla = m.type === "bible" ? "verses" : "commentary";
      const n = db.prepare(`SELECT count(*) n FROM ${tabla}`).all() as { n: number }[];
      notas = n[0]?.n ?? 0;
      db.close();
    }
    return {
      id: m.id,
      type: m.type,
      nombre: m.name,
      idioma: m.language,
      licencia: m.license,
      version: m.version,
      bytes: m.sizeBytes,
      entradas: notas,
      defectos: Number(info.defects_count ?? "0"),
      enDisco: existe,
      sha256: m.sha256,
      contentHash: info.content_hash ?? null,
    };
  });

  if (comoJson) {
    console.log(JSON.stringify({ catalogo: catalogo.version, modulos }, null, 2));
    return Promise.resolve(0);
  }

  console.log(`catalogo ${catalogo.version}\n`);
  for (const m of modulos) {
    console.log(`${m.id} (${m.type}, ${m.idioma})`);
    console.log(`  ${m.nombre}`);
    console.log(`  licencia: ${m.licencia}   version: ${m.version}`);
    console.log(`  entradas: ${m.entradas}   defectos de la fuente: ${m.defectos}`);
    console.log(`  bytes:    ${m.bytes}   en disco: ${m.enDisco ? "si" : "NO"}`);
    console.log(`  sha256:      ${m.sha256}`);
    console.log(`  contentHash: ${m.contentHash ?? "?"}`);
    console.log("");
  }
  const ausente = modulos.filter((m) => !m.enDisco);
  return Promise.resolve(ausente.length === 0 ? 0 : 1);
}

const ORDENES: Record<string, () => Promise<number>> = {
  build: ordenBuild,
  validate: ordenValidate,
  gate: ordenGate,
  bundle: ordenBundle,
  info: ordenInfo,
};

const orden = process.argv[2];

if (!orden || orden === "-h" || orden === "--help" || orden === "help") {
  console.log(AYUDA);
  process.exit(orden ? 0 : 1);
}

const fn = ORDENES[orden];
if (!fn) {
  console.error(`orden desconocida: "${orden}"`);
  console.error(`disponibles: ${Object.keys(ORDENES).join(", ")}`);
  process.exit(1);
}

process.exit(await fn());