import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, phone, email, password, role, restaurantId } = body;

    if (!email || !password || !name || !restaurantId || !role) {
      return NextResponse.json(
        { error: "Name, email, password, role, and restaurant are required." },
        { status: 400 }
      );
    }

    // 1. Create auth user in Supabase Auth
    const { data: authUser, error: createAuthError } =
      await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password: password,
        email_confirm: true,
        user_metadata: {
          name: name.trim(),
          phone: phone ? phone.trim() : null,
          role,
          restaurant_id: restaurantId,
        },
      });

    if (createAuthError) {
      return NextResponse.json(
        { error: createAuthError.message },
        { status: 400 }
      );
    }

    // 2. Insert record into public.users table
    const { data: userData, error: insertError } = await supabaseAdmin
      .from("users")
      .insert({
        auth_user_id: authUser.user.id,
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        email: email.trim().toLowerCase(),
        role: role,
        restaurant_id: restaurantId,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      // Rollback auth user creation if database insert fails
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, user: userData },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("CREATE USER ERROR:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create user" },
      { status: 500 }
    );
  }
}
