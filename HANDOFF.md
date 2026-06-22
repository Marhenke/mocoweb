# Handoff — mocoweb (sitio del estudio Moco)

> Documento para que otro agente continúe el trabajo. Escrito 2026-06-22.

## La usuaria (importante)

- **No es técnica.** Explicar simple y **en español**; ejecutar TODO lo técnico por ella (no le pidas que corra comandos en la terminal).
- **Arrancá vos el dev server**: ella ve los cambios en vivo en el navegador, no usa terminal.
- **No pushear a GitHub salvo pedido explícito** ("commit", "subí", etc.). Podés commitear local solo cuando lo pide.
- Voseo argentino en los textos del sitio ("Empecemos", "Hacé click", "¿Qué necesitás?").

## Qué es

Web del estudio creativo **Moco**. Sitio multipágina.
Repo: `https://github.com/Marhenke/mocoweb.git` (privado, branch `main`).

## Stack

- **SvelteKit** con **Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`)**.
- **Tailwind v4** — tokens en `@theme` dentro de `src/routes/layout.css`. **No hay `tailwind.config.js`.**
- `@sveltejs/adapter-node` (para Railway). `railway.json` con Nixpacks, start `node build`.
- `$app/state` (no `$app/stores`) para el `page` (detección de link activo en Nav).

## Entorno de desarrollo

- **Node 24 vía nvm.** No hay Homebrew. `gh` está en `~/.local/bin`.
- **Dev server en puerto 5180** (configurado en `/Users/marlenehenke/Projects/.claude/launch.json`).
  ⚠️ El proyecto hermano **Durazno usa 5173 — no pisar ese puerto.**
- Preview: usar las tools `preview_*` (ya hay server corriendo normalmente). El `preview_screenshot`
  a veces renderiza con el viewport angosto/glitcheado; cuando pasa, verificar por DOM con
  `preview_eval` (getBoundingClientRect, getComputedStyle) en vez de confiar en la captura.

## Conversión de video (heros)

Los videos vienen como `.MOV` de iPhone (**HEVC/H.265 ~58MB**, no se reproducen en todos los
navegadores). Hay que convertirlos a mp4 H.264.

- **No hay ffmpeg instalado** ni brew. Se usa un **ffmpeg portátil arm64 en `/tmp/ffmpeg`**.
  Si `/tmp` se limpió, re-descargar:
  ```bash
  cd /tmp && curl -sL -o ffmpeg.zip "https://www.osxexperts.net/ffmpeg711arm.zip" && unzip -o -q ffmpeg.zip && chmod +x ffmpeg
  ```
- Comando usado para convertir (reemplaza `static/video/hero.mp4` + poster):
  ```bash
  SRC=~/Downloads/ARCHIVO.MOV
  /tmp/ffmpeg -y -hide_banner -loglevel error -i "$SRC" -an -vf "scale=1280:-2" \
    -c:v libx264 -profile:v high -crf 27 -preset veryfast -movflags +faststart static/video/hero.mp4
  /tmp/ffmpeg -y -hide_banner -loglevel error -ss 1 -i "$SRC" -vframes 1 -vf "scale=1280:-2" static/video/hero-poster.jpg
  ```
  (`-an` = sin audio, queda ~9MB). Los archivos que pasa la usuaria suelen estar en `~/Downloads`.

## Identidad / tokens (`src/routes/layout.css`)

- `--color-cream #f4f0e6` (fondo base) · `--color-cream-dark #e8e2d2`
- `--color-ink #16140f` (texto/oscuro) · `--color-ink-soft #3a362d` · `--color-muted #6f6a5d`
- `--color-lime #c8f135` (acento) · `--color-lime-dark #aad419`
- Fuentes: `--font-display` = **Bricolage Grotesque** (títulos) · `--font-sans` = **Inter** (texto)
- Animaciones definidas ahí: marquee, float-up. `body { overflow-x: hidden }`.

