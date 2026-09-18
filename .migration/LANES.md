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
| A4 | Read path: componentes leen de la base | ⏸️ siguiente |
| A5 | Media: bucket, `/media/*`, upload | pendiente |
| A6 | OAuth Authorization Server | pendiente |
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

## Huecos de descubrimiento que quedan abiertos (para A7)

El JSON Schema servido todavía no le dice a un agente:
- que `slug` y `position` son parámetros aparte, fuera de `data`
- cómo obtener el `ratio` de un archivo (lo resuelve `upload_media` en A5)
- cómo elegir el color `ink` de un proyecto mirando la portada

## Bugs de contenido preexistentes (NO tocar en la migración)

Preservados tal cual; arreglarlos es una tarea de contenido, no de migración:
- Home dice **"AV & Produs"** (truncado, debería ser "AV & Producción") — `Services.svelte:15`
- Home y `/estudio` tienen **dos listas de servicios distintas** con textos que divergieron
- `npm run check` da un error de TS preexistente: falta `@types/node`
