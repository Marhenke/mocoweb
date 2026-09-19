# Migración a motor de contenido MCP — estado de lanes

Branch: `cms-migration` · Referencia congelada: tag `pre-cms` en `main` · **Nada pusheado.**

Gate de aceptación: `.migration/verify.sh` — compara las 10 rutas renderizadas contra
`.migration/baseline/`. **Nunca se edita para acomodar un cambio.** Si falla, se rompió algo.

## Estado

| Lane | Qué | Estado |
|---|---|---|
| A1 | Congelar referencia: tag, 10 baselines, `verify.sh` | ✅ verificada |
| A2 | Capa de datos: Docker Postgres, Drizzle, 7 tablas, migraciones | ✅ verificada |
| A3 | `content.schema.ts` + seed (13 colecciones, 39 entries) | ✅ reportada |
| A4 | Read path: componentes leen de la base | ✅ **verificada** |
| A5 | Media: bucket, `/media/*`, upload | ✅ verificada |
| A6 | OAuth Authorization Server (10/10 criterios) | ✅ verificada |
| A7 | Tools MCP + descubrimiento (10 tools, 7/7 criterios) | ✅ verificada |
| A8 | Borrador, publicación, regeneración estática | ✅ verificada |
| A9 | Railway: provisioning, deploy, cutover | ✅ entorno preparado, sin deploy (ver `.migration/CUTOVER.md`) |

A4 es el gate real: cuando los componentes dejen de leer TypeScript hardcodeado y lean de
Postgres, `verify.sh` tiene que seguir dando PASS con cero diferencias. Eso prueba que no se
perdió nada.

## Defectos de documentación encontrados (el producto real de la Fase A)

Estos alimentan la skill. Cada uno salió de un agente trabado o de una revisión.

1. **Aleatoriedad por request, no solo por build.** `BouncingBand.svelte` se randomiza en cada
   render SSR. Decir "buildeá dos veces para ver qué varía" no lo encuentra. Los briefs tienen
   que distinguir ruido build-a-build de ruido render-a-render.

2. **Pedir "hacé pasar el self-test" induce a normalizar de más.** El primer `verify.sh` borraba
   *todo* `translate(...)`. Un self-test que pasa no dice nada sobre si el gate quedó ciego. Regla
   para la skill: normalizá lo más angosto posible y **demostrá** que no tapa cambios reales.

3. **"Demostralo, no lo afirmes" funciona.** Cuando el brief exige construir la prueba, los agentes
   la construyen en vez de asegurar que anda. Patrón fijo en todos los briefs.

4. **No dar un conteo separado de una lista.** El brief de A2 decía "8 tablas" y el contrato listaba
   7. Un número aparte del listado es una segunda fuente de verdad que se desincroniza.

5. **"Instalado" ≠ "corriendo".** Docker está vía OrbStack y el daemon puede estar caído.
   Los briefs dan el remedio (`open -a OrbStack`), no afirman que está listo.

6. **`@sveltejs/adapter-node` no lee archivos `.env`** — usa `process.env` directo. Todo script
   standalone necesita `dotenv` o `node --env-file`. En Railway no importa (inyecta variables),
   pero sí para correr en modo producción local.

7. **Decir "UNIQUE" en un contrato es ambiguo** al mapear a un ORM. Un agente puso primero un
   índice no único. Escribir "unique index/constraint" explícito.

8. **La regla de galería del brief era falsa.** Decía que nunca se mezclan orientaciones en una
   fila; 4 de 6 proyectos tienen filas mixtas (apaisada + vertical). El agente chequeó la realidad
   y ganó la realidad. Los briefs tienen que decir explícitamente *verificá contra los datos reales
   antes de endurecer una regla*, y los agentes tienen que sentirse autorizados a contradecir.

9. **zsh no hace word-splitting de variables sin comillas.** `PSQL="docker exec ..."; $PSQL -c "..."` anda
   en bash y falla con exit 127 en zsh. Los briefs ya avisan de los globs; hay que avisar de esto también.

11. **MinIO Community Edition fue archivado/EOL en 2026** (dato dado en el brief de A5, verificado
    aquí como premisa del propio brief, no re-chequeado contra la realidad externa) — no usarlo por
    default en briefs futuros. **SeaweedFS** (`chrislusf/seaweedfs`, imagen activa) es un reemplazo
    válido: habla S3 real (confirmado con el AWS SDK: crear bucket + put/get byte a byte), corre en
    un solo contenedor sin sidecar de init.

