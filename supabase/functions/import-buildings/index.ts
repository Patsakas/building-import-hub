// Imports buildings from an uploaded .xlsx/.xls/.csv file for the signed-in user.
//
// withSupabase({ auth: "user" }) verifies the caller's JWT against the project's JWKS, answers
// CORS preflights and gives us a client scoped to that user, so the insert goes through RLS
// exactly like a request from the browser would. No service-role key is used here.
import { withSupabase } from "@supabase/server";
import { MAX_FILE_BYTES, parseBuildingsWorkbook } from "./buildings.ts";

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      file = null;
    }
    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "bad_request",
          message: 'Upload the file as multipart/form-data in a "file" field.',
        },
        { status: 400 },
      );
    }
    if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      return Response.json(
        { error: "unsupported_file_type", message: "Upload an .xlsx, .xls or .csv file." },
        { status: 415 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: "file_too_large", message: "The file is larger than 5 MB." },
        { status: 413 },
      );
    }

    const result = parseBuildingsWorkbook(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      return Response.json(
        { error: "validation_failed", errors: result.errors, errorCount: result.errorCount },
        { status: 422 },
      );
    }

    // One INSERT statement, so Postgres applies it atomically: all rows or none.
    const userId = ctx.userClaims!.id;
    const { error } = await ctx.supabase
      .from("buildings")
      .insert(result.rows.map((row) => ({ ...row, user_id: userId })));
    if (error) {
      console.error("import-buildings: insert failed", error);
      return Response.json(
        { error: "insert_failed", message: "The buildings could not be saved." },
        { status: 500 },
      );
    }

    return Response.json({ inserted: result.rows.length });
  }),
};
