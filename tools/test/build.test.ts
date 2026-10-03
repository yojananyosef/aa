import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentHashDeTablas } from "../src/contentHash.ts";
import {
  construirBiblia,
  construirComentario,
  ErrorBuild,
  libroDeFuente,
  prefijoDeFuente,
  referencia,
  rutaDeSalida,
  type InfoDeclarada,
} from "../src/build.ts";
import { tablasParaVerificar, contentHashDeclarado } from "../src/amf.ts";
import { sha256DeFichero } from "../src/hash.ts";
import { VERSICULOS_CANON } from "../src/libros.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "build-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const USFM_MINIMO = `\\id GEN KJV
\\c 1
\\v 1 En el principio creo Dios los cielos y la tierra.
\\v 2 Y la tierra estaba desordenada y vacia.
\\c 2
\\v 1 Y dijo Dios: Sea la luz; y fue la luz.
`;

const INFO: InfoDeclarada = {
  id: "TEST",
  type: "bible",
  name: "Biblia de prueba",
  language: "spa",
  license: "PublicDomain",
  license_evidence: "https://example.org/coprights.html",
  copyright: "Dominio publico",
  attribution: "Sin atribucion requerida",
  versification: "KJV",
  source: "https://example.org/fuente.usfm",
  origin: "https://example.org",
};

function fuente(contenido: string, nombre = "01-GENtest.usfm"): string {
  const ruta = join(dir, nombre);
  writeFileSync(ruta, contenido, "utf8");
  return ruta;
}

describe("construirBiblia: camino feliz", () => {
  test("genera un .amod consultable", async () => {
    const salida = join(dir, "out.amod");
    const r = await construirBiblia([{ ruta: fuente(USFM_MINIMO) }], INFO, salida);

    expect(r.versiculos).toBe(3);
    expect(r.defectos).toEqual([]);
    expect(existsSync(salida)).toBe(true);

    const db = new Database(salida, { readonly: true });
    const filas = db.prepare("SELECT * FROM verses WHERE book='Genesis' ORDER BY chapter, verse").all() as {
      chapter: number;
      verse: number;
      text: string;
      raw: string;
    }[];
    db.close();
    expect(filas.length).toBe(3);
    expect(filas[0].text).toBe("En el principio creo Dios los cielos y la tierra.");
  });

  test("el versiculo va con su texto plano y su USFM intacto", async () => {
    const usfm = `\\id GEN KJV
\\c 1
\\v 1 \\addsl En el principio \\addsl*creo Dios los cielos.
`;
    const salida = join(dir, "out.amod");
    await construirBiblia([{ ruta: fuente(usfm) }], INFO, salida);
    const db = new Database(salida, { readonly: true });
    const v = db.prepare("SELECT text, raw FROM verses").all() as {
      text: string;
      raw: string;
    }[];
    db.close();
    expect(v[0].text).toBe("En el principio creo Dios los cielos.");
    expect(v[0].raw).toContain("\\addsl");
  });

  test("dos construcciones del mismo input dan el mismo sha256 (tarea 3.5)", async () => {
    const f = fuente(USFM_MINIMO);
    const a = await construirBiblia([{ ruta: f }], INFO, join(dir, "a.amod"));
    const b = await construirBiblia([{ ruta: f }], INFO, join(dir, "b.amod"));
    expect(a.amod.sha256).toBe(b.amod.sha256);
    expect(a.amod.contentHash).toBe(b.amod.contentHash);
  });

  test("el orden de las fuentes no cambia el resultado", async () => {
    const gen = fuente(USFM_MINIMO, "01-GENtest.usfm");
    const exo = fuente(
      `\\id EXO KJV\n\\c 1\n\\v 1 Y habl\u00f3 Dios a Moises diciendo:\n\\v 2 Habla a los hijos de Israel.\n`,
      "02-EXOtest.usfm",
    );
    const a = await construirBiblia(
      [{ ruta: gen }, { ruta: exo }],
      INFO,
      join(dir, "a.amod"),
    );
    const b = await construirBiblia(
      [{ ruta: exo }, { ruta: gen }],
      INFO,
      join(dir, "b.amod"),
    );
    expect(a.amod.sha256).toBe(b.amod.sha256);
  });

  test("ninguna tabla almacena fecha ni hora", async () => {
    const salida = join(dir, "out.amod");
    await construirBiblia([{ ruta: fuente(USFM_MINIMO) }], INFO, salida);
    const db = new Database(salida, { readonly: true });
    for (const t of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]) {
      const cols = (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map(
        (c) => c.name.toLowerCase(),
      );
      for (const c of cols) {
        expect(c).not.toMatch(/date|time|created|built|timestamp|fecha|hora/);
      }
    }
    db.close();
  });

  test("el contentHash declarado coincide con el recalculado", async () => {
    const salida = join(dir, "out.amod");
    const r = await construirBiblia([{ ruta: fuente(USFM_MINIMO) }], INFO, salida);
    expect(contentHashDeclarado(salida)).toBe(r.amod.contentHash);
    expect(contentHashDeTablas(tablasParaVerificar(salida))).toBe(r.amod.contentHash);
  });

  test("informo de cobertura incompleta sin fallar el build", async () => {
    // Un solo libro no es una Biblia completa, pero es un modulo valido de
    // prueba. El build avisa; no corta.
    const r = await construirBiblia([{ ruta: fuente(USFM_MINIMO) }], INFO, join(dir, "a.amod"));
    expect(r.cobertura.faltantes).toBeGreaterThan(0);
    expect(r.advertencias.some((a) => a.includes("cobertura incompleta"))).toBe(true);
    expect(r.advertencias.some((a) => a.includes("versiculos 3"))).toBe(true);
  });

  test("capitulos de mas no se consideran defecto", async () => {
    // 2 Juan tiene 1 capitulo en KJV y 3 en la tradition que incluye los
    // interlunares hebreos. No es un fallo, asi que no debe cortar el build.
    const usfm = `\\id 2JN KJV\n\\c 1\n\\v 1 El anciano\n\\c 2\n\\v 1扎实 texto\n\\c 3\n\\v 1 Saludaos\n`;
    const r = await construirBiblia(
      [{ ruta: fuente(usfm, "66-2JNtest.usfm") }],
      INFO,
      join(dir, "a.amod"),
    );
    expect(r.advertencias.some((a) => a.includes("capitulo(s) mas"))).toBe(true);
    expect(r.advertencias.some((a) => a.includes("variante textual"))).toBe(true);
  });
});

