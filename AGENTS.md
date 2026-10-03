# AGENTS.md

Instrucciones para quien trabaje en este repositorio, empezando por un agente
autonomo. Esta es la parte del proyecto que mas caros han salido las cosas, asi
que va primero y sin rodeos.

---

## 1. Un solo repositorio. Sin excepciones.

**Este proyecto vive en UN repositorio. No se crea un segundo.**

No es una preferencia de estilo ni una recomendacion. Es la causa raiz de que
este sea el decimoquinto intento: catorce repositorios, cinco stacks distintos
(Rust, Flutter, TypeScript/Expo, Svelte, Python, HTML), seis releases. Todas las
releases fueron del **catalogo**. Ninguna fue de la **aplicacion**.

Un repositorio por proyecto obliga a elegir un stack y a mantenerlo. Cuando
todo esta aqui, no hay decision que tomar, y las decisiones son lo que consume
el tiempo.

Si hace falta una segunda pieza de infraestructura, va **dentro** de este
repositorio, en su directorio. Si de verdad hace falta otro repositorio, hace
falta un cambio de OpenSpec aprobado por la persona duena del proyecto. No se
hace porque quede comodo.

## 2. El orden es: catalogo primero, aplicacion despues.

La aplicacion lee del catalogo. Nunca al reves. Un texto que entra en el
catalogo pasa por `tools/src/gate.ts`; uno que se descarga de internet y se
muestra en pantalla, no.

Esto no es purismo. Es lo que cuesta: una app puede ser un prototipo de un dia
y un catalogo es un compromiso de diez anos. El catalogo se construye primero
porque es lo que no se puede rehacer despues.

## 3. Todo lo que sale de aqui tiene que ser verificable.

Un artefacto sin hash no existe. Un modulo sin `license_evidence` no se
publica. Un texto que no se puede volver a construir byte a byte no se publica.

Y al reves: **si no se puede comprobar, no se afirma**. Cuando algo no se ha
podido verificar, se dice que no se ha podido verificar. Al principio de este
proyecto se dio por hecho que "la traduccion esta completa" sin comprobar que
las transcripciones digitales lo estuvieran, y costo un dia entero de busqueda
descubrir que ninguna lo estaba.

## 4. Nunca se inventa texto biblico.

Si una fuente declara un versiculo y no trae su texto, el build **falla**. Con
`--allow-defects` construye, pero el defecto queda grabado en `info` del modulo
y no se rellena nada.

Un versiculo inventado es peor que un versiculo ausente: el usuario no tiene
forma de saber que se lo han rellenado. Y "se ve por contexto" no es una
fuente, es una conjetura.

Igual con las licencias. "Es una Reina-Valera, luego es libre" es falso, y el
gate lo rechaza. La Reina-Valera Gomez tiene copyright de 2004 a 2023 y es una
"Reina-Valera". El gate decide sobre lo declarado en `tools/src/modulos.ts` y
sobre la evidencia que lo acompana, nunca sobre parecido.

## 5. Lo que este proyecto ya sabe, para no repetirlo

Esto esta escrito porque las dos cosas costaron dinero descubrirlo. Si algo de
aqui contradice una suposicion nueva, gana lo que esta aqui hasta que se
demuestre lo contrario.

### La RVR1909 no tiene transcripcion digital completa

Dieciocho versiculos aparecen sin texto en **todas** las exportaciones de
eBible (USFM, USFX, VPL) y en el modulo SWORD `SpaRV`. Cuatro tuberias de
serializacion distintas fallan en los mismos dieciocho: el defecto esta en su
base de datos de origen, no en la exportacion. Wikisource tiene el texto de los
dieciocho (verificado 18/18) pero le faltan 25 capitulos enteros y usa otra
versificacion en 10 libros.

**Por eso el primer modulo del catalogo es KJV, que es completa, de dominio
publico y coherente con la versificacion.** RVR1909 entra despues, por colato
de dos testigos, documentado. No antes.

Detalle en `openspec/changes/phase-0-catalogo/proposal.md`, seccion "Auditoria
de fuentes RVR1909".

### La versificacion es el problema de verdad, no un detalle

KJV es el espacio de nombres canonico porque es la unica con una estructura
fija y publicly documentada (66 libros, 1189 capitulos, 31.102 versiculos) que
permite comparar modulos entre si. La RVR1909 sigue la tradicion espanola y
numera distinto en 10 libros: Salmo 18 tiene 51 versiculos donde KJV tiene 50,
Salmo 78 tiene 73 donde KJV tiene 72.

Cualquier modulo nuevo tiene que declarar su versificacion, y si no es KJV, su
correspondencia con KJV tiene que estar medida y versionada.

### Lo que la gente recuerda de memoria esta mal

La tabla de libros se escribio primero desde el recuerdo. **21 de 66 tenian un
numero de versiculos equivocado**, y el total salia en 32.473 en vez de
31.102. Los numeros ahora salen de un texto de referencia y estan bloqueados
por tests que verifican las tres invariantes: 66 / 1189 / 31102.

Lo mismo vale para cualquier dato: se mide o no se afirma.

### Los detalles de implementacion cambian el texto biblico

El parser USFM, en su version primera, perdia el espacio de separacion cuando
un marcador envolvente acababa en espacio:

