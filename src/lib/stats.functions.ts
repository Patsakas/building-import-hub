import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Total number of buildings across all users, for an admin dashboard.
export const countAllBuildings = createServerFn({ method: "GET" }).handler(async () => {
  const { count } = await supabaseAdmin
    .from("buildings")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
});
