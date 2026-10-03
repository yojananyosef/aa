# Phase 0 — Catálogo verificable

## Por qué el catálogo va primero

Históricamente este proyecto ha muerto en la aplicación. 14 repositorios, 0
releases de app. El único componente que llegó a usuarios fue un catálogo.

Además, el catálogo es el componente que se puede verificar sin usuarios: es un
JSON más un conjunto de ficheros, y su corrección se comprueba con tests. La
aplicación, no.

Este change entrega un catálogo que se autovalida, desde cero, en TypeScript.

## Qué hace

Una cadena de herramientas sobre Bun/TypeScript que convierte texto bíblico en
módulos `.amod`, los indexa en un `catalog.json`, y **se bloquea a sí misma**
cuando la licencia de un módulo no es demostrablemente dominio público.

Cuatro piezas:

1. **Contrato de módulo (AMF v3)** — qué debe contener un `.amod`. SQLite, con
   una tabla `info` de metadatos y tablas de contenido por tipo.
2. **Constructor** — de un texto fuente (USFM) a un `.amod` determinista.
   Determinista significa: mismos inputs → mismo sha256. Sin esto no hay
   reproducible builds ni actualizaciones incrementales fiables.
3. **Gate de licencia** — ejecutable, en CI, no un checklist. Rechaza cualquier
   módulo cuya licencia no se pueda probar.
4. **Validador de catálogo** — comprueba que cada entrada apunte a un artefacto
   real con el sha256 correcto, y que ninguna referencia esté rota.

## Fuera de alcance (explícito)

- **No hay aplicación.** Ni Flutter, ni Dart, ni Expo, ni web. Cero UI.
- **No hay monetización**, ni billing, ni suscripciones, ni cuentas de usuario.
- **No hay DRM, cifrado, ni capa de entitlements.** El contenido es PD.
- **No hay sincronización cloud.**
- **No hay Búsqueda full-text ni índice global invertido.** SeSpec más adelante.
- **No se migra código de repos anteriores.** Se reaprovecha el conocimiento,
  no los ficheros. Empezar de cero es explícito.
- **No se publica en App Store.** Se publica el catálogo como artefacto.

## Definition of Done

Verificable sin usuario y sin red. Un único comando:

```
bun run gate
```

Pasa solo si **todas** estas condiciones son ciertas:

1. `bun test` pasa, y hay al menos un test por requisito WHEN/THEN de este change.
2. El catálogo contiene ≥ 1 Biblia y ≥ 1 comentario, ambos PD verificados.
3. Cada entrada del catálogo tiene un artefacto `.amod` **existente en disco**.
4. El sha256 de cada artefacto en disco **coincide** con el declarado en el catálogo.
5. Un módulo no-PD **es rechazado** por el gate, y ese caso está cubierto por test.
6. El constructor es **determinista**: construir dos veces el mismo input produce
   el mismo sha256, y hay test que lo demuestra.
7. Todo módulo declara `license: "PublicDomain"` o una CC con nombre explícito.

Los puntos 5 y 6 son los que importan: son la diferencia entre un catálogo que
se documenta y un catálogo que **se hace cumplir**.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Volver a fragmentar en varios repos | Un solo repo, ya fijado en `openspec/config.yaml` |
| Empezar por la app otra vez | No hay UI en este change, por diseño |
| Sobre-ingeniería del formato | Solo los tipos que un change posterior vaya a usar: `bible` y `commentary` |
| USFM como input es un cuello de botella | Se acepta USFM v2/v3; el parser es sustituible porque el `.amod` es el contrato |
| Licencias mal declaradas | El gate exige evidencia (URL + tipo), no una cadena de texto libre |

## Auditoria de fuentes RVR1909

Al implementar el parser se audito el contenido disponible en dominio publico.
Resultado, con la fuente concreta y el defecto medido:

| Fuente | Licencia | Capitulos | Texto | Versificacion KJV |
|---|---|---|---|---|
| eBible `spaRV1909` USFM | Public Domain | 1189 | **18 versiculos sin texto** | si |
| eBible `spaRV1909` USFX | Public Domain | 1189 | los mismos 18 | si |
| eBible `spaRV1909` VPL  | Public Domain | 1189 | los mismos 18 | si |
| Wikisource (directo) | CC-BY-SA-4.0 | **1164** (faltan 25) | 0 vacios | **no** (10 libros) |
| SWORD `SpaRV` | Public Domain | sin verificar | sin verificar | declara si |
| eBible `sparvg` (RVR Gomez) | **copyright 2004-2023** | - | - | gate rechaza |

Las tres exportaciones de eBible fallan en los MISMOS 18 versiculos. Es un
defecto de su base de datos de origen, no de la serializacion: USFM, USFX y
VPL son tuberias distintas y coinciden.

Wikisource tiene el texto de los 18 (verificado 18/18), pero le faltan 25
capitulos enteros y usa otra versificacion en 10 libros: Jueces, Ruth, Salmos,
Oseas, Joel, Amos, Abdias, 2 Timoteo, Tito y Filemon.

Conclusion: no hay hoy una fuente de RVR1909 que sea a la vez completa,
KJV-compatible y de dominio publico. La decision queda registrada; no se
rellenan versiculos por inferencia en ninguna hipotesis.
