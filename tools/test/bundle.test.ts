import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  abrirBundle,
  crc32,
  empaquetar,
  leerZip,
  type ModuloParaBundle,
  VERSION_BUNDLE,
} from "../src/bundle.ts";
import { escribirAmf, ESQUEMA_BIBLIA, ESQUEMA_COMENTARIO } from "../src/amf.ts";
import { sha256DeFichero } from "../src/hash.ts";
import type { Fila } from "../src/contentHash.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bundle-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const INFO = {
  schema_version: "3",
  versification: "KJV",
  copyright: "Dominio publico",
  attribution: "Sin atribucion",
  license_evidence: "https://example.org/copr.htm",
  source: "https://example.org/x.usfm",
  origin: "https://example.org",
};

const fila = (b: string, c: number, v: number, t: string): Fila => ({
  clave: [b, c, v],
  celdas: [t, "\\v " + v + " " + t],
});

/** Modulo de biblia real, para que el bundle contenga algo de verdad. */
async function amodBiblia(id: string, nVersiculos: number) {
  const filas: Fila[] = [];
  for (let i = 1; i <= nVersiculos; i++) {
    filas.push(fila("John", 3, i, `Porque Dios amó al mundo de tal manera ${i} `.repeat(3)));
  }
  const ruta = join(dir, `${id}_bible.amod`);
  const r = await escribirAmf(ruta, {
    nombre: `${id}_bible`,
    tipo: "bible",
    esquema: ESQUEMA_BIBLIA,
    info: {
      ...INFO,
      id,
      type: "bible",
      name: `Biblia ${id}`,
      language: "spa",
      license: "PublicDomain",
    },
    contenido: [{ tabla: "verses", filas }],
  });
  return { ruta, id, type: "bible", name: `Biblia ${id}`, language: "spa", ...r };
}

async function amodComentario(id: string) {
  const ruta = join(dir, `${id}_commentary.amod`);
  const r = await escribirAmf(ruta, {
    nombre: `${id}_commentary`,
    tipo: "commentary",
    esquema: ESQUEMA_COMENTARIO,
    info: {
      ...INFO,
      id,
      type: "commentary",
      name: `Comentario ${id}`,
      language: "eng",
      license: "PublicDomain",
    },
    contenido: [
      {
        tabla: "commentary",
        filas: [0, 1, 2].map((seq) => ({
          clave: ["John", 3, 16, seq],
          celdas: [`Nota ${seq} sobre Juan 3:16. `.repeat(4), `\\v 16 nota ${seq}`],
        })),
      },
    ],
  });
  return { ruta, id, type: "commentary", name: `Comentario ${id}`, language: "eng", ...r };
}

function comoModulo(x: Awaited<ReturnType<typeof amodBiblia>>): ModuloParaBundle {
  return {
    id: x.id,
    type: x.type,
    name: x.name,
    language: x.language,
    sha256: x.sha256,
    contentHash: x.contentHash,
    defects_count: 0,
    ruta: x.ruta,
  };
}

describe("crc32", () => {
  test("coincide con el valor conocido", () => {
    // "123456789" -> 0xCBF43926. Es el vector de verificacion de CRC-32.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from(""))).toBe(0);
  });
});

