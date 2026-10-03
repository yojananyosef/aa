# aa

Plataforma de estudio biblico paraamerica latina, construida sobre un catalogo
desacoplado de recursos de dominio publico.

El catalogo esta terminado y publicado. La aplicacion todavia no existe.

## Que es esto

Un modulo es un fichero **SQLite**. Se abre y se consulta con SQL: no hay
adaptadores por tipo de recurso, no hay formato binario proprietary, y no hay
que confiar en la aplicacion para leer un texto.

```
KJV2006_bible.amod     22,5 MB   31.102 versiculos   66 libros
CLARKE_commentary.amod 57,5 MB   19.742 notas
```

Los dos son de dominio publico, y el catalogo comprueba que lo sean antes de
publicarlos: `tools/src/gate.ts` rechaza cualquier licencia que no sea dominio
publico o una Creative Commons nombrada, y exige la URL que respalda la
declaracion.

## Descargar

El catalogo son unos 8 MB comprimidos. Se puede bajar entero de una vez:

```
https://github.com/yojananyosef/aa/releases/download/v0.1.0/v0.1.0.bundle
```

Un `unzip` normal lo abre sin conocer nada de este proyecto:

```
bundle.json
KJV2006_bible.amod.zst
CLARKE_commentary.amod.zst
```

Cada `.amod.zst` se descomprime con zstd y da un SQLite abrible con cualquier
herramienta:

```bash
unzip v0.1.0.bundle
zstd -d KJV2006_bible.amod.zst
sqlite3 KJV2006_bible.amod "SELECT text FROM verses WHERE book='John' AND chapter=3 AND verse=16"
```

## Consultar el catalogo sin descargar los textos

```
https://github.com/yojananyosef/aa/releases/download/v0.1.0/catalog.json
```

`latest.json` es el mismo puntero, flotante, y lleva el `sha256` del
`catalog.json` al que apunta. Un cliente lo lee, ve que hay, elige lo que
quiere, descarga solo eso y comprueba el hash antes de abrirlo.

## Por que SQLite y no un formato propio

Porque el archivo es la API. Se puede inspeccionar con `sqlite3`, consultar
desde cualquier lenguaje con un driver estandar, y depurar con las
herramientas que ya existen. Un formato binario proprietary obliga a que el
usuario confie en nuestra aplicacion para leer un texto, y no hay forma de
comprobar que no le hemos dado otra cosa.

## Los dos hashes

Cada modulo declara dos, porque responden a preguntas distintas.

**`sha256`** es del **fichero**. Verifica que lo que se descargo no se altero.
Es lo que compara un cliente.

**`contentHash`** es de un volcado canonico del **contenido logico**. Verifica
que el build es reproducible.

La separacion no es purismo. Los bytes 96-99 de la cabecera SQLite guardan
`SQLITE_VERSION_NUMBER`, asi que el mismo contenido compilado con dos versiones
de SQLite produce ficheros distintos con el mismo texto. El `sha256` no puede
servir como criterio de reproducibilidad, y el `contentHash` si.

```bash
bun run tools/scripts/comprobar-reproducible.ts   # dos builds, mismo hash
```

## Dominio publico, de verdad

