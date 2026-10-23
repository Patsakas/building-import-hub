# End-to-end tests

Playwright drives the real app: the static build served by the Firebase Hosting emulator (the
same rewrites as production, from `firebase.json`; it does not apply custom headers, which the
post-deploy smoke test checks), talking to a local Supabase stack
with the seed users from `supabase/seed.sql`. CI runs them in the _Database and integration_ job.

The page carries the production Content Security Policy as a `<meta>` tag, so it applies here too:
every test fails if the browser blocks anything under it (`e2e/fixtures.ts`).

```sh
npx supabase start                      # local stack: migrations + seed users
npx supabase status -o env              # note API_URL and PUBLISHABLE_KEY

# Build against the local stack (these variables override the committed .env), then add the CSP
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY> bun run build
deno run --config scripts/deno.json --allow-read=.output --allow-write=.output \
  scripts/add-csp.ts http://127.0.0.1:54321

npx firebase-tools emulators:start --only hosting --project demo-e2e   # serves on :5000
bunx playwright install chromium                                       # first time only
bun run test:e2e
```
