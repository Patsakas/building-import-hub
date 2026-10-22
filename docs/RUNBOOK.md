# Runbook

Operational procedures for Building Import Hub. Commands assume the repository root.

## Deploy to production

1. Merge the changes to `main` (pull request, all checks green).
2. Create a GitHub release on `main` with a new tag (`v1.2.0`). Its notes say what changed.
3. The **Deploy** workflow starts, re-runs CI on that commit, then waits for approval: open the run,
   _Review deployments_ → `production` → _Approve and deploy_.
4. The run ends with a smoke test of the live site. A red smoke test means the new version is live
   but broken: roll back (below).

A manual run (_Actions → Deploy → Run workflow_) deploys the selected branch or tag to the chosen
environment, with the same checks and approval.

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

| Credential              | Where                                     | Scope                                                                                                                                              | Rotation                                                                                                       |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | GitHub environment secret                 | One project. Project Settings read, Auth Config and Edge Functions read-write; nothing else (no database, API key or signing key access).          | Expires after 90 days: generate a new one with the same permissions, replace the secret, delete the old token. |
| `SUPABASE_DB_PASSWORD`  | GitHub environment secret                 | Postgres, used only to apply migrations                                                                                                            | Reset in _Project Settings → Database_, then update the secret.                                                |
| Google Cloud            | none stored                               | Workload Identity Federation: only this repository's `production` environment can act as `github-deployer`, which can only deploy Firebase Hosting | Nothing to rotate.                                                                                             |
| Publishable key         | GitHub environment variable, in the build | Public by design; RLS protects the data                                                                                                            | Rotate in Supabase if needed, update the variable, redeploy.                                                   |

The deploy job's first step checks the access token: it calls every Management API endpoint the
deploy uses, prints the status of each and stops before changing anything if one is missing.

### Workload Identity Federation (how production was set up)

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

## Add an environment (for example staging)

1. Create a Supabase project and a Firebase project (Spark plan; open _Hosting → Get started_ once
   so the default site exists).
2. Repeat the Workload Identity Federation setup for the new Google project, with
   `assertion.environment == 'staging'`.
3. Create a GitHub environment with the variables and secrets listed at the top of
   `.github/workflows/deploy.yml`. Generate a separate access token scoped to the new project.
4. Run the Deploy workflow for it.

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
