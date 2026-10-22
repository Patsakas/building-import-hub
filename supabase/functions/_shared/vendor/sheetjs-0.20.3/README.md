# SheetJS Community Edition 0.20.3 (vendored)

Reads and writes the Excel files of the buildings import. Unmodified copies of:

- `xlsx.mjs` from https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs
- `types/index.d.ts` from https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts
- `LICENSE` (Apache 2.0) from https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE

Why vendored: SheetJS publishes current versions only on its own CDN (the `xlsx` package on npm
stopped at 0.18.5, which has known vulnerabilities), and Supabase's Edge Function bundler refuses
imports from that host.

CI checks the files against `SHA256SUMS`, and CodeQL does not scan them
(`.github/codeql/codeql-config.yml`): its findings here are in SheetJS's own XML text extraction,
whose output the importer validates and stores as plain data. To upgrade, download the new version's files into a new
`sheetjs-<version>` directory, regenerate the sums (`sha256sum xlsx.mjs types/index.d.ts LICENSE >
SHA256SUMS`), and point the `xlsx` and `xlsx/types` entries of each `deno.json` at it.
