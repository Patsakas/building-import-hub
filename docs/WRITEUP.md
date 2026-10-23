# Building Import Hub: deployment write-up

|                |                                                 |
| -------------- | ----------------------------------------------- |
| **Production** | https://building-import-hub-prod.web.app        |
| **Staging**    | https://building-import-hub-staging.web.app     |
| **Repository** | https://github.com/Patsakas/building-import-hub |
| **Login**      | sent separately                                 |

The Lovable app runs on Firebase Hosting (static) and a free Supabase project, end to end, on free
tiers only. The goal was the setup I would want in the job itself: the app stays editable in
Lovable, and the manual review of every Lovable change (do the migrations work, are keys exposed,
is RLS right) becomes automatic checks that run on every pull request.

## 1. SSR: not needed

Everything is behind a login and per user. There is nothing to index, and no page needs data
before JavaScript runs. The template already had `defaultSsr: false`, so I turned on TanStack
Start's SPA mode: the build prerenders one HTML shell, and Firebase rewrites every route to it.

The only real server code was the Excel import, written as a TanStack `createServerFn`. A static
host cannot run it, so it moved to a Supabase **Edge Function** (`import-buildings`). That is also
where the original brief put it. The function verifies the user's JWT, parses and validates the
file, and inserts all rows or none through a client scoped to that user, so RLS still applies. CI
keeps it this way: ESLint rejects `createServerFn`, and the build must have an empty server-function
manifest.

## 2. Deployment choices

- **Environments.**
  - **Lovable** (business users, with its own backend).
  - **Local** (Docker).
  - **CI** (a fresh Supabase stack for every PR).
  - **Staging** (deployed automatically on every merge to `main`).
  - **Production** (a GitHub release plus an approval).

  Each deployed environment has its own Supabase project, Firebase project and GitHub
  environment, and no credentials are shared between them.

- **Staying Lovable-compatible.**
  - Lovable syncs a `lovable` branch, which reaches `main` only through a PR, and a workflow merges
    `main` back into it.
  - Lovable applies `drizzle/migrations` and the deploy applies `supabase/migrations`, so CI checks
    that both hold the same SQL.
  - The committed `.env` stays Lovable's: it points at Lovable's backend and holds only public
    values. CI enforces that, and the deploy checks the bundle targets the right backend.
  - `AGENTS.md` gives Lovable's AI the repo's rules.
- **Credentials.**
  - **Google:** no stored key. GitHub OIDC with Workload Identity Federation; each Google project
    trusts only its own GitHub environment of this repository.
  - **Supabase token:** scoped to one project, with deploy permissions only.
  - **Database password:** used only for migrations, through the IPv4 pooler.
  - **Approval:** production needs a named reviewer, and deploys only from `main` or `v*` tags.
- **The deploy job**, in order:
  1. Runs the full CI suite again on the same commit.
  2. Checks the token's permissions, then the auth settings. Nothing changes if either fails.
  3. Applies the migrations, then deploys the Edge Functions.
  4. Builds the frontend for the environment and checks the bundle targets it.
  5. Deploys to Firebase.
  6. Smoke-tests the live site: pages, headers, CSP, a 401 from the function for anonymous
     requests, and sign-up disabled.
- **Security.** Highlights only; the PRs have the details.
  - **The original schema gave `anon` every privilege, including `TRUNCATE`.** RLS was the only
    barrier. A migration revokes those privileges and the database's default privileges, adds
    CHECK constraints and a foreign key to `auth.users`, and pgTAP tests pin it all.
  - **Accounts:** public sign-up is removed from the UI and disabled on the server, and accounts are
    created by an admin script.
  - **SheetJS:** `xlsx` 0.18.5 from npm has CVEs, so SheetJS 0.20.3 is vendored, byte for byte and
    checksum-verified.
  - **Content Security Policy:** a strict policy, computed from each build.
  - **Supply chain:** actions are pinned by SHA, Dependabot waits 7 days before proposing a new
    version, and bun refuses packages less than a day old.
  - **CodeQL** scans every change.

## 3. The manual review, automated

