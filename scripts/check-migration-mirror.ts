// Lovable applies drizzle/migrations to its own backend; the deployed environments apply
// supabase/migrations with the Supabase CLI. Both must hold the same SQL in the same order, or an
// environment silently misses a schema change. CI runs this on every change:
//
//   deno run --allow-read scripts/check-migration-mirror.ts

type JournalEntry = { idx: number; tag: string };

const journal: { entries: JournalEntry[] } = JSON.parse(
  await Deno.readTextFile("drizzle/migrations/meta/_journal.json"),
);
const drizzleFiles = journal.entries
  .toSorted((a, b) => a.idx - b.idx)
  .map((entry) => `drizzle/migrations/${entry.tag}.sql`);

const supabaseFiles = [...Deno.readDirSync("supabase/migrations")]
  .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
  .map((entry) => `supabase/migrations/${entry.name}`)
  .toSorted();

const unlisted = [...Deno.readDirSync("drizzle/migrations")]
  .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
  .map((entry) => `drizzle/migrations/${entry.name}`)
  .filter((file) => !drizzleFiles.includes(file));

const normalize = (sql: string) => sql.replace(/\r\n/g, "\n").trim();
const problems: string[] = unlisted.map((file) => `${file} is not listed in the drizzle journal`);

for (let i = 0; i < Math.max(drizzleFiles.length, supabaseFiles.length); i++) {
  const drizzle = drizzleFiles[i];
  const supabase = supabaseFiles[i];
  if (!drizzle || !supabase) {
    problems.push(`${drizzle ?? supabase} has no counterpart in the other migrations folder`);
  } else if (
    normalize(await Deno.readTextFile(drizzle)) !== normalize(await Deno.readTextFile(supabase))
  ) {
    problems.push(`${drizzle} and ${supabase} contain different SQL`);
  }
}

if (problems.length > 0) {
  console.error("Migrations in drizzle/ and supabase/ are out of sync:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Write every migration to both folders with identical SQL (see AGENTS.md).");
  Deno.exit(1);
}
console.log(`${drizzleFiles.length} migrations, identical in drizzle/ and supabase/.`);
