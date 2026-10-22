// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "xlsx";
import { assertEquals, assertObjectMatch } from "@std/assert";
import {
  MAX_ROWS,
  parseBuildingsWorkbook,
  type ParseResult,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLE_ROW,
} from "./buildings.ts";

function xlsx(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Buildings");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

function errorsOf(result: ParseResult) {
  if (result.ok) throw new Error("expected the import to fail");
  return result.errors;
}

Deno.test("parses valid rows and normalizes headers", () => {
  const result = parseBuildingsWorkbook(
    xlsx([
      ["Name", "Address", "City", "Country", "Floors", "Year Built"],
      ["Tower A", "1 Main St", "Athens", "Greece", 12, 1998],
      ["Tower B", null, null, null, "7", null],
    ]),
  );
  assertEquals(result, {
    ok: true,
    rows: [
      {
        name: "Tower A",
        address: "1 Main St",
        city: "Athens",
        country: "Greece",
        floors: 12,
        year_built: 1998,
      },
      { name: "Tower B", address: null, city: null, country: null, floors: 7, year_built: null },
    ],
  });
});

Deno.test("only the name column is required", () => {
  const result = parseBuildingsWorkbook(xlsx([["name"], ["Solo"]]));
  assertEquals(result.ok, true);
});

Deno.test("skips blank rows but keeps the spreadsheet row numbers in errors", () => {
  const errors = errorsOf(
    parseBuildingsWorkbook(
      xlsx([
        ["name", "floors"],
        ["Tower A", 3],
        [null, null],
        ["Tower C", "three"],
      ]),
    ),
  );
  assertEquals(errors, [{ row: 4, column: "floors", message: "floors must be a number" }]);
});

Deno.test("rejects the whole file and reports every invalid row", () => {
  const result = parseBuildingsWorkbook(
    xlsx([
      ["name", "floors", "year_built"],
      ["Valid", 2, 2001],
      [null, 2, 2001],
      ["Half floor", 2.5, 2001],
      ["Too old", 2, 900],
      ["Negative", -1, 2001],
    ]),
  );
  assertObjectMatch(result, {
    ok: false,
    errorCount: 4,
    errors: [
      { row: 3, column: "name", message: "name is required" },
      { row: 4, column: "floors", message: "floors must be a whole number" },
      { row: 5, column: "year_built", message: "year_built must be 1000 or more" },
      { row: 6, column: "floors", message: "floors must be 0 or more" },
    ],
  });
});

Deno.test("rejects unknown, duplicate and missing columns", () => {
  assertEquals(
    errorsOf(
      parseBuildingsWorkbook(
        xlsx([
          ["name", "flors"],
          ["A", 1],
        ]),
      ),
    ),
    [
      {
        row: 1,
        column: null,
        message: `Unknown column "flors". Expected: ${TEMPLATE_COLUMNS.join(", ")}.`,
      },
    ],
  );
  assertEquals(
    errorsOf(
      parseBuildingsWorkbook(
        xlsx([
          ["name", "Name"],
          ["A", "B"],
        ]),
      ),
    ),
    [{ row: 1, column: "name", message: 'Column "name" appears twice.' }],
  );
  assertEquals(errorsOf(parseBuildingsWorkbook(xlsx([["city"], ["Athens"]]))), [
    { row: 1, column: "name", message: 'Missing the required "name" column.' },
  ]);
});

Deno.test("rejects files without buildings", () => {
  assertEquals(
    errorsOf(parseBuildingsWorkbook(xlsx([["name"]])))[0]?.message,
    "The file has no buildings to import.",
  );
});

Deno.test("enforces the row limit", () => {
  const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`Building ${i}`]);
  const errors = errorsOf(parseBuildingsWorkbook(xlsx([["name"], ...rows])));
  assertEquals(errors.length, 1);
  assertEquals(errors[0]?.row, null);
});

Deno.test("caps the number of reported errors", () => {
  const rows = Array.from({ length: 80 }, () => [null, "x"]);
  const result = parseBuildingsWorkbook(xlsx([["name", "floors"], ...rows]));
  assertObjectMatch(result, { ok: false, errorCount: 160 });
  assertEquals(errorsOf(result).length, 50);
});

Deno.test("reads CSV files", () => {
  const csv = new TextEncoder().encode("name,city,floors\nTower A,Athens,4\n");
  assertEquals(parseBuildingsWorkbook(csv), {
    ok: true,
    rows: [
      {
        name: "Tower A",
        address: null,
        city: "Athens",
        country: null,
        floors: 4,
        year_built: null,
      },
    ],
  });
});

Deno.test("the committed template matches the importer", async () => {
  const template = await Deno.readFile(
    new URL("../../../public/buildings-template.xlsx", import.meta.url),
  );
  const workbook = XLSX.read(template, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  const [header] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  assertEquals(header, [...TEMPLATE_COLUMNS]);

  const result = parseBuildingsWorkbook(template);
  assertObjectMatch(result, { ok: true, rows: [{ name: TEMPLATE_EXAMPLE_ROW[0] }] });
});
