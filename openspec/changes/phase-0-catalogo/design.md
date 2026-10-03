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
CREATE TABLE verses (
  book    TEXT    NOT NULL,   -- id canónico de KJV: 'John', 'Psalms'
  chapter INTEGER NOT NULL,
  verse   INTEGER NOT NULL,
  text    TEXT    NOT NULL,   -- texto plano legible
  raw     TEXT    NOT NULL,   -- fragmento USFM original (sin pérdida)
  PRIMARY KEY (book, chapter, verse)   -- la PK ya crea el índice (book,chapter,verse)
);

-- módulo tipo: commentary
CREATE TABLE commentary (
  book    TEXT    NOT NULL,
  chapter INTEGER NOT NULL,
  verse   INTEGER NOT NULL,
  seq     INTEGER NOT NULL,   -- 0, 1, 2... varios artículos por versículo
  article TEXT    NOT NULL,
  PRIMARY KEY (book, chapter, verse, seq)
);
```

`versification` = `KJV` en esta fase. Los identificadores de libro salen de una
tabla canónica fija, no de texto libre: `John`, `Psalms`, `1Corinthians`. Son
independientes del idioma del texto, que es lo que permite comparar una Biblia
en español con un comentario en inglés.

### Dos hashes, dos preguntas

| Campo | Hash de | Responde a |
|---|---|---|
| `sha256` | el **fichero** | ¿lo que descargué llegó alterado? |
| `contentHash` | un volcado **canónico** del contenido lógico | ¿el build es reproducible? |

Deben existir los dos. La cabecera SQLite guarda `SQLITE_VERSION_NUMBER` en los
bytes 96-99, así que el mismo contenido lógico serializado con dos versiones
de SQLite produce ficheros distintos:

```
contenido lógico idéntico:   true
sha256 original:             ffe1fe38a1...
sha256 parcheado:            af7791ae8...   <- distinto
```

Por eso `sha256` **no** sirve como criterio de reproducibilidad. El
`contentHash` se calcula sobre un volcado canónico (contenido ordenado por
clave natural, sin metadatos del motor) y sí es estable entre versiones.

El `contentHash` va dentro de la tabla `info` del propio módulo, porque depende
solo de su contenido. El `sha256` vive en `catalog.json`, porque depende de cómo
se empaquetó el fichero, no de qué contiene.

### Lossless USFM

`text` es para leer. `raw` es la verdad. El builder nunca descarta marcado: lo
que no sabe interpretar lo conserva en `raw` y lo reporta como advertencia. Un
build que pierde texto en silencio es peor que uno que falla.

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