import { createClient } from "@supabase/supabase-js";

/*
  Server-only admin client.

  Uses the SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so it's
  never bundled into client-side JS). This client bypasses Row-Level
  Security entirely, so it must only ever be imported from server code
  — API routes, server actions, etc. Never import this from a
  "use client" component.
*/

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
}

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});