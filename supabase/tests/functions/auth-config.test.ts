// Auth settings from supabase/config.toml, checked against the running local stack. Accounts are
// provisioned by an admin, so public sign-up must be off, while email + password login must
// still work (setting [auth.email] enable_signup = false once disabled login as well).
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (local stack).");

const client = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.test("public sign-up is disabled", async () => {
  const { error } = await client().auth.signUp({
    email: `intruder-${crypto.randomUUID()}@test.local`,
    password: "a-long-enough-password-1",
  });
  assertEquals(error?.code, "signup_disabled");
});

Deno.test("existing users can sign in with email and password", async () => {
  const { data, error } = await client().auth.signInWithPassword({
    email: "alice@test.local",
    password: "password123",
  });
  assertEquals(error, null);
  assertEquals(data.user?.email, "alice@test.local");
});
