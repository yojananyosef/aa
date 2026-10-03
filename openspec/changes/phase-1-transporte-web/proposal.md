# Phase 1 — Transporte web

## Por qué

El catálogo está publicado y verificado, pero **un navegador no puede descargar
ni un solo módulo desde él**. Eso no es una suposición: está medido con `fetch`
real en Chrome 154 headless, y documentado en el repositorio hermano
`ab`, en `docs/investigacion/transporte-cors.md`.

El resultado es que la aplicación lectora, que va web primero, puede pintar el
manifiesto y no puede hacer nada con él. La página que va primera es la única
bloqueada.

La causa es una sola y es de transporte:

| Origen | `Access-Control-Allow-Origin` en la respuesta final | ¿Sirve en navegador? |
| --- | --- | --- |
| `github.com/.../releases/download/...` | ninguna | no |
| `api.github.com/.../assets/{id}` con `octet-stream` | ninguna (la redirección sí, el destino no) | no |
| `raw.githubusercontent.com` | `*` | sí, pero solo para lo que está en el repositorio |
| **`yojananyosef.github.io/ab/`** | `*` | **sí, incluidos los binarios** |

La trampa que hace esto fácil de errar: `curl -L` sobre la URL de la API
devuelve 200, los 22.544.384 bytes y el `sha256` correcto. Por `curl` parece
que funciona. En el navegador da `Failed to fetch`, porque una redirección no
hereda sus permisos a la respuesta final.

## Qué cambia

Se añade un origen de transporte para los artefactos, y el catálogo lo declara
para que el cliente no tenga que adivinarlo:

- **Un workflow que publica los artefactos del release en GitHub Pages**, sin
  tocar el formato, ni el versionado, ni el proceso de build.
- **Un campo `browserUrl` en cada entrada del catálogo**, que es la URL desde la
  que un navegador puede leer ese módulo. El `downloadUrl` se queda como está,
  porque es correcto para nativo, y los dos clientes eligen el que pueden usar.

GitHub Releases sigue siendo el registro inmutable con su tag. El sitio es
solo el transporte, y se reconstruye desde el release, nunca desde el
repositorio: los `.amod` no entran en el historial de git, que es exactamente
lo que este repo lleva decidiendo desde el principio.

## Fuera de alcance (explícito)

- **No se cambia el formato AMF**, ni `catalog.json`, ni el gate de licencia.
- **No se migra a almacenamiento de objetos.** GitHub Pages aguanta de sobra el
  volumen actual y no cuesta nada. R2 es el paso siguiente, y el cambio son
  tres líneas cuando el número de descargas lo pida.
- **No se compromete con Pages como CDN de binarios.** Los límites son de 1 GB
  de sitio y 100 GB/mes de ancho de banda, y con el volumen actual son unas
  1.740 descargas al mes del módulo grande. Está escrito, no escondido.
- **No se toca `ab`.** El cliente ya sabe distinguir "no legible desde el
  navegador" y lo dice; en cuanto este change aterrice, esa vía empieza a
  funcionar sin tocar el cliente.

## Definition of Done

Verificable sin usuario, con peticiones reales desde un origen distinto:

1. `bun test` pasa y `bun run tools/src/cli.ts gate` sigue en verde.
2. Cada entrada del catálogo tiene `browserUrl`, y la comprobación de que es
   accesible desde un navegador con `Origin:` ajeno pasa para todos los módulos.
3. Un `.amod` descargado **desde la URL de Pages** tiene el mismo `sha256` que
   declara el catálogo. Esto es lo importante: que el camino nuevo sirva el
   contenido viejo, no otra cosa.
4. `catalog.json` y `latest.json` son legibles desde el navegador.
5. Existe una prueba que falla si `browserUrl` desaparece del catálogo, para que
   no se pueda quitar en un cambio futuro sin que salte.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Publicar 80 MB en un sitio de Pages | El límite son 1 GB y 100 GB/mes. Con `sizeBytes` de 80 MB hay margen de sobra, y el workflow falla si el sitio pasa de 1 GB |
| Que Pages deje de servir cabeceras de origen cruzado | Es lo que se está midiendo, no suponiendo. La tarea de comprobación usa `Origin:` real, y si algún día cambia, el aviso del cliente lo dirá en vez de fallar en silencio |
| Que el sitio y el release se desincronicen | El sitio se construye **desde** el release publicado, en el mismo workflow que lo publica. No hay dos fuentes |
