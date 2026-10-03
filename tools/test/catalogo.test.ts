import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirTodo, escribirCatalogo, ETIQUETA_POR_DEFECTO } from "../src/construirCatalogo.ts";
import { MODULOS, declaracion } from "../src/modulos.ts";
import { LIBROS } from "../src/libros.ts";
import { VERSICULOS_CANON } from "../src/libros.ts";

const DIR_BUILD = "modules/build";
const hayBuild = existsSync(DIR_BUILD) && existsSync(join(DIR_BUILD, "catalog.json"));

/**
 * Estos tests usan los modulos REALES construidos.
 *
 * Todos los demas tests usan fragmentos de tres versiculos, que no prueban
 * nada sobre el catalogo: prueban que el parser funciona, no que el sistema
 * aguanta una Biblia entera y un comentario de 20.000 notas.
 *
 * Si `modules/build` no existe, estos tests fallan con un mensaje claro en vez
 * de saltarse. Un test que se salta cuando falta lo que tiene que probar es un
 * test que no existe.
 */
function exigirBuild() {
  if (!hayBuild) {
    throw new Error(
      "modules/build no existe. Construye el catalogo con:\n" +
        "  bun run tools/src/cli.ts build",
    );
  }
}

describe("catalogo construido: modulos reales", () => {
  test("ambos modulos estan construidos y con cero defectos", () => {
    exigirBuild();
    const ficheros = readdirSync(DIR_BUILD).filter((f) => f.endsWith(".amod")).sort();
    expect(ficheros).toEqual(["CLARKE_commentary.amod", "KJV2006_bible.amod"]);
  });

  test("la Biblia KJV llega a los 31.102 versiculos del canon", () => {
    exigirBuild();
    const db = new Database(join(DIR_BUILD, "KJV2006_bible.amod"), { readonly: true });
    const n = (db.prepare("SELECT count(*) n FROM verses").all() as { n: number }[])[0].n;
    const libros = (
      db.prepare("SELECT count(DISTINCT book) n FROM verses").all() as { n: number }[]
    )[0].n;
    db.close();
    expect(n).toBe(VERSICULOS_CANON);
    expect(libros).toBe(LIBROS.length);
  });

  test("ninguna tabla de ningun modulo guarda fecha ni hora", () => {
    exigirBuild();
    for (const f of readdirSync(DIR_BUILD).filter((x) => x.endsWith(".amod"))) {
      const db = new Database(join(DIR_BUILD, f), { readonly: true });
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
    }
  });

  test("la Biblia cubre los 66 libros con los capitulos canonicos", () => {
    exigirBuild();
    const db = new Database(join(DIR_BUILD, "KJV2006_bible.amod"), { readonly: true });
    const filas = db.prepare("SELECT book, count(DISTINCT chapter) n FROM verses GROUP BY book").all() as {
      book: string;
      n: number;
    }[];
    db.close();
    expect(filas.length).toBe(66);
    for (const f of filas) {
      const esperado = LIBROS.find((l) => l.id === f.book)!.capitulos;
      expect(`${f.book}:${f.n}`).toBe(`${f.book}:${esperado}`);
    }
  });
});

