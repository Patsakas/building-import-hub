// Parsing and validation for the buildings Excel import. Used by the Edge Function, its tests and
// scripts/generate-template.ts, so the template and the importer cannot drift.

// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "xlsx";
import { z } from "zod";

export const TEMPLATE_COLUMNS = [
  "name",
  "address",
  "city",
  "country",
  "floors",
  "year_built",
] as const;
export const TEMPLATE_EXAMPLE_ROW = ["Example Tower", "1 Main St", "Athens", "Greece", 12, 1998];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5_000;
const MAX_REPORTED_ERRORS = 50;

type Column = (typeof TEMPLATE_COLUMNS)[number];

export type BuildingRow = {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  floors: number | null;
  year_built: number | null;
};

/** `row` is the spreadsheet row number the user sees (the header is row 1 for a sheet at A1). */
export type ImportError = { row: number | null; column: Column | null; message: string };

export type ParseResult =
  { ok: true; rows: BuildingRow[] } | { ok: false; errors: ImportError[]; errorCount: number };

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toNumber(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : Number(text);
  }
  return value ?? null;
}

const optionalText = (max: number) =>
  z.preprocess(toText, z.string().max(max, `must be at most ${max} characters`).nullable());

const optionalInteger = (min: number, max: number) =>
  z.preprocess(
    toNumber,
    z
      .number({ invalid_type_error: "must be a number" })
      .int("must be a whole number")
      .min(min, `must be ${min} or more`)
      .max(max, `must be ${max} or less`)
      .nullable(),
  );

function rowSchema() {
  return z.object({
    name: z.preprocess(
      toText,
      z.string({ invalid_type_error: "is required" }).max(200, "must be at most 200 characters"),
    ),
    address: optionalText(300),
    city: optionalText(100),
    country: optionalText(100),
    floors: optionalInteger(0, 200),
    year_built: optionalInteger(1000, new Date().getUTCFullYear() + 10),
  });
}

/** "Year Built " -> "year_built", matching how the original importer read headers. */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isColumn(header: string): header is Column {
  return (TEMPLATE_COLUMNS as readonly string[]).includes(header);
}

function failure(errors: ImportError[]): ParseResult {
  return { ok: false, errors: errors.slice(0, MAX_REPORTED_ERRORS), errorCount: errors.length };
}

/**
 * Reads the first sheet of an .xlsx/.xls/.csv file. All-or-nothing: either every non-blank row
 * is valid and returned, or every problem found is reported and nothing should be inserted.
 */
export function parseBuildingsWorkbook(data: Uint8Array): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array" });
  } catch {
    return failure([
      { row: null, column: null, message: "The file is not a readable Excel or CSV file." },
    ]);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) {
    return failure([{ row: null, column: null, message: "The file has no data." }]);
  }

  // Spreadsheet row number of the first row returned by sheet_to_json (1-based).
  const firstRow = XLSX.utils.decode_range(sheet["!ref"]).s.r + 1;
  const [header = [], ...dataRows] = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });

  const headers = header.map(normalizeHeader);
  const errors: ImportError[] = [];
  const seen = new Set<string>();
  headers.forEach((name) => {
    if (name === "") return;
    if (!isColumn(name)) {
      errors.push({
        row: firstRow,
        column: null,
        message: `Unknown column "${name}". Expected: ${TEMPLATE_COLUMNS.join(", ")}.`,
      });
    } else if (seen.has(name)) {
      errors.push({ row: firstRow, column: name, message: `Column "${name}" appears twice.` });
    }
    seen.add(name);
  });
  if (!seen.has("name")) {
    errors.push({ row: firstRow, column: "name", message: 'Missing the required "name" column.' });
  }
  if (errors.length > 0) return failure(errors);

  const nonBlank = dataRows
    .map((cells, index) => ({ cells, rowNumber: firstRow + 1 + index }))
    .filter(({ cells }) => cells.some((cell) => toText(cell) !== null));

  if (nonBlank.length === 0) {
    return failure([{ row: null, column: null, message: "The file has no buildings to import." }]);
  }
  if (nonBlank.length > MAX_ROWS) {
    return failure([
      {
        row: null,
        column: null,
        message: `The file has ${nonBlank.length} rows; the limit is ${MAX_ROWS} per import.`,
      },
    ]);
  }

  const schema = rowSchema();
  const rows: BuildingRow[] = [];
  for (const { cells, rowNumber } of nonBlank) {
    const record: Record<string, unknown> = {};
    headers.forEach((name, i) => {
      if (isColumn(name)) record[name] = cells[i];
    });
    const parsed = schema.safeParse(record);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        const column = String(issue.path[0]) as Column;
        errors.push({ row: rowNumber, column, message: `${column} ${issue.message}` });
      }
    }
  }

  return errors.length > 0 ? failure(errors) : { ok: true, rows };
}
