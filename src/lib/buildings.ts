import { FunctionsHttpError } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Mirrors the limit enforced by the import-buildings Edge Function, to fail fast before uploading.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const buildingsQuery = queryOptions({
  queryKey: ["buildings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("buildings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

/** A problem in the uploaded file; `row` is the spreadsheet row number, null for the whole file. */
export type ImportError = { row: number | null; column: string | null; message: string };

export type ImportResult =
  | { ok: true; inserted: number }
  | { ok: false; message: string; errors: ImportError[]; errorCount: number };

type FunctionFailure = { message?: string; errors?: ImportError[]; errorCount?: number };

async function readFailure(error: unknown): Promise<FunctionFailure | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    return (await (error.context as Response).json()) as FunctionFailure;
  } catch {
    return null;
  }
}

/** Uploads a file to the import-buildings Edge Function. Never throws; the result says why not. */
export async function importBuildingsFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, message: "The file is larger than 5 MB.", errors: [], errorCount: 0 };
  }

  const body = new FormData();
  body.append("file", file);
  const { data, error } = await supabase.functions.invoke<{ inserted: number }>(
    "import-buildings",
    { body },
  );
  if (!error) return { ok: true, inserted: data?.inserted ?? 0 };

  const failure = await readFailure(error);
  const errors = failure?.errors ?? [];
  return {
    ok: false,
    message:
      errors.length > 0
        ? "Nothing was imported. Fix the rows listed below and try again."
        : (failure?.message ?? "The import failed. Please try again."),
    errors,
    errorCount: failure?.errorCount ?? errors.length,
  };
}
