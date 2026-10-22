// Applies the auth settings from supabase/config.toml, plus the environment's site URL, to a
// deployed Supabase project, then reads them back and fails if any did not take effect.
// Needs only the "Auth Config: read-write" permission on the access token.
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... SITE_URL=... \
//     deno run --config scripts/deno.json --allow-read=supabase --allow-env --allow-net=api.supabase.com \
//     scripts/apply-auth-config.ts
import { authConfigPayload, mismatches } from "./auth-config.ts";

const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
const ref = Deno.env.get("SUPABASE_PROJECT_REF");
const siteUrl = Deno.env.get("SITE_URL");
if (!token || !ref || !siteUrl) {
  console.error("Set SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF and SITE_URL.");
  Deno.exit(2);
}

const desired = authConfigPayload(await Deno.readTextFile("supabase/config.toml"), siteUrl);
const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const update = await fetch(endpoint, {
  method: "PATCH",
  headers,
  body: JSON.stringify(desired),
});
if (!update.ok) {
  console.error(`Updating auth settings failed: ${update.status} ${await update.text()}`);
  Deno.exit(1);
}
await update.body?.cancel();

const applied = await (await fetch(endpoint, { headers })).json();
const wrong = mismatches(desired, applied);
if (wrong.length > 0) {
  console.error(`Auth settings did not take effect: ${wrong.join(", ")}`);
  Deno.exit(1);
}
for (const [key, value] of Object.entries(desired)) console.log(`${key} = ${value}`);
console.log(`Auth settings applied to ${ref}.`);
