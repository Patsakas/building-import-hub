// Writes public/buildings-template.xlsx from the importer's column list, so the template users
// download always matches what the import-buildings Edge Function accepts.
//
//   deno run --config scripts/deno.json --allow-write=public scripts/generate-template.ts
//
// A Deno test (supabase/functions/import-buildings/buildings.test.ts) fails if the file drifts.

// @deno-types="xlsx/types"
import * as XLSX from "xlsx";
import {
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLE_ROW,
} from "../supabase/functions/import-buildings/buildings.ts";

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([[...TEMPLATE_COLUMNS], TEMPLATE_EXAMPLE_ROW]),
  "Buildings",
);
const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
await Deno.writeFile("public/buildings-template.xlsx", new Uint8Array(bytes));
console.log("Wrote public/buildings-template.xlsx");