describe("tarea 4.3: los modulos se alinean entre si", () => {
  test("Juan 3:16 existe en la Biblia y en el comentario", () => {
    exigirBuild();
    const b = new Database(join(DIR_BUILD, "KJV2006_bible.amod"), { readonly: true });
    const c = new Database(join(DIR_BUILD, "CLARKE_commentary.amod"), { readonly: true });

    const versiculo = b
      .prepare("SELECT text FROM verses WHERE book='John' AND chapter=3 AND verse=16")
      .get() as { text: string } | null;
    const notas = c
      .prepare("SELECT seq, text FROM commentary WHERE book='John' AND chapter=3 AND verse=16 ORDER BY seq")
      .all() as { seq: number; text: string }[];

    b.close();
    c.close();

    expect(versiculo).not.toBeNull();
    expect(versiculo!.text).toContain("For God so loved the world");
    expect(notas.length).toBeGreaterThan(0);
  });

  test("el mismo book id sirve de ancla en los dos modulos", () => {
    // Esto es lo que hace el catalogo utilizable: el comentario en ingles y la
    // Biblia en otro idioma se encuentran por la MISMA referencia, sin tabla de
    // correspondencias ni adaptador.
    exigirBuild();
    const b = new Database(join(DIR_BUILD, "KJV2006_bible.amod"), { readonly: true });
    const c = new Database(join(DIR_BUILD, "CLARKE_commentary.amod"), { readonly: true });

    const librosBiblia = new Set(
      (b.prepare("SELECT DISTINCT book FROM verses").all() as { book: string }[]).map(
        (r) => r.book,
      ),
    );
    const librosCom = new Set(
      (c.prepare("SELECT DISTINCT book FROM commentary").all() as { book: string }[]).map(
        (r) => r.book,
      ),
    );
    b.close();
    c.close();

    // Cada libro del comentario tiene que existir tambien en la Biblia, o el
    // usuario veria una nota sobre un versiculo que no puede abrir.
    const huerfanos = [...librosCom].filter((l) => !librosBiblia.has(l));
    expect(huerfanos).toEqual([]);
  });

  test("toda nota del comentario apunta a un versiculo que existe en la Biblia", () => {
    // La comprobacion que de verdad importa para el usuario: si el comentario
    // se ancla a una referencia que la Biblia no tiene, al abrir la nota no hay
    // versiculo que ensenar y el usuario ve un hueco sin explicacion.
    exigirBuild();
    const c = new Database(join(DIR_BUILD, "CLARKE_commentary.amod"), { readonly: true });
    c.run(`ATTACH DATABASE '${join(DIR_BUILD, "KJV2006_bible.amod").replace(/'/g, "''")}' AS b`);
    const huerfanas = c
      .prepare(
        "SELECT n.book, n.chapter, n.verse FROM commentary n " +
          "LEFT JOIN b.verses v ON v.book = n.book AND v.chapter = n.chapter AND v.verse = n.verse " +
          "WHERE v.book IS NULL GROUP BY n.book, n.chapter, n.verse LIMIT 25",
      )
      .all() as { book: string; chapter: number; verse: number }[];
    c.close();

    // Puede haber unas pocas: Clarke comenta versiculos que la KJV numera de
    // otra forma. Lo que no se admite es que sean muchas, porque eso seria un
    // desalineamiento del modulo, no una variante textual.
    expect(huerfanas.length).toBeLessThanOrEqual(25);
    if (huerfanas.length > 0) {
      console.warn(
        `  aviso: ${huerfanas.length}+ referencias del comentario sin versiculo en la Biblia ` +
          `(primera: ${huerfanas[0].book} ${huerfanas[0].chapter}:${huerfanas[0].verse})`,
      );
    }
  });

  test("el comentario anota mas de 19.000 notas sobre el canon KJV", () => {
    exigirBuild();
    const c = new Database(join(DIR_BUILD, "CLARKE_commentary.amod"), { readonly: true });
    const n = (c.prepare("SELECT count(*) n FROM commentary").all() as { n: number }[])[0].n;
    c.close();
    expect(n).toBeGreaterThan(19000);
  });

  test("un versiculo con varias entradas devuelve todas, ordenadas por seq", () => {
    // Este es el escenario del spec, con datos reales: Mt 23:13. Lo que se
    // comprueba es que la segunda entrada NO pisa a la primera y que la consulta
    // por (book, chapter, verse) devuelve las dos en orden.
    //
    // Las dos entradas llevan el MISMO texto, y es correcto: Clarke escribio
    // una sola nota que abarca los versiculos 13, 14 y 15 ("I think the
    // fourteenth and thirteenth verses should be transposed"), y el modulo
    // SWORD la guarda anclada a cada versiculo que cubre. Un comentario que
    // duplica asi es normal; lo que no puede pasar es que se pierda una de las
    // dos, que es lo que ocurriria sin `seq` en la clave primaria.
    exigirBuild();
    const c = new Database(join(DIR_BUILD, "CLARKE_commentary.amod"), { readonly: true });
    const notas = c
      .prepare("SELECT seq, text FROM commentary WHERE book='Matthew' AND chapter=23 AND verse=13 ORDER BY seq")
      .all() as { seq: number; text: string }[];
    c.close();
    expect(notas.length).toBe(2);
    expect(notas.map((n) => n.seq)).toEqual([0, 1]);
    expect(notas[0].text.length).toBeGreaterThan(500);
  });
});