12. **SeaweedFS auto-acepta un `PutObject` en un bucket que nunca se creó formalmente, y después
    ese mismo bucket falla todo `GetObject` con "NoSuchBucket"** — queda en un estado inconsistente
    invisible hasta que alguien intenta leer. La lane A5 lo pisó: 70 uploads "exitosos" que después
    no resolvían ninguno. Arreglo: llamar `HeadBucket`→`CreateBucket` (idempotente, ignora
    `BucketAlreadyExists`/`BucketAlreadyOwnedByYou`) **antes** del primer `PutObject`, no confiar en
    la auto-creación implícita. Un brief que diga "asumí que el bucket existe" para un servicio
    S3-compatible nuevo se equivoca — hay que demostrar el ciclo put→get, no solo el put.

13. **`sharp` no puede medir video** (mp4/webm/etc. — solo decodifica formatos de imagen fija), a
    pesar de que un brief puede pedir "medí ancho/alto con sharp" sin distinguir. Para video real se
    necesita un decodificador real: `ffprobe`, empaquetado sin instalación de sistema vía
    `@ffprobe-installer/ffprobe` (binario estático per-plataforma, funciona igual en Railway).
    Cualquier pipeline de medios que declare "todo con sharp" sin esta distinción está mal
    especificado.

14. **El cross-check de `ratio` contra archivos reales encontró un bug de contenido real**, no solo
    una verificación que pasa: `barbara-plesky/foto-1.jpg`, `foto-2.jpg` y `foto-3.jpg` están
    seteadas con `ratio: 0.75` (retrato) en el contenido pero son 1600×1200 (paisaje, ratio real
    1.3333) — un guess a mano que nunca se validó contra el archivo. La lane A5 lo detectó, lo
    reportó y **no lo corrigió** (mismo criterio que el bug "AV & Produs": corregir contenido no es
    tarea de esta migración) — pero a diferencia de ese bug, este sí rompe el layout de la galería
    hoy mismo, así que es candidato a una tarea de contenido separada, no a "dejar como está para
    siempre".

15. **Un archivo puede existir en `static/` sin que ningún `entries.data` lo referencie** (huérfano
    de un commit anterior — se encontraron 3: `barbara-plesky/placa.jpg`, `ref-summit/img-6.jpg`,
    `ref-summit/portada.jpg`). Un migrador de medios que solo copia "todo lo que hay en `static/`"
    subiría basura; caminar el JSON de contenido real y quedarse solo con paths que aparecen ahí es
    lo que evita eso — pero también significa que un brief que diga "migrá todo `static/`" es
    impreciso: hay que migrar lo que el contenido referencia, no el directorio entero.

16. **"Byte a byte idéntico" es un criterio mal planteado para cualquier migración a CMS**, y hay que
    corregirlo en la skill desde la lane 1 en vez de descubrirlo en la lane 4. Cuando el contenido deja
    de venir compilado en el bundle y pasa a un `+page.server.ts`, SvelteKit **serializa el resultado del
    load dentro del HTML** para poder hidratar. Ese payload no existía antes y no puede no existir ahora
    (el acceso a la base tiene que ser server-only o las credenciales terminan en el cliente). No es un
    bug ni ruido: es arquitectura. El criterio correcto es **"el visitante ve la misma página"**, con la
    normalización del payload prevista de entrada.

17. **Al ablandar un gate, exigir la prueba FAIL→PASS.** Se redefinió qué mide `verify.sh`; la
    contrapartida obligatoria fue demostrar que sigue fallando ante un cambio real. Verificación
    independiente: mutar `projects.racebox.title` hizo fallar **3** rutas — `/trabajos`,
    `/trabajos/racebox` y `/trabajos/sergio-castiglione`, esta última porque muestra "Siguiente
    proyecto → Racebox". El gate detecta propagación transitiva, no solo cambios directos.