Each row was tested with a deliberately broken pull request, then closed without merging
(label [`guardrail-demo`](https://github.com/Patsakas/building-import-hub/pulls?q=label%3Aguardrail-demo)):

| What a reviewer checks by hand                 | Demo PR                                                        | Caught by                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| New table without RLS                          | [#19](https://github.com/Patsakas/building-import-hub/pull/19) | pgTAP guardrail: every table has RLS and a policy                         |
| Policy that lets everyone see everything       | [#20](https://github.com/Patsakas/building-import-hub/pull/20) | pgTAP: no `using (true)`, user isolation tests                            |
| Data readable without login                    | [#21](https://github.com/Patsakas/building-import-hub/pull/21) | pgTAP: `anon` has no privileges                                           |
| Migration that breaks the app or existing data | [#22](https://github.com/Patsakas/building-import-hub/pull/22) | All migrations + seed on a fresh database, then integration and E2E tests |
| Migration missing from Lovable's or our folder | [#23](https://github.com/Patsakas/building-import-hub/pull/23) | Mirror check of `drizzle/` vs `supabase/`                                 |
| Secret in the frontend                         | [#24](https://github.com/Patsakas/building-import-hub/pull/24) | `.env` allow-list (plus a scan of the built bundle for real key shapes)   |
| Server code a static host cannot run           | [#25](https://github.com/Patsakas/building-import-hub/pull/25) | ESLint rule (plus the server-function manifest check)                     |
| Edge Function import Supabase will not bundle  | [#26](https://github.com/Patsakas/building-import-hub/pull/26) | `deno check` with a strict import allow-list                              |
| Third-party script, font or API host           | [#27](https://github.com/Patsakas/building-import-hub/pull/27) | E2E tests run under the production CSP and fail on any violation          |

On top of that, every PR runs:

- Prettier, ESLint, TypeScript and the unit tests (Vitest and Deno),
- the RLS and privilege tests (pgTAP),
- Edge Function integration tests against a local Supabase,
- Playwright tests of the real UI, served by the Firebase emulator with the production rewrites.

The human review that remains is reading a diff that has already passed all of this.

## 4. Issues and fixes

| Issue                                                                                                                                                 | Fix                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The generated code failed its own lint and format checks, and Windows line endings broke them further                                                 | `.gitattributes` (LF), app code formatted, generated code excluded (#1)                                                                  |
| The pgTAP tests showed `anon` held every privilege on `buildings`, because of Supabase's default privileges                                           | Hardening migration, and default privileges revoked for future tables (#5)                                                               |
| `enable_signup = false` under `[auth.email]` turns off email login entirely, not just sign-up                                                         | Set under `[auth]` instead; an integration test pins both behaviours                                                                     |
| `supabase link` needs a broad token (API keys, storage, pooler)                                                                                       | Migrations via `db push --db-url` through the pooler, plus a preflight that checks the token's permissions before changing anything (#8) |
| Changing auth settings through the API needs _Project Settings: write_, which can also delete the project                                             | The deploy only **verifies** auth settings against `config.toml`; an admin applies changes with a short-lived token (#13, #14)           |
| First production deploy: _"Failed to bundle the function: Cannot import from cdn.sheetjs.com"_. CI had allowed that host, the hosted bundler does not | SheetJS vendored with checksums; CI allows only `jsr.io`, a subset of what the bundler accepts (#15, demo #26)                           |
| CodeQL reported 15 alerts inside the vendored library                                                                                                 | CodeQL moved to a workflow that ignores vendored code, as it ignores `node_modules` (#15)                                                |
| CodeQL flagged my first CSP script for parsing HTML with regular expressions                                                                          | Replaced with a spec-compliant HTML parser (#18)                                                                                         |
| TanStack's inline hydration script embeds a build timestamp (and a NUL character), so a hand-written CSP hash breaks on the next build                | Hashes computed from each build; the policy ships as a `<meta>` tag so the E2E tests (whose emulator ignores headers) run under it (#18) |
| Dependabot: Vite dev-server advisories (1 high)                                                                                                       | Vite 8.1.6, the patch release of the line Lovable pinned (#16). Dev server only; production is static files                              |
| Two failures only showed up on hosted Supabase, which CI's local stack cannot reproduce                                                               | A staging environment that every merge deploys to first (#17)                                                                            |

## 5. Next steps

- **Backups.** The free plan has no automatic backups (the runbook covers `supabase db dump`). For
  real data: the Pro plan with point-in-time recovery.
- **Email.** Custom SMTP, so password-reset emails reach users. Supabase's built-in sender only
  delivers to the project's team.
- **Monitoring.** Error tracking and alerts on the Edge Function and on failed deploys.
- **Per-PR previews.** If business users need to show unmerged work outside Lovable: Firebase
  preview channels against staging.

Operational details (deploy, rollback, access, credentials, adding an environment) are in
[`docs/RUNBOOK.md`](RUNBOOK.md).
