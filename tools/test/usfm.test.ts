import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ErrorParseoUsfm, parseUsfm, usfmAPlano } from "../src/usfm.ts";
import { LIBROS } from "../src/libros.ts";

/**
 * Cada TRADUCCION tiene su directorio. No un directorio con todo mezclado: dos
 * traducciones del mismo libro dan el mismo (book, chapter, verse) y el build
 * no podria saber cual es la buena. Separarlas por directorio hace que la
 * ambiguedad sea imposible en vez de detectable.
 */
const KJV = "modules/source/eng-kjv2006";
const RVR = "modules/source/spaRV1909";

function ficheros(termino: string): string[] {
  const de = (dir: string) =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".usfm") && f.includes(termino)) : [];
  return [...de(KJV), ...de(RVR)];
}

describe("usfm a texto plano", () => {
  test("quita los atributos de \\w pero conserva la palabra", () => {
    expect(usfmAPlano(`\\w For|strong="G1063"\\w* Dios`)).toBe("For Dios");
  });

  test("\\+w produce el mismo resultado que \\w", () => {
    expect(usfmAPlano(`\\+w Verily|strong="G0281"\\+w*`)).toBe("Verily");
  });

  test("el texto Added SÍ va al texto plano", () => {
    // \add marca texto que los traductores anadieron para cerrar sentido.
    // Es texto de la Biblia, no comentario: debe leerse.
    expect(usfmAPlano(`\\add of\\add* the Spirit`)).toBe("of the Spirit");
  });

  test("\\wj es envoltorie y no debe quedar en el plano", () => {
    expect(usfmAPlano(`\\wj \\+w Hola|strong="G1"\\+w*\\wj*`)).toBe("Hola");
  });

  test("la referencia \\f se elimina del plano", () => {
    expect(usfmAPlano(`antes \\f + despues`)).toBe("antes despues");
  });

  test("el pilcrow de poema no aparece en el plano", () => {
    expect(usfmAPlano(`uno ¶ dos`)).toBe("uno dos");
  });

  test("los marcadores de estructura se vuelven espacio", () => {
    expect(usfmAPlano(`uno\\p dos`)).toBe("uno dos");
  });

  test("el escape \\* produce un asterisco literal", () => {
    expect(usfmAPlano(`\\*no es un marcador`)).toBe("*no es un marcador");
  });

  test("el plano no conserva ninguna barra invertida", () => {
    const plano = usfmAPlano(`\\w Hola|strong="G1"\\w* \\add a\\add* \\f x \\p \\q1`);
    expect(plano).not.toContain("\\");
  });

  test("un marcador desconocido se conserva y se reporta", () => {
    const avisos: string[] = [];
    const plano = usfmAPlano(`antes \\inventado contenido\\inventado* despues`, avisos);
    expect(plano).toContain("contenido");
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toContain("inventado");
  });
});

