# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Local setup (database + media), one command

This app reads content and media from Postgres and an S3-compatible bucket
(see `docker-compose.dev.yml`) — a checkout with no local database has no
content and no images. From a clean checkout, with Docker/OrbStack running:

```sh
npm install
npm run setup:local
```

This starts Postgres + object storage, applies migrations, seeds content,
and migrates every referenced media file into the bucket (sourced from the
frozen `pre-cms` git tag, so it works even though the original files under
`static/` were deleted once already migrated — see
`scripts/migrate-media-from-tag.ts` and `.migration/LANES.md` defect #21).
It's safe to re-run any time, including after `npm run db:seed` on its own
(which reintroduces pre-migration `/projects/...` media paths — seeding and
migrating media are two separate steps on purpose, and `setup:local` is what
runs both in the right order). Then `npm run dev`.

Before trusting any manual check of the site locally (screenshots, clicking
around), run `npm run setup:local` first — a dev DB with stale media paths
looks broken in ways that have nothing to do with whatever you're actually
testing.

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.16.1 create --template minimal --types ts --add tailwindcss="plugins:typography" prettier --no-download-check --install npm .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
