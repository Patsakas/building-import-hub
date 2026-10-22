// Keeps a deployed Supabase project's auth settings in line with supabase/config.toml, plus the
// environment's site URL.
//
//   --check   Read-only: fails, listing the differences, if the project does not match. Every
//             deploy runs this, so the deploy token needs only "Auth Config: read".
//   (default) Applies the settings, then reads them back and fails if any did not take effect.
//             Supabase requires "Auth Config" and "Project Settings" read-write for this, and the
//             latter also allows deleting the project, so the deploy token never has it: an
//             administrator runs this with a short-lived token (docs/RUNBOOK.md).
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... SITE_URL=... \
//     deno run --config scripts/deno.json --allow-read=supabase --allow-env --allow-net=api.supabase.com \
//     scripts/apply-auth-config.ts [--check]
import { authConfigPayload, mismatches } from "./auth-config.ts";

const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
const ref = Deno.env.get("SUPABASE_PROJECT_REF");
const siteUrl = Deno.env.get("SITE_URL");
const check = Deno.args[0] === "--check";
if (!token || !ref || !siteUrl || Deno.args.length > (check ? 1 : 0)) {
  console.error(
    "Set SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF and SITE_URL; the only option is --check.",
  );
  Deno.exit(2);
}

const desired = authConfigPayload(await Deno.readTextFile("supabase/config.toml"), siteUrl);
const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}` };

async function current(): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    console.error(`Reading auth settings failed: ${response.status} ${await response.text()}`);
    Deno.exit(1);
  }
  return await response.json();
}

const before = await current();
const drift = mismatches(desired, before);
if (drift.length === 0) {
  console.log(`The auth settings of ${ref} match supabase/config.toml.`);
  Deno.exit(0);
}
for (const key of drift) {
  console.log(`${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(desired[key])}`);
}
if (check) {
  console.error(
    `The auth settings of ${ref} differ from supabase/config.toml (above). An administrator ` +
      'applies them: see "Change auth settings" in docs/RUNBOOK.md.',
  );
  Deno.exit(1);
}

const update = await fetch(endpoint, {
  method: "PATCH",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(desired),
});
if (!update.ok) {
  console.error(`Updating auth settings failed: ${update.status} ${await update.text()}`);
  Deno.exit(1);
}
await update.body?.cancel();

const wrong = mismatches(desired, await current());
if (wrong.length > 0) {
  console.error(`Auth settings did not take effect: ${wrong.join(", ")}`);
  Deno.exit(1);
}
console.log(`Auth settings applied to ${ref}.`);
