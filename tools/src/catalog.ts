/**
 * Catalogo: tipos, lectura y validacion.
 *
 * El catalogo es el control plane. Es pequeno, cambia rapido y se cachea.
 * Nunca debe contener contenido: solo metadatos y punteros.
 */

import { existsSync, readFileSync } from "node:fs";
import { sha256DeFichero, tamanoDeFichero } from "./hash.ts";

export const CAMPOS_MINIMOS = [
  "id",
  "type",
  "name",
  "language",
  "license",
  "license_evidence",
  "version",
  "schemaVersion",
  "minReaderVersion",
  "sizeBytes",
  "sha256",
  "downloadUrl",
] as const;

export type TipoModulo = "bible" | "commentary";

/** Tipos admitidos en esta fase. Anadir mas exige un change de OpenSpec. */
export const TIPOS_ADMITIDOS: readonly TipoModulo[] = ["bible", "commentary"];

export type EntradaCatalogo = {
  id: string;
  type: TipoModulo;
  name: string;
  language: string;
  license: string;
  license_evidence: string;
  version: string;
  schemaVersion: number;
  minReaderVersion: number;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  /** Ruta local relativa, usada por la validacion de integridad. */
  path?: string;
};

export type Catalogo = {
  format: string;
  version: string;
  modules: EntradaCatalogo[];
};

export type Latest = {
  tag: string;
  url: string;
  catalogSha256?: string;
};

export type Problema =
  | { clase: "campo"; id: string; campo: string; motivo: string }
  | { clase: "integridad"; id: string; estado: EstadoIntegridad; motivo?: string }
  | { clase: "licencia"; id: string; motivo: string }
  | { clase: "estructura"; motivo: string };

export type EstadoIntegridad = "valid" | "invalid" | "missing";

export type ResultadoValidacion = {
  ok: boolean;
  problemas: Problema[];
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function leerCatalogo(ruta: string): Catalogo {
  return JSON.parse(readFileSync(ruta, "utf8")) as Catalogo;
}

export function leerLatest(ruta: string): Latest {
  return JSON.parse(readFileSync(ruta, "utf8")) as Latest;
}

/**
 * Valida el catalogo contra disco.
 *
 * Tres comprobaciones independientes: forma de los campos, integridad de los
 * artefactos, y coherencia con latest.json.
 */
export async function validarCatalogo(
  catalogo: Catalogo,
  raiz: string,
  latest?: Latest,
): Promise<ResultadoValidacion> {
  const problemas: Problema[] = [];

  if (!Array.isArray(catalogo.modules) || catalogo.modules.length === 0) {
    problemas.push({ clase: "estructura", motivo: "el catalogo no declara modulos" });
    return { ok: false, problemas };
  }

  const vistos = new Set<string>();

  for (const m of catalogo.modules) {
    // --- 1. Campos minimos presentes y con forma valida ---
    for (const campo of CAMPOS_MINIMOS) {
      const valor = (m as Record<string, unknown>)[campo];
      if (valor === undefined || valor === null || String(valor).trim() === "") {
        problemas.push({
          clase: "campo",
          id: m.id ?? "(sin id)",
          campo,
          motivo: `campo obligatorio ausente o vacio: \`${campo}\``,
        });
      }
    }

    if (m.sha256 && !SHA256_HEX.test(m.sha256)) {
      problemas.push({
        clase: "campo",
        id: m.id,
        campo: "sha256",
        motivo: `no es un sha256 hexadecimal de 64 caracteres: "${m.sha256}"`,
      });
    }

    if (m.type && !TIPOS_ADMITIDOS.includes(m.type)) {
      problemas.push({
        clase: "campo",
        id: m.id,
        campo: "type",
        motivo: `tipo "${m.type}" fuera de esta fase (${TIPOS_ADMITIDOS.join(", ")})`,
      });
    }

    // --- 2. Identificadores unicos ---
    if (vistos.has(m.id)) {
      problemas.push({
        clase: "estructura",
        motivo: `id duplicado en el catalogo: "${m.id}"`,
      });
    }
    vistos.add(m.id);

    // --- 3. Integridad contra disco ---
    const rutaArtefacto = m.path ? `${raiz}/${m.path}` : `${raiz}/modules/${m.id}_${m.type}.amod`;
    const estado = await verificarIntegridad(rutaArtefacto, m.sha256, m.sizeBytes);

    if (estado.estado !== "valid") {
      problemas.push({ clase: "integridad", id: m.id, estado: estado.estado, motivo: estado.motivo });
    }
  }

  // --- 4. Coherencia con el puntero flotante ---
  if (latest) {
    if (!latest.tag || latest.tag.trim() === "") {
      problemas.push({ clase: "estructura", motivo: "latest.json no declara `tag`" });
    }
    if (!latest.url || latest.url.trim() === "") {
      problemas.push({ clase: "estructura", motivo: "latest.json no declara `url`" });
    }
  }

  return { ok: problemas.length === 0, problemas };
}

export type ResultadoIntegridad = {
  estado: EstadoIntegridad;
  motivo?: string;
  hashReal?: string;
};

export async function verificarIntegridad(
  ruta: string,
  sha256Declarado: string,
  tamanoDeclarado?: number,
): Promise<ResultadoIntegridad> {
  if (!existsSync(ruta)) {
    return {
      estado: "missing",
      motivo: `no existe el artefacto: ${ruta}`,
    };
  }

  const hashReal = await sha256DeFichero(ruta);

  if (hashReal !== sha256Declarado) {
    return {
      estado: "invalid",
      hashReal,
      motivo:
        `sha256 no coincide\n` +
        `        declarado: ${sha256Declarado}\n` +
        `        en disco:  ${hashReal}\n` +
        `        fichero:   ${ruta}`,
    };
  }

  if (tamanoDeclarado !== undefined) {
    const real = tamanoDeFichero(ruta);
    if (real !== null && real !== tamanoDeclarado) {
      return {
        estado: "invalid",
        hashReal,
        motivo: `tamano no coincide: declarado ${tamanoDeclarado} bytes, en disco ${real}`,
      };
    }
  }

  return { estado: "valid", hashReal };
}