# Catálogo — requisitos

## ADDED Requirements

### Requirement: Catálogo como manifiesto único

El sistema SHALL mantener un único `catalog.json` en la raíz del repositorio que
describa **todos** los módulos disponibles.

Cada entrada SHALL contener, como mínimo: `id`, `type`, `name`, `language`,
`license`, `version`, `schemaVersion`, `minReaderVersion`, `sizeBytes`,
`sha256`, `downloadUrl`.

#### Scenario: catálogo completo y navegable

- **WHEN** se lee `catalog.json`
- **THEN** contiene una lista `modules` con al menos una entrada
- **AND** cada entrada tiene todos los campos mínimos presentes y no vacíos

#### Scenario: tipo de módulo restringido en esta fase

- **WHEN** se inspeccionan los tipos presentes en el catálogo
- **THEN** todos pertenecen a `{bible, commentary}`
- **AND** ningún otro tipo está declarado

### Requirement: Integridad verificada por hash

El catálogo SHALL declarar el sha256 de cada artefacto, y el validador SHALL
comprobar que el artefacto en disco corresponde a ese hash.

#### Scenario: artefacto íntegro

- **WHEN** el artefacto de un módulo existe y su sha256 coincide con el declarado
- **THEN** el módulo se marca `valid`

#### Scenario: artefacto corrupto

- **WHEN** el artefacto existe pero su sha256 **no** coincide con el declarado
- **THEN** el módulo se marca `invalid`
- **AND** el validador devuelve código de salida distinto de 0
- **AND** el error nombra el `id` del módulo y los dos hashes

#### Scenario: artefacto ausente

- **WHEN** el catálogo declara un módulo cuyo artefacto no existe en disco
- **THEN** el módulo se marca `missing`
- **AND** el validador devuelve código de salida distinto de 0

### Requirement: Punto flotante de versión

El sistema SHALL mantener `latest.json` en la rama principal, que apunte al tag
de la release vigente del catálogo, para permitir invalidación de caché sin
requerir una release nueva.

#### Scenario: consumidor resuelve la versión vigente

- **WHEN** un consumidor lee `latest.json`
- **THEN** obtiene un `tag` y una `url` de manifiesto resolubles

#### Scenario: coherencia entre latest y release

- **WHEN** se valida el repositorio en CI
- **THEN** el tag apuntado por `latest.json` existe como tag published
- **AND** `catalog.json` en ese tag tiene el mismo `version` que el repositorio

### Requirement: Señalización de desactualización

El catálogo SHALL exponer, por módulo, la versión del esquema que un lector
necesita, de modo que un lector pueda rechazar un módulo que no soporta.

#### Scenario: módulo demasiado nuevo para el lector

- **WHEN** un lector con `schemaVersion` menor que el del módulo intenta abrirlo
- **THEN** el módulo se marca `unsupported` con el mensaje explicando qué versión falta