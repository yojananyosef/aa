#!/usr/bin/env bun
/**
 * Prueba negativa del gate, en un proceso aparte.
 *
 * Construye un modulo con una licencia PROTEGIDA y comprueba que TODAS las
 * capas lo paran: la escritura, el gate de lectura, y la validacion del
 * catalogo. Sale con codigo distinto de cero si alguna no lo hace.
 *
 * Por que un script y no un test: en CI esto corre como job separado, y su
 * objeto es demostrar que el gate RECHAZA, no comprobar una funcion. Si
 * estuviera dentro de `bun test`, un fallo aqui solo se veria cuando todo lo
 * demas pasa, que es el escenario en el que este script mas importa.
 *
 * La licencia usada es la de la Reina-Valera Gomez: "Copyright 2004-2023
 * Humberto Gomez Caballero". Es el caso de referencia, porque es una
 * "Reina-Valera" mas, igual que la de 1909, y por eso es el que un gate
 * ligero dejaria pasar.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirBiblia } from "../src/build.ts";
import { escribirAmf, ESQUEMA_BIBLIA, leerInfo } from "../src/amf.ts";
import { validarCatalogo, type Catalogo } from "../src/catalog.ts";
import type { InfoDeclarada } from "../src/build.ts";
import type { Fila } from "../src/contentHash.ts";

const LICENCIA_PROTEGIDA = "Copyright 2004-2023 Humberto Gomez Caballero";

const temporal = mkdtempSync(join(tmpdir(), "rechazo-"));
let fallos = 0;

function comprobar(nombre: string, condicion: boolean, detalle = ""): void {
  if (condicion) {
    console.log(`  OK    ${nombre}`);
  } else {
    console.error(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ""}`);
    fallos++;
  }
}

try {
  console.log(`probando que el gate rechaza: "${LICENCIA_PROTEGIDA}"\n`);

  // --- 1. La escritura se niega a crear el modulo ---
  console.log("1. escribirAmf");
  const salida = join(temporal, "RVRG_bible.amod");
  const filas: Fila[] = [{ clave: ["Genesis", 1, 1], celdas: ["texto", "\\v 1 texto"] }];
  const info: InfoDeclarada = {
    schema_version: "3",
    id: "RVRG",
    type: "bible",
    name: "Reina-Valera Gomez",
    language: "spa",
    license: LICENCIA_PROTEGIDA,
    license_evidence: "https://example.org/copr.htm",
    copyright: "Copyright 2004-2023 Humberto Gomez Caballero",
    attribution: "Humberto Gomez Caballero",
    versification: "KJV",
    source: "https://example.org/rvrg.usfm",
    origin: "https://example.org",
  };

  let falloAlEscribir = false;
  let mensaje = "";
  try {
    await escribirAmf(salida, {
      nombre: "RVRG_bible",
      tipo: "bible",
      esquema: ESQUEMA_BIBLIA,
      info,
      contenido: [{ tabla: "verses", filas }],
    });
  } catch (e) {
    falloAlEscribir = true;
    mensaje = (e as Error).message;
  }
  comprobar("se niega a escribir el modulo", falloAlEscribir);
  comprobar("el fallo nombra el campo license", /\[license\]/.test(mensaje), mensaje.slice(0, 80));
  comprobar("no queda ningun fichero en disco", !existsSync(salida));

  // --- 2. El build completo tambiene falla ---
  console.log("\n2. construirBiblia");
  const fuente = join(temporal, "rvrg.usfm");
  writeFileSync(
    fuente,
    "\\id GEN KJV\n\\c 1\n\\v 1 En el principio creo Dios los cielos y la tierra.\n",
    "utf8",
  );
  let falloBuild = false;
  try {
    await construirBiblia([{ ruta: fuente }], info, join(temporal, "otro.amod"));
  } catch (e) {
    falloBuild = /gate de licencia/.test((e as Error).message);
  }
  comprobar("el build falla por el gate", falloBuild);

  // --- 3. Si alguien lo publica a mano, la lectura lo detecta ---
  // Sin esto, el gate solo impediria construir: un .amod descargado de otro
  // sitio, o editado, pasaria sin revision.
  console.log("\n3. leerInfo sobre un modulo publicado a mano");
  const publicado = join(temporal, "publicado.amod");
  const { Database } = await import("bun:sqlite");
  const db = new Database(publicado, { create: true });
  db.run("CREATE TABLE info (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID");
  db.run(
    "CREATE TABLE verses (book TEXT, chapter INTEGER, verse INTEGER, text TEXT, raw TEXT, PRIMARY KEY (book,chapter,verse)) WITHOUT ROWID",
  );
  const ins = db.prepare("INSERT INTO info (key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries(info)) ins.run(k, v);
  db.prepare("INSERT INTO verses VALUES (?,?,?,?,?)").run(
    "Genesis",
    1,
    1,
    "texto",
    "\\v 1 texto",
  );
  db.close();

  const { veredicto } = leerInfo(publicado);
  comprobar("leerInfo lo marca como no apto", !veredicto.ok);
  comprobar("la licencia leida es la protegida", leerInfo(publicado).info.license === LICENCIA_PROTEGIDA);

  // --- 4. Y la validacion del catalogo tambien ---
  console.log("\n4. validarCatalogo");
  const { statSync } = await import("node:fs");
  const catalogo: Catalogo = {
    format: "aa-catalog/1",
    version: "v0.0.1",
    modules: [
      {
        id: "RVRG",
        type: "bible",
        name: "Reina-Valera Gomez",
        language: "spa",
        license: LICENCIA_PROTEGIDA,
        license_evidence: "https://example.org/copr.htm",
        version: "2004",
        schemaVersion: 3,
        minReaderVersion: 1,
        sizeBytes: statSync(publicado).size,
        sha256: "0".repeat(64),
        downloadUrl: "https://example.org/RVRG_bible.amod",
        path: publicado,
      },
    ],
  };
  const validacion = await validarCatalogo(catalogo, temporal);
  comprobar("el catalogo se declara invalido", !validacion.ok);
  comprobar(
    "el problema se reporta con clase identificable",
    validacion.problemas.every((p) => typeof p.clase === "string" && p.clase.length > 0),
  );

  // --- 5. Y el dominio publico SI pasa, o el gate no serviria para nada ---
  console.log("\n5. control: un modulo de dominio publico SI pasa");
  const bueno = join(temporal, "KJV2006_bible.amod");
  const r = await escribirAmf(bueno, {
    nombre: "KJV2006_bible",
    tipo: "bible",
    esquema: ESQUEMA_BIBLIA,
    info: { ...info, id: "KJV2006", license: "PublicDomain", copyright: "Dominio publico" },
    contenido: [{ tabla: "verses", filas }],
  });
  comprobar("se escribe sin problema", existsSync(bueno));
  comprobar("leerInfo lo aprueba", leerInfo(bueno).veredicto.ok);
  comprobar("devuelve hash", r.sha256.length === 64);

  console.log("");
  if (fallos > 0) {
    console.error(`RECHAZO INCOMPLETO: ${fallos} comprobacion(es) fallaron.`);
    console.error("El gate deja pasar algo que deberia rechazar. NO se publica.");
    process.exit(1);
  }
  console.log("El gate rechaza lo protegido y acepta lo libre. Comprobacion correcta.");
} finally {
  rmSync(temporal, { recursive: true, force: true });
}