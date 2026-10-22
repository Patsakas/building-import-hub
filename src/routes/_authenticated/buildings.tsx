import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const buildingsQuery = queryOptions({
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

export const Route = createFileRoute("/_authenticated/buildings")({
  head: () => ({
    meta: [
      { title: "Buildings — Buildings Registry" },
      { name: "description", content: "Your buildings list with Excel import." },
      { property: "og:title", content: "Buildings — Buildings Registry" },
      { property: "og:description", content: "Your buildings list with Excel import." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(buildingsQuery),
  component: BuildingsPage,
});

// Mirrors the limit enforced by the import-buildings Edge Function, to fail fast before uploading.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type ImportError = { row: number | null; column: string | null; message: string };
type ImportFailure = { message?: string; errors?: ImportError[]; errorCount?: number };

async function readImportFailure(error: unknown): Promise<ImportFailure | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    return (await error.context.json()) as ImportFailure;
  } catch {
    return null;
  }
}

function BuildingsPage() {
  const { data: buildings } = useSuspenseQuery(buildingsQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<{ errors: ImportError[]; errorCount: number } | null>(
    null,
  );

  async function onFile(file: File) {
    setRejected(null);
    if (file.size > MAX_FILE_BYTES) {
      toast.error("The file is larger than 5 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data, error } = await supabase.functions.invoke<{ inserted: number }>(
        "import-buildings",
        { body },
      );
      if (error) {
        const failure = await readImportFailure(error);
        if (failure?.errors?.length) {
          setRejected({
            errors: failure.errors,
            errorCount: failure.errorCount ?? failure.errors.length,
          });
          toast.error("Nothing was imported. Fix the rows listed below and try again.");
        } else {
          toast.error(failure?.message ?? "The import failed. Please try again.");
        }
        return;
      }
      toast.success(`Imported ${data?.inserted ?? 0} buildings.`);
      await qc.invalidateQueries({ queryKey: ["buildings"] });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Buildings</h1>
          <p className="text-sm text-muted-foreground">{buildings.length} total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/buildings-template.xlsx" download>
              Download Excel template
            </a>
          </Button>
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Importing…" : "Import Excel"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      {rejected && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>
            Nothing was imported: {rejected.errorCount}{" "}
            {rejected.errorCount === 1 ? "problem" : "problems"} found
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {rejected.errors.map((e, i) => (
                <li key={i}>
                  {e.row !== null && `Row ${e.row}: `}
                  {e.message}
                </li>
              ))}
            </ul>
            {rejected.errorCount > rejected.errors.length && (
              <p className="mt-2">…and {rejected.errorCount - rejected.errors.length} more.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Floors</TableHead>
              <TableHead className="text-right">Year built</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No buildings yet. Download the template, fill it in and import it.
                </TableCell>
              </TableRow>
            ) : (
              buildings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.address}</TableCell>
                  <TableCell>{b.city}</TableCell>
                  <TableCell>{b.country}</TableCell>
                  <TableCell className="text-right">{b.floors}</TableCell>
                  <TableCell className="text-right">{b.year_built}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