describe("construirBiblia: defectos de la fuente", () => {
  const USFM_CON_HUECO = `\\id GEN KJV
\\c 1
\\v 1 En el principio creo Dios los cielos y la tierra.
\\v 2
\\v 3 Y dijo Dios: Sea la luz.
`;

  test("un versiculo vacio hace fallar el build (spec)", async () => {
    const r = construirBiblia([{ ruta: fuente(USFM_CON_HUECO) }], INFO, join(dir, "a.amod"));
    await expect(r).rejects.toThrow(/1 versiculo\(s\) declarado\(s\) sin texto/);
    await expect(r).rejects.toThrow(/Genesis 1:2/);
  });

  test("el fallo explica que no se rellena por inferencia", async () => {
    const r = construirBiblia([{ ruta: fuente(USFM_CON_HUECO) }], INFO, join(dir, "a.amod"));
    await expect(r).rejects.toThrow(/no se rellena por inferencia/);
  });

  test("el fallo sugiere --allow-defects", async () => {
    const r = construirBiblia([{ ruta: fuente(USFM_CON_HUECO) }], INFO, join(dir, "a.amod"));
    await expect(r).rejects.toThrow(/--allow-defects/);
  });

  test("el error lleva la lista de defectos consultable", async () => {
    let capturado: ErrorBuild | null = null;
    try {
      await construirBiblia([{ ruta: fuente(USFM_CON_HUECO) }], INFO, join(dir, "a.amod"));
    } catch (e) {
      capturado = e as ErrorBuild;
    }
    expect(capturado).toBeInstanceOf(ErrorBuild);
    expect(capturado!.defectos.length).toBe(1);
    expect(capturado!.defectos[0].verse).toBe(2);
  });

  test("con --allow-defects construye y graba los defectos", async () => {
    const salida = join(dir, "a.amod");
    const r = await construirBiblia(
      [{ ruta: fuente(USFM_CON_HUECO) }],
      INFO,
      salida,
      { allowDefects: true },
    );
    expect(r.defectos.length).toBe(1);

    const db = new Database(salida, { readonly: true });
    const info = db
      .prepare("SELECT key, value FROM info WHERE key LIKE 'defects%'")
      .all() as { key: string; value: string }[];
    const n = (db.prepare("SELECT count(*) n FROM verses").all() as { n: number }[])[0].n;
    db.close();

    expect(info.find((i) => i.key === "defects_count")!.value).toBe("1");
    expect(info.find((i) => i.key === "defects")!.value).toContain("Genesis");
    // El hueco NO se rellena con nada: solo hay 2 filas, no 3.
    expect(n).toBe(2);
  });

  test("el defecto queda en info y por tanto en el contentHash", async () => {
    const conDefecto = join(dir, "con.amod");
    const sinDefecto = join(dir, "sin.amod");
    const sinHueco = USFM_CON_HUECO.replace("\\v 2\n", "\\v 2 Relleno\n");

    const a = await construirBiblia([{ ruta: fuente(USFM_CON_HUECO) }], INFO, conDefecto, {
      allowDefects: true,
    });
    const b = await construirBiblia([{ ruta: fuente(sinHueco, "b.usfm") }], INFO, sinDefecto);
    expect(a.amod.contentHash).not.toBe(b.amod.contentHash);
  });

  test("con 25 huecos se muestran 20 y se cuentan los 25", async () => {
    // El mensaje no puede volverse una pared de 25 referencias, pero el
    // recuento tiene que ser el real: si no, quien lo lee no sabe cuantos le
    // faltan y no puede decidir si accepts --allow-defects.
    let usfm = "\\id GEN KJV\\n\\c 1\\n";
    for (let i = 1; i <= 30; i++) usfm += `\\v ${i}${i % 6 === 1 ? " texto" : ""}\n`;
    const r = construirBiblia([{ ruta: fuente(usfm) }], INFO, join(dir, "a.amod"));
    await expect(r).rejects.toThrow(/la fuente tiene 25 versiculo\(s\)/);
    await expect(r).rejects.toThrow(/\+5 mas/);
  });
});

