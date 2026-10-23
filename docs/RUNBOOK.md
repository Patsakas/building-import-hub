# Runbook

Operational procedures for Building Import Hub. Commands assume the repository root.

## Deploy

1. Merge the changes to `main` (pull request, all checks green). The **Deploy** workflow deploys
   that commit to **staging** on its own: https://building-import-hub-staging.web.app.
2. Try the change on staging. If its deploy failed, fix it on `main` first: production would fail
   the same way.
3. Create a GitHub release on that `main` commit with a new tag (`v1.2.0`). Its notes say what
   changed.
4. The **Deploy** workflow starts again, re-runs CI on that commit, then waits for approval: open
   the run, _Review deployments_ → `production` → _Approve and deploy_.
5. The run ends with a smoke test of the live site. A red smoke test means the new version is live
   but broken: roll back (below).

A manual run (_Actions → Deploy → Run workflow_) deploys `main` (staging, production) or a `v*` tag
(production) to the chosen environment, with the same checks and, for production, the approval.

## Roll back

- **Frontend:** in the Firebase console, _Hosting → Release history_, choose the previous release →
  _Rollback_. Takes effect immediately. Or run the Deploy workflow on the previous tag.
- **Edge Functions:** run the Deploy workflow on the previous tag.
- **Database:** migrations are forward-only. Fix a bad migration with a new migration (written to
  both `supabase/migrations` and `drizzle/migrations`); never edit one that has been applied.
  The free plan has no automatic backups, so take one before a risky migration:
  `npx supabase db dump --db-url <pooler URL> --data-only -f backup.sql` (keep it out of the repo).

## Give someone access

Public sign-up is disabled, so accounts are created by an administrator:

```sh
# Secret key: Supabase dashboard → Project Settings → API Keys → Secret keys
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SECRET_KEY=<secret key> \
  deno run --allow-net --allow-env --allow-write scripts/provision-user.ts person@example.com credentials.txt
```

The script creates a confirmed account with a generated 24-character password and writes it only to
`credentials.txt`. Send the email address and the password through different channels (for
example email and a one-time secret link), then delete the file. Never commit it.

To remove access, delete the user in _Authentication → Users_; their buildings are deleted with
them (foreign key `on delete cascade`).

## Credentials

Each environment (staging, production) has its own set; none is shared between them.

| Credential              | Where                                     | Scope                                                                                                                                          | Rotation                                                                                                       |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | GitHub environment secret                 | One project. Project Settings and Auth Config read, Edge Functions read-write; nothing else (no database, API key or signing key access).      | Expires after 90 days: generate a new one with the same permissions, replace the secret, delete the old token. |
| Admin access token      | nowhere: created when needed              | One project. Project Settings and Auth Config read-write, only to change auth settings (below)                                                 | Shortest expiry; deleted right after use.                                                                      |
| `SUPABASE_DB_PASSWORD`  | GitHub environment secret                 | Postgres, used only to apply migrations                                                                                                        | Reset in _Project Settings → Database_, then update the secret.                                                |
| Google Cloud            | none stored                               | Workload Identity Federation: only this repository's matching environment can act as `github-deployer`, which can only deploy Firebase Hosting | Nothing to rotate.                                                                                             |
| Publishable key         | GitHub environment variable, in the build | Public by design; RLS protects the data                                                                                                        | Rotate in Supabase if needed, update the variable, redeploy.                                                   |

The deploy job's first step checks the access token: it calls every Management API endpoint the
deploy uses, prints the status of each and stops before changing anything if one is missing.

### Change auth settings

Sign-up, password length and email confirmation are declared in `supabase/config.toml`, the site
URL in the environment's `SITE_URL`. Every deploy verifies them and stops, before changing
anything, if the environment differs, listing each difference. The deploy cannot change them
itself: Supabase requires _Project Settings: read-write_ for that, which also allows deleting the
project. An administrator applies them:

1. Supabase → _Account → Access Tokens_: generate a token for that one project with _Auth Config_
   and _Project Settings_ read-write, and the shortest expiry.
2. Apply the settings (the token is pasted at the prompt, so it is not echoed or kept in history):

   ```sh
   read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
   SUPABASE_PROJECT_REF=<project ref> SITE_URL=https://<site>.web.app \
     deno run --config scripts/deno.json --allow-read=supabase --allow-env \
     --allow-net=api.supabase.com scripts/apply-auth-config.ts
   unset SUPABASE_ACCESS_TOKEN
   ```

3. Delete the token, then run (or re-run) the deploy.

When a pull request changes these settings, apply them right after merging it.

### Workload Identity Federation (how each environment was set up)

Shown for production; staging is the same with `P=building-import-hub-staging` and
`assertion.environment == 'staging'`. Each Google project trusts only its own environment.

```sh
P=building-import-hub-prod
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com firebasehosting.googleapis.com --project $P
gcloud iam workload-identity-pools create github --project $P --location global \
  --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc building-import-hub --project $P \
  --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.repository_id == '<repo id>' && assertion.repository_owner_id == '<owner id>' && assertion.environment == 'production'"
gcloud iam service-accounts create github-deployer --project $P
for role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $P --role $role \
    --member serviceAccount:github-deployer@$P.iam.gserviceaccount.com
done
gcloud iam service-accounts add-iam-policy-binding github-deployer@$P.iam.gserviceaccount.com \
  --project $P --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/<project number>/locations/global/workloadIdentityPools/github/attribute.repository_id/<repo id>"
```

Repository and owner ids come from `gh api repos/<owner>/<repo> --jq '.id, .owner.id'`. Pinning
ids rather than names means a repository recreated under the same name cannot deploy.

## Add an environment

Staging was set up this way.

1. Create a Supabase project and a Firebase project (Spark plan; open _Hosting → Get started_ once
   so the default site exists).
2. Repeat the Workload Identity Federation setup for the new Google project, with
   `assertion.environment == '<name>'`.
3. Create a GitHub environment with the variables and secrets listed at the top of
   `.github/workflows/deploy.yml`, restricted to deploy from `main` (and `v*` tags if releases go
   there). Generate a separate access token scoped to the new project.
4. Apply the auth settings to the new project (see _Change auth settings_).
5. Run the Deploy workflow for it, and add a trigger in `.github/workflows/deploy.yml` if it should
   deploy on its own.

## Troubleshooting

- **The project is paused.** Free Supabase projects pause after 7 days without activity. Restore
  it from the dashboard; nothing is lost.
- **Deploy preflight fails.** The table in the log shows which endpoint returned 401/403. Add only
  that permission to the access token.
- **"Sync main into lovable" failed.** `main` and `lovable` changed the same lines. Resolve by hand:
  `git checkout lovable && git merge origin/main`, fix, push (no rebase, no force push).
- **Lovable pushed to `lovable-sync`.** Lovable was still syncing `main`, which rejects direct
  pushes. Open a pull request from `lovable-sync` to `main`, and point Lovable at `lovable`.
- **CI fails on "no server functions".** Code added a `createServerFn`. Move that logic to a
  Supabase Edge Function (see `AGENTS.md`).
- **Auth emails.** The project uses Supabase's built-in email service, which only delivers to the
  organization's team members, so password-reset emails do not reach other users. Configure
  custom SMTP before relying on them.
