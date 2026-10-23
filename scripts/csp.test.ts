import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { addContentSecurityPolicy, contentSecurityPolicy } from "./csp.ts";

const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

async function hash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function directive(policy: string, name: string) {
  return policy.split("; ").find((d) => d.startsWith(`${name} `));
}

Deno.test("allows each inline script by hash, and no other inline script", async () => {
  const html = `<html><head><script>a()</script><script type="module" src="/assets/x.js"></script>
    <script data-x="">b()</script></head></html>`;
  assertEquals(
    directive(await contentSecurityPolicy(html, SUPABASE), "script-src"),
    `script-src 'self' 'sha256-${await hash("a()")}' 'sha256-${await hash("b()")}'`,
  );
});

Deno.test("hashes scripts as the browser parses them", async () => {
  // NUL becomes U+FFFD and CRLF becomes LF; an end tag may carry whitespace and junk attributes.
  const html = `<head><script>x("\0");\r\ny()</script\t\n bar><script>z()</script></head>`;
  const policy = await contentSecurityPolicy(html, SUPABASE);
  assertStringIncludes(policy, `'sha256-${await hash(`x("${REPLACEMENT_CHARACTER}");\ny()`)}'`);
  assertStringIncludes(policy, `'sha256-${await hash("z()")}'`);
});

Deno.test("only lets the page connect to itself and its Supabase project", async () => {
  const policy = await contentSecurityPolicy("<head></head>", `${SUPABASE}/`);
  assertEquals(directive(policy, "connect-src"), `connect-src 'self' ${SUPABASE}`);
  assertEquals(directive(policy, "object-src"), "object-src 'none'");
  assertEquals(directive(policy, "script-src"), "script-src 'self'");
});

Deno.test("refuses inline event handlers and script URLs", async () => {
  for (const html of [
    '<head></head><button onclick="x()">',
    '<head></head><img src="/a.png" ONERROR="x()">',
    '<head></head><a href=" java\tscript:x()">',
    '<head></head><iframe src="data:text/html,x"></iframe>',
  ]) {
    await assertRejects(() => contentSecurityPolicy(html, SUPABASE), Error, "which the CSP blocks");
  }
});

Deno.test("adds the policy as the first element of <head>, once", async () => {
  const page = await addContentSecurityPolicy(
    '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><script>a()</script></head></html>',
    SUPABASE,
  );
  assertMatch(
    page,
    /^<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; [^"]+"\/><meta charSet/,
  );
  await assertRejects(() => addContentSecurityPolicy(page, SUPABASE), Error, "already has");
});
