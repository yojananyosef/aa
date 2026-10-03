# Tasks

## 1. `browserUrl` en el catálogo

- [ ] 1.1 Añadir `browserUrl` a los campos obligatorios en `tools/src/catalog.ts` y a `EntradaCatalogo`; verificar que el validador falla nombrando el `id` del módulo y el campo que falta
- [ ] 1.2 Declarar el origen web junto al origen de releases en `tools/src/modulos.ts`,derivándolo de `REPOSITORIO` igual que `ORIGEN`; verificar que no hay URL escrita a mano en ningún otro sitio
- [ ] 1.3 Emitir `browserUrl` en `tools/src/construirCatalogo.ts` apuntando al mismo nombre de fichero que `downloadUrl`; verificar con `bun run tools/src/cli.ts build` que el `catalog.json` generado lo trae en las dos entradas
- [ ] 1.4 Comprobar que `downloadUrl` no ha cambiado para ningún módulo; verificar que sigue siendo `https://github.com/yojananyosef/aa/releases/download/<tag>/<fichero>`
- [ ] 1.5 Añadir el campo a la prueba del catálogo y verificar que `bun test` pasa con el campo nuevo y falla si se quita

## 2. Workflow de publicación

- [ ] 2.1 Añadir `.github/workflows/pages.yml` que se dispare al publicar un release, descargue sus artefactos y los publique con `actions/upload-pages-artifact` y `actions/deploy-pages`; verificar que el workflow existe y se ejecuta
- [ ] 2.2 Habilitar Pages en `yojananyosef/aa` con `build_type: workflow`; verificar con `gh api repos/yojananyosef/aa/pages` que responde y que `build_type` es `workflow`
- [ ] 2.3 Fallar el despliegue si el conjunto servido pasa de 1 GB, que es el límite de un sitio de Pages; verificar que el umbral está en el workflow y no solo en un comentario
- [ ] 2.4 Publicar un release nuevo y comprobar que el sitio se reconstruye con sus artefactos; verificar que los `sha256` del sitio coinciden con los del release

## 3. Comprobación con peticiones reales

- [ ] 3.1 Solicitar `catalog.json` desde el origen web con una cabecera `Origin` de otro dominio y verificar que la respuesta incluye `Access-Control-Allow-Origin`; la comprobación usa `curl` con `-H "Origin: ..."`, no la lectura del sitio en un navegador
- [ ] 3.2 Solicitar `sqlite3.wasm` desde el origen web con `Origin` ajeno y verificar que también lo incluye, para saber que no es solo el HTML
- [ ] 3.3 Descargar un `.amod` real desde el origen web y verificar que su `sha256` es `ce0cb1bc4edbf3341d673739539421bbfed3972e39cbac5fc129f35f25324fe9`
- [ ] 3.4 Descargar el `.amod` del comentario desde el origen web y verificar que su `sha256` es `3df25f8286231c344fb8f47ce74a697b40b4cfeffce0dc311ac7aa5f19c1608c`
- [ ] 3.5 Abrir los dos `sha256` con `sqlite3` y responder Juan 3:16 en los dos, para comprobar que no es un fichero corrupto que casualmente tiene el hash
- [ ] 3.6 Medir el ancho de banda que representa el catálogo completo y anotarlo en el README con el número de descargas/mes que sale; verificar que el cálculo está escrito y no solo afirmado

## 4. Green

- [ ] 4.1 `bun test`, `bun run tools/src/cli.ts gate` y `bun run tools/src/cli.ts validate` los tres en verde; verificar que los tres salen con código 0
- [ ] 4.2 Actualizar `AGENTS.md` con la regla que se acaba de aprender: una URL que devuelve 200 por `curl` puede ser inusable desde un navegador, y por eso se comprueba con `Origin`; verificar que la regla está escrita con el caso concreto
- [ ] 4.3 Anotar en `openspec/changes/archive/` que este change desbloquea la descarga en navegador del repositorio hermano
