# Transporte web — requisitos

## Purpose

Define cómo se obtiene un módulo desde un navegador, que es la plataforma que
va primera en el cliente, y cómo se comprueba que lo que llega por ese camino
es lo mismo que declara el catálogo.

## ADDED Requirements

### Requirement: Cada entrada declara una URL legible desde el navegador

El catálogo SHALL declarar, en cada entrada de módulo, un campo `browserUrl`
apuntando a un origen que devuelve `Access-Control-Allow-Origin`. El campo
`downloadUrl` se conserva sin modificar, porque sigue siendo la URL correcta
para clientes nativos.

#### Scenario: Entrada completa

- **WHEN** se lee una entrada del catálogo
- **THEN** tiene `browserUrl` presente, no vacío, y con esquema `https`

#### Scenario: El campo no puede desaparecer sin que salte

- **WHEN** se valida el catálogo y alguna entrada no tiene `browserUrl`
- **THEN** el validador falla nombrando el `id` del módulo y el campo que falta

#### Scenario: Las dos URLs son distintas y coherentes

- **WHEN** se leen `downloadUrl` y `browserUrl` de una entrada
- **THEN** apuntan al mismo fichero, identificadas por su nombre

### Requirement: El origen del navegador sirve los artefactos del release vigente

El sistema SHALL publicar los artefactos del último release en un origen
legible desde navegador, construyéndolos desde el release y no desde el
repositorio.

#### Scenario: El sitio refleja el release vigente

- **WHEN** existe un release con tag `v0.1.0`
- **THEN** el origen del navegador sirve ese mismo conjunto de ficheros

#### Scenario: Un release nuevo cambia el contenido servido

- **WHEN** se publica un release con tag posterior
- **THEN** el origen del navegador sirve los artefactos de ese tag

#### Scenario: Los artefactos no entran en el historial de git

- **WHEN** se inspecciona el historial del repositorio
- **THEN** no contiene ningún fichero `.amod`

### Requirement: Lo que llega por el navegador es lo que declara el catálogo

Los bytes servidos por el origen del navegador SHALL tener el mismo `sha256`
que el catálogo declara para ese módulo.

#### Scenario: Módulo servido íntegro

- **WHEN** se descarga un módulo desde `browserUrl` y se calcula su `sha256`
- **THEN** coincide con el `sha256` de la entrada correspondiente

#### Scenario: El origen sirve otro contenido

- **WHEN** el `sha256` de lo servido **no** coincide con el declarado
- **THEN** la comprobación falla nombrando el `id`, el hash esperado y el
  obtenido

### Requirement: El manifiesto es legible desde el navegador

`catalog.json` y `latest.json` SHALL ser accesibles desde un origen con
cabecera de origen cruzado.

#### Scenario: Lectura del manifiesto con `Origin` ajeno

- **WHEN** se solicita `catalog.json` con una cabecera `Origin` de otro dominio
- **THEN** la respuesta incluye `Access-Control-Allow-Origin`

### Requirement: Un fallo de publicación no invalida el release

Si la publicación del sitio falla, el release SHALL seguir publicado y el
catálogo SHALL seguir siendo válido.

#### Scenario: El workflow del sitio falla

- **WHEN** el workflow de publicación termina en error
- **THEN** el release sigue existiendo y `catalog.json` sigue siendo válido
- **AND** el fallo del workflow nombra el paso que falló
