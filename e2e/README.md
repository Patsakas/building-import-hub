# End-to-end tests

Playwright drives the real app: the static build served by the Firebase Hosting emulator (the
same rewrites as production, from `firebase.json`; it does not apply custom headers, which the
post-deploy smoke test checks), talking to a local Supabase stack
with the seed users from `supabase/seed.sql`. CI runs them in the _Database and integration_ job.

```sh
npx supabase start                      # local stack: migrations + seed users
npx supabase status -o env              # note API_URL and PUBLISHABLE_KEY

# Build against the local stack (these variables override the committed .env)
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY> bun run build

npx firebase-tools emulators:start --only hosting --project demo-e2e   # serves on :5000
bunx playwright install chromium                                       # first time only
bun run test:e2e
```
