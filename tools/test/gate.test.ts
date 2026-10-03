import { describe, expect, test } from "bun:test";
import {
  LICENCIAS_PERMITIDAS,
  RECHAZOS_ESPERADOS,
  esDominioPublico,
  esLicenciaValida,
} from "../src/aceptadas.ts";
import { CLAVES_OBLIGATORIAS, evaluar, formatear, type Info } from "../src/gate.ts";

/** Metadatos validos de referencia. Cada test altera solo lo que necesita. */
function infoBase(): Info {
  return {
    id: "RVR1909",
    type: "bible",
    name: "Reina-Valera 1909",
    language: "es",
    license: "PublicDomain",
    license_evidence: "https://example.org/dominio-publico/reina-valera-1909",
    copyright: "Dominio publico",
    attribution: "Reina-Valera 1909, texto de dominio publico",
    schema_version: "3",
    versification: "KJV",
    source: "https://example.org/fuente/rvr1909.usfm",
    origin: "aa/tools",
  };
}

describe("conjunto de licencias admitidas", () => {
  test("acepta exactamente las 8 declaradas", () => {
    expect(LICENCIAS_PERMITIDAS).toHaveLength(8);
    for (const l of LICENCIAS_PERMITIDAS) {
      expect(esLicenciaValida(l)).toBe(true);
    }
  });

  test("rechaza las etiquetas de editora y las variantes mal escritas", () => {
    for (const l of RECHAZOS_ESPERADOS) {
      expect(esLicenciaValida(l)).toBe(false);
    }
  });

  test("distingue dominio publico de Creative Commons", () => {
    expect(esDominioPublico("PublicDomain")).toBe(true);
    expect(esDominioPublico("CC-BY-SA-4.0")).toBe(false);
  });
});

describe("gate: camino feliz", () => {
  test("acepta un modulo de dominio publico bien documentado", () => {
    const r = evaluar(infoBase());
    expect(r.violaciones).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("acepta Creative Commons con evidencia", () => {
    const r = evaluar({ ...infoBase(), license: "CC-BY-SA-4.0" });
    expect(r.ok).toBe(true);
  });

  test("informe de exito es legible", () => {
    expect(formatear("RVR1909", evaluar(infoBase()))).toContain("dominio publico");
  });
});

describe("gate: licencia no admitida", () => {
  test("rechaza copyright", () => {
    const r = evaluar({ ...infoBase(), license: "Copyrighted" });
    expect(r.ok).toBe(false);
    expect(r.violaciones.map((v) => v.campo)).toContain("license");
  });

  test("rechaza una etiqueta de editora", () => {
    const r = evaluar({ ...infoBase(), license: "RVR1960" });
    expect(r.ok).toBe(false);
    expect(r.violaciones[0].motivo).toContain("editora");
  });

  test("rechaza una variante mal escrita", () => {
    const r = evaluar({ ...infoBase(), license: " creatively adapted" });
    expect(r.ok).toBe(false);
  });

  test("el motivo nombra el valor rechazado", () => {
    const r = evaluar({ ...infoBase(), license: "NIV" });
    expect(r.violaciones.some((v) => v.motivo.includes("NIV"))).toBe(true);
  });
});

describe("gate: evidencia obligatoria", () => {
  test("dominio publico sin evidencia se rechaza", () => {
    const r = evaluar({ ...infoBase(), license_evidence: "" });
    expect(r.ok).toBe(false);
    expect(r.violaciones.map((v) => v.campo)).toContain("license_evidence");
  });

  test("Creative Commons sin evidencia se rechaza", () => {
    const r = evaluar({ ...infoBase(), license: "CC-BY-4.0", license_evidence: "" });
    expect(r.ok).toBe(false);
  });

  test("evidencia que no es URL se rechaza", () => {
    const r = evaluar({ ...infoBase(), license_evidence: "es de dominio publico, si" });
    expect(r.ok).toBe(false);
    expect(r.violaciones.map((v) => v.campo)).toContain("license_evidence");
  });

  test("URL no http se rechaza", () => {
    const r = evaluar({ ...infoBase(), license_evidence: "file:///etc/passwd" });
    expect(r.ok).toBe(false);
  });
});

describe("gate: procedencia y atribucion obligatorias", () => {
  for (const clave of ["origin", "source", "attribution", "copyright", "name", "language"]) {
    test(`rechaza un modulo sin \`${clave}\``, () => {
      const info = infoBase();
      delete info[clave];
      const r = evaluar(info);
      expect(r.ok).toBe(false);
      const v = r.violaciones.find((x) => x.campo === clave);
      expect(v).toBeDefined();
      expect(v!.motivo).toContain(clave);
    });
  }

  test("rechaza un modulo sin ninguna metadatos", () => {
    const r = evaluar({});
    expect(r.ok).toBe(false);
    // Falla por cada clave obligatoria.
    expect(r.violaciones.length).toBe(CLAVES_OBLIGATORIAS.length);
  });
});

describe("gate: el contenido no puede auto-aprobarse", () => {
  test("afirmar que se esta aprobado dentro de info no cambia el veredicto", () => {
    const info = {
      ...infoBase(),
      license_evidence: "", // se declara aprobado por otra via
      gate_verdict: "approved",
      verificado: "true",
      license: "RVR1960",
    } as Info;

    const r = evaluar(info);
    expect(r.ok).toBe(false);
    // Sigue falling por licencia invalida y por evidencia ausente.
    expect(r.violaciones.map((v) => v.campo).sort()).toEqual(
      ["license", "license_evidence"].sort(),
    );
  });

  test("claves desconocidas no(systema) pueden limpiar el veredicto", () => {
    const info = { ...infoBase(), license: "Copyrighted", approved: "1" } as Info;
    expect(evaluar(info).ok).toBe(false);
  });

  test("el veredicto depende solo de licencia y evidencia", () => {
    const conRuido = evaluar({
      ...infoBase(),
      archivo: "no leo nada",
      autor: "quien sea",
    } as Info);
    expect(conRuido.ok).toBe(true);
  });
});

describe("gate: informe de fallo", () => {
  test("lista todas las violaciones, no solo la primera", () => {
    const info = infoBase();
    delete info.origin;
    delete info.attribution;
    info.license = "Copyrighted";
    const r = evaluar(info);
    expect(r.violaciones.length).toBeGreaterThanOrEqual(3);
  });

  test("el informe formateado menciona el id y el campo", () => {
    const r = evaluar({ ...infoBase(), license: "ESV" });
    const texto = formatear("RVR1960", r);
    expect(texto).toContain("RVR1909".slice(0, 4));
    expect(texto).toContain("[license]");
  });
});