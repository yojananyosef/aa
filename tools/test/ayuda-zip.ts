/**
 * Ayudante de test: escribe un zip minimo CON deflate.
 *
 * Existe para comprobar que `leerZip` tolera entradas de otro escritor. No
 * pertenece al catalogo: es solo una referencia minima del formato, escrita
 * aqui para no depender de como este proyecto hace las cosas.
 */

import { deflateRawSync } from "node:zlib";
import { crc32 } from "../src/bundle.ts";

export function escribirConDeflate(destino: string, nombre: string, datos: Buffer): void {
  const comprimido = deflateRawSync(datos);
  const nombreBuf = Buffer.from(nombre, "utf8");
  const crc = crc32(datos);
  const trozos: Buffer[] = [];

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); // metodo 8 = deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(datos.length, 22);
  local.writeUInt16LE(nombreBuf.length, 26);
  trozos.push(local, nombreBuf, comprimido);

  const inicioCentral = trozos.reduce((n, b) => n + b.length, 0);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comprimido.length, 20);
  central.writeUInt32LE(datos.length, 24);
  central.writeUInt16LE(nombreBuf.length, 28);
  central.writeUInt32LE(0, 42);
  trozos.push(central, nombreBuf);

  const tamCentral = trozos.slice(-2).reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(inicioCentral, 16);
  trozos.push(fin);

  require("node:fs").writeFileSync(destino, Buffer.concat(trozos));
}
