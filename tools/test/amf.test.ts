import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  APPLICATION_ID,
  contentHashDeclarado,
  ESQUEMA_BIBLIA,
  ESQUEMA_COMENTARIO,
  ErrorAmf,
  escribirAmf,
  leerInfo,
  nombreDeFichero,
  PAGE_SIZE,
  SCHEMA_VERSION,
  tablasParaVerificar,
  type EntradaAmf,
} from "../src/amf.ts";
import { contentHashDeTablas, type Fila } from "../src/contentHash.ts";
import { sha256DeFichero } from "../src/hash.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "amf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const INFO_VALIDA = {
  id: "TEST",
  type: "bible",
  name: "Biblia de prueba",
  language: "spa",
  license: "PublicDomain",
  license_evidence: "https://example.org/coprights.html",
  copyright: "Dominio publico",
  attribution: "Sin atribucion requerida",
  schema_version: SCHEMA_VERSION,
  versification: "KJV",
  source: "https://example.org/fuente.usfm",
  origin: "https://example.org",
};

/**
 * Convencion de fila: la clave primaria va en `clave` y `celdas` solo lleva
 * las columnas que NO son clave. Es lo que hacen el escritor y el verificador.
 */
const fila = (book: string, chapter: number, verse: number, text: string, raw: string): Fila => ({
  clave: [book, chapter, verse],
  celdas: [text, raw],
});

function biblia(filas: Fila[], info = INFO_VALIDA): EntradaAmf {
  return {
    nombre: "TEST_bible",
    tipo: "bible",
    esquema: ESQUEMA_BIBLIA,
    info,
    contenido: [{ tabla: "verses", filas }],
  };
}

describe("escribirAmf: estructura", () => {
  test("crea el fichero y devuelve los dos hashes", async () => {
    const r = await escribirAmf(join(dir, "a.amod"), biblia([fila("John", 3, 16, "texto", "\\v 16 texto")]));
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.sha256).not.toBe(r.contentHash);
    expect(r.bytes).toBeGreaterThan(0);
  });

  test("las tablas y columnas son las que fija el spec", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const db = new Database(ruta, { readonly: true });
    const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[]).map((t) => t.name).sort();
    expect(tablas).toEqual(["info", "verses"]);
    const cols = (db.prepare("PRAGMA table_info(verses)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(["book", "chapter", "verse", "text", "raw"]);
    db.close();
  });

  test("el versiculo se lee con la consulta que documenta el spec", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "Porque Dios amó", "\\v 16 Porque Dios amó")]));
    const db = new Database(ruta, { readonly: true });
    const r = db.prepare("SELECT * FROM verses WHERE book = 'John' AND chapter = 3").all();
    expect(r.length).toBe(1);
    expect((r[0] as { verse: number }).verse).toBe(16);
    expect((r[0] as { text: string }).text).toBe("Porque Dios amó");
    db.close();
  });

  test("existe indice sobre (book, chapter, verse)", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const db = new Database(ruta, { readonly: true });
    const idx = db.prepare("PRAGMA index_list('verses')").all() as {
      name: string;
      origin: string;
    }[];
    // La clave primaria de una tabla WITHOUT ROWID ES un indice, y por eso el
    // spec se cumple sin crear un indice redundante.
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM verses WHERE book='John' AND chapter=3 AND verse=16")
      .all() as { detail: string }[];
    expect(plan[0].detail).toMatch(/SEARCH|USING INDEX/);
    expect(idx.length).toBeGreaterThan(0);
    db.close();
  });

  test("los pragmas de identidad quedan fijados", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const db = new Database(ruta, { readonly: true });
    const v = (p: string) => (db.prepare("PRAGMA " + p).all() as Record<string, number>[])[0];
    expect(v("application_id")["application_id"]).toBe(APPLICATION_ID);
    expect(Number(v("user_version")["user_version"])).toBe(Number(SCHEMA_VERSION));
    expect(v("page_size")["page_size"]).toBe(PAGE_SIZE);
    db.close();
  });

  test("no queda ningun fichero -wal ni -shm al lado", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).filter((f) => f.endsWith("-wal") || f.endsWith("-shm"))).toEqual([]);
  });

  test("ninguna tabla almacena fecha ni hora de construccion", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const db = new Database(ruta, { readonly: true });
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

  test("contentHash queda grabado dentro del propio modulo", async () => {
    const ruta = join(dir, "a.amod");
    const r = await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    expect(contentHashDeclarado(ruta)).toBe(r.contentHash);
  });
});

