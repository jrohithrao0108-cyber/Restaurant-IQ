"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  ChevronRight,
  X,
  RefreshCw,
  SlidersHorizontal,
  Info,
  ChevronDown,
  CheckCircle2
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  getDemoHistoricalOrders,
  DEMO_TODAY_ORDERS,
  DEMO_PRODUCTS
} from "@/lib/demoData";

/* =========================================================
   HYDERABAD (IST) LIGHTNING-FAST TIMEZONE ENGINE
   (UTC+05:30 with 0 DST - Pure millisecond arithmetic)
========================================================= */

export const IST_OFFSET_MS = 19800000; // 5 hours 30 minutes in milliseconds

export function getFastISTParts(dateInput?: string | Date | number | null): {
  dateStr: string; // "YYYY-MM-DD"
  hours: number;
  minutes: number;
  seconds: number;
  msIntoDay: number;
} {
  if (!dateInput) {
    return { dateStr: "", hours: 0, minutes: 0, seconds: 0, msIntoDay: 0 };
  }

  let ts: number;
  if (typeof dateInput === "number") {
    ts = dateInput;
  } else if (typeof dateInput === "string") {
    ts = new Date(dateInput).getTime();
  } else if (dateInput instanceof Date) {
    ts = dateInput.getTime();
  } else if (typeof dateInput === "object" && typeof (dateInput as any).getTime === "function") {
    ts = (dateInput as any).getTime();
  } else {
    ts = new Date(String(dateInput)).getTime();
  }

  if (isNaN(ts)) {
    return { dateStr: "", hours: 0, minutes: 0, seconds: 0, msIntoDay: 0 };
  }

  const istMs = ts + IST_OFFSET_MS;
  const d = new Date(istMs);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${day}`;

  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const msIntoDay = (hours * 3600 + minutes * 60 + seconds) * 1000;

  return { dateStr, hours, minutes, seconds, msIntoDay };
}

export function formatFastISTTime(hours: number, minutes: number): string {
  const h12 = hours % 12 || 12;
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${h12}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

export function getISTDateStr(dateInput: string | Date | number): string {
  return getFastISTParts(dateInput).dateStr;
}

export function getISTTimeParts(dateInput: string | Date | number) {
  return getFastISTParts(dateInput);
}

export function formatISTTime(dateInput: string | Date): string {
  const parts = getFastISTParts(dateInput);
  return formatFastISTTime(parts.hours, parts.minutes);
}

export function formatISTDate(dateInput: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(options || { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  });
}

/* =========================================================
   TYPES & SELECT QUERIES
========================================================= */

export type OrderSource = "ZOMATO" | "DINE_IN" | "SWIGGY" | "TAKEAWAY";

export type Item = {
  id: string;
  name: string;
  price: number;
  category: string;
  qty: number;
  notes?: string;
};

export type Order = {
  id: string;
  databaseId?: string;
  time: string;
  source: OrderSource;
  table?: string;
  items: Item[];
  total: number;
  payment: string;
  createdAt: string;
  closedAt?: string | null;
  status?: string;
  istDateStr?: string;
  istHour?: number;
  istMsIntoDay?: number;
};

interface RestaurantIQDashboardProps {
  orders?: any[];
  historicalOrders?: any[];
  restaurantId?: string;
  restaurantName?: string;
  currentUserPhone?: string;
  onLogout?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const TODAY_ORDER_SELECT = `
  id,
  order_number,
  order_type,
  channel,
  payment_mode,
  table_number,
  subtotal,
  discount,
  tax,
  total,
  status,
  created_at,
  closed_at,
  order_items (
    id,
    menu_item_id,
    name_snapshot,
    price_snapshot,
    qty,
    menu_items (
      category
    )
  )
`;

const RECENT_HIST_ORDER_SELECT = `
  id,
  order_number,
  order_type,
  channel,
  payment_mode,
  table_number,
  total,
  status,
  created_at,
  order_items (
    id,
    name_snapshot,
    price_snapshot,
    qty,
    menu_items (
      category
    )
  )
`;

const HIST_ORDER_SELECT = `
  id,
  order_number,
  order_type,
  channel,
  payment_mode,
  table_number,
  total,
  status,
  created_at
`;

function deriveSource(o: any): OrderSource {
  if (o.source) return o.source;
  const ch = (o.channel || "").toUpperCase();
  const ot = (o.order_type || o.orderType || "").toUpperCase();
  if (ch.includes("ZOMATO") || ot.includes("ZOMATO")) return "ZOMATO";
  if (ch.includes("SWIGGY") || ot.includes("SWIGGY")) return "SWIGGY";
  if (ot.includes("DINE") || ch.includes("DINE") || o.table_number || o.table) return "DINE_IN";
  return "TAKEAWAY";
}

function parseOrder(o: any): Order {
  const itemMap = new Map<string, Item>();

  // Support orders that already have parsed items
  if (Array.isArray(o.items) && o.items.length > 0) {
    o.items.forEach((it: any) => {
      const id = it.id || it.menu_item_id || "item";
      const price = Number(it.price) || 0;
      const key = `${id}-${price}`;
      itemMap.set(key, {
        id,
        name: it.name || "Item",
        price,
        category: it.category || "Mains",
        qty: Number(it.qty) || 1,
      });
    });
  } else {
    (o.order_items || []).forEach((i: any) => {
      const id = i.menu_item_id || i.id;
      const price = Number(i.price_snapshot) || 0;
      const key = `${id}-${price}`;
      const qty = Number(i.qty) || 0;
      const cat =
        (Array.isArray(i.menu_items) ? i.menu_items[0]?.category : i.menu_items?.category) ||
        "Mains";

      const existing = itemMap.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        itemMap.set(key, {
          id,
          name: i.name_snapshot || "Item",
          price,
          category: cat,
          qty,
        });
      }
    });
  }

  const rawCreatedAt = o.created_at || o.createdAt || new Date().toISOString();
  const ist = getFastISTParts(rawCreatedAt);

  return {
    id: o.order_number || o.orderNumber || String(o.id || ""),
    databaseId: o.databaseId || o.id,
    time: formatFastISTTime(ist.hours, ist.minutes),
    source: deriveSource(o),
    table: o.table_number || o.table || undefined,
    items: Array.from(itemMap.values()),
    total: Number(o.total) || 0,
    payment: o.payment_mode || o.payment || "UPI",
    createdAt: rawCreatedAt,
    closedAt: o.closed_at || o.closedAt || null,
    status: o.status || "COMPLETED",
    istDateStr: ist.dateStr,
    istHour: ist.hours,
    istMsIntoDay: ist.msIntoDay,
  };
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export function RestaurantIQDashboard({
  orders: propTodayOrders,
  historicalOrders: propHistoricalOrders,
  restaurantId = "demo-restaurant-1",
  restaurantName = "Spice Garden Fine Dine",
  onLogout,
  onRefresh: propOnRefresh,
  isRefreshing: propIsRefreshing = false,
}: RestaurantIQDashboardProps) {
  // Data State
  const [internalTodayOrders, setInternalTodayOrders] = useState<Order[]>([]);
  const [internalHistoricalOrders, setInternalHistoricalOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);
  const [localRefreshing, setLocalRefreshing] = useState(false);

  // Navigation & Drilldown State
  const [dimension, setDimension] = useState<"channels" | "hours" | "menu">("channels");
  const [selectedItemId, setSelectedItemId] = useState<string>("ZOMATO");
  const [dateRange, setDateRange] = useState<"today" | "7days" | "30days" | "custom">("7days");
  const [graphMetric, setGraphMetric] = useState<"both" | "rev" | "orders">("both");

  // Current Hyderabad time references (reactive every 30s)
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const now = currentTime;
  const todayISTStr = getISTDateStr(now);
  const nowIST = getISTTimeParts(now);

  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 10);
    return getISTDateStr(d);
  });
  const [customEnd, setCustomEnd] = useState(todayISTStr);

  // Fast, clean, and reliable data loading from Supabase with Hyderabad IST boundaries
  async function loadData(options?: { fullHistorical?: boolean }) {
    const shouldFetchHistory = options?.fullHistorical ?? (internalHistoricalOrders.length === 0);
    setLocalRefreshing(true);
    try {
      if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
        const demoHistory = getDemoHistoricalOrders().map(parseOrder);
        const demoToday = DEMO_TODAY_ORDERS.map(parseOrder);
        setInternalTodayOrders(demoToday);
        setInternalHistoricalOrders(demoHistory);
        setLoading(false);
        setHasFetched(true);
        setLocalRefreshing(false);
        return;
      }

      // ALWAYS compute fresh IST date boundaries dynamically at runtime
      const freshNow = new Date();
      const freshTodayISTStr = getISTDateStr(freshNow);
      const todayStartUtcIso = new Date(`${freshTodayISTStr}T00:00:00+05:30`).toISOString();

      if (shouldFetchHistory) {
        // Parallel fetch: today's detailed orders + historical lightweight pages in 1 roundtrip
        const [todayRes, page1, page2, page3] = await Promise.all([
          supabase
            .from("orders")
            .select(TODAY_ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .gte("created_at", todayStartUtcIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false }),
          supabase
            .from("orders")
            .select(RECENT_HIST_ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .lt("created_at", todayStartUtcIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false })
            .range(0, 999),
          supabase
            .from("orders")
            .select(HIST_ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .lt("created_at", todayStartUtcIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false })
            .range(1000, 1999),
          supabase
            .from("orders")
            .select(HIST_ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .lt("created_at", todayStartUtcIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false })
            .range(2000, 2999),
        ]);

        if (todayRes.error) {
          console.warn("Notice: today's live query info:", todayRes.error.message || todayRes.error);
        }

        const parsedToday = (todayRes.data || []).map(parseOrder);
        const allHistRows = [
          ...(page1.data || []),
          ...(page2.data || []),
          ...(page3.data || []),
        ];
        const parsedHist = allHistRows.map(parseOrder);

        // Single batched state update prevents cascading re-render loops
        setInternalTodayOrders(parsedToday);
        setInternalHistoricalOrders(parsedHist);
      } else {
        // Real-time incremental path: Only re-fetch today's orders (~50ms)
        const todayRes = await supabase
          .from("orders")
          .select(TODAY_ORDER_SELECT)
          .eq("restaurant_id", restaurantId)
          .gte("created_at", todayStartUtcIso)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: false });

        if (todayRes.error) {
          console.warn("Notice: today's live query info:", todayRes.error.message || todayRes.error);
        }

        const parsedToday = (todayRes.data || []).map(parseOrder);
        setInternalTodayOrders(parsedToday);
      }
    } catch (err: any) {
      console.warn("Live data notice:", err?.message || err);
    } finally {
      setLoading(false);
      setHasFetched(true);
      setLocalRefreshing(false);
    }
  }

  // Ref keeps loadData fresh for subscriptions without tearing down connection
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    loadData({ fullHistorical: true });
  }, [restaurantId]);

  // Real-time Postgres channel subscription (debounced to avoid re-render storms)
  useEffect(() => {
    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") return;

    let debounceTimer: NodeJS.Timeout | null = null;
    const channel = supabase
      .channel(`restaurant-iq-live-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            loadDataRef.current?.({ fullHistorical: false });
          }, 1500);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  // Ensure all incoming orders have precomputed fast IST fields
  // Protect genuine zero-order days with hasFetched
  const todayOrders = useMemo(() => {
    const raw = hasFetched
      ? internalTodayOrders
      : propTodayOrders && propTodayOrders.length > 0
      ? propTodayOrders
      : internalTodayOrders;
    return raw.map((o) => (o.istDateStr ? (o as Order) : parseOrder(o)));
  }, [hasFetched, internalTodayOrders, propTodayOrders]);

  const historicalOrders = useMemo(() => {
    const raw = hasFetched
      ? internalHistoricalOrders
      : propHistoricalOrders && propHistoricalOrders.length > 0
      ? propHistoricalOrders
      : internalHistoricalOrders;
    return raw.map((o) => (o.istDateStr ? (o as Order) : parseOrder(o)));
  }, [hasFetched, internalHistoricalOrders, propHistoricalOrders]);

  // Hyderabad Display Meta
  const dateFormatted = formatISTDate(now, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const weekdayName = formatISTDate(now, { weekday: "long" });

  const currentHour = nowIST.hours;
  let currentShiftBadge = "🌙 Evening & Dinner (4:00 PM - Close)";
  if (currentHour >= 7 && currentHour < 12) {
    currentShiftBadge = "🌅 Morning Shift (7:00 AM - 12:00 PM)";
  } else if (currentHour >= 12 && currentHour < 16) {
    currentShiftBadge = "☀️ Afternoon Shift (12:00 PM - 4:00 PM)";
  }

  /* =========================================================
     HYDERABAD 3-WEEK SAME-DAY & SAME-TIME BASELINE ENGINE
     (Pre-indexed O(1) Date Map + Nanosecond Integer Compares)
  ========================================================= */

  const historicalOrdersByDate = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (let i = 0; i < historicalOrders.length; i++) {
      const o = historicalOrders[i];
      const dStr = o.istDateStr || getFastISTParts(o.createdAt).dateStr;
      const list = map.get(dStr);
      if (list) {
        list.push(o);
      } else {
        map.set(dStr, [o]);
      }
    }
    return map;
  }, [historicalOrders]);

  function calculateSameTimeBaseline(
    filterFn?: (o: Order) => boolean
  ): { baselineRev: number; baselineOrders: number; weeksSampled: number } {
    const weeklyTotals: { rev: number; count: number }[] = [];

    // Check last 3 weeks on the exact same day of the week in Hyderabad time
    for (let w = 1; w <= 3; w++) {
      const pastMs = now.getTime() - w * 7 * 86400000;
      const pastISTDate = getFastISTParts(pastMs).dateStr;

      const dayOrders = historicalOrdersByDate.get(pastISTDate);
      if (!dayOrders || dayOrders.length === 0) continue;

      let dayRev = 0;
      let count = 0;
      for (let i = 0; i < dayOrders.length; i++) {
        const o = dayOrders[i];
        if (o.istMsIntoDay <= nowIST.msIntoDay && (!filterFn || filterFn(o))) {
          dayRev += Number(o.total) || 0;
          count++;
        }
      }

      weeklyTotals.push({ rev: dayRev, count });
    }

    const validWeeks = weeklyTotals.filter((w) => w.rev > 0 || w.count > 0);
    if (validWeeks.length > 0) {
      const sumRev = validWeeks.reduce((s, w) => s + w.rev, 0);
      const sumCount = validWeeks.reduce((s, w) => s + w.count, 0);
      return {
        baselineRev: Math.round(sumRev / validWeeks.length),
        baselineOrders: Math.round(sumCount / validWeeks.length),
        weeksSampled: validWeeks.length,
      };
    }

    return { baselineRev: 0, baselineOrders: 0, weeksSampled: 0 };
  }

  // Top Row Overall KPIs
  const topMetrics = useMemo(() => {
    const todayRev = todayOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const todayCount = todayOrders.length;

    const { baselineRev, baselineOrders, weeksSampled } = calculateSameTimeBaseline();

    const revDelta = Math.round(todayRev - baselineRev);
    const ordersDelta = todayCount - baselineOrders;

    const revGrowthPct =
      baselineRev > 0
        ? ((revDelta / baselineRev) * 100).toFixed(1)
        : todayRev > 0
        ? "+100.0"
        : "0.0";
    const ordersGrowthPct =
      baselineOrders > 0
        ? ((ordersDelta / baselineOrders) * 100).toFixed(1)
        : todayCount > 0
        ? "+100.0"
        : "0.0";

    return {
      todayRev,
      baselineRev,
      revDelta,
      revGrowthPct: (revDelta >= 0 ? "+" : "") + revGrowthPct + "%",
      revUp: revDelta >= 0,
      todayCount,
      baselineOrders,
      ordersDelta,
      ordersGrowthPct: (ordersDelta >= 0 ? "+" : "") + ordersGrowthPct + "%",
      ordersUp: ordersDelta >= 0,
      weeksSampled,
    };
  }, [todayOrders, historicalOrders, nowIST.msIntoDay]);

  /* =========================================================
     DIMENSION BREAKDOWN LISTS
  ========================================================= */

  // 1. Channels Breakdown
  const channelCards = useMemo(() => {
    const channelConfigs: {
      id: OrderSource;
      name: string;
      icon: string;
      iconBg: string;
      tagColor: string;
      tagTextColor: string;
    }[] = [
      {
        id: "ZOMATO",
        name: "Zomato",
        icon: "Z",
        iconBg: "#ef4444",
        tagColor: "rgba(239, 68, 68, 0.15)",
        tagTextColor: "#f87171",
      },
      {
        id: "SWIGGY",
        name: "Swiggy",
        icon: "S",
        iconBg: "#f97316",
        tagColor: "rgba(249, 115, 22, 0.15)",
        tagTextColor: "#fb923c",
      },
      {
        id: "DINE_IN",
        name: "Dine-In (Tables)",
        icon: "🍽️",
        iconBg: "#3b82f6",
        tagColor: "rgba(59, 130, 246, 0.15)",
        tagTextColor: "#60a5fa",
      },
      {
        id: "TAKEAWAY",
        name: "Direct / Takeaway",
        icon: "🥡",
        iconBg: "#10b981",
        tagColor: "rgba(16, 185, 129, 0.15)",
        tagTextColor: "#34d399",
      },
    ];

    const totalRevAll = topMetrics.todayRev || 1;

    return channelConfigs.map((cfg) => {
      const chOrders = todayOrders.filter((o) => o.source === cfg.id);
      const rev = chOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const count = chOrders.length;
      const sharePct = Math.round((rev / totalRevAll) * 100);

      const base = calculateSameTimeBaseline((o) => o.source === cfg.id);
      const revDelta = rev - base.baselineRev;
      const orderDelta = count - base.baselineOrders;

      const revGrowth =
        base.baselineRev > 0
          ? ((revDelta / base.baselineRev) * 100).toFixed(1)
          : rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        base.baselineOrders > 0
          ? ((orderDelta / base.baselineOrders) * 100).toFixed(1)
          : count > 0
          ? "+100.0"
          : "0.0";

      return {
        id: cfg.id,
        name: cfg.name,
        icon: cfg.icon,
        iconBg: cfg.iconBg,
        tag: `${sharePct}% of Rev`,
        tagColor: cfg.tagColor,
        tagTextColor: cfg.tagTextColor,
        rev,
        revGrowth: (revDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(revGrowth)) + "%",
        revUp: revDelta >= 0,
        orders: count,
        orderGrowth: (orderDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(orderGrowth)) + "%",
        orderDelta: (orderDelta >= 0 ? "+" : "") + String(orderDelta),
        orderUp: orderDelta >= 0,
        revDeltaInsight: `${revDelta >= 0 ? "+" : "-"}₹${Math.abs(revDelta).toLocaleString("en-IN")} ${
          revDelta >= 0 ? "UP" : "DOWN"
        }`,
        orderDeltaInsight: `${Math.abs(orderDelta)} Orders ${orderDelta >= 0 ? "UP" : "DOWN"}`,
        filterFn: (o: Order) => o.source === cfg.id,
      };
    });
  }, [todayOrders, historicalOrders, topMetrics.todayRev, nowIST.msIntoDay]);

  // 2. Hour Shifts Breakdown in Hyderabad IST
  const hourCards = useMemo(() => {
    const shiftConfigs = [
      {
        id: "morning",
        name: "🌅 Morning Shift (7:00 AM - 12:00 PM)",
        icon: "☕",
        iconBg: "#f59e0b",
        tag: "Breakfast",
        tagColor: "rgba(245, 158, 11, 0.15)",
        tagTextColor: "#fbbf24",
        hourFilter: (h: number) => h >= 7 && h < 12,
      },
      {
        id: "afternoon",
        name: "☀️ Afternoon Shift (12:00 PM - 4:00 PM)",
        icon: "🍛",
        iconBg: "#f97316",
        tag: "Lunch Peak",
        tagColor: "rgba(249, 115, 22, 0.15)",
        tagTextColor: "#fb923c",
        hourFilter: (h: number) => h >= 12 && h < 16,
      },
      {
        id: "evening",
        name: "🌙 Evening & Dinner (4:00 PM - Close)",
        icon: "🔥",
        iconBg: "#6366f1",
        tag: "Dinner Rush",
        tagColor: "rgba(99, 102, 241, 0.15)",
        tagTextColor: "#818cf8",
        hourFilter: (h: number) => h >= 16 || h < 4,
      },
    ];

    return shiftConfigs.map((cfg) => {
      const shiftOrders = todayOrders.filter((o) => cfg.hourFilter(o.istHour));
      const rev = shiftOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const count = shiftOrders.length;

      const base = calculateSameTimeBaseline((o) => cfg.hourFilter(o.istHour));
      const revDelta = rev - base.baselineRev;
      const orderDelta = count - base.baselineOrders;

      const revGrowth =
        base.baselineRev > 0
          ? ((revDelta / base.baselineRev) * 100).toFixed(1)
          : rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        base.baselineOrders > 0
          ? ((orderDelta / base.baselineOrders) * 100).toFixed(1)
          : count > 0
          ? "+100.0"
          : "0.0";

      return {
        id: cfg.id,
        name: cfg.name,
        icon: cfg.icon,
        iconBg: cfg.iconBg,
        tag: cfg.tag,
        tagColor: cfg.tagColor,
        tagTextColor: cfg.tagTextColor,
        rev,
        revGrowth: (revDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(revGrowth)) + "%",
        revUp: revDelta >= 0,
        orders: count,
        orderGrowth: (orderDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(orderGrowth)) + "%",
        orderDelta: (orderDelta >= 0 ? "+" : "") + String(orderDelta),
        orderUp: orderDelta >= 0,
        revDeltaInsight: `${revDelta >= 0 ? "+" : "-"}₹${Math.abs(revDelta).toLocaleString("en-IN")} ${
          revDelta >= 0 ? "UP" : "DOWN"
        }`,
        orderDeltaInsight: `${Math.abs(orderDelta)} Bills ${orderDelta >= 0 ? "UP" : "DOWN"}`,
        filterFn: (o: Order) => cfg.hourFilter(o.istHour),
      };
    });
  }, [todayOrders, historicalOrders, nowIST.msIntoDay]);

  // 3. Menu Categories Breakdown
  const menuCards = useMemo(() => {
    const catMap = new Map<string, { rev: number; count: number }>();
    const totalRevAll = topMetrics.todayRev || 1;

    const initialCats = ["Rice & Biryani", "Starters", "Main Course", "Breads", "Desserts", "Beverages"];
    initialCats.forEach((c) => catMap.set(c, { rev: 0, count: 0 }));

    todayOrders.forEach((o) => {
      o.items.forEach((it) => {
        const rawCat = it.category || "Main Course";
        const cat = rawCat === "Mains" ? "Main Course" : rawCat;
        const current = catMap.get(cat) || { rev: 0, count: 0 };
        current.rev += it.price * it.qty;
        current.count += it.qty;
        catMap.set(cat, current);
      });
    });

    const catIcons: Record<string, { icon: string; bg: string }> = {
      "Rice & Biryani": { icon: "🍗", bg: "#ef4444" },
      Starters: { icon: "🍢", bg: "#f97316" },
      "Main Course": { icon: "🍲", bg: "#eab308" },
      Breads: { icon: "🫓", bg: "#10b981" },
      Desserts: { icon: "🍨", bg: "#ec4899" },
      Beverages: { icon: "🥤", bg: "#06b6d4" },
    };

    return Array.from(catMap.entries()).map(([cat, stats]) => {
      const sharePct = Math.round((stats.rev / totalRevAll) * 100);
      const iconInfo = catIcons[cat] || { icon: "🍽️", bg: "#8b5cf6" };

      const base = calculateSameTimeBaseline((o) =>
        o.items.some((it) => {
          const c = it.category === "Mains" ? "Main Course" : it.category;
          return c === cat;
        })
      );

      // Historical orders omit child item rows for performance, so if item-level baseline is 0,
      // benchmark against overall baseline scaled by category share of revenue/orders
      const estimatedBaseRev =
        base.baselineRev > 0
          ? base.baselineRev
          : Math.round(topMetrics.baselineRev * (stats.rev / totalRevAll));
      const estimatedBaseOrders =
        base.baselineOrders > 0
          ? base.baselineOrders
          : Math.round(topMetrics.baselineOrders * (stats.count / (topMetrics.todayCount || 1)));

      const revDelta = stats.rev - estimatedBaseRev;
      const orderDelta = stats.count - estimatedBaseOrders;

      const revGrowth =
        estimatedBaseRev > 0
          ? ((revDelta / estimatedBaseRev) * 100).toFixed(1)
          : stats.rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        estimatedBaseOrders > 0
          ? ((orderDelta / estimatedBaseOrders) * 100).toFixed(1)
          : stats.count > 0
          ? "+100.0"
          : "0.0";

      return {
        id: cat,
        name: cat,
        icon: iconInfo.icon,
        iconBg: iconInfo.bg,
        tag: `${sharePct}% Share`,
        tagColor: "rgba(239, 68, 68, 0.15)",
        tagTextColor: iconInfo.bg,
        rev: stats.rev,
        revGrowth: (revDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(revGrowth)) + "%",
        revUp: revDelta >= 0,
        orders: stats.count,
        orderGrowth: (orderDelta >= 0 ? "▲ " : "▼ ") + Math.abs(Number(orderGrowth)) + "%",
        orderDelta: (orderDelta >= 0 ? "+" : "") + String(orderDelta),
        orderUp: orderDelta >= 0,
        revDeltaInsight: `${revDelta >= 0 ? "+" : "-"}₹${Math.abs(revDelta).toLocaleString("en-IN")} ${
          revDelta >= 0 ? "UP" : "DOWN"
        }`,
        orderDeltaInsight: `${Math.abs(orderDelta)} Items ${orderDelta >= 0 ? "UP" : "DOWN"}`,
        filterFn: (o: Order) =>
          o.items.some((it) => {
            const c = it.category === "Mains" ? "Main Course" : it.category;
            return c === cat;
          }),
      };
    });
  }, [todayOrders, historicalOrders, topMetrics.todayRev, nowIST.msIntoDay]);

  // Active items list based on dimension
  const currentDimensionCards = useMemo(() => {
    if (dimension === "channels") return channelCards;
    if (dimension === "hours") return hourCards;
    return menuCards;
  }, [dimension, channelCards, hourCards, menuCards]);

  // Active selected item for drilldown
  const activeCard = useMemo(() => {
    const found = currentDimensionCards.find((c) => c.id === selectedItemId);
    return found || currentDimensionCards[0];
  }, [currentDimensionCards, selectedItemId]);

  /* =========================================================
     DYNAMIC DRILLDOWN & TREND GRAPH CALCULATIONS
  ========================================================= */

  const drilldownData = useMemo(() => {
    if (!activeCard) return null;
    const filterFn = activeCard.filterFn;
    const isMenuDim = dimension === "menu";

    const getOrderRev = (o: Order): number => {
      if (isMenuDim) {
        if (o.items && o.items.length > 0) {
          return o.items.reduce((sum, it) => {
            const c = it.category === "Mains" ? "Main Course" : it.category;
            return c === activeCard.id ? sum + (it.price * it.qty) : sum;
          }, 0);
        }
        return 0;
      }
      return Number(o.total) || 0;
    };

    const getOrderCount = (o: Order): number => {
      if (isMenuDim) {
        if (o.items && o.items.length > 0) {
          return o.items.reduce((sum, it) => {
            const c = it.category === "Mains" ? "Main Course" : it.category;
            return c === activeCard.id ? sum + it.qty : sum;
          }, 0);
        }
        return 0;
      }
      return 1;
    };

    // Deduplicate orders between today and historical
    const seenOrderIds = new Set<string>();
    const allFilteredOrders: Order[] = [];
    for (const o of todayOrders) {
      const oid = String(o.databaseId || o.id);
      if (oid && !seenOrderIds.has(oid)) {
        seenOrderIds.add(oid);
        if (!filterFn || filterFn(o)) allFilteredOrders.push(o);
      }
    }
    for (const o of historicalOrders) {
      const oid = String(o.databaseId || o.id);
      if (oid && !seenOrderIds.has(oid)) {
        seenOrderIds.add(oid);
        if (!filterFn || filterFn(o)) allFilteredOrders.push(o);
      }
    }

    // 1. "today" -> Hourly buckets covering active operations
    if (dateRange === "today") {
      let buckets = [
        { label: "8-11 AM", minH: 8, maxH: 11 },
        { label: "11-2 PM", minH: 11, maxH: 14 },
        { label: "2-5 PM", minH: 14, maxH: 17 },
        { label: "5-8 PM", minH: 17, maxH: 20 },
        { label: "8-10 PM", minH: 20, maxH: 22 },
        { label: "10-12 AM", minH: 22, maxH: 24 },
      ];

      if (activeCard.id === "morning") {
        buckets = [
          { label: "8 AM", minH: 7, maxH: 9 },
          { label: "9 AM", minH: 9, maxH: 10 },
          { label: "10 AM", minH: 10, maxH: 11 },
          { label: "11 AM", minH: 11, maxH: 12 },
        ];
      } else if (activeCard.id === "afternoon") {
        buckets = [
          { label: "12 PM", minH: 12, maxH: 13 },
          { label: "1 PM", minH: 13, maxH: 14 },
          { label: "2 PM", minH: 14, maxH: 15 },
          { label: "3 PM", minH: 15, maxH: 16 },
        ];
      } else if (activeCard.id === "evening") {
        buckets = [
          { label: "4-6 PM", minH: 16, maxH: 18 },
          { label: "6-8 PM", minH: 18, maxH: 20 },
          { label: "8-10 PM", minH: 20, maxH: 22 },
          { label: "10-12 AM", minH: 22, maxH: 24 },
        ];
      }

      const todaysMatching = todayOrders.filter(filterFn);
      const revs: number[] = [];
      const counts: number[] = [];

      buckets.forEach((b) => {
        const matching = todaysMatching.filter((o) => o.istHour >= b.minH && o.istHour < b.maxH);
        revs.push(matching.reduce((s, o) => s + getOrderRev(o), 0));
        counts.push(matching.reduce((s, o) => s + getOrderCount(o), 0));
      });

      const cumRev = revs.reduce((a, b) => a + b, 0);
      const cumOrders = counts.reduce((a, b) => a + b, 0);

      return {
        days: buckets.map((b) => b.label),
        rev: revs,
        orders: counts,
        cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
        cumOrders: String(cumOrders),
        avgDailyRev: `₹${cumRev.toLocaleString("en-IN")}`,
        avgDailyOrders: `${cumOrders} ${isMenuDim ? "items" : "orders"}`,
        baselineRev: Math.round(cumRev * 0.95),
        baselineOrders: Math.round(cumOrders * 0.95),
        insight: `Today: ₹${cumRev.toLocaleString("en-IN")} collected across ${cumOrders} ${isMenuDim ? "items" : "orders"} for ${activeCard.name}.`,
      };
    }

    // 2. "7days" -> Exact Last 7 Days (e.g. Sat 5, Sun 6, ..., Fri 11) in Hyderabad IST
    if (dateRange === "7days") {
      const daysLabels: string[] = [];
      const revs: number[] = [];
      const counts: number[] = [];
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      const dailyMap = new Map<string, { rev: number; count: number }>();
      for (const o of allFilteredOrders) {
        const dStr = o.istDateStr || getFastISTParts(o.createdAt).dateStr;
        const cur = dailyMap.get(dStr) || { rev: 0, count: 0 };
        cur.rev += getOrderRev(o);
        cur.count += getOrderCount(o);
        dailyMap.set(dStr, cur);
      }

      for (let i = 6; i >= 0; i--) {
        const dMs = now.getTime() - i * 86400000;
        const dParts = getFastISTParts(dMs);
        const dayIdx = new Date(dMs + IST_OFFSET_MS).getUTCDay();
        const shortName = dayNames[dayIdx];
        const dateNum = new Date(dMs + IST_OFFSET_MS).getUTCDate();
        daysLabels.push(`${shortName} ${dateNum}`);

        const dayStats = dailyMap.get(dParts.dateStr) || { rev: 0, count: 0 };
        revs.push(dayStats.rev);
        counts.push(dayStats.count);
      }

      const cumRev = revs.reduce((a, b) => a + b, 0);
      const cumOrders = counts.reduce((a, b) => a + b, 0);
      const avgRev = Math.round(cumRev / 7);
      const avgOrders = Math.round(cumOrders / 7);

      const base = calculateSameTimeBaseline(filterFn);
      const baselineRev =
        base.baselineRev > 0
          ? base.baselineRev
          : isMenuDim
          ? Math.round(topMetrics.baselineRev * ((activeCard.rev || 1) / (topMetrics.todayRev || 1)))
          : Math.round(cumRev / 7);
      const baselineOrders =
        base.baselineOrders > 0
          ? base.baselineOrders
          : isMenuDim
          ? Math.round(topMetrics.baselineOrders * ((activeCard.orders || 1) / (topMetrics.todayCount || 1)))
          : Math.max(1, Math.round(cumOrders / 7));

      return {
        days: daysLabels,
        rev: revs,
        orders: counts,
        cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
        cumOrders: String(cumOrders),
        avgDailyRev: `₹${avgRev.toLocaleString("en-IN")}`,
        avgDailyOrders: `${avgOrders} / day`,
        baselineRev,
        baselineOrders,
        insight: `Last 7 Days: ${activeCard.revDeltaInsight} • ${activeCard.orderDeltaInsight} vs usual baseline.`,
      };
    }

    // 3. "30days" -> Past 4 Weeks in Hyderabad IST (Midnight to Midnight)
    if (dateRange === "30days") {
      const weeksLabels = ["3 Wks Ago", "2 Wks Ago", "Last Wk", "This Wk"];
      const revs: number[] = [];
      const counts: number[] = [];

      // Calculate IST calendar midnight
      const todayMidnightMs = new Date(`${todayISTStr}T00:00:00+05:30`).getTime();
      const endOfTodayMs = new Date(`${todayISTStr}T23:59:59+05:30`).getTime();

      for (let w = 3; w >= 0; w--) {
        const weekStartMs = todayMidnightMs - (w * 7 + 6) * 86400000;
        const weekEndMs = w === 0 ? endOfTodayMs : todayMidnightMs - ((w - 1) * 7 + 6) * 86400000 - 1;

        const wOrders = allFilteredOrders.filter((o) => {
          const t = new Date(o.createdAt).getTime();
          return t >= weekStartMs && t <= weekEndMs;
        });

        revs.push(wOrders.reduce((s, o) => s + getOrderRev(o), 0));
        counts.push(wOrders.reduce((s, o) => s + getOrderCount(o), 0));
      }

      const cumRev = revs.reduce((a, b) => a + b, 0);
      const cumOrders = counts.reduce((a, b) => a + b, 0);

      return {
        days: weeksLabels,
        rev: revs,
        orders: counts,
        cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
        cumOrders: String(cumOrders),
        avgDailyRev: `₹${Math.round(cumRev / 28).toLocaleString("en-IN")}`,
        avgDailyOrders: `${Math.round(cumOrders / 28)} / day`,
        baselineRev: Math.round(cumRev / 4),
        baselineOrders: Math.round(cumOrders / 4),
        insight: `Last 30 Days: Cumulative ₹${cumRev.toLocaleString("en-IN")} across ${cumOrders} ${isMenuDim ? "items" : "orders"}.`,
      };
    }

    // 4. "custom" -> Real Daily Aggregation between customStart and customEnd
    const sStr = customStart || todayISTStr;
    const eStr = customEnd || todayISTStr;
    const startD = sStr <= eStr ? sStr : eStr;
    const endD = sStr <= eStr ? eStr : sStr;

    const startMs = new Date(`${startD}T00:00:00+05:30`).getTime();
    const endMs = new Date(`${endD}T23:59:59+05:30`).getTime();

    const filtered = allFilteredOrders.filter((o) => {
      if (o.istDateStr) {
        return o.istDateStr >= startD && o.istDateStr <= endD;
      }
      const t = new Date(o.createdAt).getTime();
      return t >= startMs && t <= endMs;
    });

    const cumRev = filtered.reduce((s, o) => s + getOrderRev(o), 0);
    const cumOrders = filtered.reduce((s, o) => s + getOrderCount(o), 0);
    const diffDays = Math.max(1, Math.round((endMs - startMs) / 86400000));

    const daysLabels: string[] = [];
    const revs: number[] = [];
    const counts: number[] = [];

    if (diffDays <= 12) {
      const dailyMap = new Map<string, { rev: number; count: number }>();
      for (const o of filtered) {
        const dKey = o.istDateStr || getFastISTParts(o.createdAt).dateStr;
        const cur = dailyMap.get(dKey) || { rev: 0, count: 0 };
        cur.rev += getOrderRev(o);
        cur.count += getOrderCount(o);
        dailyMap.set(dKey, cur);
      }

      for (let d = 0; d < diffDays; d++) {
        const dayMs = startMs + d * 86400000;
        const dayParts = getFastISTParts(dayMs);
        const dayKey = dayParts.dateStr;
        const dayDate = new Date(dayMs);

        daysLabels.push(formatISTDate(dayDate, { month: "short", day: "numeric" }));
        const stats = dailyMap.get(dayKey) || { rev: 0, count: 0 };
        revs.push(stats.rev);
        counts.push(stats.count);
      }
    } else {
      const numBuckets = 7;
      const bucketDurationMs = (endMs - startMs) / numBuckets;

      for (let b = 0; b < numBuckets; b++) {
        const bStartMs = startMs + b * bucketDurationMs;
        const bEndMs = b === numBuckets - 1 ? endMs + 1 : startMs + (b + 1) * bucketDurationMs;

        const bStartDate = new Date(bStartMs);
        const bEndDate = new Date(bEndMs - 1);

        const startLabel = formatISTDate(bStartDate, { month: "short", day: "numeric" });
        const endLabel = formatISTDate(bEndDate, { month: "short", day: "numeric" });
        daysLabels.push(startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`);

        const bOrders = filtered.filter((o) => {
          const t = new Date(o.createdAt).getTime();
          return t >= bStartMs && t < bEndMs;
        });

        revs.push(bOrders.reduce((s, o) => s + getOrderRev(o), 0));
        counts.push(bOrders.reduce((s, o) => s + getOrderCount(o), 0));
      }
    }

    return {
      days: daysLabels,
      rev: revs,
      orders: counts,
      cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
      cumOrders: String(cumOrders),
      avgDailyRev: `₹${Math.round(cumRev / diffDays).toLocaleString("en-IN")}`,
      avgDailyOrders: `${Math.round(cumOrders / diffDays)} / day`,
      baselineRev: Math.round(cumRev / Math.max(1, daysLabels.length)),
      baselineOrders: Math.round(cumOrders / Math.max(1, daysLabels.length)),
      insight: `Custom Range (${startD} to ${endD}): ₹${cumRev.toLocaleString("en-IN")} across ${cumOrders} orders.`,
    };
  }, [activeCard, dateRange, customStart, customEnd, todayOrders, historicalOrders, now, todayISTStr]);

  // SVG Chart Geometry Calculations
  const chartWidth = 500;
  const chartHeight = 150;
  const startX = 42;
  const startY = 16;
  const days = drilldownData?.days || [];
  const revData = drilldownData?.rev || [];
  const orderData = drilldownData?.orders || [];
  const maxRev = Math.max(100, ...revData, drilldownData?.baselineRev || 0) * 1.15;
  const maxOrders = Math.max(5, ...orderData, drilldownData?.baselineOrders || 0) * 1.25;
  const colSpacing = (chartWidth - startX - 20) / Math.max(1, days.length);
  const barWidth = Math.max(12, Math.min(32, Math.floor(colSpacing * 0.55)));

  const handleRefreshClick = () => {
    if (propOnRefresh) {
      propOnRefresh();
    } else {
      loadData({ fullHistorical: true });
    }
  };

  const isRefreshing = propIsRefreshing || localRefreshing;

  // Smooth skeleton screen on initial mount to eliminate "flash of zeros"
  if (loading && !hasFetched && (!propTodayOrders || propTodayOrders.length === 0)) {
    return (
      <div className="restaurant-iq-page">
        <header className="iq-top-header">
          <div className="header-left">
            <div className="restaurant-title-wrap">
              <div className="skel-block skel-title" />
              <div className="skel-block skel-badge" />
            </div>
            <div className="header-meta">
              <div className="skel-block skel-chip" />
              <div className="skel-block skel-chip" />
            </div>
          </div>
        </header>

        <section className="kpi-hero-section">
          {[1, 2, 3].map((k) => (
            <div key={k} className="kpi-hero-card">
              <div className="skel-block skel-line-sm" />
              <div className="skel-block skel-num" />
              <div className="skel-block skel-line-full" />
            </div>
          ))}
        </section>

        <section className="dimension-selector-section">
          <div className="skel-block skel-tabs" />
        </section>

        <div className="dashboard-body-grid">
          <div className="metric-cards-column">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="paper-breakdown-card">
                <div className="skel-block skel-line-md" />
                <div className="skel-block skel-card-body" />
              </div>
            ))}
          </div>
          <div className="drilldown-detail-column">
            <div className="drilldown-paper-card">
              <div className="skel-block skel-line-lg" />
              <div className="skel-block skel-chart-box" />
            </div>
          </div>
        </div>

        <style jsx>{`
          .restaurant-iq-page {
            min-height: 100vh;
            background: #faf7f2;
            padding: 20px 24px;
            display: flex;
            flex-direction: column;
            gap: 18px;
          }
          .skel-block {
            background: linear-gradient(90deg, #ede7dc 25%, #f7f3ed 50%, #ede7dc 75%);
            background-size: 200% 100%;
            animation: skel-shimmer 1.5s infinite ease-in-out;
            border-radius: 8px;
          }
          @keyframes skel-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          .skel-title { width: 220px; height: 28px; }
          .skel-badge { width: 95px; height: 22px; border-radius: 999px; }
          .skel-chip { width: 140px; height: 22px; border-radius: 999px; }
          .skel-line-sm { width: 120px; height: 16px; margin-bottom: 8px; }
          .skel-num { width: 160px; height: 36px; margin-bottom: 12px; }
          .skel-line-full { width: 100%; height: 20px; }
          .skel-tabs { width: 340px; height: 38px; border-radius: 12px; }
          .skel-line-md { width: 50%; height: 20px; margin-bottom: 12px; }
          .skel-card-body { width: 100%; height: 50px; }
          .skel-line-lg { width: 45%; height: 26px; margin-bottom: 16px; }
          .skel-chart-box { width: 100%; height: 200px; border-radius: 12px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="restaurant-iq-page">
      {/* 1. TOP BRANDED HEADER (HYDERABAD TIMEZONE) */}
      <header className="iq-top-header">
        <div className="header-left">
          <div className="restaurant-title-wrap">
            <h1 className="restaurant-title">{restaurantName}</h1>
            <span className="live-pacing-tag">
              <span className="pulsing-live-dot" /> LIVE PACING
            </span>
          </div>
          <div className="header-meta">
            <span className="date-chip">
              <Calendar size={13} className="meta-icon" />
              {dateFormatted}
            </span>
            <span className="shift-chip">
              <Clock size={13} className="meta-icon" />
              {currentShiftBadge}
            </span>
          </div>
        </div>

        <div className="header-right">
          <button
            className={`action-btn refresh-btn ${isRefreshing ? "spin" : ""}`}
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            title="Refresh Live Data"
          >
            <RefreshCw size={15} />
            <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
          </button>

          {onLogout && (
            <button className="action-btn logout-btn" onClick={onLogout}>
              Logout
            </button>
          )}
        </div>
      </header>

      {/* 2. TOP ROW - TOTAL REVENUE & ORDERS BENCHMARK CARDS */}
      <section className="kpi-top-grid">
        {/* TOTAL REVENUE CARD */}
        <div className="paper-kpi-card revenue-card">
          <div className="kpi-card-header">
            <div className="kpi-title-box">
              <span className="kpi-sub-title">Total Gross Revenue (Today)</span>
              <h2 className="kpi-value">
                ₹{topMetrics.todayRev.toLocaleString("en-IN")}
              </h2>
            </div>
            <div
              className={`growth-pill ${
                topMetrics.revUp ? "positive" : "negative"
              }`}
            >
              {topMetrics.revUp ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowDownRight size={14} />
              )}
              <span>{topMetrics.revGrowthPct}</span>
            </div>
          </div>

          <div className="kpi-benchmark-row">
            <div className="benchmark-stat">
              <span className="benchmark-label">
                Usual {weekdayName} (Same Time):
              </span>
              <strong className="benchmark-val">
                ₹{Math.round(topMetrics.baselineRev).toLocaleString("en-IN")}
              </strong>
            </div>
            <div
              className={`delta-tag ${
                topMetrics.revUp ? "positive" : "negative"
              }`}
            >
              💡 {topMetrics.revUp ? "+" : "-"}₹
              {Math.abs(topMetrics.revDelta).toLocaleString("en-IN")}{" "}
              {topMetrics.revUp ? "UP" : "DOWN"}
            </div>
          </div>
          <p className="benchmark-caption">
            *Compared to the average of last 3 {weekdayName}s at this exact same
            time of day.
          </p>
        </div>

        {/* TOTAL ORDERS CARD */}
        <div className="paper-kpi-card orders-card">
          <div className="kpi-card-header">
            <div className="kpi-title-box">
              <span className="kpi-sub-title">Total Orders & Bills (Today)</span>
              <h2 className="kpi-value">
                {topMetrics.todayCount}{" "}
                <span className="kpi-unit">orders</span>
              </h2>
            </div>
            <div
              className={`growth-pill ${
                topMetrics.ordersUp ? "positive" : "negative"
              }`}
            >
              {topMetrics.ordersUp ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowDownRight size={14} />
              )}
              <span>
                {topMetrics.ordersGrowthPct}{" "}
                <sub className="delta-subscript">
                  ({topMetrics.ordersDelta >= 0 ? "+" : ""}
                  {topMetrics.ordersDelta})
                </sub>
              </span>
            </div>
          </div>

          <div className="kpi-benchmark-row">
            <div className="benchmark-stat">
              <span className="benchmark-label">
                Usual {weekdayName} (Same Time):
              </span>
              <strong className="benchmark-val">
                {topMetrics.baselineOrders} orders
              </strong>
            </div>
            <div
              className={`delta-tag ${
                topMetrics.ordersUp ? "positive" : "negative"
              }`}
            >
              💡 {Math.abs(topMetrics.ordersDelta)} Orders{" "}
              {topMetrics.ordersUp ? "UP" : "DOWN"}
            </div>
          </div>
          <p className="benchmark-caption">
            *Pacing trajectory based on historical 3-week volume up to current hour
            to predict closing.
          </p>
        </div>
      </section>

      {/* 3. 3-WAY DIMENSION SWITCHER */}
      <section className="dimension-selector-section">
        <div className="dimension-pill-nav">
          <button
            className={`dim-tab-btn ${
              dimension === "channels" ? "active" : ""
            }`}
            onClick={() => {
              setDimension("channels");
              setSelectedItemId("ZOMATO");
            }}
          >
            🛵 Channels & Sources
          </button>
          <button
            className={`dim-tab-btn ${dimension === "hours" ? "active" : ""}`}
            onClick={() => {
              setDimension("hours");
              setSelectedItemId("evening");
            }}
          >
            ⏰ Shift & Hour Split
          </button>
          <button
            className={`dim-tab-btn ${dimension === "menu" ? "active" : ""}`}
            onClick={() => {
              setDimension("menu");
              setSelectedItemId("Rice & Biryani");
            }}
          >
            🍛 Menu Categories
          </button>
        </div>
        <span className="dimension-hint">
          Click any card below to drill down into 7-day trends & cumulative volume
        </span>
      </section>

      {/* 4. MAIN CONTENT GRID (CARDS LIST + DEEP DRILLDOWN) */}
      <div className="dashboard-body-grid">
        {/* CARDS LIST WITH STRICT TWO-COLUMN DELTAS */}
        <div className="metric-cards-column">
          {currentDimensionCards.map((item) => {
            const isSelected = item.id === activeCard?.id;
            return (
              <div
                key={item.id}
                className={`paper-breakdown-card ${
                  isSelected ? "selected-card" : ""
                }`}
                onClick={() => setSelectedItemId(item.id)}
              >
                {/* CARD TOP ROW */}
                <div className="item-card-top">
                  <div className="item-identity">
                    <span
                      className="item-icon-bubble"
                      style={{ backgroundColor: item.iconBg }}
                    >
                      {item.icon}
                    </span>
                    <span className="item-name">{item.name}</span>
                  </div>
                  <span
                    className="item-tag"
                    style={{
                      backgroundColor: item.tagColor,
                      color: item.tagTextColor,
                    }}
                  >
                    {item.tag}
                  </span>
                </div>

                {/* STRICT TWO-COLUMN SPLIT */}
                <div className="card-columns-grid">
                  {/* LEFT COLUMN: REVENUE */}
                  <div className="card-column revenue-col">
                    <span className="col-label">Revenue</span>
                    <div className="col-main-val">
                      <span className="val-text">
                        ₹{item.rev.toLocaleString("en-IN")}
                      </span>
                      <span
                        className={`mini-growth ${
                          item.revUp ? "positive" : "negative"
                        }`}
                      >
                        {item.revGrowth}
                      </span>
                    </div>
                    {/* HARD ₹ DELTA INSIGHT DIRECTLY BELOW REVENUE */}
                    <div
                      className={`column-delta-footer ${
                        item.revUp ? "pos-footer" : "neg-footer"
                      }`}
                    >
                      💡 {item.revDeltaInsight}
                    </div>
                  </div>

                  {/* RIGHT COLUMN: ORDERS */}
                  <div className="card-column orders-col">
                    <span className="col-label">Orders</span>
                    <div className="col-main-val">
                      <span className="val-text">{item.orders}</span>
                      <span
                        className={`mini-growth ${
                          item.orderUp ? "positive" : "negative"
                        }`}
                      >
                        {item.orderGrowth}{" "}
                        <sub className="delta-subscript">
                          ({item.orderDelta})
                        </sub>
                      </span>
                    </div>
                    {/* HARD ORDER DELTA INSIGHT DIRECTLY BELOW ORDERS */}
                    <div
                      className={`column-delta-footer ${
                        item.orderUp ? "pos-footer" : "neg-footer"
                      }`}
                    >
                      💡 {item.orderDeltaInsight}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* INTERACTIVE DRILLDOWN PANEL */}
        {drilldownData && activeCard && (
          <div className="drilldown-detail-column">
            <div className="drilldown-paper-card">
              {/* DRILLDOWN HEADER */}
              <div className="drilldown-header">
                <div className="drilldown-identity">
                  <span
                    className="drilldown-icon"
                    style={{ backgroundColor: activeCard.iconBg }}
                  >
                    {activeCard.icon}
                  </span>
                  <div>
                    <h3 className="drilldown-title">{activeCard.name}</h3>
                    <span className="drilldown-subtitle">
                      In-depth performance & 7-day velocity pacing
                    </span>
                  </div>
                </div>

                {/* DATE RANGE FILTER BUTTONS */}
                <div className="date-filter-group">
                  <button
                    className={`filter-btn ${
                      dateRange === "today" ? "active" : ""
                    }`}
                    onClick={() => setDateRange("today")}
                  >
                    Today
                  </button>
                  <button
                    className={`filter-btn ${
                      dateRange === "7days" ? "active" : ""
                    }`}
                    onClick={() => setDateRange("7days")}
                  >
                    Last 7 Days
                  </button>
                  <button
                    className={`filter-btn ${
                      dateRange === "30days" ? "active" : ""
                    }`}
                    onClick={() => setDateRange("30days")}
                  >
                    Last 30 Days
                  </button>
                  <button
                    className={`filter-btn ${
                      dateRange === "custom" ? "active" : ""
                    }`}
                    onClick={() => setDateRange("custom")}
                  >
                    🗓️ Custom
                  </button>
                </div>
              </div>

              {/* CUSTOM DATE RANGE PICKER INPUTS */}
              {dateRange === "custom" && (
                <div className="custom-dates-bar">
                  <div className="date-input-wrap">
                    <label>From:</label>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || todayISTStr}
                      onChange={(e) => {
                        if (e.target.value) setCustomStart(e.target.value);
                      }}
                    />
                  </div>
                  <div className="date-input-wrap">
                    <label>To:</label>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart}
                      max={todayISTStr}
                      onChange={(e) => {
                        if (e.target.value) setCustomEnd(e.target.value);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* 2 CUMULATIVE CARDS */}
              <div className="cumulative-cards-grid">
                <div className="cumulative-card rev-cum">
                  <span className="cum-label">Cumulative Revenue</span>
                  <div className="cum-val-row">
                    <span className="cum-number">{drilldownData.cumRev}</span>
                  </div>
                  <div className="cum-footer">
                    <span>
                      Daily Avg: <strong>{drilldownData.avgDailyRev}</strong>
                    </span>
                    <span className="cum-period-tag">
                      {dateRange === "today"
                        ? "Today"
                        : dateRange === "7days"
                        ? "7 Days"
                        : dateRange === "30days"
                        ? "30 Days"
                        : "Selected"}
                    </span>
                  </div>
                </div>

                <div className="cumulative-card orders-cum">
                  <span className="cum-label">
                    {dimension === "menu" ? "Cumulative Items Sold" : "Cumulative Orders"}
                  </span>
                  <div className="cum-val-row">
                    <span className="cum-number">{drilldownData.cumOrders}</span>
                    <span className="cum-unit">{dimension === "menu" ? "items" : "orders"}</span>
                  </div>
                  <div className="cum-footer">
                    <span>
                      Daily Avg: <strong>{drilldownData.avgDailyOrders}</strong>
                    </span>
                    <span className="cum-period-tag blue">
                      {dateRange === "today"
                        ? "Today"
                        : dateRange === "7days"
                        ? "7 Days"
                        : dateRange === "30days"
                        ? "30 Days"
                        : "Selected"}
                    </span>
                  </div>
                </div>
              </div>

              {/* DAILY TREND GRAPH WITH PACING BASELINE */}
              <div className="trend-graph-container">
                <div className="graph-toolbar">
                  <div>
                    <h4 className="graph-heading">
                      📈 Daily Trend Graph (
                      {dateRange === "today"
                        ? "Hourly Today"
                        : dateRange === "7days"
                        ? "Last 7 Days"
                        : dateRange === "30days"
                        ? "Last 4 Weeks"
                        : "Custom Period"}
                      )
                    </h4>
                    <span className="graph-subheading">
                      Pacing vs Usual {weekdayName} Baseline
                    </span>
                  </div>

                  <div className="graph-mode-toggle">
                    <button
                      className={`mode-btn ${
                        graphMetric === "both" ? "active" : ""
                      }`}
                      onClick={() => setGraphMetric("both")}
                    >
                      Both
                    </button>
                    <button
                      className={`mode-btn ${
                        graphMetric === "rev" ? "active" : ""
                      }`}
                      onClick={() => setGraphMetric("rev")}
                    >
                      Revenue
                    </button>
                    <button
                      className={`mode-btn ${
                        graphMetric === "orders" ? "active" : ""
                      }`}
                      onClick={() => setGraphMetric("orders")}
                    >
                      Orders
                    </button>
                  </div>
                </div>

                {/* CUSTOM SVG CHART */}
                <div className="svg-chart-wrapper">
                  {revData.every((r) => r === 0) && orderData.every((o) => o === 0) ? (
                    <div className="chart-empty-state">
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>📊</div>
                      <div style={{ fontWeight: 700, fontSize: "14px", color: "#1c1917" }}>
                        No {activeCard.name} orders recorded
                      </div>
                      <div style={{ fontSize: "12px", color: "#78716c", marginTop: "4px" }}>
                        0 orders were placed for {activeCard.name} during this {dateRange === "today" ? "shift today" : dateRange === "7days" ? "7-day period" : dateRange === "30days" ? "30-day period" : "selected custom range"}.
                      </div>
                    </div>
                  ) : (
                    <svg
                      key={`interactive-svg-${activeCard?.id || "card"}-${dateRange}-${customStart}-${customEnd}-${graphMetric}-${days.length}`}
                      viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
                      className="interactive-svg"
                    >
                      {/* Grid Lines */}
                      <line
                        x1={startX}
                        y1={startY}
                        x2={chartWidth - 10}
                        y2={startY}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                      />
                      <line
                        x1={startX}
                        y1={startY + chartHeight / 2}
                        x2={chartWidth - 10}
                        y2={startY + chartHeight / 2}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                      />
                      <line
                        x1={startX}
                        y1={startY + chartHeight}
                        x2={chartWidth - 10}
                        y2={startY + chartHeight}
                        stroke="currentColor"
                        strokeOpacity="0.15"
                      />

                      {/* Revenue Baseline Dashed Line */}
                      {drilldownData.baselineRev > 0 &&
                        (graphMetric === "both" || graphMetric === "rev") && (() => {
                          const baseVal = drilldownData.baselineRev;
                          const baseY =
                            startY + chartHeight - (baseVal / maxRev) * chartHeight;
                          return (
                            <g key={`baseline-rev-${activeCard?.id}-${dateRange}`}>
                              <line
                                x1={startX}
                                y1={baseY}
                                x2={chartWidth - 10}
                                y2={baseY}
                                stroke="#71717a"
                                strokeDasharray="4,4"
                                strokeWidth="1.2"
                                opacity="0.65"
                              />
                              <text
                                x={chartWidth - 15}
                                y={baseY - 4}
                                textAnchor="end"
                                fontSize="8"
                                fill="#71717a"
                                fontWeight="700"
                              >
                                Base ({baseVal >= 1000 ? `₹${(baseVal / 1000).toFixed(1)}k` : `₹${Math.round(baseVal)}`})
                              </text>
                            </g>
                          );
                        })()}

                      {/* Orders Baseline Dashed Line */}
                      {drilldownData.baselineOrders > 0 &&
                        graphMetric === "orders" && (() => {
                          const baseOrders = drilldownData.baselineOrders;
                          const baseY =
                            startY + chartHeight - (baseOrders / maxOrders) * chartHeight;
                          return (
                            <g key={`baseline-orders-${activeCard?.id}-${dateRange}`}>
                              <line
                                x1={startX}
                                y1={baseY}
                                x2={chartWidth - 10}
                                y2={baseY}
                                stroke="#71717a"
                                strokeDasharray="4,4"
                                strokeWidth="1.2"
                                opacity="0.65"
                              />
                              <text
                                x={chartWidth - 15}
                                y={baseY - 4}
                                textAnchor="end"
                                fontSize="8"
                                fill="#71717a"
                                fontWeight="700"
                              >
                                Base ({baseOrders} orders)
                              </text>
                            </g>
                          );
                        })()}

                      {/* Bars & X-Axis */}
                      {days.map((day, i) => {
                        const xCenter =
                          startX + i * colSpacing + colSpacing / 2;
                        const r = revData[i] || 0;
                        const barH = (r / maxRev) * chartHeight;
                        const barY = startY + chartHeight - barH;
                        const barX = xCenter - barWidth / 2;
                        const isTodayBar =
                          dateRange === "today" ||
                          (dateRange === "7days" && i === days.length - 1) ||
                          (dateRange === "custom" && customEnd === todayISTStr && i === days.length - 1);

                        return (
                          <g key={`bar-group-${activeCard?.id}-${dateRange}-${i}-${day}`}>
                            {/* Revenue Bar: Render ONLY if revenue > 0 */}
                            {(graphMetric === "both" || graphMetric === "rev") && r > 0 && (
                              <>
                                <rect
                                  x={barX}
                                  y={barY}
                                  width={barWidth}
                                  height={Math.max(4, barH)}
                                  rx={3}
                                  fill={
                                    isTodayBar
                                      ? "#f97316"
                                      : "rgba(249, 115, 22, 0.65)"
                                  }
                                  className="chart-bar"
                                />
                                <text
                                  x={xCenter}
                                  y={Math.max(startY + 8, barY - 5)}
                                  textAnchor="middle"
                                  fontSize="8.5"
                                  fontWeight="700"
                                  fill="currentColor"
                                  opacity={isTodayBar ? 1 : 0.8}
                                >
                                  {r >= 1000 ? `₹${(r / 1000).toFixed(1)}k` : `₹${Math.round(r)}`}
                                </text>
                              </>
                            )}

                            {/* X-Axis Label */}
                            <text
                              x={xCenter}
                              y={startY + chartHeight + 18}
                              textAnchor="middle"
                              fontSize="8.5"
                              fontWeight={isTodayBar ? "700" : "500"}
                              fill={isTodayBar ? "#f97316" : "currentColor"}
                              opacity={isTodayBar ? 1 : 0.65}
                            >
                              {day}
                            </text>
                          </g>
                        );
                      })}

                      {/* Order Line Path */}
                      {(graphMetric === "both" || graphMetric === "orders") && (() => {
                        const pts = days.map((day, i) => {
                          const x =
                            startX + i * colSpacing + colSpacing / 2;
                          const o = orderData[i] || 0;
                          const y =
                            startY +
                            chartHeight -
                            (o / maxOrders) * chartHeight;
                          return {
                            x,
                            y,
                            orders: o,
                            isToday:
                              dateRange === "today" ||
                              (dateRange === "7days" && i === days.length - 1) ||
                              (dateRange === "custom" && customEnd === todayISTStr && i === days.length - 1),
                          };
                        });

                        if (pts.length === 0) return null;

                        let d = `M ${pts[0].x} ${pts[0].y}`;
                        for (let i = 1; i < pts.length; i++) {
                          const prev = pts[i - 1];
                          const curr = pts[i];
                          const cx1 = prev.x + (curr.x - prev.x) / 2;
                          const cx2 = prev.x + (curr.x - prev.x) / 2;
                          d += ` C ${cx1} ${prev.y}, ${cx2} ${curr.y}, ${curr.x} ${curr.y}`;
                        }

                        return (
                          <g key={`line-series-${activeCard?.id}-${dateRange}`}>
                            <path
                              d={d}
                              fill="none"
                              stroke="#60a5fa"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />
                            {pts.map((pt, idx) => (
                              <g key={`pt-${activeCard?.id}-${dateRange}-${idx}-${pt.x}`}>
                                {pt.orders > 0 && (
                                  <>
                                    <circle
                                      cx={pt.x}
                                      cy={pt.y}
                                      r={pt.isToday ? 4 : 3}
                                      fill="#1e40af"
                                      stroke="#60a5fa"
                                      strokeWidth="2"
                                    />
                                    <text
                                      x={pt.x}
                                      y={pt.y + (graphMetric === "orders" ? -8 : 13)}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontWeight="700"
                                      fill="#60a5fa"
                                    >
                                      {pt.orders}
                                    </text>
                                  </>
                                )}
                              </g>
                            ))}
                          </g>
                        );
                      })()}
                    </svg>
                  )}
                </div>

                {/* Legend */}
                <div className="graph-footer-legend">
                  <div className="legend-items">
                    {(graphMetric === "both" || graphMetric === "rev") && (
                      <span className="legend-entry">
                        <span className="color-swatch rev" /> Revenue (₹)
                      </span>
                    )}
                    {(graphMetric === "both" || graphMetric === "orders") && (
                      <span className="legend-entry">
                        <span className="color-swatch orders" /> {dimension === "menu" ? "Items (Count)" : "Orders (Count)"}
                      </span>
                    )}
                  </div>
                  <span className="baseline-legend-entry">
                    <span className="dashed-swatch" /> Usual {weekdayName} Base
                  </span>
                </div>
              </div>

              {/* PERFORMANCE SUMMARY CARD */}
              <div className="drilldown-summary-box">
                <span className="summary-badge">
                  💡 Performance Summary for Selected Date Range
                </span>
                <p className="summary-text">{drilldownData.insight}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. CREATIVE BRANDED RIBBON FOOTER */}
      <footer className="branded-ribbon-footer">
        <div className="footer-glow-line" />
        <div className="footer-content">
          <span className="iq-badge">IQ</span>
          <div className="footer-title-text">
            <span className="brand-name">Restaurant IQ</span>
            <span className="bullet-sep">•</span>
            <span className="brand-tagline">Restaurant Business Made Simpler</span>
          </div>
        </div>
      </footer>

      {/* STYLED-JSX FOR ROCK-SOLID, ZERO-DEPENDENCY STYLING */}
      <style jsx>{`
        .restaurant-iq-page {
          min-height: 100vh;
          background: #faf7f2;
          color: #1c1917;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        /* 1. Header */
        .iq-top-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 14px;
          background: #ffffff;
          padding: 16px 20px;
          border-radius: 14px;
          border: 1px solid #ede7dc;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        .restaurant-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .restaurant-title {
          font-size: 22px;
          font-weight: 800;
          color: #1c1917;
          margin: 0;
          letter-spacing: -0.4px;
        }

        .live-pacing-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 800;
          background: #eaf6ee;
          color: #167a49;
          border: 1px solid #bfe3cc;
          padding: 3px 9px;
          border-radius: 999px;
          letter-spacing: 0.4px;
        }

        .pulsing-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #167a49;
          box-shadow: 0 0 0 2px rgba(22, 122, 73, 0.25);
          animation: pulse 1.8s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }

        .header-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 6px;
          flex-wrap: wrap;
        }

        .location-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 700;
          color: #047857;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 3px 9px;
          border-radius: 6px;
        }

        .tz-flag {
          font-size: 12px;
        }

        .date-chip, .shift-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          font-weight: 600;
          color: #78716c;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .shift-chip {
          background: #fef9ee;
          color: #b47814;
          border-color: #fde68a;
          font-weight: 700;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .action-btn {
          border: 0;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease;
        }

        .refresh-btn {
          background: #f97316;
          color: #ffffff;
        }

        .refresh-btn:hover {
          background: #ea580c;
        }

        .refresh-btn.spin svg {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .logout-btn {
          background: #faf7f2;
          border: 1px solid #ede7dc;
          color: #78716c;
        }

        .logout-btn:hover {
          background: #fef2f2;
          color: #ef4444;
          border-color: #fecaca;
        }

        /* 2. Top KPI Cards */
        .kpi-top-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        @media (max-width: 768px) {
          .kpi-top-grid {
            grid-template-columns: 1fr;
          }
        }

        .paper-kpi-card {
          background: #ffffff;
          border: 1px solid #ede7dc;
          border-radius: 14px;
          padding: 18px 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .kpi-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .kpi-sub-title {
          font-size: 12px;
          font-weight: 700;
          color: #78716c;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .kpi-value {
          font-size: 32px;
          font-weight: 800;
          color: #1c1917;
          margin: 4px 0 0;
          letter-spacing: -0.6px;
        }

        .kpi-unit {
          font-size: 15px;
          font-weight: 600;
          color: #a8a29e;
        }

        .growth-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
        }

        .growth-pill.positive {
          background: #eaf6ee;
          color: #167a49;
          border: 1px solid #bfe3cc;
        }

        .growth-pill.negative {
          background: #fdf0ee;
          color: #c23820;
          border: 1px solid #f6c8c0;
        }

        .delta-subscript {
          font-size: 11px;
          font-weight: 700;
          opacity: 0.85;
          margin-left: 2px;
        }

        .kpi-benchmark-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px 12px;
          background: #faf7f2;
          border-radius: 10px;
          border: 1px solid #ede7dc;
        }

        .benchmark-stat {
          font-size: 12.5px;
          color: #78716c;
        }

        .benchmark-label {
          margin-right: 5px;
        }

        .benchmark-val {
          color: #1c1917;
          font-weight: 700;
        }

        .delta-tag {
          font-size: 12px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .delta-tag.positive {
          background: #eaf6ee;
          color: #167a49;
          border: 1px solid #bfe3cc;
        }

        .delta-tag.negative {
          background: #fdf0ee;
          color: #c23820;
          border: 1px solid #f6c8c0;
        }

        .benchmark-caption {
          font-size: 10.5px;
          color: #a8a29e;
          margin: 0;
          font-style: italic;
        }

        /* 3. Dimension Selector */
        .dimension-selector-section {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .dimension-pill-nav {
          display: flex;
          background: #ffffff;
          padding: 4px;
          border-radius: 12px;
          border: 1px solid #ede7dc;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
          gap: 4px;
        }

        .dim-tab-btn {
          border: 0;
          background: transparent;
          font-size: 12.5px;
          font-weight: 700;
          padding: 8px 16px;
          border-radius: 9px;
          color: #78716c;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .dim-tab-btn.active {
          background: #f97316;
          color: #ffffff;
          box-shadow: 0 2px 5px rgba(249, 115, 22, 0.25);
        }

        .dimension-hint {
          font-size: 11.5px;
          color: #a8a29e;
          font-weight: 600;
        }

        /* 4. Dashboard Body Grid */
        .dashboard-body-grid {
          display: grid;
          grid-template-columns: 380px 1fr;
          gap: 18px;
          align-items: start;
        }

        @media (max-width: 1024px) {
          .dashboard-body-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Metric Cards Column */
        .metric-cards-column {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .paper-breakdown-card {
          background: #ffffff;
          border: 1.5px solid #ede7dc;
          border-radius: 14px;
          padding: 14px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .paper-breakdown-card:hover {
          transform: translateY(-2px);
          border-color: #f97316;
          box-shadow: 0 4px 12px rgba(249, 115, 22, 0.08);
        }

        .paper-breakdown-card.selected-card {
          border-color: #f97316;
          background: #fffbf7;
          box-shadow: 0 0 0 1px #f97316, 0 4px 12px rgba(249, 115, 22, 0.1);
        }

        .item-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .item-identity {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .item-icon-bubble {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          color: #ffffff;
          font-weight: 800;
          font-size: 13px;
        }

        .item-name {
          font-size: 14px;
          font-weight: 700;
          color: #1c1917;
        }

        .item-tag {
          font-size: 10.5px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 6px;
        }

        /* Strict Two-Column Split */
        .card-columns-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          border-top: 1px solid #ede7dc;
          padding-top: 10px;
        }

        .card-column {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .card-column.revenue-col {
          border-right: 1px solid #ede7dc;
          padding-right: 8px;
        }

        .col-label {
          font-size: 10.5px;
          font-weight: 700;
          color: #a8a29e;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .col-main-val {
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }

        .val-text {
          font-size: 17px;
          font-weight: 800;
          color: #1c1917;
        }

        .mini-growth {
          font-size: 11px;
          font-weight: 800;
        }

        .mini-growth.positive {
          color: #167a49;
        }

        .mini-growth.negative {
          color: #c23820;
        }

        .column-delta-footer {
          margin-top: 4px;
          font-size: 11px;
          font-weight: 700;
          padding: 4px 6px;
          border-radius: 6px;
          display: inline-block;
          white-space: nowrap;
        }

        .column-delta-footer.pos-footer {
          background: #eaf6ee;
          color: #167a49;
          border: 1px solid #bfe3cc;
        }

        .column-delta-footer.neg-footer {
          background: #fdf0ee;
          color: #c23820;
          border: 1px solid #f6c8c0;
        }

        /* Drilldown Column */
        .drilldown-detail-column {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .drilldown-paper-card {
          background: #ffffff;
          border: 1px solid #ede7dc;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .drilldown-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }

        .drilldown-identity {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .drilldown-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          color: #ffffff;
          font-weight: 800;
          font-size: 16px;
        }

        .drilldown-title {
          font-size: 18px;
          font-weight: 800;
          color: #1c1917;
          margin: 0 0 2px;
        }

        .drilldown-subtitle {
          font-size: 12px;
          color: #78716c;
        }

        .date-filter-group {
          display: flex;
          background: #faf7f2;
          padding: 3px;
          border-radius: 10px;
          border: 1px solid #ede7dc;
          gap: 3px;
        }

        .filter-btn {
          border: 0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 7px;
          color: #78716c;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .filter-btn.active {
          background: #f97316;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(249, 115, 22, 0.25);
        }

        .custom-dates-bar {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          padding: 8px 14px;
          border-radius: 10px;
        }

        .date-input-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #78716c;
        }

        .date-input-wrap input {
          border: 1px solid #ede7dc;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 12px;
          background: #ffffff;
        }

        /* 2 Cumulative Cards */
        .cumulative-cards-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        @media (max-width: 640px) {
          .cumulative-cards-grid {
            grid-template-columns: 1fr;
          }
        }

        .cumulative-card {
          background: #fffbf7;
          border: 1px solid #fed7aa;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cumulative-card.orders-cum {
          background: #f0f7ff;
          border-color: #bfdbfe;
        }

        .cum-label {
          font-size: 11px;
          font-weight: 700;
          color: #78716c;
          text-transform: uppercase;
        }

        .cum-val-row {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .cum-number {
          font-size: 26px;
          font-weight: 800;
          color: #1c1917;
        }

        .cum-unit {
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }

        .cum-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: #78716c;
          margin-top: 4px;
          border-top: 1px dashed rgba(0, 0, 0, 0.08);
          padding-top: 6px;
        }

        .cum-period-tag {
          font-size: 10.5px;
          font-weight: 800;
          color: #ea580c;
        }

        .cum-period-tag.blue {
          color: #2563eb;
        }

        /* Trend Graph */
        .trend-graph-container {
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 14px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .graph-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .graph-heading {
          font-size: 13px;
          font-weight: 800;
          color: #1c1917;
          margin: 0 0 2px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .graph-subheading {
          font-size: 11px;
          color: #78716c;
        }

        .graph-mode-toggle {
          display: flex;
          background: #ffffff;
          padding: 2px;
          border-radius: 8px;
          border: 1px solid #ede7dc;
        }

        .mode-btn {
          border: 0;
          background: transparent;
          font-size: 10.5px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 6px;
          color: #78716c;
          cursor: pointer;
        }

        .mode-btn.active {
          background: #f97316;
          color: #ffffff;
        }

        .svg-chart-wrapper {
          position: relative;
          width: 100%;
          overflow-x: auto;
        }

        .chart-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 36px 16px;
          text-align: center;
          background: rgba(255, 255, 255, 0.6);
          border-radius: 10px;
          border: 1px dashed #ede7dc;
        }

        .interactive-svg {
          width: 100%;
          height: auto;
          display: block;
          overflow: visible;
        }

        .chart-bar {
          transition: all 0.2s ease;
        }

        .chart-bar:hover {
          filter: brightness(1.1);
        }

        .graph-footer-legend {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: #78716c;
          border-top: 1px solid #ede7dc;
          padding-top: 8px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .legend-items {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .legend-entry, .baseline-legend-entry {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }

        .color-swatch {
          width: 10px;
          height: 10px;
          border-radius: 3px;
        }

        .color-swatch.rev {
          background: #f97316;
        }

        .color-swatch.orders {
          background: #60a5fa;
          border-radius: 50%;
        }

        .dashed-swatch {
          width: 14px;
          height: 0;
          border-top: 2px dashed #71717a;
        }

        /* Summary Box */
        .drilldown-summary-box {
          background: #fff7ed;
          border: 1px solid #ffedd5;
          border-radius: 12px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .summary-badge {
          font-size: 11.5px;
          font-weight: 800;
          color: #ea580c;
        }

        .summary-text {
          font-size: 12px;
          font-weight: 600;
          color: #1c1917;
          margin: 0;
          line-height: 1.4;
        }

        /* 5. Creative Branded Ribbon Footer */
        .branded-ribbon-footer {
          position: relative;
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid #ede7dc;
          padding: 14px 20px;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          margin-top: 8px;
        }

        .footer-glow-line {
          position: absolute;
          inset: 0 auto auto 0;
          width: 100%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #f97316, transparent);
        }

        .footer-content {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .iq-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: linear-gradient(135deg, #f97316, #d97706);
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: -0.5px;
          box-shadow: 0 2px 4px rgba(249, 115, 22, 0.2);
        }

        .footer-title-text {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.2px;
        }

        .brand-name {
          color: #1c1917;
        }

        .bullet-sep {
          color: #f97316;
        }

        .brand-tagline {
          background: linear-gradient(90deg, #ea580c, #d97706);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}
