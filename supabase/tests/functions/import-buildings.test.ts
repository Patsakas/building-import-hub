// Integration tests for the import-buildings Edge Function against a running local stack
// (`supabase start` + `supabase db reset`, which loads the seed users). Run with:
//
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... deno test --config supabase/tests/functions/deno.json \
//     --allow-net --allow-env --allow-import=cdn.sheetjs.com,jsr.io supabase/tests/functions
//
// The seed users alice@test.local and bob@test.local share the password "password123".
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "xlsx";
import { assertEquals, assertExists } from "@std/assert";
import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (local stack).");

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, key!, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw error;
  return client;
}

function xlsxFile(rows: unknown[][], name = "buildings.xlsx"): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Buildings");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([bytes], name);
}

async function upload(client: SupabaseClient, file: File) {
  const body = new FormData();
  body.append("file", file);
  const { data, error } = await client.functions.invoke("import-buildings", { body });
  if (error instanceof FunctionsHttpError) {
    return { status: error.context.status as number, body: await error.context.json() };
  }
  if (error) throw error;
  return { status: 200, body: data };
}

async function buildingNames(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from("buildings").select("name").order("name");
  if (error) throw error;
  return data.map((row) => row.name as string);
}

Deno.test("imports a valid file for the signed-in user only", async () => {
  const alice = await signIn("alice@test.local");
  const bob = await signIn("bob@test.local");
  const before = await buildingNames(alice);
  const bobBefore = await buildingNames(bob);

  const result = await upload(
    alice,
    xlsxFile([
      ["name", "city", "floors"],
      ["Integration A", "Athens", 3],
      ["Integration B", "Patras", 5],
    ]),
  );

  assertEquals(result, { status: 200, body: { inserted: 2 } });
  assertEquals((await buildingNames(alice)).length, before.length + 2);
  assertEquals(await buildingNames(bob), bobBefore, "bob must not see alice's import");
});

Deno.test("rejects an invalid file without inserting anything", async () => {
  const alice = await signIn("alice@test.local");
  const before = await buildingNames(alice);

  const result = await upload(
    alice,
    xlsxFile([
      ["name", "floors"],
      ["Valid row", 2],
      ["Broken row", "two"],
    ]),
  );

  assertEquals(result.status, 422);
  assertEquals(result.body.errors, [
    { row: 3, column: "floors", message: "floors must be a number" },
  ]);
  assertEquals(await buildingNames(alice), before, "the valid row must not be inserted either");
});

Deno.test("rejects unsupported file types", async () => {
  const alice = await signIn("alice@test.local");
  const result = await upload(alice, new File(["name\nX\n"], "buildings.txt"));
  assertEquals(result.status, 415);
});

Deno.test("rejects requests without a signed-in user", async () => {
  const body = new FormData();
  body.append("file", xlsxFile([["name"], ["Anonymous"]]));
  const response = await fetch(`${url}/functions/v1/import-buildings`, {
    method: "POST",
    headers: { apikey: key! },
    body,
  });
  await response.body?.cancel();
  assertEquals(response.status, 401);
});

Deno.test("answers CORS preflight requests", async () => {
  const response = await fetch(`${url}/functions/v1/import-buildings`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.web.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info",
    },
  });
  await response.body?.cancel();
  assertEquals(response.ok, true);
  assertExists(response.headers.get("access-control-allow-origin"));
});
