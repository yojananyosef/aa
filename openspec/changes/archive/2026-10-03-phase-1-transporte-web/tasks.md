# Tasks

## 1. `browserUrl` en el catálogo

- [x] 1.1 Añadir `browserUrl` a los campos obligatorios en `tools/src/catalog.ts` y a `EntradaCatalogo`. Verificado: el validador falla nombrando el `id` del módulo y el campo que falta
- [x] 1.2 Declarar el origen web junto al origen de releases en `tools/src/modulos.ts`, derivándolo de `REPOSITORIO` igual que `ORIGEN`. Verificado: `ORIGEN_WEB` sale de `REPOSITORIO.split("/")` y no hay ninguna URL escrita a mano en el repositorio
- [x] 1.3 Emitir `browserUrl` en `tools/src/construirCatalogo.ts`, con el mismo nombre de fichero que `downloadUrl`. Verificado con `bun run tools/src/cli.ts build --tag v0.1.1`: las dos entradas lo traen
- [x] 1.4 `downloadUrl` no ha cambiado para ningún módulo. Verificado: sigue siendo `https://github.com/yojananyosef/aa/releases/download/<tag>/<fichero>`
- [x] 1.5 Cuatro pruebas negativas nuevas: sin `browserUrl`, vacío, no-https, y apuntando a un fichero distinto de `downloadUrl`. Verificado: `bun test` -> 241 pass, 0 fail (eran 237)

## 2. Workflow de publicación

- [x] 2.1 Añadir `.github/workflows/pages.yml`, que baja los artefactos del release publicado y los sube con `actions/upload-pages-artifact` y `actions/deploy-pages`. Verificado: run `37160124486` en `success`
- [x] 2.2 Habilitar Pages en `yojananyosef/aa` con `build_type: workflow`. Verificado con `gh api repos/yojananyosef/aa/pages`: responde y `build_type` es `workflow`
- [x] 2.3 El workflow falla si el sitio pasa de 1 GB. Verificado: el umbral está en el `run`, no en un comentario, y el sitio pesa 80.153.299 bytes
- [x] 2.4 Release nuevo y sitio reconstruido. Verificado: `v0.1.1` publicado y el sitio sirve sus artefactos

## 3. Comprobación con peticiones reales

- [x] 3.1 `catalog.json` con `Origin` ajeno responde `Access-Control-Allow-Origin: *`. Verificado con `curl -H "Origin: https://ab.ejemplo"` y también con `fetch` desde Chrome 154 headless
- [x] 3.2 Un binario del sitio, no solo el HTML, también lo incluye. Verificado con `KJV2006_bible.amod`: `ACAO: *`, `content-type: application/octet-stream`, 22.544.384 bytes
- [x] 3.3 `KJV2006_bible.amod` descargado del sitio: `ce0cb1bc4edbf3341d673739539421bbfed3972e39cbac5fc129f35f25324fe9`
- [x] 3.4 `CLARKE_commentary.amod` descargado del sitio: `3df25f8286231c344fb8f47ce74a697b40b4cfeffce0dc311ac7aa5f19c1608c`
- [x] 3.5 Los dos `.amod` del sitio abren en SQLite y responden Juan 3:16. Verificado: `quick_check=ok`, 31.102 versículos y 19.742 notas, texto correcto en ambos. Un hash que cuadra no basta: un fichero corrupto puede tener el hash que sea
- [x] 3.6 El ancho de banda, con su cálculo. Verificado: 100 GB/mes dan unas 1.740 descargas del módulo grande y 4.400 del pequeño

## 4. Green

- [x] 4.1 `bun test`, `gate` y `validate` los tres en verde. Verificado: 241 pass, `GATE OK`, 2 módulos válidos
- [x] 4.2 La regla nueva escrita en `AGENTS.md`: una URL que devuelve 200 por `curl` puede ser inservible desde un navegador. Verificado con el caso concreto y con el `CONTRASTE` que lo demuestra
- [x] 4.3 Anotado en este change que desbloquea la descarga en navegador del repositorio hermano

