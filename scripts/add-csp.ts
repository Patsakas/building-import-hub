// Adds the Content Security Policy to the built SPA shell (see scripts/csp.ts). Runs after every
// build that is deployed or tested end to end, with the Supabase URL that build talks to.
//
//   deno run --allow-read=.output --allow-write=.output scripts/add-csp.ts <supabase-url>
import { addContentSecurityPolicy } from "./csp.ts";

const SHELL = ".output/public/_shell.html";
const supabaseUrl = Deno.args[0];
if (!supabaseUrl || Deno.args.length > 1) {
  console.error("Usage: add-csp.ts <supabase-url>");
  Deno.exit(2);
}

const html = await addContentSecurityPolicy(await Deno.readTextFile(SHELL), supabaseUrl);
await Deno.writeTextFile(SHELL, html);
console.log(
  `Content Security Policy added to ${SHELL} (Supabase: ${new URL(supabaseUrl).origin}).`,
);
