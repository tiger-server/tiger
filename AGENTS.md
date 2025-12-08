# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript source for the engine (`tiger.ts`), resolvers, plugins (HTTP/cron/queue), distributed coordinator, and monitor server. Edit only here.
- `bin/`: CLI entrypoints in TS; build output lives in `lib/bin`.
- `lib/`: Generated JS and types from the build; do not hand-edit.
- `test/runtime/`: Runtime scenario (`runtest.ts`); extend for integration coverage.
- `example/`: Sample app definitions for manual checks.
- `docs/`: Architecture and plugin notes; refresh when behavior changes.
- `db/migrations/`: Sequelize migrations needed for Postgres-backed distributed mode.

## Build, Test, and Development Commands
- `npm run build`: Compile TypeScript to `lib/` (Node 22.6+).
- `npm run example:bun`: Run the runtime scenario via Bun with `.env`.
- `npm run example:node`: Compile then run the scenario through Node using `.example.env`.
- `npm run distributed:node`: Same as above with `.tigerconf.example.json`; requires `DATABASE_URL` and migrations.
- CLI for local apps: `npx tiger-server run path/to/server.ts`.

## Coding Style & Naming Conventions
- TypeScript with ESM (NodeNext); prefer async/await and explicit return types on exported helpers.
- Two-space indentation; keep imports grouped by module path; keep files small and single-purpose.
- PascalCase for types/interfaces, camelCase for variables/functions, kebab-case for file names, and stable `id` values for modules/plugins.
- Never edit `lib/`; regenerate via the build.

## Testing Guidelines
- Add new runtime scenarios in `test/runtime` (e.g., `distributed-heartbeat.spec.ts`) and register required plugins.
- Run `npm run example:bun` for quick feedback or `npm run example:node` to mirror published usage. For distributed tests, apply migrations first: `DATABASE_URL=... npx sequelize-cli db:migrate`.
- Validate monitor endpoints and queue/cron notifications when features touch them; capture logs from `tiger.log` if debugging.

## Commit & Pull Request Guidelines
- Commit messages stay short and imperative (`fix deps`, `update doc`); keep the first line under 72 chars.
- PRs should describe the change, list testing steps (commands above), and call out config/env/migration impacts; link related issues.
- Attach logs or screenshots for monitor/management UI changes; update `docs/` when protocols or flow change.

## Security & Configuration Tips
- Keep secrets in `.env`/`.example.env`; never commit real credentials. Prefer `DATABASE_URL` env vars over hard-coded strings.
- Default LevelDB paths (`.tiger-level`, `.tiger-cron`) live in the repo root; override via config or env vars when running multiple instances locally.