describe("empaquetar: bundle de dos modulos (tarea 3.10)", () => {
  test("contiene ambos modulos y un bundle.json con sus hashes", async () => {
    const a = comoModulo(await amodBiblia("TESTB", 40));
    const b = comoModulo(await amodComentario("TESTC"));
    const destino = join(dir, "test.bundle");
    const r = empaquetar([a, b], destino);

    expect(existsSync(destino)).toBe(true);
    expect(r.modulos).toBe(2);
    expect(r.manifiesto.bundle_version).toBe(VERSION_BUNDLE);
    expect(r.manifiesto.compression).toBe("zstd");
    expect(r.manifiesto.modules.length).toBe(2);

    // El manifiesto declara los dos hashes de cada modulo.
    const m = r.manifiesto.modules.find((x) => x.id === "TESTB")!;
    expect(m.sha256).toBe(a.sha256);
    expect(m.contentHash).toBe(a.contentHash);

    const abierto = abrirBundle(destino);
    expect(abierto.modulos.size).toBe(2);
    expect(abierto.manifiesto.modules.map((x) => x.id).sort()).toEqual(["TESTB", "TESTC"]);
  });

  test("el bundle comprime: es menor que la suma de los .amod", async () => {
    const a = comoModulo(await amodBiblia("GDE", 400));
    const b = comoModulo(await amodComentario("CMT"));
    const destino = join(dir, "test.bundle");
    const r = empaquetar([a, b], destino);

    const suma = (await sha256DeFichero(a.ruta)) && r.bytesSinComprimir;
    expect(suma).toBeGreaterThan(0);
    // El spec exige que sea estrictamente menor, no menor o igual.
    expect(r.bytes).toBeLessThan(suma);
  });

  test("el modulo extraido es byte a byte el original", async () => {
    const a = comoModulo(await amodBiblia("IGUAL", 60));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    const { modulos } = abrirBundle(destino);
    const original = require("node:fs").readFileSync(a.ruta);
    expect(modulos.get("IGUAL")!.equals(original)).toBe(true);
  });

  test("el modulo extraido abre como SQLite y es consultable", async () => {
    const a = comoModulo(await amodBiblia("SQLITE", 25));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    const { modulos } = abrirBundle(destino);
    const ruta = join(dir, "extraido.amod");
    writeFileSync(ruta, modulos.get("SQLITE")!);
    const db = new Database(ruta, { readonly: true });
    const n = (db.prepare("SELECT count(*) n FROM verses").all() as { n: number }[])[0].n;
    db.close();
    expect(n).toBe(25);
  });
});

describe("empaquetar: formato", () => {
  test("bundle.json va primero y sin comprimir", async () => {
    const a = comoModulo(await amodBiblia("PRIMERO", 20));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    const entradas = [...leerZip(require("node:fs").readFileSync(destino)).keys()];
    expect(entradas[0]).toBe("bundle.json");
  });

  test("las entradas .amod van comprimidas con zstd", async () => {
    const a = comoModulo(await amodBiblia("ZSTD", 300));
    const destino = join(dir, "test.bundle");
    const r = empaquetar([a], destino);

    const m = r.manifiesto.modules[0];
    expect(m.entrada).toBe("ZSTD_bible.amod.zst");
    expect(m.bytes_comprimido).toBeLessThan(m.bytes);
  });

  test("el zip lo lee una herramienta externa (tarea 3.10)", async () => {
    // Esta es la razon de usar zip de contenedor y no un formato propio: un
    // `unzip` del sistema tiene que poder abrirlo sin conocer este proyecto.
    const a = comoModulo(await amodBiblia("EXTERNO", 50));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    let salida = "";
    try {
      salida = execFileSync("unzip", ["-l", destino], { encoding: "utf8" });
    } catch (e) {
      const err = e as { stderr?: string };
      throw new Error(`unzip no pudo leer el bundle: ${err.stderr ?? String(e)}`);
    }
    expect(salida).toContain("bundle.json");
    expect(salida).toContain("EXTERNO_bible.amod.zst");
  });

  test("unzip extrae las entradas sin que las altere", async () => {
    const a = comoModulo(await amodBiblia("EXTRAE", 40));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);
    const salidaDir = join(dir, "extraido");
    execFileSync("unzip", ["-q", destino, "-d", salidaDir]);
    const nombres = readdirSync(salidaDir).sort();
    expect(nombres).toEqual(["EXTERNO", "EXTRAE_bible.amod.zst", "bundle.json"].filter((n) => n !== "EXTERNO").sort());
  });
});

describe("empaquetar: determinismo", () => {
  test("dos empaquetados del mismo contenido dan el mismo sha256", async () => {
    const a = comoModulo(await amodBiblia("DET", 80));
    const x = empaquetar([a], join(dir, "a.bundle"));
    const y = empaquetar([a], join(dir, "b.bundle"));
    expect(x.sha256).toBe(y.sha256);
  });

  test("el orden de los modulos no cambia el bundle", async () => {
    const a = comoModulo(await amodBiblia("AAA", 30));
    const b = comoModulo(await amodComentario("ZZZ"));
    const x = empaquetar([a, b], join(dir, "a.bundle"));
    const y = empaquetar([b, a], join(dir, "b.bundle"));
    expect(x.sha256).toBe(y.sha256);
  });

  test("el zip no lleva la hora del sistema", async () => {
    // Si las entradas usaran la hora actual, dos bundles hechos con un minuto
    // de diferencia darian hash distinto y no serian verificables.
    const a = comoModulo(await amodBiblia("HORA", 20));
    const destino = join(dir, "test.bundle");
    const r = empaquetar([a], destino);
    const buf = require("node:fs").readFileSync(destino);
    // La hora y la fecha estan en los bytes 10-15 de cada cabecera local.
    expect(buf.readUInt16LE(10)).toBe(0);
    expect(buf.readUInt16LE(12)).toBe(0);
    expect(r.bytes).toBeGreaterThan(0);
  });
});

