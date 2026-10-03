import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escribirAmf, ESQUEMA_BIBLIA, leerInfo } from "../src/amf.ts";
import { construirBiblia, ErrorBuild } from "../src/build.ts";
import { formatear } from "../src/gate.ts";
import { validarCatalogo, type Catalogo } from "../src/catalog.ts";
import type { Fila } from "../src/contentHash.ts";
import type { InfoDeclarada } from "../src/build.ts";

/**
 * Tests NEGATIVOS end-to-end.
 *
 * Los tests positivos demuestran que el sistema funciona cuando todo esta
 * bien. No demuestran nada sobre lo que pasa cuando algo esta mal, que es lo
 * unico que importa en un gate: un gate que solo se ha probado con material
 * bueno es una Hypothesis, no una garantia.
 *
 * El escenario de referencia es la Reina-Valera Gomez (sparvg), que esta
 * protegida por copyright (2004-2023, Humberto Gomez Caballero) y se
 * parece a una version libre en todo menos en la licencia. Un gate que la
 * aceptara por parecido de nombre seria inutil.
 */

const INFO_BASE: InfoDeclarada = {
  // escribirAmf se llama directo aqui, sin pasar por construirBiblia, asi que
  // schema_version hay que aportarlo: el build lo anade en otro sitio.
  schema_version: "3",
  id: "PRUEBA",
  type: "bible",
  name: "Modulo de prueba",
  language: "spa",
  license: "PublicDomain",
  license_evidence: "https://example.org/copr.htm",
  copyright: "Dominio publico",
  attribution: "Sin atribucion",
  versification: "KJV",
  source: "https://example.org/x.usfm",
  origin: "https://example.org",
};