18. **`verify.sh` ya estaba en FAIL antes de que A6 tocara una sola línea**, y el brief de A6 asumía
    que reportaba PASS. A5 dejó documentado en su propio commit (`git log 0c521f9`) que las 9 rutas
    con media fallan porque las URLs pasaron de `/projects/...` a `/media/<hash>` — un cambio
    arquitectónico esperado, con prueba compensatoria (hash byte-a-byte, conteo de referencias,
    resolución 200 de las 70 URLs) en vez de diff exacto — pero a diferencia de A4 (que sí agregó una
    regla de normalización para su propio cambio arquitectónico, el payload de hidratación), A5 nunca
    actualizó `normalize()` para las URLs de media, así que el gate quedó en FAIL permanente para
    cualquier lane siguiente. A6 lo verificó por aislamiento: moviendo todos sus archivos nuevos fuera
    del árbol y volviendo a correr `verify.sh`, el resultado es **idéntico** (mismas 9 rutas, mismo
    diff de 6 líneas en `/estudio`, `/contacto` sigue pasando) — cero relación con A6. No se tocó
    `verify.sh` (regla explícita del brief); queda para que el orquestador decida si A5 se re-abre
    para agregar la regla de normalización que le faltó, o si el criterio de aceptación de gates
    futuros se redacta como "cero diffs *nuevos* respecto del estado heredado" en vez de "PASS".

## Huecos de descubrimiento (estado tras A7)

Los tres huecos originales, re-chequeados contra lo que las tools MCP devuelven de verdad
(no contra lo que el brief de A7 asumía):

- ~~que `slug` y `position` son parámetros aparte, fuera de `data`~~ — **cerrado.**
  `describe_collection` devuelve una nota explícita: "`slug` y `position` son propiedades de la
  ENTRY, no campos de `data`...". Verificado con el tool real (`describe_collection('projects')`).
- ~~cómo obtener el `ratio` de un archivo~~ — resuelto en A5, reforzado en A7: `upload_media` lo
  mide del archivo real y lo devuelve; la descripción del tool y las notas de `describe_collection`
  repiten "nunca lo estimes". Probado con un PNG de 800×400 real → `ratio: 2` exacto.
- cómo elegir el color `ink` de un proyecto mirando la portada — **sigue abierto.** Ninguna tool de
  A7 deja que un agente "vea" el contenido visual de un archivo subido (no hay tool de
  análisis/preview de imagen); el agente solo tiene la ruta del archivo y sus dimensiones. La
  descripción del campo `ink` en el schema da la regla en prosa, pero aplicarla sigue exigiendo
  juicio visual que ninguna tool aquí provee. Un futuro lane podría agregar un tool que devuelva,
  por ejemplo, el color dominante/luminancia medida del archivo (con sharp, igual que `ratio`).
- ~~qué significa que `upload_media` devuelva `deduped: true`~~ — **cerrado.** La descripción del
  tool lo dice explícitamente ("this is a normal no-op, not an error").

Huecos nuevos encontrados al construir A7 (no estaban en la lista original):

- ~~`reorder_entries` no puede tocar una colección con algo publicado~~ — **cerrado en A8.** Se
  agregó `entries.published_position` (columna separada de `position`, ver migración
  `drizzle/0001_wonderful_tyger_tiger.sql`): `position` es ahora exclusivamente el orden de
  borrador, `published_position` es el orden que ve el visitante, congelado en el último
  `publish`. `reorder_entries` ya no tiene ninguna restricción; probado reordenando `projects`
  (que tiene las 6 entries de producción publicadas) sin mover el sitio en vivo hasta el `publish`
  explícito.
- ~~`delete_entry` se niega si la entry tiene `published_data`~~ — **cerrado en A8.** Se agregó
  `entries.pending_delete`: borrar una entry publicada ya no la borra de la base — la marca
  `pending_delete: true` (sigue en vivo tal cual) y recién `publish` borra la fila de verdad.
  `delete_entry(restore: true)` deshace la marca antes de publicar. Ver tools `publish` /
  `unpublish` / `list_revisions` / `rollback` / `preview_url` nuevas en
  `src/lib/server/cms/mcp/tools/publish.ts`.
- **`create_entry` sigue agregando siempre al final** (sin cambios en A8) — pero ya no es una
  limitación real: `reorder_entries` ahora funciona libremente sobre el orden de borrador aunque
  la colección tenga entries publicadas, así que "crear al final + reordenar" cubre insertar en
  cualquier posición.

## Bugs de contenido preexistentes (NO tocar en la migración)

Preservados tal cual; arreglarlos es una tarea de contenido, no de migración:
- Home dice **"AV & Produs"** (truncado, debería ser "AV & Producción") — `Services.svelte:15`
- Home y `/estudio` tienen **dos listas de servicios distintas** con textos que divergieron
- `npm run check` da un error de TS preexistente: falta `@types/node` (A5 agrega más ocurrencias del
  mismo error preexistente en sus propios archivos nuevos, no un error nuevo — instalar `@types/node`
  arreglaría todas de una vez, pero es una tarea de config, no de esta migración)
