# Agent Instructions

## Project Shape

- This is an Angular 22 standalone application with server-side rendering and an Express host.
- The user-facing feature is the chatbot in `src/app/chatbot/`; keep its template, styles, behavior, and focused tests together.
- `src/app/app.ts` is the root composition point. Add routes through `src/app/app.routes.ts` rather than bypassing Angular routing.
- `src/server.ts` owns Express middleware, the `/api/chat` backend boundary, static assets, and SSR fallback. Keep server-only code and secrets there.

## Development Workflow

- Install with the repository's declared npm version when possible (`npm@11.19.0`).
- Start the development server with `npm start` and use `http://localhost:4200/`.
- Run the production build with `npm run build`.
- Run unit tests with `npm test`; add or update focused specs beside the implementation when behavior changes.
- For SSR changes, build first, then use `npm run serve:ssr:my-app` to exercise the generated server.

## Implementation Conventions

- Prefer standalone components, Angular dependency injection, and the existing direct-import style. Avoid introducing NgModules or a new state-management library for local chatbot state.
- Preserve SSR compatibility: guard `window`, `document`, `localStorage`, `navigator`, and other browser-only APIs with the existing platform check pattern.
- Keep API contracts explicit and validate request data at the Express boundary. Never expose `GEMINI_API_KEY` or other secrets to browser code, templates, logs, or committed files.
- Reuse the existing chatbot visual language and responsive CSS before adding new design primitives. Keep controls keyboard accessible, labeled, and usable on narrow screens.
- Keep TypeScript strictness intact. Avoid `any` in new code, handle failed network responses, and preserve user-friendly error behavior.
- Make focused changes, preserve public behavior unless the task requires otherwise, and do not reformat unrelated files.

## Documentation

- See [README.md](README.md) for the baseline Angular CLI workflow and project commands.
- Update nearby tests and documentation when changing an API contract, user workflow, or development command.