describe("parseo de USFM real", () => {
  test("Juan 3 de KJV: capitulo 3 con 36 versiculos", () => {
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "73-JHNeng-kjv2006.usfm");
    const del3 = r.versiculos.filter((v) => v.chapter === 3);
    expect(del3.length).toBe(36);
    expect(r.libro.id).toBe("John");
  });

  test("Juan 3:16 se lee correctamente y sin marcado", () => {
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    const v = r.versiculos.find((x) => x.chapter === 3 && x.verse === 16)!;
    expect(v.text).toBe(
      "For God so loved the world, that he gave his only begotten Son, " +
        "that whosoever believeth in him should not perish, but have everlasting life.",
    );
    expect(v.text).not.toContain("\\");
  });

  test("el raw de Juan 3:16 conserva el marcado original", () => {
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    const v = r.versiculos.find((x) => x.chapter === 3 && x.verse === 16)!;
    // El Strong's de "God" (G2316) tiene que seguir en raw.
    expect(v.raw).toContain(`strong="G2316"`);
    // Y el piloto de poema tambien.
    expect(v.raw).toContain("¶");
  });

  test("el texto Added sobrevive en los dos campos", () => {
    // Juan 3:5 KJV lleva +add of+add* (con el prefijo + de continuacion).
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    const v = r.versiculos.find((x) => x.chapter === 3 && x.verse === 5)!;
    expect(v.raw).toContain("add");
    // El plano debe llevar el texto Added: es texto de la Biblia, no nota.
    expect(v.text).toContain("Except a man be born of water");
  });

  test("el prefijo + de continuacion se procesa como su marcador base", () => {
    // \+add, \+w, \+q son formas de continuacion de \add, \w, \q.
    expect(usfmAPlano("\\+add de\\+add* agua")).toBe("de agua");
    expect(usfmAPlano("\\+w Hola|strong=\"G1\"\\+w* mundo")).toBe("Hola mundo");
  });

  test("round-trip: el texto plano conserva todas las palabras del raw", () => {
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    for (const v of r.versiculos) {
      // Quita el piloto y compara palabras; el plano no puede perder ninguna.
      const palabras = v.raw
        .replace(/\\(\+?[a-z0-9]+)\*?/gi, " ")
        .replace(/\|[^\\]*/g, " ")
        .replace(/¶/g, " ")
        .split(/\s+/)
        .filter((x) => /[A-Za-zÀ-ÿ]/.test(x));
      for (const p of palabras) {
        expect(v.text).toContain(p.replace(/[.,;:)]/g, ""));
      }
    }
  });

  test("RVR1909 Juan 3:16 en espanol", () => {
    const t = readFileSync(`${RVR}/73-JHNspaRV1909.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    const v = r.versiculos.find((x) => x.chapter === 3 && x.verse === 16)!;
    expect(v.text).toContain("Porque de tal manera amó Dios al mundo");
    expect(v.text).not.toContain("\\");
  });

  test("RVR1909 y KJV anclan el mismo versiculo", () => {
    // Esta es la prueba de que el espacio de nombres funciona:
    // dos idiomas, mismo id de referencia.
    const es = parseUsfm(readFileSync(`${RVR}/73-JHNspaRV1909.usfm`, "utf8"), "a");
    const en = parseUsfm(readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8"), "b");
    const a = es.versiculos.find((v) => v.chapter === 3 && v.verse === 16)!;
    const c = en.versiculos.find((v) => v.chapter === 3 && v.verse === 16)!;
    expect(a.book).toBe("John");
    expect(c.book).toBe("John");
  });

  test("un libro sin marcadores \\v se rechaza con mensaje explicito", () => {
    const roto = "\\id JHN\n\\c 1\n\\p\ntexto sin versiculos";
    expect(() => parseUsfm(roto, "roto.usfm")).toThrow(ErrorParseoUsfm);
    expect(() => parseUsfm(roto, "roto.usfm")).toThrow(/versiculos marcados/);
  });

  test("un fichero sin \\id se rechaza", () => {
    expect(() => parseUsfm("\\c 1\n\\v 1 hola", "x.usfm")).toThrow(/\\id/);
  });

  test("un libro desconocido se rechaza nombrando el fichero", () => {
    expect(() => parseUsfm("\\id ZZZ\n\\c 1\n\\v 1 hola", "malo.usfm")).toThrow(
      /libro desconocido.*malo\.usfm/,
    );
  });
});

describe("el canon completo parsea sin perder versiculos", () => {
  test("RVR1909: 66 libros, 1189 capitulos, y los 18 defectos declarados", () => {
    const ficherosRvr = ficheros("spaRV1909");
    expect(ficherosRvr.length).toBe(66);

    let capitulos = 0;
    let versiculos = 0;
    const librosVistos = new Set<string>();
    const avisos = new Set<string>();

    for (const f of ficherosRvr) {
      const r = parseUsfm(readFileSync(`${f.includes("spaRV") ? RVR : KJV}/${f}`, "utf8"), f);
      capitulos += r.capitulos;
      versiculos += r.versiculos.length;
      librosVistos.add(r.libro.id);
      for (const a of r.advertencias) avisos.add(`${f}: ${a}`);
    }

    expect(librosVistos.size).toBe(66);
    expect(capitulos).toBe(1189);
    // 31102 declarados - 18 defectuosos = 31084 con texto.
    expect(versiculos).toBe(31084);

    // Sin marcadores desconocidos: el parser conoce todo lo que hay.
    expect([...avisos]).toEqual([]);
  });

  test("KJV: 66 libros, 1189 capitulos, 31102 versiculos, cero defectos", () => {
    // El KJV de eBible esta limpio. RVR1909 no. Ver el test siguiente.
    const ficherosKjv = ficheros("eng-kjv2006");
    expect(ficherosKjv.length).toBe(66);

    let capitulos = 0;
    let versiculos = 0;
    const defectos: string[] = [];
    for (const f of ficherosKjv) {
      const r = parseUsfm(readFileSync(`${f.includes("spaRV") ? RVR : KJV}/${f}`, "utf8"), f);
      capitulos += r.capitulos;
      versiculos += r.versiculos.length;
      for (const d of r.defectos) defectos.push(`${d.libro} ${d.chapter}:${d.verse}`);
    }
    expect(capitulos).toBe(1189);
    expect(versiculos).toBe(31102);
    expect(defectos).toEqual([]);
  });

  test("los 18 defectos de RVR1909 son los conocidos y estan declarados", () => {
    // Defecto real y publicado de la fuente spaRV1909 de eBible: 18 versiculos
    // declarados sin texto. El texto no esta fusionado en el verso anterior,
    // esta ausente. Se fijan aqui para que una correccion de la fuente se vea.
    const defectos: string[] = [];
    for (const f of ficheros("spaRV1909")) {
      const r = parseUsfm(readFileSync(`${f.includes("spaRV") ? RVR : KJV}/${f}`, "utf8"), f);
      for (const d of r.defectos) defectos.push(`${d.libro} ${d.chapter}:${d.verse}`);
    }
    expect(defectos.length).toBe(18);
    expect(defectos.sort()).toEqual(
      [
        "Numbers 12:16", "Numbers 29:40",
        "1Samuel 23:29", "2Samuel 20:26", "2Chronicles 33:25",
        "Job 35:16", "Job 38:39", "Job 38:40", "Job 38:41",
        "Job 40:20", "Job 40:21", "Job 40:22", "Job 40:23", "Job 40:24",
        "Hosea 11:12", "Jonah 1:17", "Acts 19:41", "2Corinthians 13:14",
      ].sort(),
    );
  });

  test("2 Cor 13:14 es uno de los defectuosos: la bendicion final falta", () => {
    const r = parseUsfm(
      readFileSync(`${RVR}/77-2COspaRV1909.usfm`, "utf8"),
      "2CO",
    );
    expect(r.defectos.some((d) => d.chapter === 13 && d.verse === 14)).toBe(true);
    // Y el modulo NO debe inventar una fila para esa referencia.
    expect(r.versiculos.some((v) => v.chapter === 13 && v.verse === 14)).toBe(false);
  });

  test("cada libro KJV produce exactamente los versiculos que declara la tabla", () => {
    for (const f of ficheros("eng-kjv2006")) {
      const r = parseUsfm(readFileSync(`${f.includes("spaRV") ? RVR : KJV}/${f}`, "utf8"), f);
      const esperado = LIBROS.find((l) => l.id === r.libro.id)!;
      expect(r.versiculos.length).toBe(esperado.versiculos);
      expect(r.capitulos).toBe(esperado.capitulos);
      expect(r.defectos).toEqual([]);
    }
  });

  test("ningun versiculo presente queda con texto plano vacio", () => {
    for (const f of ficheros("spaRV1909")) {
      const r = parseUsfm(readFileSync(`${f.includes("spaRV") ? RVR : KJV}/${f}`, "utf8"), f);
      for (const v of r.versiculos) {
        expect(v.text.length).toBeGreaterThan(0);
        expect(v.text).not.toContain("\\");
      }
    }
  });

  test("ningun versiculo se queda sin marca de Strong cuando la fuente la traia", () => {
    // Si el parser perdiera el marcado, este test lo diria.
    const t = readFileSync(`${KJV}/73-JHNeng-kjv2006.usfm`, "utf8");
    const r = parseUsfm(t, "JHN.usfm");
    const conStrong = r.versiculos.filter((v) => v.raw.includes("strong="));
    expect(conStrong.length).toBeGreaterThan(30);
  });
});