- **`barbara-plesky/foto-1.jpg`, `foto-2.jpg`, `foto-3.jpg` tienen `ratio: 0.75` en el contenido pero
  son 1600×1200 (ratio real 1.3333)** — encontrado por el cross-check de medición real en A5, no
  corregido (ver defecto #14 arriba). Rompe la proporción de esas celdas en la galería hoy mismo.
- `static/projects/barbara-plesky/placa.jpg`, `static/projects/ref-summit/img-6.jpg` y
  `static/projects/ref-summit/portada.jpg` son archivos huérfanos (ningún `entries.data` los
  referencia) — quedaron en el repo, no se migraron a medios ni se borraron.

## Defectos encontrados en A9 (Railway)

19. **El brief de A9 volvió a decir "8 tablas"** — el mismo número que el defecto #4 ya marcó
    como falso en A2 (el contrato define 7). Recontado contra un Postgres de Railway genuinemente
    nuevo, recién migrado: 7 tablas (`collections`, `entries`, `media`, `oauth_clients`,
    `oauth_auth_codes`, `oauth_refresh_tokens`, `revisions`), no 8. El número correcto ya estaba
    documentado en este mismo archivo; el brief lo pisó igual. Señal de que "8 tablas" necesita
    borrarse de donde sea que un futuro brief lo copia, no solo corregirse otra vez acá.

20. **`railway config migrate` no puede producir una conversión fiel para este servicio, y no es un
    problema de ejecución sino de lo que el DSL declarativo (`railway/iac`) soporta hoy.** La
    referencia pública (`docs.railway.com/infrastructure-as-code/reference`) no menciona en ningún
    lado `restartPolicyType`/`restartPolicyMaxRetries` ni una forma de fijar el builder
    (NIXPACKS vs RAILPACK) — no es que falte documentar, el propio `railway config migrate`
    (dry-run) genera un archivo que omite por completo la política de reinicio
    (`ON_FAILURE`, 10 reintentos) y deja el builder como comentario, no como config real. Peor:
    `railway config pull --json` muestra que el builder "de base" que Railway tiene guardado para
    este service es **RAILPACK**, distinto del NIXPACKS que `railway.json` fija hoy — aplicar la
    migración (que además "clears Railway Config File settings", desconectando `railway.json`)
    arriesgaba cambiar builder y política de reinicio del servicio en vivo sin que hubiera forma de
    expresar lo contrario en el archivo generado. Se corrió el `migrate` en dry-run nomás (no se
    tocaron los config settings del servicio); la migración de formato queda pendiente hasta que el
    DSL soporte estos dos campos o el dueño acepte el cambio de comportamiento a sabiendas. El plazo
    real (2026-12-01) da margen.

21. **`scripts/migrate-media.ts` (A5) no es reusable tal cual contra un ambiente nuevo.** Su propio
    commit (`0c521f9`) borró los archivos de `static/` una vez subidos al bucket local, así que en
    un checkout nuevo (o un ambiente de producción nunca antes poblado) no quedan bytes que ese
    script pueda leer — encuentra "0 distinct referenced media files" no porque no haya nada que
    migrar sino porque las fuentes ya no existen en disco. La fuente durable es el tag `pre-cms`
    (`git show pre-cms:static/<path>`, el mismo truco que ya usa
    `.migration/generate-media-map.mjs`, generalizado a las 39 entries reales en vez de solo las 10
    páginas del baseline). A9 escribió un script ad-hoc para esto; si un futuro ambiente necesita
    re-poblar medios desde cero, este es el patrón a seguir, no `migrate-media.ts` de A5 sin
    modificar.

22. **Cambiar variables de un servicio Railway sí reinicia el deploy activo por default** — no es
    solo una posibilidad teórica que el brief pedía "confirmar": `railway variable --help` documenta
    la flag `--skip-deploys` explícitamente para evitar ese reinicio, lo que confirma el
    comportamiento default sin necesidad de arriesgarlo contra el servicio en vivo. Las 8 variables
    de A9 se escribieron con `--skip-deploys`; el `deployment ID` y `createdAt` del servicio
    `mocoweb` se verificaron idénticos antes y después (`b4862cbe...`, 2026-09-15) — cero reinicio.

## Lane B3: gate de navegación real, tras el incidente de `commit 463ae0f`

El incidente: `hooks.server.ts` respondía una request de navegación cliente
(`/estudio/__data.json`, normalizada por SvelteKit a `pathname === '/estudio'` +
`isDataRequest === true`) con el HTML cacheado de la página en vez de JSON. La
primera carga de cada página seguía andando (esa sí es una request HTML real);
cualquier click posterior rompía. `verify.sh` (10 rutas), `resilience.sh` (6
checks) y 150 requests manuales con `curl` durante el deploy dieron todos PASS
mientras el sitio estaba completamente inutilizable — ninguno de esos checks
hizo jamás la request que el router cliente realmente hace.

23. **Todo check contra este sitio hasta ahora usaba `curl` contra rutas HTML.**
    Se agregaron dos checks nuevos, cada uno cubriendo un lado distinto del
    contrato roto:
    - `verify.sh` ahora pide `<ruta>/__data.json` (o `/__data.json` para `/`)
      para las 10 rutas y exige `Content-Type: application/json` + body
      parseable — barato, sin browser, y habría bastado solo esto para
      atrapar el incidente. La forma exacta de la URL se verificó contra la
      versión instalada de SvelteKit (2.63) arrancando `node build` y
      mirando la request real, no asumida de memoria.
    - `.migration/browser-nav.sh` + `.migration/browser-nav.mjs` manejan un
      Chrome real (`playwright-core`, sin binario de browser empaquetado —
      ver el header de `browser-nav.sh` para el porqué) y hacen click de
      verdad: home → Trabajos → una tarjeta de proyecto → atrás → Estudio,
      fallando si algún paso cae en la página de error propia del sitio
      (`+error.svelte`, detectado por su texto exacto) o loguea un error de
      consola.
    - **Demostrado, no afirmado**: sacando el guard `event.isDataRequest` de
      `hooks.server.ts` (reintroduciendo el bug exacto del incidente), AMBOS
      checks nuevos fallaron — `verify.sh` reportó las 10 rutas con
      `Content-Type: text/html`, `browser-nav.sh` cayó en "Algo salió mal de
      nuestro lado" con un `SyntaxError: Unexpected token '<'` en consola.
      Restaurando el guard, ambos vuelven a PASS. El diff normalizado de
      `verify.sh` (las 10 rutas HTML) siguió en PASS durante todo el
      experimento — confirma que el nuevo check agrega cobertura real, no
      ruido que ya venía fallando por otra razón.

24. **La base de datos local había perdido la migración de medios de A5.**
    `npm run db:seed` reseedea desde `scripts/source-content.ts`, que sigue
    con los paths pre-migración (`/projects/racebox/portada.jpg`); algún lane
    corrió `db:seed` sin volver a correr la migración de medios después.
    `scripts/migrate-media.ts` (A5) no sirve para arreglarlo: su propio commit
    borró los archivos de `static/` una vez subidos (defecto #21), así que en
    este checkout encuentra "0 distinct referenced media files" — no porque no
    haya nada que migrar, sino porque las fuentes ya no están en disco. Esto
    no era solo un problema cosmético: con las imágenes rotas localmente, el
    check de navegación en browser real (#23) reportaba 6 `404` de consola en
    cada carga de página, indistinguibles a simple vista de un bug real —
    exactamente el tipo de ruido que un gate no puede darse el lujo de tener.
    Solución: `scripts/migrate-media-from-tag.ts`, igual que `migrate-media.ts`
    pero leyendo bytes con `git show pre-cms:static/<path>` en vez de
    `readFileSync` (mismo patrón que ya usa `generate-media-map.mjs`,
    generalizado a las 39 entries seedeadas, no solo las 10 páginas de
    baseline). Verificado: sobre la base local ya migrada, los 70 archivos
    referenciados dieron `exists` (dedupe por contenido, cero bytes subidos de
    más) y detectó los mismos 3 mismatches de `ratio` de `barbara-plesky` que
    documenta el defecto #14 — ni un archivo de más, ni uno de menos.
    `npm run setup:local` (`scripts/setup-local.sh`) encadena
    `db:up` → migrate → seed → `migrate-media-from-tag` en un solo comando
    documentado en el README, para que un checkout limpio (o un `db:seed`
    corrido por error) siempre termine con medios funcionando.