Un texto biblico puede ser de dominio publico y aun asi no ser utilizable: las
sociedades biblicas y las editoras lo(editan con el tiempo, y la fecha de la
edicion importa. Este catalogo solo publica lo que se puede demostrar.

La decision se registro midiendo, no opinando. La Reina-Valera 1909, por
ejemplo: eBible la distribuye en cuatro formatos distintos (USFM, USFX, VPL y
el modulo SWORD) y **los cuatro le faltan los mismos 18 versiculos**. Cuatro
tuberias de serializacion que coinciden en el mismo defecto solo pueden
coincidir si el defecto esta antes, en su base de datos. Wikisource tiene el
texto de esos 18, pero le faltan 25 capitulos enteros y usa otra versificacion
en 10 libros.

Conclusion: la traduccion esta completa, pero **no existe transcripcion digital
completa**. Por eso el catalogo arranca con KJV, que si lo es, y la RVR1909
entra despues por colato de dos testigos documentados. El detalle esta en
`openspec/changes/phase-0-catalogo/proposal.md`.

Y por que no esta la Reina-Valera Gomez: es una "Reina-Valera" mas, como la de
1909, y tiene copyright de 2004 a 2023. `tools/scripts/probar-rechazo.ts` lo
comprueba en cada CI.

## Versificacion

Todo modulo declara la suya, y **KJV es la de referencia**: 66 libros, 1189
capitulos, 31.102 versiculos. Es la unica con una estructura fija y
documentada que permite comparar modulos entre si.

No es un detalle. La RVR1909 sigue la tradicion espanola y numera distinto en
10 libros: el Salmo 18 tiene 51 versiculos donde KJV tiene 50, y el 78 tiene 73
donde KJV tiene 72. Sin un espacio de nombres comun, una Biblia en espanol y un
comentario en ingles no se pueden poner uno al lado del otro.

## Un comentario admite varias notas por versiculo

Un versiculo con dos notas es el caso normal en Clarke y en Wesley. Por eso la
clave primaria incluye `seq`:

```sql
SELECT seq, text FROM commentary WHERE book='Matthew' AND chapter=23 AND verse=13 ORDER BY seq;
```

Sin `seq`, la segunda nota no cabe: SQLite rechaza la clave duplicada, el build
falla entero y el comentario no se publica. El fallo no es perderla en
silencio.

## El texto USFM se conserva sin perdida

Cada versiculo guarda `text` (legible) y `raw` (el fragmento USFM verbatim).
Nada de lo que aporta el marcado se descarta.

No es prudencia teorica. El parser, en su primera version, perdia el espacio de
separacion cuando un marcador envolvente acababa en espacio:

```
\addsl En el principio \addsl*creo Dios
  ->  "En el principio" + "creo Dios"  =  "En el principiocreo Dios"
```

El USFM quedaba intacto en `raw`, asi que un round-trip de `raw` **no lo
detectaba**. El texto se leia mal y no habia ninguna senal. Por eso `raw` es
verbatim *y* el build comprueba que el texto plano nunca sea mas largo que su
fuente.

## Los huecos se registran, no se rellenan

Si una fuente declara un versiculo y no trae su texto, el build **falla**. Con
`--allow-defects` construye, graba los defecto en `info` del modulo, y sigue sin
rellenar nada:

```bash
bun run tools/src/cli.ts build --allow-defects
sqlite3 X.amod "SELECT value FROM info WHERE key='defects'"
```

Un versiculo inventado es peor que uno ausente, porque el usuario no tiene forma
de saber que se lo han rellenado.

## Nunca hay timestamps

Ninguna tabla guarda fecha ni hora de construccion, y hay un test que lo
recorre. Con un timestamp dentro, dos builds del mismo input darian hashes
distintos y el hash dejaria de servir para detectar que el contenido no ha
cambiado.

## Trabajar en esto

```bash
bun test                            # 237 tests
bun run tools/src/cli.ts build      # construye modulos y catalogo
bun run tools/src/cli.ts gate       # tests + integridad + licencias
bun run tools/src/cli.ts info
bun run tools/src/cli.ts bundle
bun run tools/src/cli.ts --help
```

`gate` es la orden que decide. Si no pasa, no se publica.

Lee **[AGENTS.md](AGENTS.md)** antes de tocar nada: la regla de un solo
repositorio, el orden catalogo-primero, y lo que este proyecto ya sabe por
haberlo pagado.

Un cambio de comportamiento es un change de OpenSpec en `openspec/changes/`,
validado con `openspec validate <nombre>`.

## Por que existe asi

Porque catorce repositorios anteriores fallaron, y todos fallaron en el mismo
sitio: se construia el catalogo y la aplicacion a la vez, y se acababa
publicando el catalogo. Seis releases, ninguna de la app.

El orden aqui es el contrario, y la razon esta en `AGENTS.md`. No es que el
catalogo sea mas importante que la app: es que la app se puede rehacer en un
mes y el catalogo no.

## Estado

| | |
|---|---|
| Catalogo | Terminado. 2 modulos, 0 defectos, reproducible byte a byte. |
| Publicacion | Hecha. GitHub Releases, tag inmutable, `latest.json` flotante. |
| Aplicacion | No existe. Es el siguiente change de OpenSpec. |
| Espanol | Pendiente. La RVR1909 entra por colato de dos testigos. |

## Licencia

El codigo de este repositorio es MIT.

Los **textos** que publica el catalogo son de dominio publico y cada modulo
declara su procedencia y su evidencia de licencia en su tabla `info`. Un modulo
de Creative Commons se declara como tal, y la licencia del texto no cambia la
del software.

Ver `tools/src/modulos.ts`.