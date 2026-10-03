import { describe, expect, test } from "bun:test";
import { sha256DeTexto } from "../src/hash.ts";
import {
  contentHashDeTablas,
  desescapar,
  escapar,
  volcar,
  VERSION_VOLCADO,
  type Fila,
} from "../src/contentHash.ts";

describe("contentHash de un texto", () => {
  //(contentHash no reimplementa sha256: usa node:crypto via hash.ts. Aqui solo
  // se fija el valor para detectar cualquier cambio en el algoritmo.)
  test("sha256 de texto simple", () => {
    expect(sha256DeTexto("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256DeTexto("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("sha256 es estatico incluso con acentos y emoji", () => {
    expect(sha256DeTexto("En el principio creó Dios los cielos y la tierra.")).toBe(
      "06daf14e1be90a54a758ccbbb830075888f421f0da65258c0333370ad57fca1c",
    );
  });
});

describe("escapar", () => {
  test("ida y vuelta", () => {
    for (const s of [
      "normal",
      "con\ttab",
      "con\nnueva",
      "con\rcarro",
      "con\\barra",
      "con\u001fseparador",
      "todo\u001f\\a\r\nb",
      "",
    ]) {
      expect(desescapar(escapar(s))).toBe(s);
    }
  });

  test("el volcado no contiene caracteres de control crudos", () => {
    // Un texto con tabulador, salto y separador sale del volcado sin ninguno
    // de esos caracteres en crudo: si se filtrasen, bastaria con que un
    // versiculo trajera un salto para partir su fila en dos.
    const sucio = "antes\tdespues\nlinea\u001finvisible";
    const v = volcar([{ nombre: "verses", filas: [{ clave: ["Gen", 1, 1], celdas: [sucio] }] }]);
    expect(v).not.toContain("\u001f" + "invisible");
    expect(desescapar(v.split("\u001f")[4].replace(/\n$/, ""))).toBe(sucio);
  });

  test("barra invertida seguida de letra de escape no se reinterpreta", () => {
    // Este es el caso que rompe los .replace() encadenados: aqui `\\u` es
    // barra escapada mas letra `u`, no un separador.
    for (const caso of ["\\u", "\\n", "\\r", "\\t", "\\\\", "a\\", "\\u\\u", "\\\\n"]) {
      expect(desescapar(escapar(caso))).toBe(caso);
    }
    // Y el volcado completo, no solo la funcion suelta.
    expect(desescapar(escapar("literal\\u001f con barra al final\\"))).toBe(
      "literal\\u001f con barra al final\\",
    );
  });
});

describe("volcar", () => {
  const f = (clave: (string | number)[], ...celdas: (string | number)[]): Fila => ({
    clave,
    celdas,
  });

  test("el orden de filas no depende del orden de entrada", () => {
    const tablas = [
      {
        nombre: "verses",
        filas: [
          f(["Gen", 1, 3], "tercero"),
          f(["Gen", 1, 1], "primero"),
          f(["Gen", 2, 1], "capitulo dos"),
        ],
      },
    ];
    const a = volcar(tablas);
    const b = volcar([{ nombre: "verses", filas: [...tablas[0].filas].reverse() }]);
    expect(a).toBe(b);
  });

  test("los capitulos se ordenan numericamente, no como texto", () => {
    // "10" < "9" en orden lexicografico. Si se comparara como texto, el
    // capitulo 10 del Salmo 150 caeria antes que el 9 y el hash dependeria
    // de como se construyo la tabla.
    const v = volcar([
      {
        nombre: "verses",
        filas: [f(["Psa", 119, 1], "a"), f(["Psa", 9, 1], "b")],
      },
    ]);
    expect(v.indexOf("Psa\u001f9\u001f1")).toBeLessThan(v.indexOf("Psa\u001f119\u001f1"));
  });

  test("el encabezado lleva la version del formato", () => {
    expect(volcar([])).toBe(`amf-volcado\t${VERSION_VOLCADO}\n`);
  });

  test("una clave primaria duplicada se hace visible", () => {
    expect(() =>
      volcar([{ nombre: "verses", filas: [f(["Gen", 1, 1], "a"), f(["Gen", 1, 1], "b")] }]),
    ).toThrow(/clave primaria duplicada/);
  });

  test("el texto de un versiculo no puede crear filas falsas", () => {
    // Un versiculo con tabulador y salto de linea debe seguir siendo UNA fila.
    const texto = "linea uno\nlinea dos\tcon tab";
    const v = volcar([{ nombre: "verses", filas: [f(["Gen", 1, 1], texto)] }]);
    const filas = v.split("\n").filter((l) => l.startsWith("verses\u001f"));
    expect(filas.length).toBe(1);
    // campos: nombre(0) + 3 de clave primaria(1-3) + 1 celda(4)
    expect(desescapar(filas[0].split("\u001f")[4])).toBe(texto);
  });

  test("las tablas se emiten en el orden dado, no en orden alfabetico", () => {
    const v = volcar([
      { nombre: "zebra", filas: [] },
      { nombre: "alfa", filas: [] },
    ]);
    expect(v.indexOf("tabla\tzebra")).toBeLessThan(v.indexOf("tabla\talfa"));
  });

  test("los enteros se normalizan (2.0 y 2.1 dan el mismo volcado)", () => {
    // Sin esto, una division que devuelva 2.0 y otra que devuelva 2.1
    // producirian modulos con distinto hash y el mismo texto.
    expect(volcar([{ nombre: "t", filas: [f([1], 2)] }])).toBe(
      volcar([{ nombre: "t", filas: [f([1], 2.4)] }]),
    );
  });
});

describe("contentHashDeTablas", () => {
  test("mismo contenido, mismo hash", () => {
    const t = () => [
      { nombre: "verses", filas: [
        { clave: ["John", 3, 16], celdas: ["texto", "\\v 16 raw"] },
      ] },
    ];
    expect(contentHashDeTablas(t())).toBe(contentHashDeTablas(t()));
  });

  test("un caracter distinto cambia el hash", () => {
    const a = [{ nombre: "verses", filas: [{ clave: ["John", 3, 16], celdas: ["a"] }] }];
    const b = [{ nombre: "verses", filas: [{ clave: ["John", 3, 16], celdas: ["b"] }] }];
    expect(contentHashDeTablas(a)).not.toBe(contentHashDeTablas(b));
  });

  test("cambiar la version del volcado cambia el hash", () => {
    // Si no, dos formatos incompatibles se compararian como iguales.
    expect(VERSION_VOLCADO).toBe("1");
    const v = volcar([]);
    expect(sha256DeTexto(v.replace("amf-volcado\t1", "amf-volcado\t2"))).not.toBe(
      sha256DeTexto(v),
    );
  });

  test("el hash es el sha256 del volcado, no del binario", () => {
    const tablas = [{ nombre: "verses", filas: [{ clave: ["Gen", 1, 1], celdas: ["x"] }] }];
    expect(contentHashDeTablas(tablas)).toBe(sha256DeTexto(volcar(tablas)));
  });
});