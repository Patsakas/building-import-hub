// Fails if the built frontend contains a server-side secret. Everything in .output/public is
// downloaded by every visitor, so only publishable keys may appear there.
//
//   deno run --allow-read scripts/check-bundle-secrets.ts [directory=.output/public]
//
// Matching is on real key shapes, not prefixes: supabase-js itself contains the literal
// "sb_secret_" (it checks key prefixes), so a plain string search would always fail.

const directory = Deno.args[0] ?? ".output/public";

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g;
const PRIVILEGED_ROLES = new Set(["service_role", "supabase_admin"]);

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role ?? null;
  } catch {
    return null;
  }
}

function* files(dir: string): Generator<string> {
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* files(path);
    else if (/\.(html|js|mjs|css|json|txt|map)$/.test(entry.name)) yield path;
  }
}

const findings: string[] = [];
for (const path of files(directory)) {
  const text = Deno.readTextFileSync(path);
  for (const match of text.matchAll(SECRET_KEY)) {
    findings.push(`${path}: Supabase secret key ${match[0].slice(0, 14)}…`);
  }
  for (const match of text.matchAll(PRIVATE_KEY)) {
    findings.push(`${path}: ${match[0]}`);
  }
  for (const match of text.matchAll(JWT)) {
    const role = jwtRole(match[0]);
    if (role && PRIVILEGED_ROLES.has(role)) findings.push(`${path}: JWT with role "${role}"`);
  }
}

if (findings.length > 0) {
  console.error("Server-side secrets found in the frontend build:");
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error("Only publishable keys may reach the browser. Rotate any key listed above.");
  Deno.exit(1);
}
console.log(`No server-side secrets in ${directory}.`);