---

## Resultados medidos

### Lo que el navegador hace ahora

```
latest.json: tag=v0.1.1
catalog.json: 2 modulos, sha256=3113ea73...
KJV2006 -> HTTP 200, 22544384 bytes,  10 ms   cabecera "SQLite format 3"
CLARKE  -> HTTP 200, 57536512 bytes, 10 ms   cabecera "SQLite format 3"
CONTRASTE por downloadUrl -> BLOQUEADO: Failed to fetch
```

El `CONTRASTE` es lo que hace que esto no sea accidental: las dos URLs conviven y
solo una funciona, por eso el catálogo declara las dos en vez de sustituir una.

### El contenido servido es el contenido verificado

| Fichero | `sha256` |
| --- | --- |
| `KJV2006_bible.amod` | `ce0cb1bc4edbf3341d673739539421bbfed3972e39cbac5fc129f35f25324fe9` |
| `CLARKE_commentary.amod` | `3df25f8286231c344fb8f47ce74a697b40b4cfeffce0dc311ac7aa5f19c1608c` |

Los mismos que declara `catalog.json` y que verifica el gate. Los dos abren en
SQLite: `quick_check=ok`, y Juan 3:16 sale correcto en ambos.

### El techo, con su cálculo

- Sitio publicado: **80.153.299 bytes**. Límite de Pages: 1 GB.
- Ancho de banda: 100 GB/mes, límite blando.
  - Con `CLARKE_commentary.amod` (57.536.512 b): unas **1.740 descargas/mes**.
  - Con `KJV2006_bible.amod` (22.544.384 b): unas **4.400 descargas/mes**.

El factor que lo estira: un módulo descargado se lee sin conexión y **no se
vuelve a descargar**. El ancho se paga una vez por usuario, no una vez por
lectura.

### Lo que falló por el camino, y por qué está escrito

1. **El primer disparo terminó en "Ensure GitHub Pages has been enabled".** Los
   pasos anteriores --descargar, comprobar el límite, generar el puntero y la
   portada, subir el artefacto-- habían pasado. Pages no estaba habilitado.
2. **Al reejecutar a mano, `workflow_dispatch` no tenía entradas.** No había
   forma de elegir el tag, y `github.event.release.tag_name` viene vacío en un
   disparo manual. Reintentar era imposible: la única salida era republicar el
   release. Se añadió la entrada `tag` y un paso que resuelve la etiqueta desde
   los dos disparadores y falla con un mensaje claro si no hay ninguna.
3. **El paso del puntero flotante se quedó sin `env: ETIQUETA`** al mover la
   resolución a un paso anterior. Con `set -u` eso es una variable no definida y
   un `exit 1` sin explicación. Ese paso comprueba ahora que el release trae
   `latest.json` y `catalog.json` antes de copiarlos, y si no, dice cuáles
   faltan.

Los tres solo se ven en los logs de un workflow, no en local, y los tres están
arreglados con el arreglo más pequeño posible.

### Una nota sobre la etiqueta

`catalog.json` lleva el tag dentro de sus dos URLs, así que cambiar de etiqueta
lo cambia: `build --tag v0.1.1` regenera el manifiesto y su `sha256` pasa a
`3113ea73...`, mientras los dos `.amod` conservan el suyo. El tag se pasa
explícito con `--tag` y no se deduce, porque publicar es una decisión y por eso
tiene que verse en la orden. El valor por defecto `v0.1.0` se queda: moverlo en
cada release sería un change propio.

## Lo que este change desbloquea

En `ab`, `phase-1-biblioteca`: la vía de descarga por URL pasa de "detectar que
no funciona y decirlo" a **funcionar**, con la comprobación de que el contenido
recibido es el que el gate verificó.