#!/usr/bin/env bun
/**
 * Comprueba que el build es REPRODUCIBLE, construyendolo dos veces.
 *
 * Por que esto es un script y no un test: necesita construir 80 MB de modulos
 * dos veces, y eso son minutos. Como test se ejecutaria siempre; como paso de
 * CI se ejecuta cuando importa, que es justo antes de publicar.
 *
 * El criterio es el `sha256` del FICHERO, no el `contentHash`. El `contentHash`
 * mide el contenido logico y coincide siempre por construccion; el `sha256` es
 * lo que un cliente verifica al descargar. Si cambia entre dos builds del
 * mismo input, el cliente no puede saber si lo que tiene es lo que se publico,
 * y el catalogo entero pierde su garantia.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirTodo, escribirCatalogo } from "../src/construirCatalogo.ts";

const raiz = process.cwd();
const ETIQUETA = "repro";

type Huellas = Record<string, string>;

/** Construye el catalogo en `dir` y devuelve la huella de cada artefacto. */
async function huellasDe(dir: string): Promise<Huellas> {
  const r = await construirTodo({ raiz, destino: dir, silencioso: true, etiqueta: ETIQUETA });
  if (r.problemas.length > 0) {
    throw new Error(`build con problemas:\n  ${r.problemas.join("\n  ")}`);
  }
  // construirTodo deja los .amod; el catalogo lo escribe escribirCatalogo.
  // Los dos hacen falta para comparar: comparar solo los modulos dejaria
  // pasar un catalogo que cambia entre builds.
  await escribirCatalogo(dir, r, ETIQUETA);

  const salida: Huellas = {};
  for (const m of r.modulos) {
    if (!existsSync(m.ruta)) {
      throw new Error(`el build declaro ${m.id} pero no escribio ${m.ruta}`);
    }
    salida[`${m.id}.sha256`] = m.sha256;
    salida[`${m.id}.contentHash`] = m.contentHash;
  }
  salida["catalog.json"] = readFileSync(join(dir, "catalog.json"), "utf8");
  salida["latest.json"] = readFileSync(join(dir, "latest.json"), "utf8");
  return salida;
}

const temporal = mkdtempSync(join(tmpdir(), "repro-"));

try {
  // Se construye DOS VECES EN EL MISMO DIRECTORIO, no en dos directorios.
  //
  // `catalog.json` lleva la ruta de cada artefacto RELATIVA a la raiz del
  // repositorio, porque una ruta absoluta haria que el mismo catalogo solo
  // fuese valido en la maquina donde se construyo. Comparar dos
  // construcciones en directorios distintos compararia esas rutas y fallaria
  // por un motivo que no es un problema.
  //
  // Reconstruir en el mismo sitio es ademas el caso real: es lo que pasa en CI
  // y lo que pasa cuando alguien vuelve a construir sin limpiar. Asi que
  // comprueba las dos cosas de una vez.
  const destino = join(temporal, "build");

  console.log("primera construccion...");
  const a = await huellasDe(destino);

  console.log("segunda construccion, sobre los artefactos existentes...");
  const b = await huellasDe(destino);

  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  let diferencias = 0;
  for (const k of claves) {
    if (a[k] !== b[k]) {
      console.error(`DIFERENTE ${k}`);
      if (k.endsWith(".json")) {
        console.error(`  (${k.length} caracteres; distinto entre builds)`);
      } else {
        console.error(`  a: ${a[k]}`);
        console.error(`  b: ${b[k]}`);
      }
      diferencias++;
    }
  }

  if (diferencias > 0) {
    console.error(
      `\n${diferencias} artefacto(s) no reproducibles. No se puede publicar: un ` +
        `cliente no sabria si lo que tiene es lo que se publico.`,
    );
    process.exit(1);
  }

  const modulos = claves.filter((k) => k.endsWith(".sha256")).length;
  console.log(
    `\n${modulos} modulo(s) reproducibles byte a byte; catalog.json y latest.json identicos.`,
  );
} finally {
  rmSync(temporal, { recursive: true, force: true });
}