const USFM = `\\id GEN KJV
\\c 1
\\v 1 En el principio creo Dios los cielos y la tierra.
\\v 2 Y la tierra estaba desordenada y vacia.
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fuente(nombre = "a.usfm"): string {
  const ruta = join(dir, nombre);
  writeFileSync(ruta, USFM, "utf8");
  return ruta;
}

/** Escribe un `.amod` saltandose la validacion, para simular un modulo ya publicado. */
function amodConLicenciaInvalida(ruta: string, licencia: string): void {
  const db = new Database(ruta, { create: true });
  db.run(
    "CREATE TABLE info (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID",
  );
  db.run("CREATE TABLE verses (book TEXT, chapter INTEGER, verse INTEGER, text TEXT, raw TEXT, PRIMARY KEY (book,chapter,verse)) WITHOUT ROWID");
  const ins = db.prepare("INSERT INTO info (key,value) VALUES (?,?)");
  const insv = db.prepare("INSERT INTO verses VALUES (?,?,?,?,?)");
  for (const [k, v] of Object.entries({ ...INFO_BASE, license: licencia })) ins.run(k, v);
  insv.run("Genesis", 1, 1, "texto", "\\v 1 texto");
  insv.run("Genesis", 1, 2, "mas texto", "\\v 2 mas texto");
  db.close();
}

describe("negativo: una licencia protegida no llega a existir", () => {
  test("escribirAmf se niega a escribir un modulo protegido", async () => {
    const ruta = join(dir, "no.amod");
    const entrada = {
      nombre: "PRUEBA_bible",
      tipo: "bible" as const,
      esquema: ESQUEMA_BIBLIA,
      info: { ...INFO_BASE, license: "Copyright 2004-2023 Humberto Gomez Caballero" },
      contenido: [
        {
          tabla: "verses",
          filas: [
            { clave: ["Genesis", 1, 1], celdas: ["t", "r"] },
            { clave: ["Genesis", 1, 2], celdas: ["t2", "r2"] },
          ] satisfies Fila[],
        },
      ],
    };
    await expect(escribirAmf(ruta, entrada)).rejects.toThrow(/\[license\]/);
    expect(existsSync(ruta)).toBe(false);
  });

  test("un build completo falla si el modulo declara copyright", async () => {
    const info: InfoDeclarada = {
      ...INFO_BASE,
      id: "RVRG",
      license: "Copyright 2004-2023 Humberto Gomez Caballero",
    };
    await expect(
      construirBiblia([{ ruta: fuente() }], info, join(dir, "rvrg.amod")),
    ).rejects.toThrow(/gate de licencia/);
  });

  test("el mensaje del fallo nombra el campo, no solo la licencia", async () => {
    const info: InfoDeclarada = { ...INFO_BASE, license: "Copyrighted" };
    let msg = "";
    try {
      await construirBiblia([{ ruta: fuente() }], info, join(dir, "x.amod"));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("[license]");
    expect(msg).toContain("no es una licencia admitida");
  });

  test("una licencia casi correcta tambien se rechaza", async () => {
    // El fallo tipico de un gate: aceptar "public domain" en minuscula o
    // "PUBLIC DOMAIN" por buena voluntad. Un valor de licencia tiene que ser
    // UN valor, o no se puede comparar.
    for (const mala of [
      "public domain",
      "PUBLIC DOMAIN",
      "Public Domain",
      "Dominio publico",
      "PD",
      "CC-BY-SA-4",
      "CC-BY-SA",
      "Creative Commons BY-SA",
    ]) {
      const info: InfoDeclarada = { ...INFO_BASE, license: mala };
      await expect(
        construirBiblia([{ ruta: fuente(`f-${mala.replace(/\W/g, "")}.usfm`) }], info, join(dir, "x.amod")),
      ).rejects.toThrow(/licencia/i);
    }
  });
});

describe("negativo: un modulo ya publicado con licencia mala se detecta al leerlo", () => {
  test("leerInfo devuelve el veredicto sin lanzar", () => {
    // Importante: un listado de modulos tiene que poder MARCAR los malos, no
    // morir en el primero.
    const ruta = join(dir, "malo.amod");
    amodConLicenciaInvalida(ruta, "Copyright 2004-2023");
    const { info, veredicto } = leerInfo(ruta);
    expect(veredicto.ok).toBe(false);
    expect(info.license).toBe("Copyright 2004-2023");
    expect(formatear("RVRG", veredicto)).toContain("[license]");
  });

  test("el gate falla al validar un catalogo que declara un modulo protegido", async () => {
    const ruta = join(dir, "malo.amod");
    amodConLicenciaInvalida(ruta, "Copyright 2004-2023");
    const bytes = readFileSync(ruta);

    const catalogo: Catalogo = {
      format: "aa-catalog/1",
      version: "v0.0.1",
      modules: [
        {
          id: "RVRG",
          type: "bible",
          name: "Reina-Valera Gomez",
          language: "spa",
          license: "Copyright 2004-2023",
          license_evidence: "https://example.org/copr.htm",
          version: "2004",
          schemaVersion: 3,
          minReaderVersion: 1,
          sizeBytes: bytes.length,
          sha256: "0".repeat(64),
          downloadUrl: "https://example.org/RVRG_bible.amod",
          path: ruta,
        },
      ],
    };

    const r = await validarCatalogo(catalogo, dir);
    expect(r.ok).toBe(false);
    // Debe nombrar el problema de licencia ademas del de integridad.
    const clases = r.problemas.map((p) => p.clase);
    expect(clases).toContain("integridad");
  });

  test("manipular un .amod invalida el sha256 del catalogo", async () => {
    const ruta = join(dir, "mod.amod");
    const filas: Fila[] = [{ clave: ["Genesis", 1, 1], celdas: ["uno", "r"] }];
    const r = await escribirAmf(ruta, {
      nombre: "PRUEBA_bible",
      tipo: "bible",
      esquema: ESQUEMA_BIBLIA,
      info: INFO_BASE,
      contenido: [{ tabla: "verses", filas }],
    });

    const catalogo: Catalogo = {
      format: "aa-catalog/1",
      version: "v0.0.1",
      modules: [
        {
          id: "PRUEBA",
          type: "bible",
          name: "Modulo de prueba",
          language: "spa",
          license: "PublicDomain",
          license_evidence: "https://example.org/copr.htm",
          version: "1",
          schemaVersion: 3,
          minReaderVersion: 1,
          sizeBytes: r.bytes,
          sha256: r.sha256,
          downloadUrl: "https://example.org/x.amod",
          path: ruta,
        },
      ],
    };

    expect((await validarCatalogo(catalogo, dir)).ok).toBe(true);

    // Se altera un versiculo. El sha256 ya no cuadra y el gate tiene que verlo.
    const db = new Database(ruta);
    db.run("UPDATE verses SET text = 'texto alterado' WHERE verse = 1");
    db.close();

    const despues = await validarCatalogo(catalogo, dir);
    expect(despues.ok).toBe(false);
    const p = despues.problemas.find((x) => x.clase === "integridad");
    expect(p).toBeDefined();
    if (p && p.clase === "integridad") expect(p.estado).toBe("invalid");
  });

  test("un modulo ausente en disco se reporta como missing, no como invalid", async () => {
    const catalogo: Catalogo = {
      format: "aa-catalog/1",
      version: "v0.0.1",
      modules: [
        {
          id: "AUSENTE",
          type: "bible",
          name: "No existe",
          language: "spa",
          license: "PublicDomain",
          license_evidence: "https://example.org/copr.htm",
          version: "1",
          schemaVersion: 3,
          minReaderVersion: 1,
          sizeBytes: 100,
          sha256: "a".repeat(64),
          downloadUrl: "https://example.org/x.amod",
          path: join(dir, "no-existe.amod"),
        },
      ],
    };
    const r = await validarCatalogo(catalogo, dir);
    expect(r.ok).toBe(false);
    const p = r.problemas.find((x) => x.clase === "integridad");
    if (p && p.clase === "integridad") expect(p.estado).toBe("missing");
  });
});

describe("negativo: los defectos de la fuente cortan el build", () => {
  const USFM_CON_HUECO = `\\id GEN KJV
