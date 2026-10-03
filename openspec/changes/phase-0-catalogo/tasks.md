# Tareas — Phase 0

Cada tarea incluye su test. Una tarea sin test no está terminada.

## Bloque 1 — Gate de licencia (el control va primero)

- [x] 1.1 `tools/src/aceptadas.ts` — conjunto de licencias permitidas y
      predicado `esLicenciaValida`. Test: acepta las 8 permitidas, rechaza
      `"Copyrighted"`, `"RVR1960"`, `" creatively adapted"`, `""`.
- [x] 1.2 `tools/src/gate.ts` — `evaluar(info): Resultado`. Puro, sin I/O.
      Devuelve `{ok, violaciones[]}`. Test: `PublicDomain` sin evidencia → viola;
      `PublicDomain` con URL → ok; CC con URL → ok.
- [x] 1.3 Test de auto-declaración: `info` que se autodeclara aprobado sin
      `license_evidence` sigue siendo rechazado. Cubre el requisito
      "no puede desactivarse desde el propio contenido".
- [x] 1.4 Test de campos obligatorios: falta de `origin`, `attribution`,
      `source`, `copyright` → violación nombrando el campo.

## Bloque 2 — Integridad del catálogo

- [ ] 2.1 `tools/src/hash.ts` — sha256 de fichero, streaming.
      Test: hash conocido de un fixture.
- [ ] 2.2 `tools/src/catalog.ts` — tipos, lectura, validación de campos mínimos.
      Test: entrada sin `sha256` o con campo vacío → error nombrando el campo.
- [ ] 2.3 Validación de integridad: compara sha256 de disco con el declarado.
      Tests: `valid`, `invalid` (nombra los dos hashes), `missing`.
- [ ] 2.4 `latest.json` + validación de coherencia con el tag publicado.
      Test: `latest.json` que apunta a tag inexistente → error.

## Bloque 3 — Formato de módulo

- [ ] 3.1 `tools/src/amf.ts` — escritor SQLite. Crea `info` + tablas del tipo.
      Test: el `.amod` generado se abre y `SELECT` sobre `info` devuelve las claves.
- [ ] 3.2 Test de módulo con `info` incompleto → validación falla nombrando la clave.
- [ ] 3.3 `tools/src/usfm.ts` — parser de `\id`, `\h`, `\v` a estructura intermedia.
      Test: USFM mínimo de Juan 3 produce los versículos esperados.
- [ ] 3.4 Test de USFM **sin** marcas `\v` → fallo con mensaje explicativo.
- [ ] 3.5 `tools/src/build.ts` — intermedio → `.amod`. Sin timestamps.
      Test: dos construcciones → sha256 idéntico. Test: ninguna tabla con fecha.
- [ ] 3.6 Índices `(book, chapter, verse)` para `bible` y `commentary`.
      Test: `EXPLAIN QUERY PLAN` usa el índice.

## Bloque 4 — Contenido real (dominio público)

- [ ] 4.1 Localizar y traer a `modules/source/` **RVR1909** (Reina-Valera 1909)
      en USFM, con versículos marcados. Registrar `source` y `license_evidence`.
      Test: el build produce un `.amod` con >31.000 versículos y hash registrado.
- [ ] 4.2 Traer un comentario clásico de dominio público en USFM (ej. Clarke,
      Benson o Wesley — un solo volumen). Registrar procedencia y evidencia.
      Test: el build produce artículos anclados a versículos verificables.
- [ ] 4.3 Test de dato: leer Juan 3:16 de RVR1909 y de un comentario, y verificar
      que ambos resuelven. Es la prueba de que catálogo y módulos encajan.
- [ ] 4.4 `catalog.json` con ambas entradas, `latest.json`, sha256 reales.

## Bloque 5 — Cierre

- [ ] 5.1 `bun run gate` ejecuta: tests + integridad + licencias. Sale 0.
- [ ] 5.2 Workflow de CI que corre `bun run gate` y falla el build si no pasa.
- [ ] 5.3 `tools/src/cli.ts` con `build`, `validate`, `gate` — usable sin conocer
      los módulos internos.
- [ ] 5.4 `AGENTS.md` con la regla de un solo repo y el enlace a este README.
- [ ] 5.5 Test negativo end-to-end: meter un módulo con licencia protegida en un
      directorio temporal, correr `bun run gate`, comprobar que **falla**.

## Definición de terminado

`bun run gate` en verde y el test 5.5 demonstrando que falla cuando debe.
Nada más. Si algo de esta lista no está, el change no se archiva.