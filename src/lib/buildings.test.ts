import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { importBuildingsFile, MAX_IMPORT_BYTES } from "./buildings";

const file = () => new File(["name\nTower\n"], "buildings.csv", { type: "text/csv" });

function httpError(status: number, body: unknown) {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

describe("importBuildingsFile", () => {
  beforeEach(() => invoke.mockReset());

  it("uploads the file as multipart form data and reports how many rows were inserted", async () => {
    invoke.mockResolvedValue({ data: { inserted: 3 }, error: null });

    await expect(importBuildingsFile(file())).resolves.toEqual({ ok: true, inserted: 3 });

    const [name, options] = invoke.mock.calls[0]!;
    expect(name).toBe("import-buildings");
    expect((options.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("returns the row errors when the function rejects the file", async () => {
    const errors = [{ row: 3, column: "floors", message: "floors must be a number" }];
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: "validation_failed", errors, errorCount: 7 }),
    });

    await expect(importBuildingsFile(file())).resolves.toEqual({
      ok: false,
      message: "Nothing was imported. Fix the rows listed below and try again.",
      errors,
      errorCount: 7,
    });
  });

  it("passes on the function's message for other rejections", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(415, { error: "unsupported_file_type", message: "Upload an .xlsx file." }),
    });

    await expect(importBuildingsFile(file())).resolves.toMatchObject({
      ok: false,
      message: "Upload an .xlsx file.",
      errors: [],
    });
  });

  it("falls back to a generic message when the function cannot be reached", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError("offline") });

    await expect(importBuildingsFile(file())).resolves.toMatchObject({
      ok: false,
      message: "The import failed. Please try again.",
    });
  });

  it("rejects files over the size limit without uploading them", async () => {
    const big = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "big.xlsx");

    await expect(importBuildingsFile(big)).resolves.toMatchObject({
      ok: false,
      message: "The file is larger than 5 MB.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
