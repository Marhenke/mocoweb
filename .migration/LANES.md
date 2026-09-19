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
| A6 | OAuth Authorization Server | ✅ reportada (verify.sh: FAIL heredado de A5, no nuevo — ver nota) |
| A7 | Tools MCP + descubrimiento | pendiente |
| A8 | Borrador, publicación, regeneración estática | pendiente |
| A9 | Railway: provisioning, deploy, cutover | pendiente — **bloqueada por `railway login`** |

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

## Huecos de descubrimiento que quedan abiertos (para A7)

El JSON Schema servido todavía no le dice a un agente:
- que `slug` y `position` son parámetros aparte, fuera de `data`
- ~~cómo obtener el `ratio` de un archivo~~ — resuelto en A5: `upload_media` (`src/lib/server/cms/media/upload.ts`)
  lo mide del archivo real (sharp para imagen, ffprobe para video) y lo devuelve; un futuro tool MCP de
  "subir media" debe llamarlo y usar el `ratio` que devuelve, nunca pedirle a un agente que lo estime.
- cómo elegir el color `ink` de un proyecto mirando la portada
- A7 también necesita saber que subir un archivo idéntico (mismo hash) es un no-op de storage (dedupe),
  no un error — el schema no dice hoy qué significa que `upload_media` devuelva `deduped: true`.

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
