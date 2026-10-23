// Content Security Policy for the static SPA shell, added to the page as a <meta> tag.
//
// The shell's inline scripts (TanStack Start's hydration and scroll-restoration snippets) are
// allowed by their sha256 hash, computed from the built file itself: the hydration script embeds a
// build timestamp, so a policy written once by hand would block it after the next build. As a
// <meta> tag the policy also applies in the Firebase Hosting emulator, which ignores custom
// headers, so the end-to-end tests run under it. (frame-ancestors cannot be set from a <meta> tag;
// firebase.json sends it as a header.)

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const META = '<meta http-equiv="Content-Security-Policy"';
export const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/** The text a browser hashes for an inline script: the HTML parser normalizes line endings and
 * replaces NUL characters (TanStack's hydration data contains one) with U+FFFD. */
function parsedText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replaceAll("\0", REPLACEMENT_CHARACTER);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** The policy for this page, allowing its inline scripts and the Supabase project it talks to. */
export async function contentSecurityPolicy(html: string, supabaseUrl: string): Promise<string> {
  // Inline event handlers and javascript: URLs cannot be allowed by hash; keep them out of the shell.
  if (/<[^>]+\son[a-z]+\s*=|javascript:/i.test(html.replace(INLINE_SCRIPT, ""))) {
    throw new Error(
      "The page has an inline event handler or javascript: URL, which the CSP blocks.",
    );
  }
  const hashes: string[] = [];
  for (const [, attributes, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/i.test(attributes!) || !body) continue;
    hashes.push(`'sha256-${await sha256(parsedText(body))}'`);
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    // sonner (the toasts) adds its stylesheet in a <style> element at runtime. Styles cannot run
    // code, so this is the one inline allowance.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${new URL(supabaseUrl).origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** The page with its policy as the first element of <head>, so it covers everything after it. */
export async function addContentSecurityPolicy(html: string, supabaseUrl: string): Promise<string> {
  if (html.includes(META)) throw new Error("The page already has a Content Security Policy.");
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (!head) throw new Error("The page has no <head>.");
  const at = head.index! + head[0].length;
  const policy = await contentSecurityPolicy(html, supabaseUrl);
  return `${html.slice(0, at)}${META} content="${policy}"/>${html.slice(at)}`;
}
