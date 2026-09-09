import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchDailyDigestData,
  formatWhatsAppDigestMessage,
  DigestShift,
} from "@/lib/digest/dailyDigest";

async function handleCronDispatch(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // Verify cron secret if configured in environment
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine shift: lunch (4:00 PM) or eod (10:30 PM)
    const shiftParam = req.nextUrl.searchParams.get("shift");
    let shift: DigestShift = "EOD";
    if (shiftParam) {
      shift = shiftParam.toLowerCase() === "lunch" ? "LUNCH" : "EOD";
    } else {
      // Auto-detect based on current time (UTC)
      // 10:30 AM UTC = 4:00 PM IST (Lunch window: 9:00 - 13:00 UTC)
      // 5:00 PM UTC = 10:30 PM IST (EOD window)
      const currentUtcHour = new Date().getUTCHours();
      shift = currentUtcHour >= 9 && currentUtcHour <= 13 ? "LUNCH" : "EOD";
    }

    // 1. Fetch active restaurants
    const { data: restaurants, error: restError } = await supabaseAdmin
      .from("restaurants")
      .select("id, name");

    if (restError) throw restError;
    if (!restaurants || restaurants.length === 0) {
      return NextResponse.json({ message: "No active restaurants found." });
    }

    const results = [];
    const metaToken = process.env.WHATSAPP_API_TOKEN;
    const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    // 2. Loop through restaurants
    for (const rest of restaurants) {
      try {
        const digest = await fetchDailyDigestData(rest.id, rest.name, shift);
        const message = formatWhatsAppDigestMessage(digest);

        // 3. Fetch ALL owners / managers for this restaurant
        const { data: adminUsers } = await supabaseAdmin
          .from("users")
          .select("phone, name, role")
          .eq("restaurant_id", rest.id)
          .in("role", ["ADMIN", "SUPER_ADMIN"])
          .not("phone", "is", null);

        const recipients = (adminUsers || []).filter((u) => u.phone && u.phone.trim().length >= 10);
        const dispatchedRecipients = [];

        for (const user of recipients) {
          let dispatched = false;

          if (metaToken && metaPhoneId && user.phone) {
            let cleanPhone = user.phone.replace(/\D/g, "");
            if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;

            try {
              const res = await fetch(
                `https://graph.facebook.com/v19.0/${metaPhoneId}/messages`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${metaToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: cleanPhone,
                    type: "text",
                    text: { body: message },
                  }),
                }
              );
              dispatched = res.ok;
            } catch (dispatchErr) {
              console.error(`Error sending WhatsApp to ${user.phone}:`, dispatchErr);
            }
          }

          dispatchedRecipients.push({
            name: user.name,
            phone: user.phone,
            dispatched,
          });
        }

        results.push({
          restaurantId: rest.id,
          restaurantName: rest.name,
          shift,
          totalRevenue: digest.totalRevenue,
          orderCount: digest.orderCount,
          recipientsCount: recipients.length,
          recipients: dispatchedRecipients,
        });
      } catch (err: any) {
        console.error(`Error processing digest for ${rest.name}:`, err);
        results.push({
          restaurantId: rest.id,
          restaurantName: rest.name,
          error: err?.message || "Failed",
        });
      }
    }

    return NextResponse.json({
      success: true,
      shift,
      scheduledTime: shift === "LUNCH" ? "4:00 PM" : "10:30 PM",
      timestamp: new Date().toISOString(),
      processed: results.length,
      results,
    });
  } catch (error: any) {
    console.error("CRON DAILY DIGEST ERROR:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleCronDispatch(req);
}

export async function GET(req: NextRequest) {
  return handleCronDispatch(req);
}