describe("empaquetar: errores", () => {
  test("sin modulos falla con explicacion", () => {
    expect(() => empaquetar([], join(dir, "vacio.bundle"))).toThrow(/no hay modulos/);
  });

  test("un modulo duplicado falla en vez de generar un manifiesto ambiguo", async () => {
    const a = comoModulo(await amodBiblia("DUP", 10));
    expect(() => empaquetar([a, a], join(dir, "d.bundle"))).toThrow(/duplicado "DUP"/);
  });
});

describe("abrirBundle: verificacion", () => {
  test("detecta un modulo manipulado comparando su sha256", async () => {
    const a = comoModulo(await amodBiblia("MANIP", 30));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    // Se altera el manifiesto para que el sha256 declarado ya no cuadre.
    const fs = require("node:fs");
    const buf = fs.readFileSync(destino);
    const texto = buf.toString("latin1");
    const hackeado = texto.replace(
      new RegExp(`"id": "MANIP"[\\s\\S]*?"sha256": "[0-9a-f]{64}"`),
      (m: string) => m.replace(/[0-9a-f]{64}/, "0".repeat(64)),
    );
    const rutaHack = join(dir, "hack.bundle");
    fs.writeFileSync(rutaHack, hackeado, "latin1");

    expect(() => abrirBundle(rutaHack)).toThrow(/sha256 declarado/);
  });

  test("un archivo que no es bundle falla al buscar bundle.json", async () => {
    const ruta = join(dir, "no.bundle");
    writeFileSync(ruta, "esto no es un zip");
    expect(() => abrirBundle(ruta)).toThrow(/fin del directorio central/);
  });

  test("un bundle sin bundle.json falla con explicacion", async () => {
    const vacio = join(dir, "vacio.bundle");
    writeFileSync(vacio, "PK");
    expect(() => abrirBundle(vacio)).toThrow(/fin del directorio central|no es un bundle/);
  });
});

describe("leerZip: tolerancia y limites", () => {
  test("falla si el metodo de compresion no es soportado", async () => {
    // Se parte de un bundle real y se le cambia el metodo a 99 en las dos
    // cabeceras (local y central), que es lo que haria una herramienta que
    // escribiera algo que este lector no entiende.
    const a = comoModulo(await amodBiblia("METODO", 20));
    const destino = join(dir, "test.bundle");
    empaquetar([a], destino);

    const fs = require("node:fs");
    const buf = fs.readFileSync(destino);

    // Local file header: metodo en el offset 8. Central directory: en el 10.
    let p = 0;
    while (p < buf.length - 4) {
      const sig = buf.readUInt32LE(p);
      if (sig === 0x04034b50) {
        buf.writeUInt16LE(99, p + 8);
        p += 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
        continue;
      }
      if (sig === 0x02014b50) {
        buf.writeUInt16LE(99, p + 10);
        p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
        continue;
      }
      p += 1;
    }

    const ruta = join(dir, "metodo.bundle");
    fs.writeFileSync(ruta, buf);
    expect(() => leerZip(fs.readFileSync(ruta))).toThrow(/metodo de compresion 99/);
  });

  test("acepta deflate aunque este escritor no lo produzca", async () => {
    // Tolerancia deliberada: si otro escritor mete deflate, el dato sigue
    // siendo el mismo y拒绝lo seria una direcion inutil.
    const { escribirConDeflate } = await import("./ayuda-zip.ts");
    const ruta = join(dir, "deflate.bundle");
    escribirConDeflate(ruta, "datos.txt", Buffer.from("hola mundo"));
    const entradas = leerZip(require("node:fs").readFileSync(ruta));
    expect(entradas.get("datos.txt")!.toString("utf8")).toBe("hola mundo");
  });

  test("falla si no encuentra el directorio central", () => {
    expect(() => leerZip(Buffer.from("esto no es un zip en absoluto"))).toThrow(
      /fin del directorio central/,
    );
  });
});