## Estructura de páginas

- `/` (Home) → `src/routes/+page.svelte`: `Hero` → `Statement` → `Services` → `PortfolioPreview`
  → `BouncingBand` → `Contact`.
- `/nosotros` → hero (negro) + "En qué creemos" (5 valores) + "Cómo trabajamos" + "Quiénes somos".
- `/trabajos` (grilla) y `/trabajos/[slug]` (detalle dinámico, 404 si no existe).
- `/contacto`.
- Layout global `src/routes/+layout.svelte` = `Nav` + slot + `Footer`.

## Componentes clave / detalles no obvios

- **`Hero.svelte`** (home): video de fondo (`/video/hero.mp4`, loop, muted, autoplay, poster).
  Título usa tamaño fluido `text-[clamp(2rem,8.5vw,7.5rem)]` para que **"contenido pegajoso"
  entre en una sola línea sin desbordar** en mobile. "pegajoso" = caja lima (`bg-lime` rotada -2°).
  Marquee abajo: Branding · Diseño Web · Identidad Visual · Dirección de Arte · Producción.
- **`Statement.svelte`**: franja **lima**, frase "El mundo merece conocerte, nosotros te podemos
  ayudar." Cada palabra es un `<span>` que **al hover cambia a una tipografía random** (array `fonts`).
  Importante: tras cada palabra va `{' '}` condicional para no perder los espacios (Svelte los come).
- **`BouncingBand.svelte`**: franja **negra** con el blob cromado (`/blobs/blob-1.png`) rebotando
  estilo DVD; el **ángulo cambia un poco en cada rebote** (jitter). **Hover** = se frena y gira.
  **Click en la franja** = cambia de imagen. Hoy hay 1 sola imagen real; las "otras" son la misma
  con `filter` CSS distinto (array `blobs`). Para sumar imágenes reales: poné PNGs en
  `static/blobs/` y agregalos al array con `filter: 'none'`.
- **`Nav.svelte`**: fijo, glass al hacer scroll. `overHero` = texto claro cuando NO se scrolleó y
  estás en una página con **hero oscuro**. Hoy `darkHero = pathname === '/' || '/nosotros'`.
  ⚠️ **Si agregás otra página con hero oscuro, sumala a `darkHero`** o el menú no se leerá.
- **`SocialIcon.svelte`**: SVGs inline para `instagram | tiktok | youtube | spotify`.
- **`projects.ts`**: 6 proyectos placeholder (verdeo, lumen-cafe, ola-studio, nido, pulpo, sereno).

## Estado actual

- Working tree **limpio**, todo pusheado. Último commit `d70822c`.
- Build de producción verificado con adapter-node.

## Pendientes / próximos pasos

1. **Railway**: la usuaria tiene que conectar el repo a mano en railway.com (crear cuenta →
   New Project → Deploy from GitHub repo → `mocoweb` → Generate Domain). No hay Railway CLI instalado.
   Ya estaba pedido pero faltaba confirmar que quedó online.
2. **Fotos reales del equipo** en Nosotros → "Quiénes somos" (hoy placeholders "Foto").
   Equipo: Marlene Henke (Lic. en Diseño — IG/TikTok/YT) y Joaquín Gegenschatz
   (Lic. en Comunicación — IG/TikTok/YT/Spotify). Las **URLs de redes son placeholders** todavía.
3. **Proyectos reales** en `projects.ts` + imágenes (hoy todo placeholder).
4. La usuaria venía iterando sobre Home y Nosotros; seguirá pidiendo ajustes de texto/diseño.
   Mencionó querer seguir con más cosas del hero/secciones.

## Flujo de trabajo recomendado

1. Asegurar dev server en 5180 (`preview_start` si hace falta).
2. Editar componentes; verificar en vivo (preferir `preview_eval` por DOM si la captura glitchea).
3. Commitear/pushear **solo cuando lo pida** ("commit"). Mensajes en español, terminar con
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
