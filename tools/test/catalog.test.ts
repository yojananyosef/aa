import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256DeFichero, sha256DeTexto, tamanoDeFichero } from "../src/hash.ts";
import {
  leerCatalogo,
  leerLatest,
  validarCatalogo,
  verificarIntegridad,
  type Catalogo,
  type EntradaCatalogo,
} from "../src/catalog.ts";

const temporales: string[] = [];

function dirTemporal(): string {
  const d = mkdtempSync(join(tmpdir(), "aa-test-"));
  temporales.push(d);
  return d;
}

afterAll(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

const EVIDENCIA = "https://example.org/dominio-publico/rvr1909";

function entrada(over: Partial<EntradaCatalogo> = {}): EntradaCatalogo {
  return {
    id: "RVR1909",
    type: "bible",
    name: "Reina-Valera 1909",
    language: "es",
    license: "PublicDomain",
    license_evidence: EVIDENCIA,
    version: "1.0.0",
    schemaVersion: 3,
    minReaderVersion: 1,
    sizeBytes: 0,
    sha256: "0".repeat(64),
    downloadUrl: "https://example.org/releases/v1/modules/RVR1909_bible.amod",
    ...over,
  };
}

describe("hash", () => {
  test("sha256 de texto conocido", () => {
    // sha256("")
    expect(sha256DeTexto("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("sha256 de 'abc' conocido", () => {
    expect(sha256DeTexto("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("sha256 de fichero coincide con el de su texto", async () => {
    const d = dirTemporal();
    const ruta = join(d, "x.txt");
    writeFileSync(ruta, "contenido de prueba");
    expect(await sha256DeFichero(ruta)).toBe(sha256DeTexto("contenido de prueba"));
  });

  test("sha256 de fichero grande en streaming", async () => {
    const d = dirTemporal();
    const ruta = join(d, "grande.bin");
    const trozo = "x".repeat(1024 * 1024);
    writeFileSync(ruta, trozo.repeat(3)); // 3 MB
    expect(await sha256DeFichero(ruta)).toBe(sha256DeTexto(trozo.repeat(3)));
  });

  test("tamano de fichero, y null si no existe", () => {
    const d = dirTemporal();
    const ruta = join(d, "y.txt");
    writeFileSync(ruta, "12345");
    expect(tamanoDeFichero(ruta)).toBe(5);
    expect(tamanoDeFichero(join(d, "no-existe"))).toBeNull();
  });
});

describe("integridad de artefactos", () => {
  test("artefacto intacto: valid", async () => {
    const d = dirTemporal();
    const ruta = join(d, "m.amod");
    writeFileSync(ruta, "contenido");
    const r = await verificarIntegridad(ruta, sha256DeTexto("contenido"), 9);
    expect(r.estado).toBe("valid");
  });

  test("artefacto ausente: missing, nombrando la ruta", async () => {
    const d = dirTemporal();
    const r = await verificarIntegridad(join(d, "no-existe.amod"), "0".repeat(64));
    expect(r.estado).toBe("missing");
    expect(r.motivo).toContain("no-existe.amod");
  });

  test("artefacto corrupto: invalid, nombrando los DOS hashes", async () => {
    const d = dirTemporal();
    const ruta = join(d, "m.amod");
    writeFileSync(ruta, "contenido alterado");
    const declarado = sha256DeTexto("contenido original");
    const r = await verificarIntegridad(ruta, declarado);
    expect(r.estado).toBe("invalid");
    // El requisito exige reportar ambos hashes.
    expect(r.motivo).toContain(declarado);
    expect(r.motivo).toContain(sha256DeTexto("contenido alterado"));
  });

  test("tamano declarado que no coincide: invalid", async () => {
    const d = dirTemporal();
    const ruta = join(d, "m.amod");
    writeFileSync(ruta, "0123456789");
    const r = await verificarIntegridad(ruta, sha256DeTexto("0123456789"), 999);
    expect(r.estado).toBe("invalid");
    expect(r.motivo).toContain("999");
  });
});

describe("validacion de campos del catalogo", () => {
  function cat(modulos: EntradaCatalogo[]): Catalogo {
    return { format: "aa-catalog", version: "1", modules: modulos };
  }

  test("campo obligatorio ausente nombra el campo", async () => {
    const e = entrada();
    delete (e as Record<string, unknown>).sha256;
    const r = await validarCatalogo(cat([e]), "/raiz/inexistente");
    const p = r.problemas.find((x) => x.clase === "campo" && x.campo === "sha256");
    expect(p).toBeDefined();
    expect(r.ok).toBe(false);
  });

  test("campo obligatorio vacio nombra el campo", async () => {
    const r = await validarCatalogo(cat([entrada({ attribution: undefined as never, name: "  " })]), "/x");
    expect(r.problemas.some((x) => x.clase === "campo" && x.campo === "name")).toBe(true);
  });

  test("sha256 mal formado se rechaza por forma, no por integridad", async () => {
    const r = await validarCatalogo(cat([entrada({ sha256: "no-es-un-hash" })]), "/x");
    const p = r.problemas.find((x) => x.clase === "campo" && x.campo === "sha256");
    expect(p?.motivo).toContain("64");
  });

  test("tipo fuera de esta fase se rechaza", async () => {
    const r = await validarCatalogo(
      cat([entrada({ type: "lexicon" as never })]),
      "/x",
    );
    const p = r.problemas.find((x) => x.clase === "campo" && x.campo === "type");
    expect(p?.motivo).toContain("bible, commentary");
  });

  test("id duplicado se detecta", async () => {
    const r = await validarCatalogo(cat([entrada(), entrada()]), "/x");
    expect(r.problemas.some((x) => x.clase === "estructura" && x.motivo.includes("duplicado"))).toBe(
      true,
    );
  });

  test("catalogo sin modulos se rechaza", async () => {
    const r = await validarCatalogo({ format: "x", version: "1", modules: [] }, "/x");
    expect(r.ok).toBe(false);
    expect(r.problemas[0].clase).toBe("estructura");
  });

  test("catalogo sin array de modulos se rechaza sin lanzar excepcion", async () => {
    const r = await validarCatalogo({ format: "x", version: "1" } as unknown as Catalogo, "/x");
    expect(r.ok).toBe(false);
  });
});

describe("coherencia con el puntero flotante", () => {
  const cat: Catalogo = { format: "aa-catalog", version: "1", modules: [entrada()] };

  test("latest.json sin tag se reporta", async () => {
    const r = await validarCatalogo(cat, "/x", { tag: "", url: "https://e.org/c.json" });
    expect(r.problemas.some((p) => p.clase === "estructura" && p.motivo.includes("`tag`"))).toBe(true);
  });

  test("latest.json sin url se reporta", async () => {
    const r = await validarCatalogo(cat, "/x", { tag: "v1.0.0", url: "" });
    expect(r.problemas.some((p) => p.clase === "estructura" && p.motivo.includes("`url`"))).toBe(true);
  });

  test("latest.json completo no aporta problemas", async () => {
    const r = await validarCatalogo(cat, "/x", { tag: "v1.0.0", url: "https://e.org/c.json" });
    expect(r.problemas.filter((p) => p.clase === "estructura")).toEqual([]);
  });
});

describe("validacion completa contra disco", () => {
  test("catalogo real con artefactos reales pasa", async () => {
    const raiz = dirTemporal();
    mkdirSync(join(raiz, "modules"), { recursive: true });
    const contenido = "contenido del artefacto";
    writeFileSync(join(raiz, "modules", "RVR1909_bible.amod"), contenido);

    const cat: Catalogo = {
      format: "aa-catalog",
      version: "1",
      modules: [entrada({ sha256: sha256DeTexto(contenido), sizeBytes: contenido.length })],
    };
    const r = await validarCatalogo(cat, raiz);
    // Solo queda el problema de latest si no se pasa. Sin latest: debe pasar.
    expect(r.ok).toBe(true);
  });

  test("catalogo que apunta a un artefacto ausente falla", async () => {
    const raiz = dirTemporal();
    const cat: Catalogo = {
      format: "aa-catalog",
      version: "1",
      modules: [entrada()],
    };
    const r = await validarCatalogo(cat, raiz);
    expect(r.ok).toBe(false);
    const p = r.problemas.find((x) => x.clase === "integridad");
    expect(p && "estado" in p && p.estado).toBe("missing");
  });
});

describe("lectura de ficheros del catalogo", () => {
  test("leerCatalogo y leerLatest parsean JSON", () => {
    const d = dirTemporal();
    writeFileSync(join(d, "catalog.json"), JSON.stringify({ format: "f", version: "1", modules: [] }));
    writeFileSync(join(d, "latest.json"), JSON.stringify({ tag: "v1", url: "https://e.org" }));
    expect(leerCatalogo(join(d, "catalog.json")).format).toBe("f");
    expect(leerLatest(join(d, "latest.json")).tag).toBe("v1");
  });
});