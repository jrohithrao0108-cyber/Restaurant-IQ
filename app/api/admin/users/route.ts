import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/*
  Server-only admin client, created right here using the service role
  key. This bypasses Row-Level Security, so it must never be imported
  into client-side ("use client") code — only used inside this API
  route, which runs on the server.
*/
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Next.js 15+ (including 16) passes dynamic route params as a
    // Promise — it must be awaited, not read synchronously.
    const { id: targetUserId } = await params;

    // 1. Verify the caller's session token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
    }

    const { data: callerAuth, error: callerAuthError } = await supabaseAdmin.auth.getUser(token);

    if (callerAuthError || !callerAuth.user) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    // 2. Confirm the caller is a Super Admin
    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();

    if (callerProfileError) throw callerProfileError;

    if (!callerProfile || callerProfile.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only Super Admins can enable or disable users." }, { status: 403 });
    }

    // 3. Validate the request body
    const body = await req.json();
    const isActive = Boolean(body?.isActive);

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing user id." }, { status: 400 });
    }

    // 4. Look up the target user, including their auth_user_id so we
    // can also ban/unban them at the Supabase Auth level — this means
    // a disabled user can't get a new session at all, not just fail a
    // check inside the app itself.
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from("users")
      .select("id, auth_user_id, role")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (targetUser.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Super admin accounts can't be disabled here." },
        { status: 400 }
      );
    }

    // 5. Update the profile flag
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ is_active: isActive })
      .eq("id", targetUserId);

    if (updateError) throw updateError;

    // 6. Ban/unban at the Supabase Auth level too
    if (targetUser.auth_user_id) {
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUser.auth_user_id,
        {
          // "none" clears any ban (re-enable); a long duration
          // effectively locks the account out (disable). Supabase
          // doesn't have a literal "forever" value.
          ban_duration: isActive ? "none" : "876000h",
        }
      );

      if (banError) {
        console.error("AUTH BAN UPDATE ERROR:", banError);
        // Don't fail the whole request over this — users.is_active is
        // already updated and enforced by the app's own login check —
        // but it's logged so a mismatch here can be investigated.
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("TOGGLE USER ACTIVE API ERROR:", err);
    return NextResponse.json({ error: err?.message || "Could not update this user." }, { status: 500 });
  }
} 