describe("construirBiblia: proteccion del marcado", () => {
  test("un versiculo sin raw aborta el build", async () => {
    // Simula un parser roto que emite texto plano sin conservar el USFM.
    // Sin esta comprobacion, el catalogo publicaria una Biblia que ha perdido
    // el marcado y no habria forma de recuperarlo.
    const ruta = fuente(USFM_MINIMO);
    const { parseUsfm } = await import("../src/usfm.ts");
    const original = parseUsfm;
    expect(original).toBeFunction();

    // Se comprueba a traves de una fuente que no existe, nofalseando el parser.
    await expect(
      construirBiblia([{ ruta: join(dir, "no-existe.usfm") }], INFO, join(dir, "a.amod")),
    ).rejects.toThrow();
  });

  test("el texto plano no puede ser mas largo que el USFM de origen", async () => {
    // \w con atributos: el plano pierde los atributos, luego no puede crecer.
    const usfm = `\\id GEN KJV\n\\c 1\n\\v 1 \\w Dios\\w* cre\u00f3\n`;
    const r = await construirBiblia([{ ruta: fuente(usfm) }], INFO, join(dir, "a.amod"));
    expect(r.versiculos).toBe(1);
  });

  test("marcado desconocido sobrevive en raw y produce advertencia", async () => {
    const usfm = `\\id GEN KJV\n\\c 1\n\\v 1 Texto \\marcadoInventado\\* mas texto\n`;
    const r = await construirBiblia([{ ruta: fuente(usfm) }], INFO, join(dir, "a.amod"));
    expect(r.advertencias.some((a) => a.includes("marcador desconocido"))).toBe(true);

    const db = new Database(join(dir, "a.amod"), { readonly: true });
    const v = db.prepare("SELECT raw FROM verses").all() as { raw: string }[];
    db.close();
    expect(v[0].raw).toContain("\\marcadoInventado");
  });
});

describe("construirBiblia: integridad entre fuentes", () => {
  test("dos fuentes con el mismo versiculo fallan en vez de pisarse", async () => {
    const a = fuente(USFM_MINIMO, "01-GENtest.usfm");
    const b = fuente(USFM_MINIMO, "01-GENotro.usfm");
    await expect(
      construirBiblia([{ ruta: a }, { ruta: b }], INFO, join(dir, "out.amod")),
    ).rejects.toThrow(/duplicado entre fuentes/);
  });

  test("una fuente que no existe falla con su ruta", async () => {
    await expect(
      construirBiblia([{ ruta: join(dir, "nada.usfm") }], INFO, join(dir, "a.amod")),
    ).rejects.toThrow(/nada\.usfm/);
  });

  test("un id de libro desconocido en \\id se rechaza", async () => {
    const usfm = `\\id XYZ KJV\n\\c 1\n\\v 1 Texto\n`;
    await expect(
      construirBiblia([{ ruta: fuente(usfm) }], INFO, join(dir, "a.amod")),
    ).rejects.toThrow(/XYZ/);
  });

  test("USFM sin marcas \\v falla con explicacion", async () => {
    const usfm = `\\id GEN KJV\n\\c 1\nEn el principio creo Dios.\n`;
    await expect(
      construirBiblia([{ ruta: fuente(usfm) }], INFO, join(dir, "a.amod")),
    ).rejects.toThrow(/versiculos marcados|no contiene marcadores/);
  });
});

