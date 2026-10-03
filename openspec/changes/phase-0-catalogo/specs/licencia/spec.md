# Gate de licencia — requisitos

El gate es **ejecutable y corre en CI**. No es un documento. Un checklist no es
un control.

## ADDED Requirements

### Requirement: Solo dominio público o Creative Commons-named

El gate SHALL aceptar un módulo únicamente si su licencia es
`PublicDomain` o una licencia Creative Commons identificada por su nombre
completo. Cualquier otro valor SHALL ser rechazado.

#### Scenario: dominio público aceptado

- **WHEN** un módulo declara `license: "PublicDomain"`
- **THEN** el gate lo acepta

#### Scenario: copyright rechazado

- **WHEN** un módulo declara `license: "Copyrighted"` o `license: "RVR1960"`
- **THEN** el gate lo rechaza
- **AND** el error explica que solo se admite dominio público o CC nombrada
- **AND** la validación devuelve código de salida distinto de 0

#### Scenario: licencia desconocida rechazada

- **WHEN** un módulo declara `license: " creatively adapted"`
- **THEN** el gate lo rechaza por no ser un valor del conjunto permitido

### Requirement: La evidencia de licencia es obligatoria y verificable

Todo módulo SHALL declarar `license_evidence`: una URL que documente por qué el
texto es de dominio público o por qué la CC aplica. La evidencia SHALL ser
obligatoria en ambos casos.

#### Scenario: módulo PD sin evidencia

- **WHEN** un módulo declara `PublicDomain` pero `license_evidence` está vacío
- **THEN** el gate lo rechaza
- **AND** el error nombra el campo y el módulo

#### Scenario: licencia no plausible

- **WHEN** un módulo declara `license_evidence` con una URL vacía o un texto
  que no es una URL
- **THEN** el gate lo rechaza

### Requirement: Procedencia declarada

El gate SHALL exigir que todo módulo declare `source` (de dónde salió el texto)
y `origin` (quién construyó el módulo), para que un módulo sin trazabilidad sea
rechazado.

#### Scenario: módulo sin origen

- **WHEN** un módulo no declara `origin`
- **THEN** el gate lo rechaza nombrando el campo

### Requirement: Aviso de atribución obligatorio

El gate SHALL exigir que todo módulo declare `copyright` y `attribution`, de
modo que el lector pueda cumplir la atribución al mostrar el recurso.

#### Scenario: módulo sin atribución

- **WHEN** un módulo no declara `attribution`
- **THEN** el gate lo rechaza

### Requirement: El gate no puede desactivarse desde el propio contenido

El gate SHALL evaluarse sobre el contenido, y un cambio en el contenido **no
puede** marcarlo como válido a sí mismo. La decisión de licencia se toma fuera
del fichero del módulo.

#### Scenario: auto-declaración no altera el veredicto

- **WHEN** el `info` de un módulo afirma internamente que está aprobado
- **THEN** el veredicto del gate depende solo de `license` y `license_evidence`
- **AND** ese texto interno no altera el resultado