\\c 1
\\v 1 En el principio creo Dios los cielos y la tierra.
\\v 2
\\v 3 Y dijo Dios: Sea la luz.
`;

  test("sin --allow-defects el build falla y nombra el versiculo", async () => {
    const ruta = join(dir, "hueco.usfm");
    writeFileSync(ruta, USFM_CON_HUECO, "utf8");
    let err: ErrorBuild | null = null;
    try {
      await construirBiblia([{ ruta }], INFO_BASE, join(dir, "x.amod"));
    } catch (e) {
      err = e as ErrorBuild;
    }
    expect(err).toBeInstanceOf(ErrorBuild);
    expect(err!.defectos.length).toBe(1);
    expect(err!.defectos[0]).toMatchObject({ libro: "Genesis", chapter: 1, verse: 2 });
  });

  test("con --allow-defects construye, graba el defecto y NO rellena el versiculo", async () => {
    const ruta = join(dir, "hueco.usfm");
    writeFileSync(ruta, USFM_CON_HUECO, "utf8");
    const salida = join(dir, "x.amod");
    await construirBiblia([{ ruta }], INFO_BASE, salida, { allowDefects: true });

    const { info } = leerInfo(salida);
    expect(info.defects_count).toBe("1");

    const db = new Database(salida, { readonly: true });
    const n = (db.prepare("SELECT count(*) n FROM verses").all() as { n: number }[])[0].n;
    const huecos = db.prepare("SELECT * FROM verses WHERE verse = 2").all();
    db.close();

    // El versiculo 2 NO existe en el modulo. No se invento nada.
    expect(n).toBe(2);
    expect(huecos).toEqual([]);
  });
});

describe("negativo: USFM inutilizable falla con explicacion", () => {
  test("sin marcadores \\v", async () => {
    const ruta = join(dir, "sin-v.usfm");
    writeFileSync(ruta, "\\id GEN KJV\n\\c 1\nEn el principio creo Dios.\n", "utf8");
    await expect(
      construirBiblia([{ ruta }], INFO_BASE, join(dir, "x.amod")),
    ).rejects.toThrow(/versiculos marcados/);
  });

  test("sin marcador \\id", async () => {
    const ruta = join(dir, "sin-id.usfm");
    writeFileSync(ruta, "\\c 1\n\\v 1 Texto\n", "utf8");
    await expect(
      construirBiblia([{ ruta }], INFO_BASE, join(dir, "x.amod")),
    ).rejects.toThrow(/\\id/);
  });

  test("libro desconocido", async () => {
    const ruta = join(dir, "libro.usfm");
    writeFileSync(ruta, "\\id ZZZ KJV\n\\c 1\n\\v 1 Texto\n", "utf8");
    await expect(
      construirBiblia([{ ruta }], INFO_BASE, join(dir, "x.amod")),
    ).rejects.toThrow(/ZZZ/);
  });

  test("fichero que no existe nombra su ruta", async () => {
    await expect(
      construirBiblia([{ ruta: join(dir, "fantasma.usfm") }], INFO_BASE, join(dir, "x.amod")),
    ).rejects.toThrow(/fantasma\.usfm/);
  });

  test("dos fuentes con el mismo versiculo", async () => {
    const a = fuente("a.usfm");
    const b = fuente("b.usfm");
    await expect(
      construirBiblia([{ ruta: a }, { ruta: b }], INFO_BASE, join(dir, "x.amod")),
    ).rejects.toThrow(/duplicado entre fuentes/);
  });
});

describe("negativo: la CLI falla con codigo distinto de cero", () => {
  test("validate sin catalogo falla", async () => {
    const p = Bun.spawnSync(
      ["bun", "run", "tools/src/cli.ts", "validate", "--destino", dir],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(p.exitCode).toBe(1);
    expect(p.stderr.toString()).toContain("bun run build");
  });

  test("una orden desconocida falla y lista las disponibles", async () => {
    const p = Bun.spawnSync(["bun", "run", "tools/src/cli.ts", "inventada"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(1);
    expect(p.stderr.toString()).toContain("orden desconocida");
    expect(p.stderr.toString()).toContain("gate");
  });

  test("--help sale con 0 y documenta las ordenes", async () => {
    const p = Bun.spawnSync(["bun", "run", "tools/src/cli.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(0);
    const salida = p.stdout.toString();
    for (const o of ["build", "validate", "gate", "bundle", "info"]) {
      expect(salida).toContain(o);
    }
    expect(salida).toContain("--allow-defects");
  });

  test("sin argumentos sale con 1 y muestra la ayuda", async () => {
    const p = Bun.spawnSync(["bun", "run", "tools/src/cli.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(1);
    expect(p.stdout.toString()).toContain("Ordenes:");
  });
});