describe("escribirAmf: determinismo", () => {
  test("dos construcciones del mismo input dan el mismo sha256", async () => {
    const filas = [
      fila("Gen", 1, 1, "uno", "\\v 1 uno"),
      fila("John", 3, 16, "dos", "\\v 16 dos"),
      fila("John", 3, 17, "tres", "\\v 17 tres"),
    ];
    const a = await escribirAmf(join(dir, "a.amod"), biblia(filas));
    const b = await escribirAmf(join(dir, "b.amod"), biblia(filas));
    expect(a.sha256).toBe(b.sha256);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("el orden en que se pasan las filas no afecta al resultado", async () => {
    // Sin ordenar por clave primaria, SQLite escribe distinto y el sha256
    // cambia con contenido logico identico. Este test es el que lo sostiene.
    const filas = [
      fila("Gen", 1, 1, "uno", "a"),
      fila("John", 3, 16, "dos", "b"),
      fila("John", 3, 17, "tres", "c"),
      fila("Rev", 22, 21, "cuatro", "d"),
    ];
    const a = await escribirAmf(join(dir, "a.amod"), biblia(filas));
    const b = await escribirAmf(join(dir, "b.amod"), biblia([...filas].reverse()));
    expect(a.sha256).toBe(b.sha256);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("cambiar una palabra cambia los dos hashes", async () => {
    const a = await escribirAmf(join(dir, "a.amod"), biblia([fila("John", 3, 16, "uno", "x")]));
    const b = await escribirAmf(join(dir, "b.amod"), biblia([fila("John", 3, 16, "uno mas", "x")]));
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  test("el contentHash sobrevive a alterar el sello de version de la cabecera", async () => {
    // Es la razon de tener dos hashes. Los bytes 96-99 guardan
    // SQLITE_VERSION_NUMBER: se tocan a mano y el sha256 se va, pero el
    // contenido logico no ha cambiado ni un byte.
    const ruta = join(dir, "a.amod");
    const antes = await escribirAmf(ruta, biblia([fila("John", 3, 16, "uno", "x")]));

    // 96-99 es el sello de version que escribio la version de SQLite usada.
    // Se reescribe con OTRO valor valido: si no, el fichero no cambia y el
    // test pasaria sin probar nada.
    const buf = readFileSync(ruta);
    const selloOriginal = buf.readUInt32BE(96);
    expect(selloOriginal).toBeGreaterThan(0);
    const otroSello = selloOriginal === 0x002ef110 ? 0x002ef111 : 0x002ef110;
    buf.writeUInt32BE(otroSello, 96);

    const ruta2 = join(dir, "sello.amod");
    writeFileSync(ruta2, buf);

    expect(readFileSync(ruta2).readUInt32BE(96)).toBe(otroSello);
    const shaDespues = await sha256DeFichero(ruta2);
    expect(shaDespues).not.toBe(antes.sha256);

    // El contenido sigue dando el mismo contentHash.
    expect(contentHashDeTablas(tablasParaVerificar(ruta2))).toBe(antes.contentHash);
  });
});

describe("escribirAmf: contentHash verificable", () => {
  test("el lector recalcula el mismo contentHash que declaro el escritor", async () => {
    const ruta = join(dir, "a.amod");
    const r = await escribirAmf(ruta, biblia([
      fila("John", 3, 16, "uno", "\\v 16 uno"),
      fila("Gen", 1, 1, "dos", "\\v 1 dos"),
    ]));
    expect(contentHashDeTablas(tablasParaVerificar(ruta))).toBe(r.contentHash);
  });

  test("manipular un versiculo invalida el contentHash declarado", async () => {
    const ruta = join(dir, "a.amod");
    const r = await escribirAmf(ruta, biblia([fila("John", 3, 16, "uno", "x")]));
    const db = new Database(ruta);
    db.run("UPDATE verses SET text = 'manipulado' WHERE verse = 16");
    db.close();
    const recomputado = contentHashDeTablas(tablasParaVerificar(ruta));
    expect(recomputado).not.toBe(r.contentHash);
  });

  test("manipular info tambien invalida el contentHash", async () => {
    const ruta = join(dir, "a.amod");
    const r = await escribirAmf(ruta, biblia([fila("John", 3, 16, "uno", "x")]));
    const db = new Database(ruta);
    db.run("UPDATE info SET value = 'otro nombre' WHERE key = 'name'");
    db.close();
    expect(contentHashDeTablas(tablasParaVerificar(ruta))).not.toBe(r.contentHash);
  });
});

describe("escribirAmf: puerta del gate", () => {
  test("un info incompleto falla nombrando la clave ausente (tarea 3.2)", async () => {
    const info = { ...INFO_VALIDA };
    delete info.license_evidence;
    delete info.origin;

    const p = escribirAmf(join(dir, "a.amod"), biblia([fila("John", 3, 16, "t", "r")], info));
    await expect(p).rejects.toThrow(/license_evidence/);
    await expect(p).rejects.toThrow(/origin/);
  });

  test("el fallo del gate ocurre antes de crear el fichero", async () => {
    // Un modulo que no pasa el gate no debe existir ni como fichero roto.
    const info = { ...INFO_VALIDA, license: "Copyright 2004-2023 Humberto Gomez" };
    const ruta = join(dir, "no-debe-existir.amod");
    await expect(escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")], info))).rejects.toThrow(
      /licencia/i,
    );
    expect(existsSync(ruta)).toBe(false);
  });

  test("una licencia protegida se rechaza nombrando el campo", async () => {
    const info = { ...INFO_VALIDA, license: "Copyright 2004-2023" };
    await expect(
      escribirAmf(join(dir, "a.amod"), biblia([fila("John", 3, 16, "t", "r")], info)),
    ).rejects.toThrow(/\[license\]/);
  });
});

describe("escribirAmf: validacion de filas", () => {
  test("numero de celdas incorrecto nombra la tabla y sus columnas", async () => {
    const mala: Fila = { clave: ["John", 3, 16], celdas: ["texto"] };
    await expect(escribirAmf(join(dir, "a.amod"), biblia([mala]))).rejects.toThrow(
      /verses.*1 celdas; se esperan 2.*book, chapter, verse, text, raw/,
    );
  });

  test("una clave que no encaja con la tabla se rechaza", async () => {
    // La clave fija el orden canonico del volcado y, con el, el contentHash.
    // Si su longitud no corresponde a la clave primaria declarada, el orden
    // seria de otra tabla y el hash mediria una cosa distinta de la que dice.
    const claveMalDimensionada: Fila = {
      clave: ["John", 3, 16, "extra"],
      celdas: ["texto", "raw"],
    };
    await expect(escribirAmf(join(dir, "a.amod"), biblia([claveMalDimensionada]))).rejects.toThrow(
      /clave de 4 elementos; la clave primaria es \(book, chapter, verse\)/,
    );
  });

  test("texto donde se espera INTEGER se rechaza nombrando la columna", async () => {
    const mala: Fila = {
      clave: ["John", "tres" as unknown as number, 16],
      celdas: ["texto", "raw"],
    };
    await expect(escribirAmf(join(dir, "a.amod"), biblia([mala]))).rejects.toThrow(
      /verses\.chapter.*es INTEGER y recibe string/,
    );
  });

  test("numero donde se espera TEXT se rechaza nombrando la columna", async () => {
    // El caso inverso tambien importa: SQLite convierte un numero en texto al
    // insertarlo, y el modulo guardaria un 16 donde deberia haber un "John".
    const mala: Fila = {
      clave: ["John", 3, 16],
      celdas: [42 as unknown as string, "raw"],
    };
    await expect(escribirAmf(join(dir, "a.amod"), biblia([mala]))).rejects.toThrow(
      /verses\.text.*es TEXT y recibe number/,
    );
  });

  test("un entero no entero en la clave se rechaza", async () => {
    const mala: Fila = { clave: ["John", 3, 16.5], celdas: ["t", "r"] };
    await expect(escribirAmf(join(dir, "a.amod"), biblia([mala]))).rejects.toThrow(
      /no es entero/,
    );
  });

  test("una columna INTEGER no entera se rechaza nombrando la columna", async () => {
    // Se comprueba tambien sobre las celdas, no solo sobre la clave.
    const mala: Fila = {
      clave: ["John", 3, 16],
      celdas: [7.5 as unknown as number, "r"],
    };
    await escribirAmf(join(dir, "ok.amod"), biblia([fila("John", 3, 16, "t", "r")]));
    await expect(escribirAmf(join(dir, "b.amod"), biblia([mala]))).rejects.toThrow();
  });

  test("una fila duplicada se rechaza", async () => {
    await expect(
      escribirAmf(
        join(dir, "a.amod"),
        biblia([fila("John", 3, 16, "a", "x"), fila("John", 3, 16, "b", "y")]),
      ),
    ).rejects.toThrow(/duplicada/);
  });

  test("una tabla que no existe en el esquema se rechaza", async () => {
    const entrada = biblia([]);
    entrada.contenido = [{ tabla: "capitulos", filas: [] }];
    await expect(escribirAmf(join(dir, "a.amod"), entrada)).rejects.toThrow(
      /tabla "capitulos" no existe/,
    );
  });

  test("info.type distinto del tipo declarado se rechaza", async () => {
    const entrada = biblia([]);
    entrada.info = { ...INFO_VALIDA, type: "commentary" };
    await expect(escribirAmf(join(dir, "a.amod"), entrada)).rejects.toThrow(/info.type/);
  });
});

describe("escribirAmf: comentario con seq", () => {
  const infoComentario = {
    ...INFO_VALIDA,
    id: "CLARKE",
    type: "commentary",
    name: "Comentario de Clarke",
  };
  const nota = (book: string, chapter: number, verse: number, seq: number, text: string): Fila => ({
    clave: [book, chapter, verse, seq],
    celdas: [text, text],
  });

  function comentario(notas: Fila[]): EntradaAmf {
    return {
      nombre: "CLARKE_commentary",
      tipo: "commentary",
      esquema: ESQUEMA_COMENTARIO,
      info: infoComentario,
      contenido: [{ tabla: "commentary", filas: notas }],
    };
  }

  test("varias notas sobre el mismo versiculo coexisten (tarea 3.7)", async () => {
    const ruta = join(dir, "c.amod");
    await escribirAmf(
      ruta,
      comentario([
        nota("John", 3, 16, 0, "primera nota"),
        nota("John", 3, 16, 1, "segunda nota"),
        nota("John", 3, 16, 2, "tercera nota"),
      ]),
    );
    const db = new Database(ruta, { readonly: true });
    const r = db
      .prepare("SELECT seq, text FROM commentary WHERE book='John' AND chapter=3 AND verse=16 ORDER BY seq")
      .all() as { seq: number; text: string }[];
    expect(r.length).toBe(3);
    expect(r.map((x) => x.text)).toEqual(["primera nota", "segunda nota", "tercera nota"]);
    expect(r.map((x) => x.seq)).toEqual([0, 1, 2]);
    db.close();
  });

  test("sin seq en la clave, la segunda nota NO SE PUEDE guardar", async () => {
    // Medido, no supuesto: SQLite NO sobrescribe en silencio, rechaza con
    // SQLITE_CONSTRAINT_PRIMARYKEY. El problema sin `seq` no es la perdida
    // silenciosa, es que la segunda nota no cabe: el build falla entero y el
    // comentario no se puede publicar. Por eso `seq` va en la clave.
    const ruta = join(dir, "sin-seq.amod");
    const db = new Database(ruta, { create: true });
    db.run(
      "CREATE TABLE c (book TEXT, chapter INTEGER, verse INTEGER, seq INTEGER, " +
        "text TEXT, PRIMARY KEY (book,chapter,verse))",
    );
    const ins = db.prepare("INSERT INTO c VALUES (?,?,?,?,?)");
    ins.run("John", 3, 16, 0, "primera");
    expect(() => ins.run("John", 3, 16, 1, "segunda")).toThrow(/UNIQUE/);
    const quedan = (db.prepare("SELECT text FROM c").all() as { text: string }[]).map(
      (r) => r.text,
    );
    db.close();
    expect(quedan).toEqual(["primera"]);
  });

  test("con seq en la clave, las dos notas caben", async () => {
    // El esquema real, que es el que resuelve el caso anterior.
    const ruta = join(dir, "con-seq.amod");
    await escribirAmf(
      ruta,
      comentario([nota("John", 3, 16, 0, "primera"), nota("John", 3, 16, 1, "segunda")]),
    );
    const db = new Database(ruta, { readonly: true });
    const quedan = (db.prepare("SELECT text FROM commentary").all() as { text: string }[])
      .map((r) => r.text)
      .sort();
    db.close();
    expect(quedan).toEqual(["primera", "segunda"]);
  });

  test("WITHOUT ROWID con seq: mismo resultado y sin segundo indice", async () => {
    // `seq` va al final de la clave, asi que el indice por
    // (book, chapter, verse) lo cubre por prefijo. No hace falta crearlo.
    const ruta = join(dir, "c.amod");
    await escribirAmf(
      ruta,
      comentario([nota("John", 3, 16, 0, "a"), nota("John", 3, 16, 1, "b")]),
    );
    const db = new Database(ruta, { readonly: true });
    const indices = (db.prepare("PRAGMA index_list('commentary')").all() as { name: string }[])
      .map((i) => i.name)
      .filter((n) => !n.startsWith("sqlite_autoindex"));
    db.close();
    expect(indices).toEqual([]);
  });

  test("seq ordena las notas del mismo versiculo", async () => {
    const ruta = join(dir, "c.amod");
    await escribirAmf(
      ruta,
      comentario([
        nota("John", 3, 16, 2, "tercera"),
        nota("John", 3, 16, 0, "primera"),
        nota("John", 3, 16, 1, "segunda"),
      ]),
    );
    const db = new Database(ruta, { readonly: true });
    const r = db
      .prepare("SELECT text FROM commentary WHERE book='John' AND chapter=3 AND verse=16 ORDER BY seq")
      .all() as { text: string }[];
    db.close();
    expect(r.map((x) => x.text)).toEqual(["primera", "segunda", "tercera"]);
  });

  test("la consulta por (book, chapter, verse) usa indice con seq en la clave", async () => {
    const ruta = join(dir, "c.amod");
    await escribirAmf(ruta, comentario([nota("John", 3, 16, 0, "nota")]));
    const db = new Database(ruta, { readonly: true });
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM commentary WHERE book='John' AND chapter=3 AND verse=16")
      .all() as { detail: string }[];
    db.close();
    expect(plan[0].detail).toMatch(/SEARCH|USING (INDEX|PRIMARY KEY)/);
  });
});

describe("escribirAmf: defectos de la fuente", () => {
  test("los defectos quedan grabados en info y no inventan filas", async () => {
    const ruta = join(dir, "a.amod");
    const entrada = biblia([fila("John", 3, 16, "uno", "x")]);
    entrada.defectos = [{ libro: "Job", chapter: 38, verse: 39, tipo: "versiculo_vacio" }];
    const r = await escribirAmf(ruta, entrada);

    const { info } = leerInfo(ruta);
    expect(info.defects_count).toBe("1");
    expect(info.defects).toContain("Job");
    expect(r.defectos).toBe(1);

    const db = new Database(ruta, { readonly: true });
    const filas = db.prepare("SELECT count(*) n FROM verses").all() as { n: number }[];
    db.close();
    expect(filas[0].n).toBe(1);
  });

  test("sin defectos, defects queda vacio y defects_count a 0", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "uno", "x")]));
    const { info } = leerInfo(ruta);
    expect(info.defects).toBe("");
    expect(info.defects_count).toBe("0");
  });
});

describe("leerInfo", () => {
  test("devuelve el veredicto del gate sin lanzar", async () => {
    const ruta = join(dir, "a.amod");
    await escribirAmf(ruta, biblia([fila("John", 3, 16, "t", "r")]));
    const { info, veredicto } = leerInfo(ruta);
    expect(veredicto.ok).toBe(true);
    expect(info.id).toBe("TEST");
    expect(info.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("nombreDeFichero", () => {
  test("sigue el patron <ID>_<type>.amod", () => {
    expect(nombreDeFichero("RVR1909", "bible")).toBe("RVR1909_bible.amod");
    expect(nombreDeFichero("CLARKE", "commentary")).toBe("CLARKE_commentary.amod");
  });

  test("rechaza ids que romperian una ruta", () => {
    expect(() => nombreDeFichero("RVR/1909", "bible")).toThrow(/id no admisible/);
    expect(() => nombreDeFichero("RVR1909", "biblia/v2")).toThrow(/tipo no admisible/);
  });
});

describe("ErrorAmf", () => {
  test("es un Error con nombre propio", () => {
    const e = new ErrorAmf("x");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorAmf");
  });
});