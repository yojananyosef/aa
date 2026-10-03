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

### Requirement: Comentario se ancla por versículo

Los comentarios SHALL exponer artículos identificados por
`(book, chapter, verse)`, de modo que un lector pueda mostrar el comentario de
un versículo concreto sin parsear nada.

#### Scenario: artículo de comentario localizable

- **WHEN** se consulta el comentario de `John 3:16`
- **THEN** se devuelve el artículo anudado a esa referencia
- **AND** existe índice sobre `(book, chapter, verse)`

### Requirement: Construcción determinista

Construir el mismo contenido fuente dos veces SHALL producir un artefacto con el
mismo sha256. El determinismo requiere: orden estable de filas, metadatos de
compilación derivados del contenido y **ningún timestamp** dentro del archivo.

#### Scenario: dos construcciones dan el mismo hash

- **WHEN** se construye dos veces el mismo input USFM
- **THEN** los dos artefactos tienen sha256 idéntico

#### Scenario: sin timestamp dentro del artefacto

- **WHEN** se inspeccionan las tablas del `.amod`
- **THEN** no existe ninguna tabla que almacene fecha u hora de construcción

### Requirement: Módulos empaquetables

Un conjunto de módulos SHALL poder empaquetarse en un único `.zip` que contenga
la estructura de módulos y metadatos de acceso, sin comprimir el interior de
cada SQLite.

#### Scenario: bundle con dos módulos

- **WHEN** se empaquetan una Biblia y un comentario en un bundle
- **THEN** el zip contiene ambos `.amod` y un `bundle.json` con sus sha256

### Requirement: Licencia declarable como Creative Commons

Además de dominio público, un módulo SHALL poder declarar una licencia Creative
Commons nombrada explícitamente, sin que eso habilite el gate.

#### Scenario: CC con nombre explícito

- **WHEN** un módulo declara `license: "CC-BY-SA-4.0"`
- **THEN** el gate lo acepta
- **AND** `license_evidence` contiene la URL de la licencia