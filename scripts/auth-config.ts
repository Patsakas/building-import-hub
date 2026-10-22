// Turns the [auth] settings declared in supabase/config.toml into a Supabase Management API
// payload for /v1/projects/{ref}/config/auth, used both to verify a deployed project and to apply
// the settings to it. Not `supabase config push`, which reads the project's whole configuration
// (storage, realtime, pooler, ...) and so needs a much broader access token.
import { parse } from "@std/toml";

type Payload = Record<string, string | number | boolean>;

// config.toml key -> Management API field. Every [auth] setting declared in config.toml must be
// listed here, so a new setting can never be silently skipped in deployed environments.
const MAPPINGS: Record<string, (value: unknown) => Payload> = {
  "auth.enable_signup": (value) => ({ disable_signup: !value }),
  "auth.minimum_password_length": (value) => ({ password_min_length: Number(value) }),
  "auth.email.enable_confirmations": (value) => ({ mailer_autoconfirm: !value }),
};

function leaves(table: Record<string, unknown>, prefix: string): [string, unknown][] {
  return Object.entries(table).flatMap(([key, value]) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? leaves(value as Record<string, unknown>, `${prefix}.${key}`)
      : [[`${prefix}.${key}`, value] as [string, unknown]],
  );
}

/** The auth settings to apply to a deployed project, plus its site URL. */
export function authConfigPayload(configToml: string, siteUrl: string): Payload {
  const auth = (parse(configToml)["auth"] ?? {}) as Record<string, unknown>;
  const payload: Payload = { site_url: siteUrl, uri_allow_list: `${siteUrl}/**` };
  for (const [key, value] of leaves(auth, "auth")) {
    const map = MAPPINGS[key];
    if (!map) {
      throw new Error(
        `${key} is set in supabase/config.toml but deployed projects cannot be checked for it; ` +
          "add it to MAPPINGS in scripts/auth-config.ts.",
      );
    }
    Object.assign(payload, map(value));
  }
  return payload;
}

/** Fields whose applied value differs from the desired one. */
export function mismatches(desired: Payload, applied: Record<string, unknown>): string[] {
  return Object.keys(desired).filter((key) => applied[key] !== desired[key]);
}