```
\addsl En el principio \addsl*creo Dios
==> "En el principio" + "creo Dios" = "En el principiocreo Dios"
```

El USFM quedaba intacto en `raw`, asi que un round-trip de `raw` **no lo
detectaba**. El texto se leia mal y no habia ninguna senal. Por eso `raw` es
verbatim y ademas el build comprueba que el texto plano nunca sea mas largo que
su fuente.

### SQLite no es determinista por si solo

Medido en este repositorio antes de escribir el escritor de modulos: el mismo
contenido insertado en orden inverso da un `sha256` distinto. Por eso las filas
se ordenan por clave primaria antes de insertar, los pragmas se fijan, y no
hay ningun timestamp en ninguna tabla.

Y por eso hay **dos** hashes: `sha256` del fichero (transporte) y `contentHash`
de un volcado canonico (reproducibilidad). Los bytes 96-99 de la cabecera
SQLite guardan `SQLITE_VERSION_NUMBER`, asi que el mismo contenido compilado con
dos versiones de SQLite da ficheros distintos. El `contentHash` excluye el
propio `content_hash` de su material, porque un hash no puede contenerse a si
mismo.

### El formato SWORD son tres ficheros, no uno

Los comentarios en dominio publico (Clarke, Wesley, Barnes) solo se distribuyen
asi. El detalle esta documentado en `tools/src/sword.ts`; lo esencial es que
`.bzs` y `.bzv` tienen registros de tamanos distintos (12 y 10 bytes) y que el
registro de verso se lee como `(bloque, inicio, longitud)`.

El verificador de esto no es que compile: es que `inicio[i+1] ==
inicio[i] + longitud[i]` encuadra en los 9.641 de 9.641.

### Comentarios: `seq` es obligatorio

Un versiculo con dos notas es el caso normal en Clarke y en Wesley. Con la
clave `(book, chapter, verse)` sola, la segunda nota **no cabe**: SQLite
rechaza la clave duplicada. El fallo no es perderla en silencio, es que el
build falla entero y el comentario no se publica.

### Una URL que responde 200 puede ser inservible

Esto se costo un dia entero de pruebas, asi que va aqui.

`curl -L https://api.github.com/repos/.../releases/assets/608475849` con
`Accept: application/octet-stream` devuelve **200**, los 22.544.384 bytes del
modulo de KJV y su `sha256` correcto. Por `curl`, el transporte funciona.

En un navegador, la misma peticion da `Failed to fetch`. La razon: el 302 de
`api.github.com` responde `Access-Control-Allow-Origin: *`, pero la respuesta
final, servida por `release-assets.githubusercontent.com`, **no responde ninguna**.
Una redireccion no hereda sus permisos a la respuesta a la que apunta.

Lo mismo pasa con `releases/download`. Y por eso el primer `curl -L` de este
proyecto dio "funciona" y el primer navegador dio "no funciona", con el mismo
fichero y el mismo hash.

**La regla:** una URL que va a leer un navegador se comprueba con una cabecera
`Origin` de otro dominio, y se comprueba en un navegador. No vale `curl -L`.

Por eso el catalogo declara **dos** URLs y ninguna sustituye a la otra:

| Campo | Para quien | Comprobado |
| --- | --- | --- |
| `downloadUrl` | clientes nativos | GitHub Releases, correcto |
| `browserUrl` | navegadores | GitHub Pages, `ACAO: *` tambien en binarios |

Y el gate comprueba que las dos lleven al mismo fichero. Si divergen, el hash no
cuadra en el cliente y no en el servidor, que es mucho mas dificil de
diagnosticar.

## 6. Como trabajar aqui

```bash
bun test                            # 241 tests
bun run tools/src/cli.ts build      # construye los modulos y el catalogo
bun run tools/src/cli.ts gate       # tests + integridad + licencias
bun run tools/src/cli.ts info       # estado
bun run tools/src/cli.ts --help
```

`gate` es la orden que decide. Si no pasa, no se publica.

Un cambio de comportamiento es un cambio de OpenSpec en
`openspec/changes/`, con `proposal.md`, `tasks.md` y los `specs/`. Despues se
valida con `openspec validate <nombre>`.

## 7. Lo que NO se hace aqui

- **No se borra ni se archivan los repositorios anteriores.** Es una decision de
  la persona duena del proyecto, al final, y solo si el proyecto funciona. No es
  una tarea de ningun cambio, y un agente que la incluya en un plan esta
  haciendo algo que no le corresponde.
- **No se abandona GitHub Releases como registro.** Sigue siendo el registro
  inmutable con su tag, y es lo que verifica el gate. GitHub Pages es solo el
  transporte, construido desde el release. R2 sigue siendo el paso siguiente
  cuando el ancho de banda de Pages deje de aguantar, y es cambiar la URL de
  origen en un sitio: la decision de cuando, con el numero medido, esta escrita
  en `openspec/changes/archive/2026-10-03-phase-1-transporte-web/tasks.md`.
- **No se anade una dependencia para algo que hace la plataforma.** El proyecto
  es Bun con cero dependencias en tiempo de ejecucion. `node:crypto`, `node:zlib`
  y `bun:sqlite` son plataforma, no dependencias. `pysword` se uso como paso
  unico de adquisicion de fuente y no esta en el proyecto.