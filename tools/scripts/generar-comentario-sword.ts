/**
 * Genera el USFM del comentario de Clarke a partir del modulo SWORD.
 *
 * Es un paso de ADQUISICION DE FUENTE, no parte del catalogo: se ejecuta una
 * vez y deja USFM en `modules/source/clarke/`. A partir de ahi, todo lo demas
 * (el parser, el build, el gate, los hashes) es igual que para cualquier otra
 * fuente y no sabe que existio un SWORD.
 *
 * Uso:
 *   bun run tools/scripts/generar-comentario-sword.ts \
 *     --zip /ruta/Clarke.zip --destino modules/source/clarke \
 *     --id CLARKE --nombre-sword Clarke
 *
 * El `.zip` del modulo se descarga de CrossWire:
 *   https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/Clarke.zip
 *
 * Por que no se copia el `.zip` al repositorio: son 8,6 MB de datos
 * comprimidos con un formato propietario de SWORD. Lo que se versiona es el
 * USFM, que es texto plano y se puede diffear. El `.zip` se vuelve a
 * descargar de la URL de arriba, y el `origin` del modulo lo declara.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { LIBROS } from "../src/libros.ts";
import { importarZCom, aUsfm } from "../src/importarSword.ts";

/**
 * Nombres de libro que usa SWORD -> id USFM de 3 letras de nuestra tabla.
 *
 * SWORD usa nombres largos ("1Kgs", "Phlm") y no es liberable su tabla, asi
 * que el mapa es explicito. Es explicito A POSTA: si un nombre no esta aqui,
 * sus notas se descartan y se cuentan, en vez de produceir un modulo con libros
 * cambiados de sitio.
 */
const NOMBRES_SWORD: Record<string, string> = {
  Gen: "GEN", Exod: "EXO", Lev: "LEV", Num: "NUM", Deut: "DEU", Josh: "JOS",
  Judg: "JDG", Ruth: "RUT", "1Sam": "1SA", "2Sam": "2SA",
  "1Kgs": "1KI", "2Kgs": "2KI", "1Chr": "1CH", "2Chr": "2CH",
  Ezra: "EZR", Neh: "NEH", Esth: "EST", Job: "JOB", Ps: "PSA",
  Prov: "PRO", Eccl: "ECC", Song: "SNG", Isa: "ISA", Jer: "JER",
  Lam: "LAM", Ezek: "EZK", Dan: "DAN", Hos: "HOS", Joel: "JOL",
  Amos: "AMO", Obad: "OBA", Jonah: "JON", Mic: "MIC", Nah: "NAM",
  Hab: "HAB", Zeph: "ZEP", Hag: "HAG", Zech: "ZEC", Mal: "MAL",
  Matt: "MAT", Mark: "MRK", Luke: "LUK", John: "JHN", Acts: "ACT",
  Rom: "ROM", "1Cor": "1CO", "2Cor": "2CO", Gal: "GAL", Eph: "EPH",
  Phil: "PHP", Col: "COL", "1Thess": "1TH", "2Thess": "2TH",
  "1Tim": "1TI", "2Tim": "2TI", Titus: "TIT", Phlm: "PHM",
  Heb: "HEB", Jas: "JAS", "1Pet": "1PE", "2Pet": "2PE",
  "1John": "1JN", "2John": "2JN", "3John": "3JN", Jude: "JUD", Rev: "REV",
};

function arg(nombre: string, porDefecto?: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`falta --${nombre}`);
}

const zip = arg("zip");
const destino = arg("destino");
const nombreSword = arg("nombre-sword", "Clarke");

// El .zip se desempaqueta en un temporal: los ficheros van en
// `modules/<driver>/<carpeta>/<testamento>.bz?` y la ruta exacta cambia entre
// versiones de SWORD, asi que se busca en vez de suponerla.
const temporal = join("/tmp", `sword-${nombreSword}`);
execFileSync("rm", ["-rf", temporal]);
mkdirSync(temporal, { recursive: true });
execFileSync("unzip", ["-o", "-q", zip, "-d", temporal]);

const conf = findConf(temporal);
console.log(`modulo: ${conf}`);
const textoConf = readFileSync(conf, "utf8");
const propiedad = (clave: string): string =>
  new RegExp(`^${clave}\\s*=\\s*(.*)$`, "m").exec(textoConf)?.[1]?.trim() ?? "";

console.log(`  ModDrv             = ${propiedad("ModDrv")}`);
console.log(`  Versification      = ${propiedad("Versification")}`);
console.log(`  DistributionLicense= ${propiedad("DistributionLicense")}`);
console.log(`  Lang               = ${propiedad("Lang")}`);
console.log(`  TextSource         = ${propiedad("TextSource")}`);

const raizDatos = join(temporal, propiedad("DataPath").replace(/^\.\//, ""), "");
if (!readdirSync(raizDatos).some((f) => f.endsWith(".bzz"))) {
  throw new Error(`no hay bloques en ${raizDatos}`);
}

const bases = readdirSync(raizDatos)
  .filter((f) => f.endsWith(".bzv"))
  .map((f) => join(raizDatos, f.replace(/\.bzv$/, "")));

const todas: Parameters<typeof aUsfm>[0] = [];
let introducciones = 0;
let sinAnclar = 0;
for (const base of bases) {
  const r = importarZCom(base);
  console.log(
    `  ${basename(base)}: notas=${r.notas.length} introducciones=${r.introducciones.length} sinAnclar=${r.sinAnclar.length}`,
  );
  introducciones += r.introducciones.length;
  sinAnclar += r.sinAnclar.length;
  todas.push(...r.notas);
}

const ficheros = aUsfm(todas, (n) => NOMBRES_SWORD[n] ?? null);
mkdirSync(destino, { recursive: true });
for (const f of ficheros) writeFileSync(join(destino, f.nombre), f.contenido, "utf8");

const total = ficheros.reduce((n, f) => n + f.notas, 0);
console.log(`\nescritos ${ficheros.length} ficheros USFM en ${destino}`);
console.log(`  notas totales: ${total} | introducciones: ${introducciones} | sin anclar: ${sinAnclar}`);

const porLibro = new Map<string, number>();
for (const f of ficheros) porLibro.set(f.nombre, f.notas);
const top = [...porLibro.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`  libros con mas notas: ${top.map(([k, v]) => `${k}=${v}`).join(", ")}`);

// Aviso si algun nombre de SWORD no estaba en el mapa: seria un libro
// descartado en silencio, que es justo lo que este script no debe hacer.
const vistos = new Set(todas.map((n) => n.libro));
const sinMapa = [...vistos].filter((n) => !NOMBRES_SWORD[n]);
if (sinMapa.length > 0) {
  console.warn(`\nATENCION: ${sinMapa.length} nombre(s) de SWORD sin mapear, sus notas se descartaron:`);
  console.warn(`  ${sinMapa.join(", ")}`);
  process.exitCode = 1;
}
void LIBROS;

function findConf(raiz: string): string {
  const dir = join(raiz, "mods.d");
  const c = readdirSync(dir).find((f) => f.endsWith(".conf"));
  if (!c) throw new Error(`no hay .conf en ${dir}`);
  return join(dir, c);
}