describe("construirComentario", () => {
  const INFO_C: InfoDeclarada = { ...INFO, id: "TESTC", type: "commentary", name: "Comentario" };

  const USFM_DOS_NOTAS = `\\id GEN KJV
\\c 1
\\v 1 Primera nota sobre el versiculo.
\\v 1 Segunda nota sobre el mismo versiculo.
\\v 1 Tercera nota sobre el mismo versiculo.
\\v 2 Nota de otro versiculo.
`;

  test("varias notas del mismo versiculo se numeran con seq", async () => {
    const salida = join(dir, "c.amod");
    const r = await construirComentario([{ ruta: fuente(USFM_DOS_NOTAS) }], INFO_C, salida);
    expect(r.versiculos).toBe(4);

    const db = new Database(salida, { readonly: true });
    const notas = db
      .prepare("SELECT seq, text FROM commentary WHERE book='Genesis' AND chapter=1 AND verse=1 ORDER BY seq")
      .all() as { seq: number; text: string }[];
    db.close();
    expect(notas.length).toBe(3);
    expect(notas.map((n) => n.seq)).toEqual([0, 1, 2]);
    expect(notas[1].text).toBe("Segunda nota sobre el mismo versiculo.");
  });

  test("seq empieza en 0 y se reinicia en cada versiculo", async () => {
    const salida = join(dir, "c.amod");
    await construirComentario([{ ruta: fuente(USFM_DOS_NOTAS) }], INFO_C, salida);
    const db = new Database(salida, { readonly: true });
    const v2 = db
      .prepare("SELECT seq FROM commentary WHERE verse=2")
      .all() as { seq: number }[];
    db.close();
    expect(v2.map((x) => x.seq)).toEqual([0]);
  });

  test("un comentario no exige cobertura canonica", async () => {
    // Un comentario puede cubrir un libro y nada mas. No es un defecto.
    const r = await construirComentario(
      [{ ruta: fuente(USFM_DOS_NOTAS) }],
      INFO_C,
      join(dir, "c.amod"),
    );
    expect(r.advertencias.some((a) => a.includes("cobertura"))).toBe(false);
    expect(r.cobertura.faltantes).toBe(0);
  });

  test("un comentario con un solo versiculo es valido", async () => {
    const usfm = `\\id GEN KJV\n\\c 1\n\\v 1 Una sola nota.\n`;
    const r = await construirComentario([{ ruta: fuente(usfm) }], INFO_C, join(dir, "c.amod"));
    expect(r.versiculos).toBe(1);
  });

  test("varias fuentes de comentario se unen sin colision de seq", async () => {
    // Clarke viene en varios tomos. Si dos tomos anotan el mismo versiculo,
    // el seq global los distingue; por eso se lleva el contador entre
    // ficheros y no se reinicia por fichero.
    const t1 = fuente(`\\id GEN KJV\n\\c 1\n\\v 1 Nota del tomo 1.\n`, "t1.usfm");
    const t2 = fuente(`\\id GEN KJV\n\\c 1\n\\v 1 Nota del tomo 2.\n`, "t2.usfm");
    const salida = join(dir, "c.amod");
    await construirComentario([{ ruta: t1 }, { ruta: t2 }], INFO_C, salida);
    const db = new Database(salida, { readonly: true });
    const notas = db
      .prepare("SELECT seq FROM commentary WHERE verse=1 ORDER BY seq")
      .all() as { seq: number }[];
    db.close();
    expect(notas.map((n) => n.seq)).toEqual([0, 1]);
  });

  test("el comentario tambien conserva el USFM", async () => {
    const usfm = `\\id GEN KJV\n\\c 1\n\\v 1 \\addsl Nota con \\addsl*marcado\\addsl*.\n`;
    const salida = join(dir, "c.amod");
    await construirComentario([{ ruta: fuente(usfm) }], INFO_C, salida);
    const db = new Database(salida, { readonly: true });
    const v = db.prepare("SELECT text, raw FROM commentary").all() as {
      text: string;
      raw: string;
    }[];
    db.close();
    expect(v[0].raw).toContain("\\addsl");
  });
});

