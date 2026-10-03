/**
 * Gate de licencia.
 *
 * PURE. Sin I/O, sin red, sin leer ficheros.
 *
 * Esa es la razon de ser de este modulo: al no tener acceso al mundo exterior,
 * nada de lo que diga el contenido del modulo puede influir en el veredicto.
 * El gate decide sobre los metadatos que se le entregan, no sobre lo que el
 * modulo afirme de si mismo.
 */

import { esDominioPublico, esLicenciaValida } from "./aceptadas.ts";

/** Metadatos minimos que la especificacion exige en la tabla `info`. */
export const CLAVES_OBLIGATORIAS = [
  "id",
  "type",
  "name",
  "language",
  "license",
  "license_evidence",
  "copyright",
  "attribution",
  "schema_version",
  "versification",
  "source",
  "origin",
] as const;

export type Info = Record<string, string>;

export type Violacion = {
  campo: string;
  motivo: string;
};

export type Resultado = {
  ok: boolean;
  licencia: string;
  violaciones: Violacion[];
};

const URL_VACIA = "";

function esUrlPlausible(valor: string): boolean {
  try {
    const u = new URL(valor);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Evalua los metadatos de un modulo.
 *
 * Devuelve todas las violaciones, no solo la primera: quien recibe el informe
 * deberia poder corregir todo de una vez.
 */
export function evaluar(info: Info): Resultado {
  const violaciones: Violacion[] = [];

  // 1. Campos obligatorios presentes y no vacios.
  for (const clave of CLAVES_OBLIGATORIAS) {
    const valor = info[clave];
    if (valor === undefined || valor.trim() === URL_VACIA) {
      violaciones.push({
        campo: clave,
        motivo: `campo obligatorio ausente o vacio: \`${clave}\``,
      });
    }
  }

  const licencia = info.license ?? URL_VACIA;

  // 2. La licencia debe pertenecer al conjunto permitido.
  if (licencia.trim() !== URL_VACIA && !esLicenciaValida(licencia)) {
    violaciones.push({
      campo: "license",
      motivo:
        `"${licencia}" no es una licencia admitida. ` +
        `Solo dominio publico o Creative Commons nombrada. ` +
        `Las etiquetas de editora no son licencias.`,
    });
  }

  // 3. La evidencia es obligatoria en todos los casos, incluido dominio publico.
  //    Sin prueba de por que el texto es libre, la declaracion no vale nada.
  const evidencia = info.license_evidence?.trim() ?? URL_VACIA;
  if (evidencia !== URL_VACIA && !esUrlPlausible(evidencia)) {
    violaciones.push({
      campo: "license_evidence",
      motivo: `"${evidencia}" no es una URL http(s) plausible`,
    });
  }

  return {
    ok: violaciones.length === 0,
    licencia,
    violaciones,
  };
}

/** Forma legible de informe, para CLI y CI. */
export function formatear(id: string, resultado: Resultado): string {
  if (resultado.ok) {
    const clase = esDominioPublico(resultado.licencia)
      ? "dominio publico"
      : resultado.licencia;
    return `OK    ${id.padEnd(24)} ${clase}`;
  }
  const lineas = [`FALLA ${id} — ${resultado.violaciones.length} violacion(es)`];
  for (const v of resultado.violaciones) {
    lineas.push(`        [${v.campo}] ${v.motivo}`);
  }
  return lineas.join("\n");
}