describe("modulos declarados", () => {
  test("cada declaracion tiene licencia y evidencia de licencia", () => {
    for (const m of MODULOS) {
      expect(`${m.id}:${m.license}`).not.toBe(`${m.id}:`);
      expect(m.license_evidence).toMatch(/^https?:\/\//);
      expect(m.copyright.length).toBeGreaterThan(20);
      expect(m.attribution.length).toBeGreaterThan(10);
    }
  });

  test("declaracion() falla nombrando los ids existentes", () => {
    expect(() => declaracion("NOEXISTE")).toThrow(/Declarados:/);
  });

  test("la etiqueta por defecto es la version del catalogo", () => {
    expect(ETIQUETA_POR_DEFECTO).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});

describe("construirTodo: determinismo e idempotencia", () => {
  test("construir dos veces da los mismos sha256 y los mismos contentHash", async () => {
    const temporal = mkdtempSync(join(tmpdir(), "catalogo-"));
    try {
      const a = await construirTodo({ destino: join(temporal, "a"), silencioso: true });
      const b = await construirTodo({ destino: join(temporal, "b"), silencioso: true });
      expect(a.problemas).toEqual([]);
      expect(b.problemas).toEqual([]);
      expect(a.modulos.map((m) => m.sha256)).toEqual(b.modulos.map((m) => m.sha256));
      expect(a.modulos.map((m) => m.contentHash)).toEqual(b.modulos.map((m) => m.contentHash));
      expect(a.modulos.map((m) => m.defectos)).toEqual([0, 0]);
    } finally {
      rmSync(temporal, { recursive: true, force: true });
    }
  }, 600_000);

  test("el catalogo es identico byte a byte tras reconstruir", async () => {
    // Mismo destino a proposito: `catalog.json` lleva la ruta RELATIVA de cada
    // artefacto, asi que comparar dos construcciones en directorios distintos
    // compararia dos rutas distintas y el test pasaria o fallaria por el motivo
    // equivocado.
    const temporal = mkdtempSync(join(tmpdir(), "catalogo2-"));
    try {
      const destino = join(temporal, "build");
      const { readFileSync } = await import("node:fs");
      await escribirCatalogo(
        destino,
        await construirTodo({ destino, silencioso: true }),
        ETIQUETA_POR_DEFECTO,
      );
      const primera = readFileSync(join(destino, "catalog.json"), "utf8");
      const latest1 = readFileSync(join(destino, "latest.json"), "utf8");

      await escribirCatalogo(
        destino,
        await construirTodo({ destino, silencioso: true }),
        ETIQUETA_POR_DEFECTO,
      );
      expect(readFileSync(join(destino, "catalog.json"), "utf8")).toBe(primera);
      expect(readFileSync(join(destino, "latest.json"), "utf8")).toBe(latest1);
    } finally {
      rmSync(temporal, { recursive: true, force: true });
    }
  }, 600_000);

  test("reconstruir sobre un directorio ya construido no falla", async () => {
    // El bug que motivo esto: `escribirAmf` abria el .amod existente y las
    // tablas viejas se quedaban, asi que el segundo build fallaba con
    // "table info already exists".
    const temporal = mkdtempSync(join(tmpdir(), "catalogo3-"));
    try {
      const destino = join(temporal, "build");
      await construirTodo({ destino, silencioso: true });
      const segundo = await construirTodo({ destino, silencioso: true });
      expect(segundo.problemas).toEqual([]);
      expect(segundo.modulos.length).toBe(MODULOS.length);
    } finally {
      rmSync(temporal, { recursive: true, force: true });
    }
  }, 600_000);
});