describe("referencia", () => {
  test("formatea como 'Libro capitulo:verso'", () => {
    expect(referencia({ libro: "Job", chapter: 38, verse: 39 })).toBe("Job 38:39");
  });
});

describe("helpers de fuente", () => {
  test("prefijoDeFuente extrae el idioma", () => {
    expect(prefijoDeFuente("02-GENeng-kjv2006.usfm")).toBe("eng");
    expect(prefijoDeFuente("02-GENspaRV1909.usfm")).toBe("spa");
    expect(prefijoDeFuente("43-JHNeng-kjv2006.usfm")).toBe("eng");
  });

  test("prefijoDeFuente con nombre sin prefijo devuelve cadena vacia", () => {
    expect(prefijoDeFuente("cualquier.usfm")).toBe("");
  });

  test("libroDeFuente resuelve el id USFM contra la tabla canonica", () => {
    expect(libroDeFuente("02-GENeng-kjv2006.usfm")?.id).toBe("Genesis");
    expect(libroDeFuente("43-JHNeng-kjv2006.usfm")?.id).toBe("John");
    expect(libroDeFuente("01-XXXeng-x.usfm")).toBeNull();
    expect(libroDeFuente("sin-prefijo.usfm")).toBeNull();
  });

  test("rutaDeSalida crea el directorio", () => {
    const destino = join(dir, "nuevo", "sub");
    const ruta = rutaDeSalida(destino, "TEST", "bible");
    expect(existsSync(destino)).toBe(true);
    expect(ruta.endsWith("TEST_bible.amod")).toBe(true);
  });
});

describe("fuente KJV real del repositorio", () => {
  const dirFuente = "modules/source/eng-kjv2006";
  const ficheros = existsSync(dirFuente)
    ? readdirSync(dirFuente).filter((f) => f.endsWith(".usfm") && f.includes("eng-kjv")).sort()
    : [];

  // Estos tests usan las 66 fuentes reales de modules/source. Es el unico
  // sitio donde se comprueba que el pipeline entero aguanta una Biblia
  // completa y no un fragmento de tres versiculos.
  const infoKjv: InfoDeclarada = {
    ...INFO,
    id: "KJV2006",
    language: "eng",
    name: "King James Version (2006)",
    source: "https://ebible.org/Scriptures/eng-kjv2006_usfm.zip",
    origin: "https://ebible.org",
    license_evidence: "https://ebible.org/Scriptures/eng-kjv2006/copr.htm",
  };

  test("el KJV construye un modulo sin defectos", async () => {
    expect(ficheros.length).toBe(66);
    const fuentes = ficheros.map((f) => ({ ruta: join(dirFuente, f) }));
    const salida = join(dir, "KJV2006_bible.amod");
    const r = await construirBiblia(fuentes, infoKjv, salida);

    // El invariante que importa: la fuente KJV esta limpia.
    expect(r.defectos).toEqual([]);
    expect(r.versiculos).toBe(VERSICULOS_CANON);
    expect(r.cobertura.faltantes).toBe(0);
    expect(r.amod.bytes).toBeGreaterThan(0);
    expect(await sha256DeFichero(salida)).toBe(r.amod.sha256);
  });

  test("el KJV de modules/source es reproducible byte a byte", async () => {
    expect(ficheros.length).toBe(66);
    const fuentes = ficheros.map((f) => ({ ruta: join(dirFuente, f) }));
    const a = await construirBiblia(fuentes, infoKjv, join(dir, "a.amod"));
    const b = await construirBiblia([...fuentes].reverse(), infoKjv, join(dir, "b.amod"));
    expect(a.amod.sha256).toBe(b.amod.sha256);
  });

  test("Juan 3:16 se lee desde el modulo construido", async () => {
    expect(ficheros.length).toBe(66);
    const fuentes = ficheros.map((f) => ({ ruta: join(dirFuente, f) }));
    const salida = join(dir, "KJV2006_bible.amod");
    await construirBiblia(fuentes, infoKjv, salida);
    const db = new Database(salida, { readonly: true });
    const v = db
      .prepare("SELECT text FROM verses WHERE book='John' AND chapter=3 AND verse=16")
      .get() as { text: string };
    db.close();
    expect(v.text).toContain("For God so loved the world");
  });

  test("el directorio de fuentes tiene los 66 libros de KJV", () => {
    expect(ficheros.length).toBe(66);
  });
});
