import { assertEquals, assertThrows } from "@std/assert";
import { authConfigPayload, mismatches } from "./auth-config.ts";

const SITE = "https://example.web.app";

Deno.test("maps the committed config.toml to the Management API fields", async () => {
  const toml = await Deno.readTextFile(new URL("../supabase/config.toml", import.meta.url));
  assertEquals(authConfigPayload(toml, SITE), {
    site_url: SITE,
    uri_allow_list: `${SITE}/**`,
    disable_signup: true,
    password_min_length: 12,
    mailer_autoconfirm: false,
  });
});

Deno.test("only declared settings are applied", () => {
  assertEquals(authConfigPayload('project_id = "x"\n', SITE), {
    site_url: SITE,
    uri_allow_list: `${SITE}/**`,
  });
});

Deno.test("an auth setting the deploy cannot check fails loudly", () => {
  assertThrows(
    () => authConfigPayload("[auth]\njwt_expiry = 3600\n", SITE),
    Error,
    "auth.jwt_expiry is set in supabase/config.toml",
  );
});

Deno.test("reports fields whose applied value differs", () => {
  assertEquals(
    mismatches(
      { disable_signup: true, password_min_length: 12 },
      { disable_signup: false, password_min_length: 12, other: 1 },
    ),
    ["disable_signup"],
  );
});
