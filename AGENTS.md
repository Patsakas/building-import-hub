<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

Read these before changing code. CI (`.github/workflows/ci.yml`) checks them wherever it can, so a
change that breaks them fails the build.

- **No SSR and no server code in the app.** The frontend is a static SPA (`spa.enabled` in
  `vite.config.ts`, `defaultSsr: false` in `src/start.ts`) served by Firebase Hosting. Do not add
  `createServerFn`, server routes or other TanStack Start server APIs: there is no server to run
  them.
- **Server-side logic goes in Supabase Edge Functions** under `supabase/functions/<name>/` (Deno),
  each with its own `deno.json`. Call them from the app with `supabase.functions.invoke`. Example:
  `supabase/functions/import-buildings` handles the Excel import.
- **Every table has Row Level Security** with policies scoped to the signed-in user
  (`auth.uid()`). Never `USING (true)` for the `authenticated` or `anon` roles.
- **Migrations are plain SQL, written twice.** Put each migration in `drizzle/migrations` (applied
  by Lovable's backend) and the identical SQL in `supabase/migrations` (applied to the deployed
  environments). Never run `drizzle-kit push` or `drizzle-kit generate`: `drizzle/schema.ts` is
  intentionally empty, so drizzle-kit would treat every table as unwanted.
- **No secrets in the repo or the browser.** Only publishable keys (`VITE_SUPABASE_*`) may reach the
  frontend. Never import `src/integrations/supabase/client.server.ts` (service role) from app code.
- **The Excel template is generated.** `public/buildings-template.xlsx` comes from
  `scripts/generate-template.ts`, which uses the importer's column list. Regenerate it instead of
  editing it by hand.
