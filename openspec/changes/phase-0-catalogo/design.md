# Diseño — Phase 0

## Estructura del monorepo

```
aa/
├── openspec/              # specs y changes (contrato)
├── catalog/
│   ├── catalog.json       # manifiesto maestro
│   └── latest.json        # puntero flotante al tag vigente
├── modules/               # artefactos .amod
│   └── source/            # texto fuente USFM, versionado
├── tools/                 # Bun + TypeScript, cero deps de runtime
│   ├── src/
│   │   ├── amf.ts         # definición del formato: escritura del .amod
│   │   ├── usfm.ts        # parser USFM -> intermediate
│   │   ├── build.ts       # intermediate -> .amod
│   │   ├── catalog.ts     # lectura/escritura y validación del catálogo
│   │   ├── gate.ts        # gate de licencia (PURA, sin I/O)
│   │   └── cli.ts         # comandos
│   └── test/              # bun test
└── AGENTS.md
```

## Decisiones

### Por qué SQLite y no JSON/zip plano

Porque el lector ejecutará consultas, no parseo. Una comentario con 31.000
entradas en JSON exige cargarlo entero en memoria; en SQLite se indexa y se
consulta un artículo. Y `ATTACH` permite consultar varios módulos a la vez, que
es exactamente el caso de uso (comentario + Biblia + diccionario en una
consulta) sin código de adaptadores.

Coste: hay queenserar un binario. Se acepta: es el mismo motor en móvil,
desktop y en web vía WASM.

### Por qué Bun y no Node+Dart

El tooling es pequeño y debe ser trivial de ejecutar. Bun ejecuta TypeScript
directamente, trae runner de tests, y no necesita paso de build. La alternativa
(Dart) obliga a un SDK aparte; Rust, a toolchain aparte. Con un solo
desarrollador, **cada toolchain extra es una razón más para no terminar.**

La app decidirá su stack en un change posterior, cuando exista el vertical slice.

### Por qué `gate.ts` puro

El gate es una función sin I/O: `(info: Info) => Resultado`. Eso lo hace
 testeable sin disco, que a su vez lo hace fiable — y lo hace imposible de
"ganar" desde dentro del contenido. Es la diferencia entre un control y un
documento.

### Determinismo

Sin `Date.now()`, sin UUID, sin orden de iteración dependiente del filesystem.
Orden de filas por clave natural, siempre. Sin esto el hash cambia en cada
build y las actualizaciones incrementales no se pueden confiar.

### Por qué solo `bible` y `commentary`

El formato admite más tipos, pero implementar `lexicon`, `dictionary`,
`devotion` y `plan` ahora es trabajo que ningún change posterior inmediato va a
verificar. Se añaden cuando se necesiten, con sus specs.

## Formato `.amod` (AMF v3)

SQLite. Tabla `info` siempre presente.

```sql
CREATE TABLE info (name TEXT NOT NULL, value TEXT NOT NULL,
                   PRIMARY KEY (name));

-- módulo tipo: bible
CREATE TABLE books  (book TEXT NOT NULL, chapter INTEGER NOT NULL,
                     verse   INTEGER NOT NULL, text TEXT NOT NULL,
                     PRIMARY KEY (book, chapter, verse));
CREATE INDEX books_bcv ON books (book, chapter, verse);

-- módulo tipo: commentary
CREATE TABLE commentary (book TEXT NOT NULL, chapter INTEGER NOT NULL,
                         verse INTEGER NOT NULL, article TEXT NOT NULL,
                         PRIMARY KEY (book, chapter, verse));
CREATE INDEX commentary_bcv ON commentary (book, chapter, verse);
```

`versification` = `KJV` en esta fase. Los identificadores de libro son nombres
en inglés normalizados (`John`, `Psalms`), independientes del idioma del texto.

## Licencias: conjunto permitido

```
PublicDomain
CC-BY-4.0   CC-BY-SA-4.0   CC-BY-NC-4.0   CC-BY-NC-SA-4.0
CC0-1.0     CC-BY-3.0      CC-BY-SA-3.0
```

Todo lo demás se rechaza, incluidas variantes mal escritas y etiquetas de
editoras. `license_evidence` debe ser una URL http(s) no vacía.

## CI

Un workflow: `bun install` → `bun test` → `bun run gate`. Si el gate falla, el
build falla. Sin excepción ni flag para saltarlo.

## Orden de implementación

1. `gate.ts` puro + sus tests — es la pieza de control, se prueba primero
2. `catalog.ts` con validación de integridad
3. `amf.ts` + `usfm.ts` + `build.ts`
4. Fuentes reales (RVR1909 + un comentario clásico PD)
5. `bun run gate` verde