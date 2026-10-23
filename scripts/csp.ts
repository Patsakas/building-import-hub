// Content Security Policy for the static SPA shell, added to the page as a <meta> tag.
//
// The shell's inline scripts (TanStack Start's hydration and scroll-restoration snippets) are
// allowed by their sha256 hash, computed from the built file itself: the hydration script embeds a
// build timestamp, so a policy written once by hand would block it after the next build. As a
// <meta> tag the policy also applies in the Firebase Hosting emulator, which ignores custom
// headers, so the end-to-end tests run under it. (frame-ancestors cannot be set from a <meta> tag;
// firebase.json sends it as a header.)
//
// The page is read with a spec-compliant HTML parser (html5ever), not regular expressions, so each
// script's text is exactly what a browser hashes: the parser decides where a script ends,
// normalizes line endings and turns NUL characters (TanStack's hydration data contains one) into
// U+FFFD, as browsers do.
import { DOMParser, type HTMLDocument } from "@b-fuze/deno-dom";

const META_SELECTOR = 'meta[http-equiv="Content-Security-Policy" i]';

function parse(html: string): HTMLDocument {
  return new DOMParser().parseFromString(html, "text/html");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** The policy for this page, allowing its inline scripts and the Supabase project it talks to. */
export async function contentSecurityPolicy(html: string, supabaseUrl: string): Promise<string> {
  const document = parse(html);
  // Inline event handlers and script URLs cannot be allowed by hash; keep them out of the shell.
  for (const element of document.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      // Browsers ignore spaces and control characters in a URL's scheme ("java\tscript:").
      const value = [...(element.getAttribute(name) ?? "")]
        .filter((character) => character > " ")
        .join("")
        .toLowerCase();
      if (name.toLowerCase().startsWith("on") || /^(javascript|vbscript|data):/.test(value)) {
        throw new Error(
          `<${element.localName} ${name}> is an inline event handler or script URL, which the CSP blocks.`,
        );
      }
    }
  }
  const hashes: string[] = [];
  for (const script of document.querySelectorAll("script:not([src])")) {
    if (script.textContent) hashes.push(`'sha256-${await sha256(script.textContent)}'`);
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
  if (parse(html).querySelector(META_SELECTOR)) {
    throw new Error("The page already has a Content Security Policy.");
  }
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (!head) throw new Error("The page has no <head>.");
  const at = head.index! + head[0].length;
  const policy = await contentSecurityPolicy(html, supabaseUrl);
  const page = `${html.slice(0, at)}<meta http-equiv="Content-Security-Policy" content="${policy}"/>${html.slice(at)}`;

  // Read the result back the way a browser will, to be sure the policy landed where it applies.
  const meta = parse(page).head?.firstElementChild;
  if (!meta?.matches(META_SELECTOR) || meta.getAttribute("content") !== policy) {
    throw new Error("The policy did not end up as the first element of <head>.");
  }
  return page;
}
