# Formato de módulo — AMF v3

Un módulo es un fichero SQLite. **El archivo es la API**: el lector lo abre y lo
consulta con SQL. No hay adaptadores por tipo de recurso.

Nombre de fichero: `<ID>_<type>.amod` (ej. `RVR1909_bible.amod`, `CLARKE_commentary.amod`).

## ADDED Requirements

### Requirement: Todo módulo lleva metadatos en `info`

Todo `.amod` SHALL contener una tabla `info` de pares nombre-valor con, como
mínimo: `id`, `type`, `name`, `language`, `license`, `license_evidence`,
`copyright`, `attribution`, `schema_version`, `versification`, `source`, `origin`.

#### Scenario: metadatos mínimos presentes

- **WHEN** se lee la tabla `info` de un `.amod` válido
- **THEN** las claves mínimas están todas presentes y no vacías

#### Scenario: módulo sin metadatos se rechaza

- **WHEN** se valida un `.amod` al que le falta una clave mínima de `info`
- **THEN** la validación falla nombrando la clave ausente

### Requirement: Biblia usa versificación estándar

Las Biblias SHALL usar versificación **KJV** (66 libros, capítulos y versículos
numerados como en la King James), para permitir comparación entre módulos y
compatibilidad con otras herramientas.

#### Scenario: estructura de versículos consultable

- **WHEN** se consulta `SELECT * FROM verses WHERE book = 'John' AND chapter = 3`
- **THEN** devuelve los versículos de Juan 3 con su texto
- **AND** existe el índice sobre `(book, chapter, verse)`

#### Scenario: versículos sin numerar

- **WHEN** se construye una Biblia desde texto sin marcas de versículo
- **THEN** la construcción falla
- **AND** el error explica que se requiere USFM con versículos marcados

### Requirement: El texto USFM se conserva sin pérdida

Todo versículo SHALL almacenar el texto plano legible en `text` y el fragmento
USFM original en `raw`.

La conversión a texto plano SHALL ser **lossless**: nada de lo que aporta el
marcado USFM (`\add`, `\addsl`, `\f`, `\q`, `\w`, caracteres de alineación,
mayúsculas y minúsculas alternativas) puede descartarse sin quedar registrado en
`raw`.

#### Scenario: marcado USFM conservado

- **WHEN** un versículo contiene marcado de texto Added (`\addsl`)
- **THEN** `raw` lo contiene íntegro
- **AND** `text` contiene el texto legible sin las marcas

#### Scenario: round-trip sin pérdida

- **WHEN** se reconstruye el fragmento USFM desde `raw`
- **THEN** es idéntico al fragmento original de la fuente

#### Scenario: el build nunca descarta marcado en silencio

- **WHEN** el builder no sabe interpretar una marca USFM
- **THEN** la conserva en `raw` en lugar de eliminarla
- **AND** registra una advertencia en el informe de build

### Requirement: Comentario admite varios artículos por versículo

Los comentarios SHALL exponer artículos identificados por
`(book, chapter, verse, seq)`, de modo que un lector pueda mostrar **todos** los
artículos de un versículo sin parsear nada.

`seq` SHALL ser un entero que empieza en 0 y se incrementa por cada artículo
adicional del mismo versículo. La clave primaria DEBE incluir `seq`: un
comentario con dos notas sobre el mismo versículo es el caso normal, no la
excepción.

#### Scenario: artículo de comentario localizable

- **WHEN** se consulta el comentario de `John 3:16`
- **THEN** se devuelven **todos** los artículos anudados a esa referencia,
  ordenados por `seq`
- **AND** existe índice sobre `(book, chapter, verse)`

#### Scenario: dos notas sobre el mismo versículo

- **WHEN** un versículo tiene dos artículos
- **THEN** ambos se almacenan con `seq` 0 y 1
- **AND** ninguno sobrescribe al otro
- **AND** la consulta por `(book, chapter, verse)` devuelve ambos

### Requirement: Construcción determinista

Construir el mismo contenido fuente con el mismo toolchain SHALL producir un
artefacto con el mismo `sha256`.

El determinismo requiere: orden estable de filas, metadatos de compilación
derivados del contenido, y **ningún timestamp** dentro del archivo.

#### Scenario: dos construcciones dan el mismo hash

- **WHEN** se construye dos veces el mismo input USFM con el mismo toolchain
- **THEN** los dos artefactos tienen `sha256` idéntico

#### Scenario: sin timestamp dentro del artefacto

- **WHEN** se inspeccionan las tablas del `.amod`
- **THEN** no existe ninguna tabla que almacene fecha u hora de construcción

### Requirement: El hash de transporte y el hash de reproducibilidad son distintos

Un `.amod` SHALL declarar dos hashes, porque responden a preguntas distintas:

- **`sha256`** — del **fichero**. Verifica que lo que se descargó no se alteró.
- **`contentHash`** — de un volcado canónico del **contenido lógico**.
  Verifica que el build es reproducible.

La separación es obligatoria porque la cabecera SQLite guarda
`SQLITE_VERSION_NUMBER` en los bytes 96-99. Dos herramientas con idéntico
contenido lógico pero distinta versión de SQLite producen ficheros con sha256
distinto. Por eso `sha256` no puede usarse como criterio de reproducibilidad.

#### Scenario: el sello de versión rompe el sha256 pero no el contentHash

- **WHEN** el mismo contenido lógico se serializa con dos versiones de SQLite
- **THEN** los `sha256` de los ficheros difieren
- **AND** los `contentHash` coinciden

#### Scenario: contentHash detecta un cambio real de contenido

- **WHEN** cambia una sola palabra del texto de un versículo
- **THEN** el `contentHash` cambia
- **AND** el `sha256` también

#### Scenario: el contentHash no depende de la versión de SQLite

- **WHEN** se serializa un módulo, se altera solo el sello de versión de la
  cabecera, y se recalcula el `contentHash`
- **THEN** el `contentHash` no cambia
- **AND** el `sha256` sí cambia

### Requirement: Módulos empaquetables

Un conjunto de módulos SHALL poder empaquetarse en un único `.zip` **comprimido
con zstd**, que contenga la estructura de módulos y metadatos de acceso.

El interior de cada SQLite SHALL comprimirse. Un texto bíblico en UTF-8 comprime
4-5x con zstd; empaquetar sin comprimir multiplica por cuatro el coste de
descarga sin ninguna contrapartida.

#### Scenario: bundle con dos módulos

- **WHEN** se empaquetan una Biblia y un comentario en un bundle
- **THEN** el zip contiene ambos `.amod` y un `bundle.json` con sus sha256 y
  contentHash

#### Scenario: el bundle comprime

- **WHEN** se mide el tamaño del zip frente a la suma de los `.amod` sin comprimir
- **THEN** el zip es estrictamente menor

### Requirement: Licencia declarable como Creative Commons

Además de dominio público, un módulo SHALL poder declarar una licencia Creative
Commons nombrada explícitamente, sin que eso habilite el gate.

#### Scenario: CC con nombre explícito

- **WHEN** un módulo declara `license: "CC-BY-SA-4.0"`
- **THEN** el gate lo acepta
- **AND** `license_evidence` contiene la URL de la licencia