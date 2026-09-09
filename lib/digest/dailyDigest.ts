import { supabase } from "@/lib/supabase";

export type DigestShift = "LUNCH" | "EOD" | "PULSE";

export type DailyDigestData = {
  restaurantName: string;
  shift: DigestShift;
  dateStr: string;
  shiftTimeLabel: string;
  totalRevenue: number;
  orderCount: number;
  aov: number;
  yesterdayRevenue: number;
  growthPercent: number | null;
  channels: {
    dineIn: { count: number; revenue: number };
    takeaway: { count: number; revenue: number };
    zomato: { count: number; revenue: number };
    swiggy: { count: number; revenue: number };
  };
  payments: {
    upi: { count: number; revenue: number };
    cash: { count: number; revenue: number };
    card: { count: number; revenue: number };
    other: { count: number; revenue: number };
  };
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  peakHour: { hourLabel: string; revenue: number; orders: number } | null;
  cancelledCount: number;
  cancelledRevenue: number;
};

export type OwnerRecipient = {
  id: string;
  name: string;
  phone: string;
  role?: string;
};

function formatMoney(num: number): string {
  return "₹" + Math.round(num).toLocaleString("en-IN");
}

export async function fetchDailyDigestData(
  restaurantId: string,
  restaurantName: string,
  shift: DigestShift = "EOD",
  targetDate: Date = new Date()
): Promise<DailyDigestData> {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  let shiftStart = new Date(startOfDay);
  let shiftEnd = new Date(targetDate);
  let shiftTimeLabel = "Full Day Close (10:30 PM)";

  if (shift === "LUNCH") {
    shiftStart.setHours(11, 0, 0, 0);
    shiftEnd = new Date(startOfDay);
    shiftEnd.setHours(16, 0, 0, 0);
    shiftTimeLabel = "Lunch Shift (4:00 PM)";
  } else if (shift === "EOD") {
    shiftEnd = new Date(startOfDay);
    shiftEnd.setHours(23, 59, 59, 999);
    shiftTimeLabel = "Night Close (10:30 PM)";
  } else {
    // PULSE (current time)
    shiftEnd = new Date();
    shiftTimeLabel = `Live Pulse (${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })})`;
  }

  const startOfYesterday = new Date(shiftStart);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const endOfYesterday = new Date(shiftEnd);
  endOfYesterday.setDate(endOfYesterday.getDate() - 1);

  // 1. Fetch shift orders
  const { data: shiftOrders, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id,
      total,
      channel,
      payment_mode,
      status,
      created_at,
      order_items (
        name_snapshot,
        price_snapshot,
        qty
      )
    `)
    .eq("restaurant_id", restaurantId)
    .gte("created_at", shiftStart.toISOString())
    .lte("created_at", shiftEnd.toISOString());

  if (ordersError) throw ordersError;

  // 2. Fetch yesterday's corresponding orders for comparison
  const { data: yesterdayOrders } = await supabase
    .from("orders")
    .select("total, status")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", startOfYesterday.toISOString())
    .lte("created_at", endOfYesterday.toISOString())
    .neq("status", "CANCELLED");

  const yesterdayRevenue = (yesterdayOrders || []).reduce(
    (sum, o) => sum + (Number(o.total) || 0),
    0
  );

  const activeOrders = (shiftOrders || []).filter(
    (o) => o.status !== "CANCELLED"
  );
  const cancelledOrders = (shiftOrders || []).filter(
    (o) => o.status === "CANCELLED"
  );

  const totalRevenue = activeOrders.reduce(
    (sum, o) => sum + (Number(o.total) || 0),
    0
  );
  const orderCount = activeOrders.length;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  const growthPercent =
    yesterdayRevenue > 0
      ? ((totalRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
      : null;

  // Channels
  const channels = {
    dineIn: { count: 0, revenue: 0 },
    takeaway: { count: 0, revenue: 0 },
    zomato: { count: 0, revenue: 0 },
    swiggy: { count: 0, revenue: 0 },
  };

  activeOrders.forEach((o) => {
    const rev = Number(o.total) || 0;
    const ch = (o.channel || "").toUpperCase();
    if (ch === "DINE_IN") {
      channels.dineIn.count++;
      channels.dineIn.revenue += rev;
    } else if (ch === "TAKEAWAY") {
      channels.takeaway.count++;
      channels.takeaway.revenue += rev;
    } else if (ch === "ZOMATO") {
      channels.zomato.count++;
      channels.zomato.revenue += rev;
    } else if (ch === "SWIGGY") {
      channels.swiggy.count++;
      channels.swiggy.revenue += rev;
    }
  });

  // Payments
  const payments = {
    upi: { count: 0, revenue: 0 },
    cash: { count: 0, revenue: 0 },
    card: { count: 0, revenue: 0 },
    other: { count: 0, revenue: 0 },
  };

  activeOrders.forEach((o) => {
    const rev = Number(o.total) || 0;
    const pm = (o.payment_mode || "").toUpperCase();
    if (pm === "UPI") {
      payments.upi.count++;
      payments.upi.revenue += rev;
    } else if (pm === "CASH") {
      payments.cash.count++;
      payments.cash.revenue += rev;
    } else if (pm === "CARD") {
      payments.card.count++;
      payments.card.revenue += rev;
    } else {
      payments.other.count++;
      payments.other.revenue += rev;
    }
  });

  // Top Items
  const itemMap = new Map<string, { qty: number; revenue: number }>();
  activeOrders.forEach((o: any) => {
    (o.order_items || []).forEach((item: any) => {
      const name = item.name_snapshot || "Item";
      const qty = Number(item.qty) || 1;
      const price = Number(item.price_snapshot) || 0;
      const existing = itemMap.get(name) || { qty: 0, revenue: 0 };
      itemMap.set(name, {
        qty: existing.qty + qty,
        revenue: existing.revenue + price * qty,
      });
    });
  });

  const topItems = Array.from(itemMap.entries())
    .map(([name, stat]) => ({ name, ...stat }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Hourly peak
  const hourMap = new Map<number, { orders: number; revenue: number }>();
  activeOrders.forEach((o) => {
    const d = new Date(o.created_at);
    const hour = d.getHours();
    const existing = hourMap.get(hour) || { orders: 0, revenue: 0 };
    hourMap.set(hour, {
      orders: existing.orders + 1,
      revenue: existing.revenue + (Number(o.total) || 0),
    });
  });

  let peakHour: { hourLabel: string; revenue: number; orders: number } | null =
    null;
  let maxRevenue = 0;
  hourMap.forEach((val, hour) => {
    if (val.revenue > maxRevenue) {
      maxRevenue = val.revenue;
      const period1 = hour % 12 === 0 ? 12 : hour % 12;
      const period2 = (hour + 1) % 12 === 0 ? 12 : (hour + 1) % 12;
      const ampm1 = hour < 12 ? "AM" : "PM";
      const ampm2 = hour + 1 < 12 || hour + 1 === 24 ? "AM" : "PM";
      peakHour = {
        hourLabel: `${period1}:00 ${ampm1} - ${period2}:00 ${ampm2}`,
        revenue: val.revenue,
        orders: val.orders,
      };
    }
  });

  const cancelledCount = cancelledOrders.length;
  const cancelledRevenue = cancelledOrders.reduce(
    (sum, o) => sum + (Number(o.total) || 0),
    0
  );

  const dateStr = targetDate.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return {
    restaurantName,
    shift,
    dateStr,
    shiftTimeLabel,
    totalRevenue,
    orderCount,
    aov,
    yesterdayRevenue,
    growthPercent,
    channels,
    payments,
    topItems,
    peakHour,
    cancelledCount,
    cancelledRevenue,
  };
}

export function formatWhatsAppDigestMessage(data: DailyDigestData): string {
  // Simple, clean format requested by user
  let topItemsList = "";
  if (data.topItems.length > 0) {
    topItemsList = data.topItems
      .slice(0, 4)
      .map((item, idx) => `${idx + 1}. ${item.name} (${item.qty})`)
      .join("\n");
  } else {
    topItemsList = "No sales recorded";
  }

  if (data.shift === "LUNCH") {
    return `☀️ *LUNCH SUMMARY (4:00 PM)*
🏢 *${data.restaurantName}*
📅 ${data.dateStr}
━━━━━━━━━━━━━━━━━━━
💰 *Lunch Revenue:* ${formatMoney(data.totalRevenue)}
📦 *Orders:* ${data.orderCount}
🏷️ *Avg Order Value:* ${formatMoney(data.aov)}

*Channels:*
• Dine-In: ${formatMoney(data.channels.dineIn.revenue)} (${data.channels.dineIn.count})
• Delivery/Takeaway: ${formatMoney(data.channels.takeaway.revenue + data.channels.zomato.revenue + data.channels.swiggy.revenue)} (${data.channels.takeaway.count + data.channels.zomato.count + data.channels.swiggy.count})

*Top Lunch Items:*
${topItemsList}
━━━━━━━━━━━━━━━━━━━
_RestaurantIQ_`;
  }

  // EOD or Pulse
  return `🌙 *DAILY CLOSE (10:30 PM)*
🏢 *${data.restaurantName}*
📅 ${data.dateStr}
━━━━━━━━━━━━━━━━━━━
💰 *Total Revenue:* ${formatMoney(data.totalRevenue)}
📦 *Total Orders:* ${data.orderCount}
🏷️ *Avg Order Value:* ${formatMoney(data.aov)}

*Channels:*
• Dine-In: ${formatMoney(data.channels.dineIn.revenue)} (${data.channels.dineIn.count})
• Takeaway: ${formatMoney(data.channels.takeaway.revenue)} (${data.channels.takeaway.count})
• Zomato/Swiggy: ${formatMoney(data.channels.zomato.revenue + data.channels.swiggy.revenue)} (${data.channels.zomato.count + data.channels.swiggy.count})

*Collections:*
• UPI / QR: ${formatMoney(data.payments.upi.revenue)}
• Cash: ${formatMoney(data.payments.cash.revenue)}
• Card: ${formatMoney(data.payments.card.revenue)}

*Top Sellers:*
${topItemsList}
${
  data.peakHour
    ? `\n*Peak Rush:* ${data.peakHour.hourLabel} (${formatMoney(data.peakHour.revenue)})\n`
    : ""
}━━━━━━━━━━━━━━━━━━━
_RestaurantIQ_`;
}

export function getWhatsAppShareUrl(phone: string, message: string): string {
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length === 10) {
    cleanPhone = "91" + cleanPhone;
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

export function getSavedOwnerRecipients(restaurantId: string): OwnerRecipient[] {
  if (typeof window === "undefined" || !restaurantId) return [];
  try {
    const raw = localStorage.getItem(`restaurant_iq_recipients_${restaurantId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOwnerRecipients(
  restaurantId: string,
  list: OwnerRecipient[]
): void {
  if (typeof window === "undefined" || !restaurantId) return;
  try {
    localStorage.setItem(
      `restaurant_iq_recipients_${restaurantId}`,
      JSON.stringify(list)
    );
  } catch (err) {
    console.error("Failed to save owner recipients:", err);
  }
}
