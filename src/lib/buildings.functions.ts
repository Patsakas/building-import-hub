import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Excel uploader: parses the uploaded workbook on the server and inserts rows.
export const importBuildings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ fileBase64: z.string().min(1).max(15_000_000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    const wb = XLSX.read(bytes, { type: "array" });
    const first = wb.SheetNames[0];
    const sheet = first ? wb.Sheets[first] : undefined;
    if (!sheet) throw new Error("The file has no sheets.");
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows = raw
      .map((r) => {
        const norm: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r))
          norm[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
        return {
          user_id: context.userId,
          name: toText(norm["name"]),
          address: toText(norm["address"]),
          city: toText(norm["city"]),
          country: toText(norm["country"]),
          floors: toInt(norm["floors"]),
          year_built: toInt(norm["year_built"]),
        };
      })
      .filter((r): r is typeof r & { name: string } => !!r.name);

    const skipped = raw.length - rows.length;
    if (rows.length === 0) return { inserted: 0, skipped };

    const { error } = await context.supabase.from("buildings").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length, skipped };
  });
