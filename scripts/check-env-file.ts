// The committed .env belongs to Lovable and holds its backend's public settings. Everything in it
// ends up in the browser bundle, so it may only contain those public values. This fails if a
// secret (or anything unexpected) is added to it, or if another .env file is committed.
//
//   deno run --allow-read --allow-run=git scripts/check-env-file.ts

const ALLOWED = new Map<string, RegExp>([
  ["SUPABASE_URL", /^https:\/\/[a-z0-9]{20}\.supabase\.co$/],
  ["VITE_SUPABASE_URL", /^https:\/\/[a-z0-9]{20}\.supabase\.co$/],
  ["SUPABASE_PROJECT_ID", /^[a-z0-9]{20}$/],
  ["VITE_SUPABASE_PROJECT_ID", /^[a-z0-9]{20}$/],
  ["SUPABASE_PUBLISHABLE_KEY", /^sb_publishable_[A-Za-z0-9_-]+$/],
  ["VITE_SUPABASE_PUBLISHABLE_KEY", /^sb_publishable_[A-Za-z0-9_-]+$/],
]);

/** Older Supabase projects use a legacy anon JWT as the publishable key; that is public too. */
function isAnonJwt(value: string): boolean {
  const payload = value.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role === "anon";
  } catch {
    return false;
  }
}

const problems: string[] = [];

const lines = (await Deno.readTextFile(".env")).split(/\r?\n/);
lines.forEach((line, index) => {
  const text = line.trim();
  if (text === "" || text.startsWith("#")) return;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(text);
  if (!match) {
    problems.push(`.env line ${index + 1}: not a KEY=value line`);
    return;
  }
  const [, name, rawValue] = match as unknown as [string, string, string];
  const value = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  const pattern = ALLOWED.get(name);
  if (!pattern) {
    problems.push(`.env line ${index + 1}: ${name} is not allowed (only public Supabase settings)`);
  } else if (!pattern.test(value) && !(name.endsWith("_PUBLISHABLE_KEY") && isAnonJwt(value))) {
    problems.push(`.env line ${index + 1}: ${name} does not look like a public value`);
  }
});

const tracked = new TextDecoder()
  .decode((await new Deno.Command("git", { args: ["ls-files", "-z"] }).output()).stdout)
  .split("\0")
  .filter(
    (path) => /(^|\/)\.env(\..+)?$/.test(path) && path !== ".env" && !path.endsWith(".example"),
  );
for (const path of tracked) problems.push(`${path} is committed; keep local env files out of git`);

if (problems.length > 0) {
  console.error("Environment files contain more than public settings:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "Secrets belong in Supabase (Edge Function secrets) or GitHub environment secrets.",
  );
  Deno.exit(1);
}
console.log(".env holds only public Supabase settings, and no other env file is committed.");
