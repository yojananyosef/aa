import { describe, expect, test } from "bun:test";
import {
  CAPITULOS_CANON,
  LIBROS,
  LIBROS_CANON,
  VERSICULOS_CANON,
  buscarPorId,
  buscarPorUsfm,
  canonicoDesdeUsfm,
  idUsfmDesdeNombreFichero,
} from "../src/libros.ts";

describe("tabla canonica de libros", () => {
  test("tiene 66 libros", () => {
    expect(LIBROS_CANON).toBe(66);
  });

  test("los tres invariantes del canon KJV se cumplen", () => {
    // Estos numeros vienen del texto KJV de referencia, no de memoria.
    // Si alguno se mueve, la tabla se ha corrompido.
    expect(CAPITULOS_CANON).toBe(1189);
    expect(VERSICULOS_CANON).toBe(31102);
  });

  test("ningun id canonico duplicado", () => {
    const ids = LIBROS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ningun id USFM duplicado", () => {
    const usfm = LIBROS.map((l) => l.idUsfm);
    expect(new Set(usfm).size).toBe(usfm.length);
  });

  test("todo libro tiene nombre, capitulos y versiculos", () => {
    for (const l of LIBROS) {
      expect(l.nombre.length).toBeGreaterThan(0);
      expect(l.nombreEn.length).toBeGreaterThan(0);
      expect(l.capitulos).toBeGreaterThan(0);
      expect(l.versiculos).toBeGreaterThan(0);
    }
  });

  test("libros de un solo capitulo tienen la versificacion coherente", () => {
    for (const l of LIBROS.filter((x) => x.capitulos === 1)) {
      // Un libro de un capitulo no puede pasar de 100 versiculos.
      expect(l.versiculos).toBeLessThanOrEqual(100);
    }
  });

  test("ningun libro declara mas versiculos que su version KJV de referencia", () => {
    // Valores de referencia para los libros que mas se confundian al teclear.
    const referencia: Record<string, number> = {
      Joshua: 658,
      Judges: 618,
      "1Samuel": 810,
      "2Samuel": 695,
      "1Kings": 816,
      "2Kings": 719,
      Psalms: 2461,
      Proverbs: 915,
      Isaiah: 1292,
      Jeremiah: 1364,
      Ezekiel: 1273,
      Daniel: 357,
      Matthew: 1071,
      John: 879,
      Revelation: 404,
    };
    for (const [id, v] of Object.entries(referencia)) {
      expect(buscarPorId(id)?.versiculos).toBe(v);
    }
  });
});

describe("traduccion de id USFM a id canonico", () => {
  test("los nombres de fichero de eBible se reconocen", () => {
    expect(idUsfmDesdeNombreFichero("73-JHNspaRV1909.usfm")).toBe("JHN");
    expect(idUsfmDesdeNombreFichero("01-GENKJV.usfm")).toBe("GEN");
    expect(idUsfmDesdeNombreFichero("65-LUKKJV.usfm")).toBe("LUK");
  });

  test("nombre de fichero inesperado se rechaza con mensaje util", () => {
    expect(() => idUsfmDesdeNombreFichero("loquesea.usfm")).toThrow(/no reconocido/);
  });

  test("JHN resuelve a John", () => {
    const l = canonicoDesdeUsfm("JHN");
    expect(l.id).toBe("John");
    expect(l.nombre).toBe("Juan");
  });

  test("PSA resuelve a Psalms, no a Salmos", () => {
    // El id canonico es independiente del idioma del texto: eso es lo que
    // permite anclar un comentario en ingles sobre una Biblia en espanol.
    expect(canonicoDesdeUsfm("PSA").id).toBe("Psalms");
  });

  test("la busqueda ignora espacios y mayusculas", () => {
    expect(canonicoDesdeUsfm("  jhn  ").id).toBe("John");
  });

  test("libro desconocido se rechaza, no se descarta en silencio", () => {
    expect(() => canonicoDesdeUsfm("XXX")).toThrow(/libro desconocido/);
  });

  test("buscarPorId y buscarPorUsfm devuelven undefined, no lanza", () => {
    expect(buscarPorId("NoExiste")).toBeUndefined();
    expect(buscarPorUsfm("XXX")).toBeUndefined();
  });

  test("todos los 66 libros son alcanzables desde su id USFM", () => {
    for (const l of LIBROS) {
      expect(canonicoDesdeUsfm(l.idUsfm).id).toBe(l.id);
    }
  });
});