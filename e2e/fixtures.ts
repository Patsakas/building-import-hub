import { expect, test as base } from "@playwright/test";

// Every test fails if the browser blocked anything under the page's Content Security Policy (the
// build adds it to the page; see scripts/csp.ts). A new inline script, external font or API host
// shows up here instead of as a broken page in production.
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await use(violations);
      expect(violations, "Content Security Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
