/**
 * Conjunto de licencias admitidas.
 *
 * Regla del proyecto: solo dominio publico o Creative Commons nombrada.
 * Cualquier otra cosa se rechaza, incluidas variantes mal escritas.
 *
 * Una etiqueta de editora ("RVR1960"), un texto libre, o unCC mal escrito
 * NO son licencias. Si no esta en esta lista, no pasa.
 */

export const LICENCIAS_PERMITIDAS = [
  "PublicDomain",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-3.0",
  "CC-BY-SA-3.0",
] as const;

export type LicenciaPermitida = (typeof LICENCIAS_PERMITIDAS)[number];

const PERMITIDAS = new Set<string>(LICENCIAS_PERMITIDAS);

/** Dominio publico implica que no hay ninguna restriccion que respetar. */
export function esDominioPublico(licencia: string): boolean {
  return licencia === "PublicDomain";
}

export function esLicenciaValida(licencia: string): boolean {
  return PERMITIDAS.has(licencia);
}

/** Etiquetas que aparecen con frecuencia y que NUNCA son licencias admitidas. */
export const RECHAZOS_ESPERADOS = [
  "Copyrighted",
  "RVR1960",
  "RVR60",
  "NBLA",
  "TBO",
  "NVI",
  "ESV",
  "NIV",
  "NASB",
  "CSB",
  "Propiedad intelectual",
  " creatively adapted",
  "",
  "public domain", // minuscula: no es el valor canonico
  "PUBLIC DOMAIN",
] as const;