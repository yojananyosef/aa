/**
 * Hash de ficheros.
 *
 * Usa node:crypto (incluido en Bun y en Node) para no anadir dependencias.
 * Streaming: un .amod puede pesar cientos de MB y no debe caber entero en
 * memoria para comprobar su integridad.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";

export function sha256DeTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** sha256 de un fichero, en streaming. */
export function sha256DeFichero(ruta: string): Promise<string> {
  const h = createHash("sha256");
  const flujo = createReadStream(ruta);
  return new Promise((resolver, rechazar) => {
    flujo.on("data", (trozo) => h.update(trozo));
    flujo.on("end", () => resolver(h.digest("hex")));
    flujo.on("error", rechazar);
  });
}

/** Tamano en bytes, o null si no existe. */
export function tamanoDeFichero(ruta: string): number | null {
  if (!existsSync(ruta)) return null;
  return statSync(ruta).size;
}