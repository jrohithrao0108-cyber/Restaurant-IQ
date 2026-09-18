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

// mv_orders_summary has no per-item category data (it's pre-aggregated
// by day/hour/order_type/payment_mode), so the monthly trend's "Menu
// category" split reads raw order_items directly instead — this is the
// minimal shape needed for that: just enough to date-bucket each item
// by its parent order's created_at and re-derive its category.
const MONTHLY_MENU_CATEGORY_SELECT = `
  created_at,
  order_items (
    price_snapshot,
    qty,
    menu_items ( category )
  )
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

// Compact number formatting for bar-chart data labels — Indian-style
// K/Lakhs rounding so labels stay short on mobile widths: plain 3-digit
// numbers under 1,000, "12.3K" from 1,000-99,999, "2.14L" from 1,00,000
// up. Pass isCurrency to prepend ₹ (used for revenue; order counts are
// passed through without it).
function formatCompactNumber(value: number, isCurrency: boolean): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const prefix = isCurrency ? "₹" : "";
  if (abs >= 100000) {
    const lakhs = abs / 100000;
    return `${sign}${prefix}${lakhs.toFixed(lakhs % 1 === 0 ? 0 : 2)}L`;
  }
  if (abs >= 1000) {
    const thousands = abs / 1000;
    return `${sign}${prefix}${thousands.toFixed(thousands % 1 === 0 ? 0 : 1)}K`;
  }
  return `${sign}${prefix}${Math.round(abs).toLocaleString("en-IN")}`;
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
  // How far back internalHistoricalOrders currently covers (IST date
  // string). Used to detect when a custom range picks a start date further
  // back than what's loaded, so that can be fetched on demand instead of
  const [loadedHistoryStartStr, setLoadedHistoryStartStr] = useState<string | null>(null);
  const wideningHistoryRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);
  const [localRefreshing, setLocalRefreshing] = useState(false);

  // Navigation & Drilldown State (Order Type, Menu Category, Payment Mode, Hours)
  const [dimension, setDimension] = useState<
    "order_type" | "menu_category" | "payment_mode" | "hours"
  >("order_type");
  const [timeframeMode, setTimeframeMode] = useState<"today" | "mtd">("today");
  const [chartMetric, setChartMetric] = useState<"orders" | "revenue">("revenue");
  const [selectedItemId, setSelectedItemId] = useState<string>("ZOMATO");
  // Whether the full-page category drilldown is open. Clicking a bar in
  // the horizontal bar chart opens this exactly like clicking "Today"/
  // "MTD" under Today's Revenue opens revenueTrendView below — a full
  // takeover of this section with its own back button, not a side panel.
  const [dimensionDrilldownOpen, setDimensionDrilldownOpen] = useState(false);
  const [dateRange, setDateRange] = useState<"today" | "7days" | "15days" | "mtd" | "30days" | "year_by_month" | "custom">("today");
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
  //
  // Historical fetch used to be capped at a flat 3,000 rows (3 pages of
  // 1,000, most-recent-first) regardless of how far back the dashboard
  // actually needed to look. At real volume (hundreds of orders/day), that
  // window covers only a few days — so the "30 days" range and the 3-week
  // same-day baseline comparison would silently run out of data with no
  // warning, well before either actually spans 21-30 days back.
  //
  // Fixed to scope the fetch by DATE instead of row count: pull everything
  // from HISTORY_LOOKBACK_DAYS back through yesterday, paging in loops of
  // 1,000 until each window is exhausted (not stopping at a fixed page
  // count), so results scale with actual order volume within that window
  // rather than silently truncating. The recent/lightweight select tiering
  // is kept — full item detail for the most recent stretch (menu trend
  // analysis needs it), lighter columns further back (only totals/counts
  // matter for the 30-day and baseline views).
  async function fetchAllPages(
    query: any,
    pageSize = 1000,
    maxPages = 50 // safety ceiling (50k rows) against a runaway fetch, not a normal-case limit
  ): Promise<any[]> {
    const rows: any[] = [];
    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await query.range(from, to);
      if (error) {
        console.warn("Notice: historical page fetch error:", error.message || error);
        break;
      }
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break; // exhausted this window
    }
    return rows;
  }

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
        // 35 days back covers the 30-day range view (with a few days'
        // margin) and the 3-week (21-day) baseline engine in one fetch.
        // A custom range picked further back than this triggers its own
        // wider fetch (see the effect below), rather than this default
        // load trying to cover every possible custom selection up front.
        const RECENT_DETAIL_DAYS = 10;
        const HISTORY_LOOKBACK_DAYS = 35;

        const recentCutoff = new Date(freshNow.getTime() - RECENT_DETAIL_DAYS * 86400000);
        const recentCutoffIso = new Date(
          `${getISTDateStr(recentCutoff)}T00:00:00+05:30`
        ).toISOString();
        const lookbackStart = new Date(freshNow.getTime() - HISTORY_LOOKBACK_DAYS * 86400000);
        const lookbackStartIso = new Date(
          `${getISTDateStr(lookbackStart)}T00:00:00+05:30`
        ).toISOString();

        const [todayRows, recentRows, olderRows] = await Promise.all([
          fetchAllPages(
            supabase
              .from("orders")
              .select(TODAY_ORDER_SELECT)
              .eq("restaurant_id", restaurantId)
              .gte("created_at", todayStartUtcIso)
              .neq("status", "CANCELLED")
              .order("created_at", { ascending: false })
          ),
          fetchAllPages(
            supabase
              .from("orders")
              .select(RECENT_HIST_ORDER_SELECT)
              .eq("restaurant_id", restaurantId)
              .lt("created_at", todayStartUtcIso)
              .gte("created_at", recentCutoffIso)
              .neq("status", "CANCELLED")
              .order("created_at", { ascending: false })
          ),
          fetchAllPages(
            supabase
              .from("orders")
              .select(HIST_ORDER_SELECT)
              .eq("restaurant_id", restaurantId)
              .lt("created_at", recentCutoffIso)
              .gte("created_at", lookbackStartIso)
              .neq("status", "CANCELLED")
              .order("created_at", { ascending: false })
          ),
        ]);

        const parsedToday = todayRows.map(parseOrder);
        const allHistRows = [...recentRows, ...olderRows];
        const parsedHist = allHistRows.map(parseOrder);

        // Single batched state update prevents cascading re-render loops
        setInternalTodayOrders(parsedToday);
        setInternalHistoricalOrders(parsedHist);
        setLoadedHistoryStartStr(getISTDateStr(lookbackStart));
      } else {
        // Real-time incremental path: Only re-fetch today's orders (~50ms)
        const todayRows = await fetchAllPages(
          supabase
            .from("orders")
            .select(TODAY_ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .gte("created_at", todayStartUtcIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false })
        );

        const parsedToday = todayRows.map(parseOrder);
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

  // Widens historical coverage on demand when a custom range starts earlier
  // than what's currently loaded — rather than guessing how far back to
  // fetch by default (which is exactly the bug being fixed above: a flat
  // cutoff that doesn't know what the user will actually ask for).
  async function loadOlderHistory(untilStr: string) {
    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") return;
    if (!loadedHistoryStartStr || wideningHistoryRef.current) return;
    if (untilStr >= loadedHistoryStartStr) return; // already covers this

    wideningHistoryRef.current = true;
    setLocalRefreshing(true);
    try {
      const loadedStartIso = new Date(`${loadedHistoryStartStr}T00:00:00+05:30`).toISOString();
      const untilIso = new Date(`${untilStr}T00:00:00+05:30`).toISOString();

      const olderRows = await fetchAllPages(
        supabase
          .from("orders")
          .select(HIST_ORDER_SELECT)
          .eq("restaurant_id", restaurantId)
          .lt("created_at", loadedStartIso)
          .gte("created_at", untilIso)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: false })
      );

      if (olderRows.length > 0) {
        setInternalHistoricalOrders((prev) => [...prev, ...olderRows.map(parseOrder)]);
      }
      setLoadedHistoryStartStr(untilStr);
    } catch (err: any) {
      console.warn("Notice: could not widen historical range:", err?.message || err);
    } finally {
      wideningHistoryRef.current = false;
      setLocalRefreshing(false);
    }
  }

  useEffect(() => {
    if (dateRange === "custom" && customStart && loadedHistoryStartStr) {
      if (customStart < loadedHistoryStartStr) {
        loadOlderHistory(customStart);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStart, loadedHistoryStartStr]);

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

  // Day-wise revenue/orders + running totals for the "Daily Summary" table —
  // scoped to a single calendar month (this month or last month), matching
  // the MTD convention already used elsewhere in this dashboard, so the
  // cumulative columns always start fresh from the 1st rather than
  // carrying over whatever partial trailing days a lookback window
  // happens to have loaded before that.
  const [showDailySummary, setShowDailySummary] = useState(false);
  const [dailySummaryMonthOffset, setDailySummaryMonthOffset] = useState<0 | 1>(0); // 0 = this month, 1 = last month
  const dailySummaryMonthStart =
    dailySummaryMonthOffset === 0 ? `${todayISTStr.slice(0, 7)}-01` : monthStartNMonthsAgo(1, todayISTStr);
  const dailySummaryMonthEnd = useMemo(() => {
    if (dailySummaryMonthOffset === 0) return todayISTStr;
    // Last day of last month = the day right before this month's 1st.
    // Computed via explicit-offset millisecond arithmetic (like the rest of
    // this file's date math), not local Date.setMonth()/setDate(0) — those
    // operate in the browser's local timezone, which silently disagrees
    // with the explicit "+05:30" the string was built with and can collapse
    // this back onto dailySummaryMonthStart itself.
    const thisMonthStart = `${todayISTStr.slice(0, 7)}-01`;
    const dayBeforeMs = new Date(`${thisMonthStart}T00:00:00+05:30`).getTime() - 86400000;
    return getFastISTParts(dayBeforeMs).dateStr;
  }, [dailySummaryMonthOffset, todayISTStr]);

  // "Last month" can fall outside whatever history is currently loaded
  // (the default lookback only guarantees the last 35 days) — widen it on
  // demand, the same way a custom date range does elsewhere in this file.
  useEffect(() => {
    if (!showDailySummary || dailySummaryMonthOffset === 0) return;
    if (!loadedHistoryStartStr) return;
    if (dailySummaryMonthStart < loadedHistoryStartStr) {
      loadOlderHistory(dailySummaryMonthStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDailySummary, dailySummaryMonthOffset, dailySummaryMonthStart, loadedHistoryStartStr]);

  const dailySummaryStillLoadingOlderMonth =
    dailySummaryMonthOffset === 1 &&
    (!loadedHistoryStartStr || dailySummaryMonthStart < loadedHistoryStartStr);

  const dailySummaryRows = useMemo(() => {
    const perDay = new Map<string, { rev: number; count: number }>();
    historicalOrdersByDate.forEach((orders, dStr) => {
      if (dStr < dailySummaryMonthStart || dStr > dailySummaryMonthEnd) return;
      let rev = 0;
      for (const o of orders) rev += Number(o.total) || 0;
      perDay.set(dStr, { rev, count: orders.length });
    });
    if (dailySummaryMonthOffset === 0 && todayOrders.length > 0) {
      let rev = 0;
      for (const o of todayOrders) rev += Number(o.total) || 0;
      perDay.set(todayISTStr, { rev, count: todayOrders.length });
    }

    const sortedDates = [...perDay.keys()].sort();
    let cumRev = 0;
    let cumCount = 0;
    return sortedDates.map((dateStr) => {
      const { rev, count } = perDay.get(dateStr)!;
      cumRev += rev;
      cumCount += count;
      return { dateStr, rev, count, cumRev, cumCount };
    });
  }, [
    historicalOrdersByDate,
    todayOrders,
    todayISTStr,
    dailySummaryMonthStart,
    dailySummaryMonthEnd,
    dailySummaryMonthOffset,
  ]);

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

    // No 3-week same-weekday history yet (a new restaurant, or simply no
    // matching orders on those exact past weekdays) — fall back to
    // yesterday's same-time-of-day performance rather than a flat zero
    // baseline, which would make every "vs baseline" comparison read as
    // a meaningless "+100% up" no matter how the day is actually going.
    const yesterdayMs = now.getTime() - 86400000;
    const yesterdayISTDate = getFastISTParts(yesterdayMs).dateStr;
    const yesterdayOrders = historicalOrdersByDate.get(yesterdayISTDate);

    if (yesterdayOrders && yesterdayOrders.length > 0) {
      let dayRev = 0;
      let count = 0;
      for (let i = 0; i < yesterdayOrders.length; i++) {
        const o = yesterdayOrders[i];
        if (o.istMsIntoDay <= nowIST.msIntoDay && (!filterFn || filterFn(o))) {
          dayRev += Number(o.total) || 0;
          count++;
        }
      }
      if (dayRev > 0 || count > 0) {
        return { baselineRev: Math.round(dayRev), baselineOrders: count, weeksSampled: 0 };
      }
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

    // MTD (Month-To-Date) Calculations in Hyderabad IST
    const currentMonthPrefix = todayISTStr.slice(0, 7); // e.g. "2026-09"
    const mtdDays = parseInt(todayISTStr.slice(8, 10), 10) || 1;
    const monthShortName = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "short" });

    const seenMtdOrderIds = new Set<string>();
    let mtdRev = 0;
    let mtdOrders = 0;

    for (let i = 0; i < todayOrders.length; i++) {
      const o = todayOrders[i];
      const oid = String(o.databaseId || o.id);
      if (oid && !seenMtdOrderIds.has(oid)) {
        seenMtdOrderIds.add(oid);
        mtdRev += Number(o.total) || 0;
        mtdOrders++;
      }
    }

    for (let i = 0; i < historicalOrders.length; i++) {
      const o = historicalOrders[i];
      const dateStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
      if (dateStr && dateStr.startsWith(currentMonthPrefix)) {
        const oid = String(o.databaseId || o.id);
        if (oid && !seenMtdOrderIds.has(oid)) {
          seenMtdOrderIds.add(oid);
          mtdRev += Number(o.total) || 0;
          mtdOrders++;
        }
      }
    }

    // Fallback: If limited history was loaded into memory, estimate MTD pacing from baseline and days
    if (mtdRev === 0 && todayRev > 0) {
      mtdRev = todayRev * mtdDays;
      mtdOrders = todayCount * mtdDays;
    }

    const mtdAvgDailyRev = Math.round(mtdRev / Math.max(1, mtdDays));
    const mtdAvgDailyOrders = Math.round(mtdOrders / Math.max(1, mtdDays));

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
      mtdRev,
      mtdOrders,
      mtdDays,
      mtdAvgDailyRev,
      mtdAvgDailyOrders,
      monthShortName,
    };
  }, [todayOrders, historicalOrders, nowIST.msIntoDay, todayISTStr, now]);

  // Full list of deduplicated MTD orders (from 1st of month to today)
  const mtdOrdersList = useMemo(() => {
    const currentMonthPrefix = todayISTStr.slice(0, 7);
    const seen = new Set<string>();
    const list: Order[] = [];
    for (let i = 0; i < todayOrders.length; i++) {
      const o = todayOrders[i];
      const oid = String(o.databaseId || o.id);
      if (oid && !seen.has(oid)) {
        seen.add(oid);
        list.push(o);
      }
    }
    for (let i = 0; i < historicalOrders.length; i++) {
      const o = historicalOrders[i];
      const dateStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
      if (dateStr && dateStr.startsWith(currentMonthPrefix)) {
        const oid = String(o.databaseId || o.id);
        if (oid && !seen.has(oid)) {
          seen.add(oid);
          list.push(o);
        }
      }
    }
    return list;
  }, [todayOrders, historicalOrders, todayISTStr]);

  // Active orders for dimension breakdown (switches dynamically between Today and MTD)
  const activePeriodOrders = useMemo(() => {
    return timeframeMode === "mtd" ? mtdOrdersList : todayOrders;
  }, [timeframeMode, mtdOrdersList, todayOrders]);

  const activePeriodTotalRev = useMemo(() => {
    return timeframeMode === "mtd" ? (topMetrics.mtdRev || 1) : (topMetrics.todayRev || 1);
  }, [timeframeMode, topMetrics.mtdRev, topMetrics.todayRev]);

  // Day-by-Day Revenue & Volume Boxes for previous days & MTD
  const dayBoxes = useMemo(() => {
    const dailyMap = new Map<string, { rev: number; orders: number }>();
    const channelCounter = new Map<string, Map<string, number>>();

    const seen = new Set<string>();
    const allOrdersList: Order[] = [];
    for (const o of todayOrders) {
      const oid = String(o.databaseId || o.id);
      if (oid && !seen.has(oid)) {
        seen.add(oid);
        allOrdersList.push(o);
      }
    }
    for (const o of historicalOrders) {
      const oid = String(o.databaseId || o.id);
      if (oid && !seen.has(oid)) {
        seen.add(oid);
        allOrdersList.push(o);
      }
    }

    allOrdersList.forEach((o) => {
      const dStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
      if (!dStr) return;
      const cur = dailyMap.get(dStr) || { rev: 0, orders: 0 };
      cur.rev += Number(o.total) || 0;
      cur.orders += 1;
      dailyMap.set(dStr, cur);

      const chMap = channelCounter.get(dStr) || new Map<string, number>();
      const ch = o.source || "DINE_IN";
      chMap.set(ch, (chMap.get(ch) || 0) + 1);
      channelCounter.set(dStr, chMap);
    });

    const datesToDisplay: string[] = [];
    const currentMonthPrefix = todayISTStr.slice(0, 7);
    const mtdDaysCount = parseInt(todayISTStr.slice(8, 10), 10) || 1;

    if (dateRange === "mtd" || (timeframeMode === "mtd" && dateRange !== "custom" && dateRange !== "7days" && dateRange !== "30days")) {
      for (let dayNum = mtdDaysCount; dayNum >= 1; dayNum--) {
        datesToDisplay.push(`${currentMonthPrefix}-${String(dayNum).padStart(2, "0")}`);
      }
    } else if (dateRange === "custom" && customStart && customEnd) {
      const startMs = new Date(`${customStart}T00:00:00+05:30`).getTime();
      const endMs = new Date(`${customEnd}T23:59:59+05:30`).getTime();
      const diff = Math.min(60, Math.max(1, Math.round((endMs - startMs) / 86400000)));
      for (let i = 0; i < diff; i++) {
        const dMs = endMs - i * 86400000;
        datesToDisplay.push(getFastISTParts(dMs).dateStr);
      }
    } else if (dateRange === "30days") {
      for (let i = 0; i < 30; i++) {
        const dMs = now.getTime() - i * 86400000;
        datesToDisplay.push(getFastISTParts(dMs).dateStr);
      }
    } else if (dateRange === "15days") {
      for (let i = 0; i < 15; i++) {
        const dMs = now.getTime() - i * 86400000;
        datesToDisplay.push(getFastISTParts(dMs).dateStr);
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const dMs = now.getTime() - i * 86400000;
        datesToDisplay.push(getFastISTParts(dMs).dateStr);
      }
    }

    let runningCum = 0;
    const sortedForward = [...datesToDisplay].sort();
    const cumMap = new Map<string, number>();
    sortedForward.forEach((dStr) => {
      const s = dailyMap.get(dStr);
      runningCum += s ? s.rev : 0;
      cumMap.set(dStr, runningCum);
    });

    return datesToDisplay.map((dStr) => {
      const s = dailyMap.get(dStr) || { rev: 0, orders: 0 };
      const aov = s.orders > 0 ? Math.round(s.rev / s.orders) : 0;
      const isToday = dStr === todayISTStr;

      const dayDate = new Date(`${dStr}T12:00:00+05:30`);
      const dayName = dayDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" });
      const dayNum = dayDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

      const chMap = channelCounter.get(dStr);
      let topCh = "Dine-In";
      let maxChCount = 0;
      if (chMap) {
        chMap.forEach((cnt, ch) => {
          if (cnt > maxChCount) {
            maxChCount = cnt;
            topCh = ch === "ZOMATO" ? "Zomato" : ch === "SWIGGY" ? "Swiggy" : ch === "DINE_IN" ? "Dine-In" : "Takeaway";
          }
        });
      }

      const baselineForDay = topMetrics.baselineRev || 1;
      const pacingPct = baselineForDay > 0 ? Math.round(((s.rev - baselineForDay) / baselineForDay) * 100) : 0;

      return {
        dateStr: dStr,
        label: `${dayName}, ${dayNum}`,
        isToday,
        rev: s.rev,
        orders: s.orders,
        aov,
        topChannel: topCh,
        cumRev: cumMap.get(dStr) || s.rev,
        pacingPct,
        pacingUp: pacingPct >= 0,
      };
    });
  }, [todayOrders, historicalOrders, todayISTStr, dateRange, timeframeMode, customStart, customEnd, now, topMetrics.baselineRev]);

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

    const totalRevAll = activePeriodTotalRev;
    const isMtd = timeframeMode === "mtd";
    const mtdMultiplier = isMtd ? Math.max(1, topMetrics.mtdDays) : 1;

    return channelConfigs.map((cfg) => {
      const chOrders = activePeriodOrders.filter((o) => o.source === cfg.id);
      const rev = chOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const count = chOrders.length;
      const sharePct = Math.round((rev / totalRevAll) * 100);

      const base = calculateSameTimeBaseline((o) => o.source === cfg.id);
      const baseRevScaled = isMtd ? Math.round(base.baselineRev * mtdMultiplier) : base.baselineRev;
      const baseOrdersScaled = isMtd ? Math.round(base.baselineOrders * mtdMultiplier) : base.baselineOrders;

      const revDelta = rev - baseRevScaled;
      const orderDelta = count - baseOrdersScaled;

      const revGrowth =
        baseRevScaled > 0
          ? ((revDelta / baseRevScaled) * 100).toFixed(1)
          : rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        baseOrdersScaled > 0
          ? ((orderDelta / baseOrdersScaled) * 100).toFixed(1)
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
  }, [activePeriodOrders, activePeriodTotalRev, historicalOrders, timeframeMode, topMetrics.mtdDays, nowIST.msIntoDay]);

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

    const isMtd = timeframeMode === "mtd";
    const mtdMultiplier = isMtd ? Math.max(1, topMetrics.mtdDays) : 1;

    return shiftConfigs.map((cfg) => {
      const shiftOrders = activePeriodOrders.filter((o) => cfg.hourFilter(o.istHour));
      const rev = shiftOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const count = shiftOrders.length;

      const base = calculateSameTimeBaseline((o) => cfg.hourFilter(o.istHour));
      const baseRevScaled = isMtd ? Math.round(base.baselineRev * mtdMultiplier) : base.baselineRev;
      const baseOrdersScaled = isMtd ? Math.round(base.baselineOrders * mtdMultiplier) : base.baselineOrders;

      const revDelta = rev - baseRevScaled;
      const orderDelta = count - baseOrdersScaled;

      const revGrowth =
        baseRevScaled > 0
          ? ((revDelta / baseRevScaled) * 100).toFixed(1)
          : rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        baseOrdersScaled > 0
          ? ((orderDelta / baseOrdersScaled) * 100).toFixed(1)
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
  }, [activePeriodOrders, historicalOrders, timeframeMode, topMetrics.mtdDays, nowIST.msIntoDay]);

  // 3. Menu Categories Breakdown
  const menuCards = useMemo(() => {
    const catMap = new Map<string, { rev: number; count: number }>();
    const totalRevAll = activePeriodTotalRev;
    const isMtd = timeframeMode === "mtd";
    const mtdMultiplier = isMtd ? Math.max(1, topMetrics.mtdDays) : 1;

    const initialCats = ["Rice & Biryani", "Starters", "Main Course", "Breads", "Desserts", "Beverages"];
    initialCats.forEach((c) => catMap.set(c, { rev: 0, count: 0 }));

    activePeriodOrders.forEach((o) => {
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

      const baseRevScaled = isMtd ? Math.round(base.baselineRev * mtdMultiplier) : base.baselineRev;
      const baseOrdersScaled = isMtd ? Math.round(base.baselineOrders * mtdMultiplier) : base.baselineOrders;

      const estimatedBaseRev =
        baseRevScaled > 0
          ? baseRevScaled
          : Math.round(topMetrics.baselineRev * (isMtd ? mtdMultiplier : 1) * (stats.rev / totalRevAll));
      const estimatedBaseOrders =
        baseOrdersScaled > 0
          ? baseOrdersScaled
          : Math.round(topMetrics.baselineOrders * (isMtd ? mtdMultiplier : 1) * (stats.count / (isMtd ? (topMetrics.mtdOrders || 1) : (topMetrics.todayCount || 1))));

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
  }, [activePeriodOrders, activePeriodTotalRev, historicalOrders, timeframeMode, topMetrics.mtdDays, topMetrics.mtdOrders, topMetrics.todayCount, topMetrics.baselineRev, topMetrics.baselineOrders, nowIST.msIntoDay]);

  // 4. Payment Modes Breakdown
  const paymentCards = useMemo(() => {
    const paymentConfigs = [
      {
        id: "UPI",
        name: "UPI & QR Payments",
        icon: "📱",
        iconBg: "#059669",
        tag: "Instant Digital",
        tagColor: "rgba(16, 185, 129, 0.15)",
        tagTextColor: "#10b981",
        matcher: (o: Order) => {
          const s = (o.source || "").toUpperCase();
          const p = (o.payment || "").toUpperCase();
          if (s === "ZOMATO" || s === "SWIGGY") return false;
          return (
            p.includes("UPI") ||
            p.includes("GPAY") ||
            p.includes("PHONEPE") ||
            p.includes("PAYTM") ||
            (!p.includes("CASH") && !p.includes("CARD"))
          );
        },
      },
      {
        id: "AGGREGATOR",
        name: "Aggregator Escrow",
        icon: "🛵",
        iconBg: "#ea580c",
        tag: "Swiggy & Zomato",
        tagColor: "rgba(249, 115, 22, 0.15)",
        tagTextColor: "#f97316",
        matcher: (o: Order) => {
          const s = (o.source || "").toUpperCase();
          const p = (o.payment || "").toUpperCase();
          return (
            s === "ZOMATO" ||
            s === "SWIGGY" ||
            p.includes("ZOMATO") ||
            p.includes("SWIGGY") ||
            p.includes("AGGREGATOR") ||
            p.includes("ESCROW")
          );
        },
      },
      {
        id: "CASH",
        name: "Counter Cash",
        icon: "💵",
        iconBg: "#16a34a",
        tag: "Direct Cash",
        tagColor: "rgba(34, 197, 94, 0.15)",
        tagTextColor: "#22c55e",
        matcher: (o: Order) => {
          const p = (o.payment || "").toUpperCase();
          return p.includes("CASH");
        },
      },
      {
        id: "CARD",
        name: "Card (POS Terminal)",
        icon: "💳",
        iconBg: "#2563eb",
        tag: "Credit / Debit",
        tagColor: "rgba(37, 99, 235, 0.15)",
        tagTextColor: "#3b82f6",
        matcher: (o: Order) => {
          const p = (o.payment || "").toUpperCase();
          return p.includes("CARD") || p.includes("POS");
        },
      },
    ];

    const totalRevAll = activePeriodTotalRev;
    const isMtd = timeframeMode === "mtd";
    const mtdMultiplier = isMtd ? Math.max(1, topMetrics.mtdDays) : 1;

    return paymentConfigs.map((cfg) => {
      const pmOrders = activePeriodOrders.filter(cfg.matcher);
      const rev = pmOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const count = pmOrders.length;
      const sharePct = Math.round((rev / totalRevAll) * 100);

      const base = calculateSameTimeBaseline(cfg.matcher);
      const baseRevScaled = isMtd ? Math.round(base.baselineRev * mtdMultiplier) : base.baselineRev;
      const baseOrdersScaled = isMtd ? Math.round(base.baselineOrders * mtdMultiplier) : base.baselineOrders;

      const revDelta = rev - baseRevScaled;
      const orderDelta = count - baseOrdersScaled;

      const revGrowth =
        baseRevScaled > 0
          ? ((revDelta / baseRevScaled) * 100).toFixed(1)
          : rev > 0
          ? "+100.0"
          : "0.0";
      const orderGrowth =
        baseOrdersScaled > 0
          ? ((orderDelta / baseOrdersScaled) * 100).toFixed(1)
          : count > 0
          ? "+100.0"
          : "0.0";

      return {
        id: cfg.id,
        name: cfg.name,
        icon: cfg.icon,
        iconBg: cfg.iconBg,
        tag: `${sharePct}% of Total`,
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
        filterFn: cfg.matcher,
      };
    });
  }, [activePeriodOrders, activePeriodTotalRev, historicalOrders, timeframeMode, topMetrics.mtdDays, nowIST.msIntoDay]);

  // Active items list based on dimension — sorted highest-revenue-first
  // so the best-performing channel/category/payment-mode always sits at
  // the top of the stack. Hours is deliberately excluded: that's a
  // time-series (midnight through night), and reordering it by
  // performance would make it unreadable as a timeline.
  const currentDimensionCards = useMemo(() => {
    const list =
      dimension === "order_type"
        ? channelCards
        : dimension === "menu_category"
        ? menuCards
        : dimension === "payment_mode"
        ? paymentCards
        : dimension === "hours"
        ? hourCards
        : channelCards;

    if (dimension === "hours") return list;
    return [...list].sort((a, b) => b.rev - a.rev);
  }, [dimension, channelCards, menuCards, paymentCards, hourCards]);

  // Display label for the active dimension, used in the bar chart header
  const dimensionLabel =
    dimension === "order_type"
      ? "Order Type"
      : dimension === "menu_category"
      ? "Menu Category"
      : dimension === "payment_mode"
      ? "Payment Mode"
      : "Shift & Hours";

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
    const isMenuDim = dimension === "menu_category";

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

    if (dateRange === "15days") {
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

      for (let i = 14; i >= 0; i--) {
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
      const avgRev = Math.round(cumRev / 15);
      const avgOrders = Math.round(cumOrders / 15);

      const base = calculateSameTimeBaseline(filterFn);
      const baselineRev =
        base.baselineRev > 0
          ? base.baselineRev
          : isMenuDim
          ? Math.round(topMetrics.baselineRev * ((activeCard.rev || 1) / (topMetrics.todayRev || 1)))
          : Math.round(cumRev / 15);
      const baselineOrders =
        base.baselineOrders > 0
          ? base.baselineOrders
          : isMenuDim
          ? Math.round(topMetrics.baselineOrders * ((activeCard.orders || 1) / (topMetrics.todayCount || 1)))
          : Math.max(1, Math.round(cumOrders / 15));

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
        insight: `Last 15 Days: ${activeCard.revDeltaInsight} • ${activeCard.orderDeltaInsight} vs usual baseline.`,
      };
    }

    // 2.5 "mtd" -> Day-by-Day for current month (Day 1 through Today)
    // Month-wise trend for the current year (Jan through the current
    // month) — triggered by clicking the MTD tier, which used to just
    // show month-to-date daily detail; this gives the bigger-picture
    // "how has each month gone this year" view instead.
    if (dateRange === "year_by_month") {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const currentYear = todayISTStr.slice(0, 4);
      const currentMonthIdx = parseInt(todayISTStr.slice(5, 7), 10) - 1;

      const monthlyMap = new Map<string, { rev: number; count: number }>();
      for (const o of allFilteredOrders) {
        const dStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
        if (!dStr || !dStr.startsWith(currentYear)) continue;
        const monthKey = dStr.slice(0, 7);
        const cur = monthlyMap.get(monthKey) || { rev: 0, count: 0 };
        cur.rev += getOrderRev(o);
        cur.count += getOrderCount(o);
        monthlyMap.set(monthKey, cur);
      }

      const monthLabels: string[] = [];
      const revs: number[] = [];
      const counts: number[] = [];
      for (let m = 0; m <= currentMonthIdx; m++) {
        const monthKey = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
        monthLabels.push(monthNames[m]);
        const stats = monthlyMap.get(monthKey) || { rev: 0, count: 0 };
        revs.push(stats.rev);
        counts.push(stats.count);
      }

      const cumRev = revs.reduce((a, b) => a + b, 0);
      const cumOrders = counts.reduce((a, b) => a + b, 0);
      const monthsElapsed = Math.max(1, currentMonthIdx + 1);
      const avgRev = Math.round(cumRev / monthsElapsed);
      const avgOrders = Math.round(cumOrders / monthsElapsed);

      return {
        days: monthLabels,
        rev: revs,
        orders: counts,
        cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
        cumOrders: String(cumOrders),
        avgDailyRev: `₹${avgRev.toLocaleString("en-IN")}`,
        avgDailyOrders: `${avgOrders} / month`,
        baselineRev: avgRev,
        baselineOrders: avgOrders,
        insight: `${currentYear} so far: ₹${cumRev.toLocaleString("en-IN")} across ${cumOrders} ${isMenuDim ? "items" : "orders"} over ${monthsElapsed} month${monthsElapsed === 1 ? "" : "s"}.`,
      };
    }

    if (dateRange === "mtd") {
      const daysLabels: string[] = [];
      const revs: number[] = [];
      const counts: number[] = [];
      const currentMonthPrefix = todayISTStr.slice(0, 7);
      const mtdDaysCount = parseInt(todayISTStr.slice(8, 10), 10) || 1;

      const dailyMap = new Map<string, { rev: number; count: number }>();
      for (const o of allFilteredOrders) {
        const dStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
        if (dStr && dStr.startsWith(currentMonthPrefix)) {
          const cur = dailyMap.get(dStr) || { rev: 0, count: 0 };
          cur.rev += getOrderRev(o);
          cur.count += getOrderCount(o);
          dailyMap.set(dStr, cur);
        }
      }

      for (let dayNum = 1; dayNum <= mtdDaysCount; dayNum++) {
        const dayStr = `${currentMonthPrefix}-${String(dayNum).padStart(2, "0")}`;
        const dayDate = new Date(`${dayStr}T12:00:00+05:30`);
        const dayLabel = formatISTDate(dayDate, { month: "short", day: "numeric" });
        daysLabels.push(dayLabel);

        const dayStats = dailyMap.get(dayStr) || { rev: 0, count: 0 };
        revs.push(dayStats.rev);
        counts.push(dayStats.count);
      }

      const cumRev = revs.reduce((a, b) => a + b, 0);
      const cumOrders = counts.reduce((a, b) => a + b, 0);
      const avgRev = Math.round(cumRev / Math.max(1, mtdDaysCount));
      const avgOrders = Math.round(cumOrders / Math.max(1, mtdDaysCount));

      return {
        days: daysLabels,
        rev: revs,
        orders: counts,
        cumRev: `₹${cumRev.toLocaleString("en-IN")}`,
        cumOrders: String(cumOrders),
        avgDailyRev: `₹${avgRev.toLocaleString("en-IN")}`,
        avgDailyOrders: `${avgOrders} / day`,
        baselineRev: avgRev,
        baselineOrders: avgOrders,
        insight: `${topMetrics.monthShortName} MTD (${mtdDaysCount} Days): Cumulative ₹${cumRev.toLocaleString("en-IN")} across ${cumOrders} ${isMenuDim ? "items" : "orders"}. Run-rate: ₹${avgRev.toLocaleString("en-IN")}/day.`,
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
  }, [activeCard, dimension, dateRange, customStart, customEnd, todayOrders, historicalOrders, now, todayISTStr]);

  // SVG Chart Geometry Calculations
  const BASE_CHART_WIDTH = 500;
  const chartHeight = 150;
  const startX = 42;
  const startY = 16;
  const days = drilldownData?.days || [];
  const revData = drilldownData?.rev || [];
  const orderData = drilldownData?.orders || [];
  const maxRev = Math.max(100, ...revData, drilldownData?.baselineRev || 0) * 1.15;
  const maxOrders = Math.max(5, ...orderData, drilldownData?.baselineOrders || 0) * 1.25;
  // Past ~15 columns, squeezing everything into a fixed 500-unit viewBox
  // (which then scales down to fit the screen via width:100%) makes bars
  // thinner than they can stay legible on a phone. Beyond that count, grow
  // the chart's native width instead and let .svg-chart-wrapper's existing
  // overflow-x: auto turn it into a horizontal swipe rather than a squish —
  // short ranges (7/15 days) keep the original always-fits behavior.
  const MIN_COL_WIDTH = 34;
  const needsHorizontalScroll = days.length > 15;
  const chartWidth = needsHorizontalScroll
    ? startX + 20 + days.length * MIN_COL_WIDTH
    : BASE_CHART_WIDTH;
  const colSpacing = (chartWidth - startX - 20) / Math.max(1, days.length);
  const barWidth = Math.max(12, Math.min(32, Math.floor(colSpacing * 0.55)));

  const handleRefreshClick = () => {
    if (propOnRefresh) {
      propOnRefresh();
    } else {
      loadData({ fullHistorical: true });
    }
  };

  // Clicking the Revenue or Orders box HEADER (not the Today/MTD tiers,
  // which have their own click behavior already) jumps straight to the
  // Last 15 Days view and scrolls down to where that breakdown actually
  // renders — the chart/dimension section below, not the KPI card itself.
  const jumpToLast15Days = () => {
    setDateRange("15days");
    document.getElementById("barchart-overview-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // Clicking "Today" or "MTD" under Today's Revenue opens a dedicated page
  // (not a scroll to the shared channel/category chart below, which is
  // scoped to whichever dimension item happens to be selected) — this is
  // the TOTAL, unfiltered revenue across every channel, its own separate
  // view with its own back button. It can also be split into a stacked
  // column by any of the same 4 dimensions used elsewhere in the
  // dashboard (order type, menu category, payment mode, shift & hours).
  const [revenueTrendView, setRevenueTrendView] = useState<null | "daily" | "monthly">(null);
  // Which number the trend page is showing — wired up so the Orders KPI
  // tiles can open the exact same page/controls the Revenue tiles do,
  // just plotting order counts instead of revenue.
  const [revenueTrendMetric, setRevenueTrendMetric] = useState<"revenue" | "orders">("revenue");
  const [revenueTrendSplitDim, setRevenueTrendSplitDim] = useState<
    "total" | "order_type" | "menu_category" | "payment_mode" | "hours"
  >("total");

  // Custom date range for each page — separate from the main dashboard's
  // own customStart/customEnd (used by its unrelated "custom" dateRange
  // pill) so picking a range in here never affects the main dashboard.
  const [dailyDateMode, setDailyDateMode] = useState<"7days" | "30days" | "thismonth" | "custom">("7days");
  const [dailyRangeStart, setDailyRangeStart] = useState(() => {
    const d = new Date(Date.now() - 6 * 86400000 + IST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
  const [dailyRangeEnd, setDailyRangeEnd] = useState(todayISTStr);
  const [monthlyDateMode, setMonthlyDateMode] = useState<"year" | "last7" | "last12" | "custom">("year");
  const [monthlyRangeStart, setMonthlyRangeStart] = useState(`${todayISTStr.slice(0, 4)}-01-01`);
  const [monthlyRangeEnd, setMonthlyRangeEnd] = useState(todayISTStr);

  // Returns the 1st-of-month date string for "n months before base's
  // month" (n=0 -> base's own month). Used by the Last 7 / Last 12
  // months presets, which are rolling windows ending on the current
  // month rather than a fixed calendar year.
  function monthStartNMonthsAgo(n: number, base: string): string {
    const y = parseInt(base.slice(0, 4), 10);
    const m = parseInt(base.slice(5, 7), 10) - 1;
    const total = y * 12 + m - n;
    const yy = Math.floor(total / 12);
    const mm = ((total % 12) + 12) % 12;
    return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
  }

  // Dimension splits (order type / menu category / payment mode / hours)
  // work for both the revenue and orders metrics — for orders, each split
  // bucket sums order counts (or item quantities for menu category)
  // instead of ₹ amounts. See totalDailyRevenue7 / totalMonthlyRevenueYear.
  // Same 4 order-type buckets/colors as channelCards, kept in sync
  // deliberately so a channel's color always means the same thing
  // everywhere in the dashboard.
  const ORDER_TYPE_SPLIT_CONFIG = [
    { id: "ZOMATO", name: "Zomato", color: "#ef4444", matcher: (o: Order) => o.source === "ZOMATO" },
    { id: "SWIGGY", name: "Swiggy", color: "#f97316", matcher: (o: Order) => o.source === "SWIGGY" },
    { id: "DINE_IN", name: "Dine-in", color: "#3b82f6", matcher: (o: Order) => o.source === "DINE_IN" },
    { id: "TAKEAWAY", name: "Takeaway", color: "#10b981", matcher: (o: Order) => o.source === "TAKEAWAY" },
  ];
  const HOURS_SPLIT_CONFIG = [
    { id: "morning", name: "Morning", color: "#f59e0b", matcher: (o: Order) => (o.istHour ?? 0) >= 7 && (o.istHour ?? 0) < 12 },
    { id: "afternoon", name: "Afternoon", color: "#f97316", matcher: (o: Order) => (o.istHour ?? 0) >= 12 && (o.istHour ?? 0) < 16 },
    { id: "evening", name: "Evening", color: "#6366f1", matcher: (o: Order) => (o.istHour ?? 0) >= 16 || (o.istHour ?? 0) < 4 },
  ];
  const PAYMENT_SPLIT_CONFIG = [
    {
      id: "UPI", name: "UPI & QR", color: "#059669",
      matcher: (o: Order) => {
        const s = (o.source || "").toUpperCase();
        const p = (o.payment || "").toUpperCase();
        if (s === "ZOMATO" || s === "SWIGGY") return false;
        return p.includes("UPI") || p.includes("GPAY") || p.includes("PHONEPE") || p.includes("PAYTM") || (!p.includes("CASH") && !p.includes("CARD"));
      },
    },
    {
      id: "AGGREGATOR", name: "Aggregator escrow", color: "#ea580c",
      matcher: (o: Order) => {
        const s = (o.source || "").toUpperCase();
        const p = (o.payment || "").toUpperCase();
        return s === "ZOMATO" || s === "SWIGGY" || p.includes("ZOMATO") || p.includes("SWIGGY") || p.includes("AGGREGATOR") || p.includes("ESCROW");
      },
    },
    { id: "CASH", name: "Cash", color: "#78716c", matcher: (o: Order) => (o.payment || "").toUpperCase().includes("CASH") },
    { id: "CARD", name: "Card", color: "#8b5cf6", matcher: (o: Order) => (o.payment || "").toUpperCase().includes("CARD") },
  ];
  const MENU_CATEGORY_SPLIT_CONFIG = [
    { id: "Rice & Biryani", name: "Rice & Biryani", color: "#d97706" },
    { id: "Starters", name: "Starters", color: "#dc2626" },
    { id: "Main Course", name: "Main Course", color: "#059669" },
    { id: "Breads", name: "Breads", color: "#a16207" },
    { id: "Desserts", name: "Desserts", color: "#db2777" },
    { id: "Beverages", name: "Beverages", color: "#0284c7" },
    // Catch-all for items whose menu_items.category doesn't match one of
    // the 6 canonical names above (e.g. an old/renamed category still
    // referenced by historical order_items) — without this, that revenue
    // silently disappears from the stacked bar instead of being counted,
    // which visually reads as a mostly-empty bar under a correct total.
    { id: "Other", name: "Other", color: "#94a3b8" },
  ];

  function getSplitConfig(dim: typeof revenueTrendSplitDim) {
    if (dim === "order_type") return ORDER_TYPE_SPLIT_CONFIG;
    if (dim === "hours") return HOURS_SPLIT_CONFIG;
    if (dim === "payment_mode") return PAYMENT_SPLIT_CONFIG;
    if (dim === "menu_category") return MENU_CATEGORY_SPLIT_CONFIG;
    return [];
  }

  const totalDailyRevenue7 = useMemo(() => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const splitConfig = getSplitConfig(revenueTrendSplitDim);
    const isMenuSplit = revenueTrendSplitDim === "menu_category";
    const isOrdersMetric = revenueTrendMetric === "orders";

    const dailyMap = new Map<string, { rev: number; count: number; byDim: number[] }>();
    for (const o of [...todayOrders, ...historicalOrders]) {
      const dStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
      if (!dStr) continue;
      const cur = dailyMap.get(dStr) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
      cur.rev += Number(o.total) || 0;
      cur.count += 1;
      if (isMenuSplit) {
        (o.items || []).forEach((it) => {
          const rawCat = it.category === "Mains" ? "Main Course" : it.category;
          const idx = splitConfig.findIndex((c) => c.id === rawCat);
          const bucket = idx >= 0 ? idx : splitConfig.findIndex((c) => c.id === "Other");
          if (bucket >= 0) cur.byDim[bucket] += isOrdersMetric ? it.qty : it.price * it.qty;
        });
      } else if (splitConfig.length > 0) {
        splitConfig.forEach((c, idx) => {
          if ((c as any).matcher(o)) cur.byDim[idx] += isOrdersMetric ? 1 : Number(o.total) || 0;
        });
      }
      dailyMap.set(dStr, cur);
    }

    const labels: string[] = [];
    const revs: number[] = [];
    const counts: number[] = [];
    const byDimSeries: number[][] = [];

    let startMs: number;
    let numDays: number;
    if (dailyDateMode === "custom" && dailyRangeStart && dailyRangeEnd) {
      startMs = new Date(`${dailyRangeStart}T00:00:00+05:30`).getTime();
      const endMs = new Date(`${dailyRangeEnd}T00:00:00+05:30`).getTime();
      // Capped at 60 days — same ceiling the main dashboard's own custom
      // range uses. Beyond that, individual day-bars stop being readable
      // anyway; a month-wise view is the right tool at that point.
      numDays = Math.min(60, Math.max(1, Math.round((endMs - startMs) / 86400000) + 1));
    } else if (dailyDateMode === "30days") {
      numDays = 30;
      startMs = now.getTime() - 29 * 86400000;
    } else if (dailyDateMode === "thismonth") {
      const firstOfMonth = `${todayISTStr.slice(0, 7)}-01`;
      startMs = new Date(`${firstOfMonth}T00:00:00+05:30`).getTime();
      numDays = Math.max(1, Math.round((now.getTime() - startMs) / 86400000) + 1);
    } else {
      // "7days" (default)
      numDays = 7;
      startMs = now.getTime() - 6 * 86400000;
    }

    for (let i = 0; i < numDays; i++) {
      const dMs = startMs + i * 86400000;
      const dParts = getFastISTParts(dMs);
      const dayIdx = new Date(dMs + IST_OFFSET_MS).getUTCDay();
      const dateNum = new Date(dMs + IST_OFFSET_MS).getUTCDate();
      labels.push(`${dayNames[dayIdx]} ${dateNum}`);
      const stats = dailyMap.get(dParts.dateStr) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
      revs.push(stats.rev);
      counts.push(stats.count);
      byDimSeries.push(stats.byDim);
    }
    return { labels, revs, counts, byDimSeries, splitConfig, cumRev: revs.reduce((a, b) => a + b, 0), cumCount: counts.reduce((a, b) => a + b, 0) };
  }, [todayOrders, historicalOrders, now, revenueTrendSplitDim, revenueTrendMetric, dailyDateMode, dailyRangeStart, dailyRangeEnd, todayISTStr]);

  // Widens the loaded order history back far enough to cover a custom
  // daily range that reaches further back than the default load window —
  // reuses the exact same mechanism the main dashboard's own custom range
  // already relies on, rather than a second, separate fetch path.
  useEffect(() => {
    if (revenueTrendView !== "daily" || !loadedHistoryStartStr) return;
    let neededStart: string | null = null;
    if (dailyDateMode === "custom" && dailyRangeStart) {
      neededStart = dailyRangeStart;
    } else if (dailyDateMode === "30days") {
      const d = new Date(now.getTime() - 29 * 86400000 + IST_OFFSET_MS);
      neededStart = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    } else if (dailyDateMode === "thismonth") {
      neededStart = `${todayISTStr.slice(0, 7)}-01`;
    }
    if (neededStart && neededStart < loadedHistoryStartStr) {
      loadOlderHistory(neededStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueTrendView, dailyDateMode, dailyRangeStart, loadedHistoryStartStr, todayISTStr]);

  // Monthly view reads from mv_orders_summary — pre-aggregated by
  // restaurant/day/hour/order_type/payment_mode — instead of downloading
  // and summing raw orders client-side, which is what made this view slow
  // in the first place. Menu category isn't covered by the summary table
  // (it needs a join to order_items), so that split bypasses it entirely
  // and reads raw orders instead — see the monthlyMenuRows fetch below.
  const [monthlySummaryRows, setMonthlySummaryRows] = useState<any[] | null>(null);
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);
  // Demo accounts (and any setup without Supabase configured) never had
  // mv_orders_summary rows to fetch, so monthlySummaryRows stayed null
  // forever and the monthly trend view (Last 7 / Last 12 Months, This
  // Year) got stuck on its loading skeleton indefinitely. For that case
  // totalMonthlyRevenueYear below builds the same monthly aggregates
  // directly from todayOrders/historicalOrders instead, exactly like
  // totalDailyRevenue7 already does for the 7-day view.
  const useDemoMonthlySource = !isSupabaseConfigured || restaurantId === "demo-restaurant-1";

  useEffect(() => {
    if (revenueTrendView !== "monthly" || !restaurantId || useDemoMonthlySource) return;

    let cancelled = false;
    setMonthlySummaryLoading(true);
    const rangeStart =
      monthlyDateMode === "custom" && monthlyRangeStart
        ? monthlyRangeStart
        : monthlyDateMode === "last7"
        ? monthStartNMonthsAgo(6, todayISTStr)
        : monthlyDateMode === "last12"
        ? monthStartNMonthsAgo(11, todayISTStr)
        : `${todayISTStr.slice(0, 4)}-01-01`;
    const rangeEndExclusive =
      monthlyDateMode === "custom" && monthlyRangeEnd && monthlyRangeEnd < todayISTStr
        ? monthlyRangeEnd
        : todayISTStr; // never fetch today itself from the summary table
    // mv_orders_summary is grouped per (date, hour, order_type, payment_mode),
    // so an active restaurant can easily produce tens of thousands of rows
    // across a several-month window — well past PostgREST's default 1000-row
    // cap per request. An unpaginated select() here silently truncates to
    // that cap with no error, which is what made "Last 7"/"Last 12" collapse
    // to only their first ~12 days of data. fetchAllPages (already used for
    // the raw orders history fetch above) pages through with .range() until
    // every matching row is retrieved.
    (async () => {
      const rows = await fetchAllPages(
        supabase
          .from("mv_orders_summary")
          .select("order_date, order_hour, order_type, payment_mode, revenue, order_count")
          .eq("restaurant_id", restaurantId)
          .gte("order_date", rangeStart)
          .lt("order_date", rangeEndExclusive) // up through YESTERDAY only — today is
        // appended live below, never read from the summary table, since the
        // view only refreshes on a schedule and could show today as
        // incomplete or missing entirely depending on refresh timing.
      );
      if (cancelled) return;
      setMonthlySummaryRows(rows);
      setMonthlySummaryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [revenueTrendView, restaurantId, useDemoMonthlySource, todayISTStr, monthlyDateMode, monthlyRangeStart, monthlyRangeEnd]);

  // Menu category bypasses mv_orders_summary entirely — it has no
  // category column, so this fetches raw orders (with their items and
  // each item's menu category) for the same date window instead, and
  // totalMonthlyRevenueYear below aggregates it client-side. Only runs
  // when that split is actually selected, so switching dimensions back
  // to Total/Order type/etc. doesn't pay this extra query's cost.
  const [monthlyMenuRows, setMonthlyMenuRows] = useState<any[] | null>(null);
  const [monthlyMenuLoading, setMonthlyMenuLoading] = useState(false);

  useEffect(() => {
    if (
      revenueTrendView !== "monthly" ||
      revenueTrendSplitDim !== "menu_category" ||
      !restaurantId ||
      useDemoMonthlySource
    )
      return;

    let cancelled = false;
    setMonthlyMenuLoading(true);
    const rangeStart =
      monthlyDateMode === "custom" && monthlyRangeStart
        ? monthlyRangeStart
        : monthlyDateMode === "last7"
        ? monthStartNMonthsAgo(6, todayISTStr)
        : monthlyDateMode === "last12"
        ? monthStartNMonthsAgo(11, todayISTStr)
        : `${todayISTStr.slice(0, 4)}-01-01`;
    const rangeEndDay =
      monthlyDateMode === "custom" && monthlyRangeEnd && monthlyRangeEnd < todayISTStr
        ? monthlyRangeEnd
        : todayISTStr;
    // Unlike the mv_orders_summary fetch, this reads raw orders directly,
    // so there's no "today is missing from the view" problem to work
    // around — push the upper bound one day past rangeEndDay so today's
    // (mid-day IST) timestamps are actually included, then filter down
    // to real IST calendar days below with getFastISTParts.
    const rangeEndExclusiveMs = new Date(`${rangeEndDay}T00:00:00+05:30`).getTime() + 86400000;
    const rangeEndExclusiveIST = getFastISTParts(rangeEndExclusiveMs).dateStr;

    // Same unpaginated-request cap risk as the mv_orders_summary fetch above
    // — a several-month order window easily exceeds PostgREST's default
    // 1000-row limit, so this pages through with fetchAllPages too.
    (async () => {
      const rows = await fetchAllPages(
        supabase
          .from("orders")
          .select(MONTHLY_MENU_CATEGORY_SELECT)
          .eq("restaurant_id", restaurantId)
          .gte("created_at", `${rangeStart}T00:00:00+05:30`)
          .lt("created_at", `${rangeEndExclusiveIST}T00:00:00+05:30`)
      );
      if (cancelled) return;
      setMonthlyMenuRows(rows);
      setMonthlyMenuLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    revenueTrendView,
    revenueTrendSplitDim,
    restaurantId,
    useDemoMonthlySource,
    todayISTStr,
    monthlyDateMode,
    monthlyRangeStart,
    monthlyRangeEnd,
  ]);

  const totalMonthlyRevenueYear = useMemo(() => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const splitConfig = getSplitConfig(revenueTrendSplitDim);
    const isOrdersMetric = revenueTrendMetric === "orders";
    const rows = monthlySummaryRows || [];

    // The span of months actually being viewed — Jan-through-current-month
    // this year by default, or whatever the custom range covers (which can
    // span multiple years).
    const viewStart =
      monthlyDateMode === "custom" && monthlyRangeStart
        ? monthlyRangeStart
        : monthlyDateMode === "last7"
        ? monthStartNMonthsAgo(6, todayISTStr)
        : monthlyDateMode === "last12"
        ? monthStartNMonthsAgo(11, todayISTStr)
        : `${todayISTStr.slice(0, 4)}-01-01`;
    const viewEnd = monthlyDateMode === "custom" && monthlyRangeEnd ? monthlyRangeEnd : todayISTStr;
    const startYear = parseInt(viewStart.slice(0, 4), 10);
    const startMonth = parseInt(viewStart.slice(5, 7), 10) - 1;
    const endYear = parseInt(viewEnd.slice(0, 4), 10);
    const endMonth = parseInt(viewEnd.slice(5, 7), 10) - 1;
    // Capped at 36 months (3 years) — a bar chart beyond that stops being
    // a readable comparison regardless of how fast the query itself is.
    const totalMonths = Math.min(36, (endYear - startYear) * 12 + (endMonth - startMonth) + 1);

    const monthlyMap = new Map<string, { rev: number; count: number; byDim: number[] }>();

    if (useDemoMonthlySource) {
      // No mv_orders_summary to read (demo account / Supabase not
      // configured) — build the same monthly aggregates straight from
      // todayOrders + historicalOrders, exactly like totalDailyRevenue7
      // does for the 7-day view. This also naturally covers "today"
      // (no separate live-append step needed, unlike the Supabase path
      // below where the summary table excludes today by design).
      for (const o of [...todayOrders, ...historicalOrders]) {
        const dStr = o.istDateStr || (o.createdAt ? getFastISTParts(o.createdAt).dateStr : "");
        if (!dStr || dStr < viewStart || dStr > viewEnd) continue;
        const monthKey = dStr.slice(0, 7);
        const cur = monthlyMap.get(monthKey) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
        const rev = Number(o.total) || 0;
        cur.rev += rev;
        cur.count += 1;
        if (revenueTrendSplitDim === "menu_category") {
          (o.items || []).forEach((it) => {
            const rawCat = it.category === "Mains" ? "Main Course" : it.category;
            const idx = splitConfig.findIndex((c) => c.id === rawCat);
            const bucket = idx >= 0 ? idx : splitConfig.findIndex((c) => c.id === "Other");
            if (bucket >= 0) cur.byDim[bucket] += isOrdersMetric ? it.qty : it.price * it.qty;
          });
        } else if (splitConfig.length > 0) {
          splitConfig.forEach((c, idx) => {
            if ((c as any).matcher(o)) cur.byDim[idx] += isOrdersMetric ? 1 : rev;
          });
        }
        monthlyMap.set(monthKey, cur);
      }
    } else {
      for (const row of rows) {
        const monthKey = String(row.order_date).slice(0, 7);
        const cur = monthlyMap.get(monthKey) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
        const rowRev = Number(row.revenue) || 0;
        const rowCount = Number(row.order_count) || 0;
        cur.rev += rowRev;
        cur.count += rowCount;
        if (revenueTrendSplitDim === "order_type") {
          const idx = splitConfig.findIndex((c) => c.id === row.order_type);
          if (idx >= 0) cur.byDim[idx] += isOrdersMetric ? rowCount : rowRev;
        } else if (revenueTrendSplitDim === "payment_mode") {
          splitConfig.forEach((c, idx) => {
            if ((c as any).matcher({ source: row.order_type, payment: row.payment_mode } as Order)) {
              cur.byDim[idx] += isOrdersMetric ? rowCount : rowRev;
            }
          });
        } else if (revenueTrendSplitDim === "hours") {
          const hour = Number(row.order_hour) || 0;
          splitConfig.forEach((c, idx) => {
            if ((c as any).matcher({ istHour: hour } as Order)) cur.byDim[idx] += isOrdersMetric ? rowCount : rowRev;
          });
        }
        monthlyMap.set(monthKey, cur);
      }

      // Append TODAY live — computed straight from todayOrders, never from
      // the summary table — but ONLY if today actually falls within the
      // range being viewed (a custom range entirely in the past shouldn't
      // have today's numbers injected into it).
      const todayFallsInView = todayISTStr >= viewStart && todayISTStr <= viewEnd;
      if (todayFallsInView) {
        const currentMonthKey = todayISTStr.slice(0, 7);
        const todayCur = monthlyMap.get(currentMonthKey) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
        for (const o of todayOrders) {
          const rev = Number(o.total) || 0;
          todayCur.rev += rev;
          todayCur.count += 1;
          if (revenueTrendSplitDim !== "menu_category" && splitConfig.length > 0) {
            splitConfig.forEach((c, idx) => {
              if ((c as any).matcher(o)) todayCur.byDim[idx] += isOrdersMetric ? 1 : rev;
            });
          }
        }
        monthlyMap.set(currentMonthKey, todayCur);
      }

      // Menu category isn't in mv_orders_summary, so its byDim numbers
      // come entirely from the raw-order bypass fetch above (which
      // already includes today, unlike the summary-table rows) — walk
      // it separately and merge into the same monthlyMap the summary
      // rows already populated with rev/count, filling in only byDim.
      if (revenueTrendSplitDim === "menu_category") {
        for (const row of monthlyMenuRows || []) {
          const dStr = row.created_at ? getFastISTParts(row.created_at).dateStr : "";
          if (!dStr || dStr < viewStart || dStr > viewEnd) continue;
          const monthKey = dStr.slice(0, 7);
          const cur = monthlyMap.get(monthKey) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
          (row.order_items || []).forEach((i: any) => {
            const price = Number(i.price_snapshot) || 0;
            const qty = Number(i.qty) || 0;
            const rawCat =
              (Array.isArray(i.menu_items) ? i.menu_items[0]?.category : i.menu_items?.category) ||
              "Mains";
            const cat = rawCat === "Mains" ? "Main Course" : rawCat;
            const idx = splitConfig.findIndex((c) => c.id === cat);
            const bucket = idx >= 0 ? idx : splitConfig.findIndex((c) => c.id === "Other");
            if (bucket >= 0) cur.byDim[bucket] += isOrdersMetric ? qty : price * qty;
          });
          monthlyMap.set(monthKey, cur);
        }
      }
    }

    const labels: string[] = [];
    const revs: number[] = [];
    const counts: number[] = [];
    const byDimSeries: number[][] = [];
    for (let i = 0; i < totalMonths; i++) {
      const totalMonthIdx = startYear * 12 + startMonth + i;
      const y = Math.floor(totalMonthIdx / 12);
      const m = totalMonthIdx % 12;
      const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
      labels.push(totalMonths > 12 ? `${monthNames[m]} '${String(y).slice(-2)}` : monthNames[m]);
      const stats = monthlyMap.get(monthKey) || { rev: 0, count: 0, byDim: splitConfig.map(() => 0) };
      revs.push(stats.rev);
      counts.push(stats.count);
      byDimSeries.push(stats.byDim);
    }
    return { labels, revs, counts, byDimSeries, splitConfig, cumRev: revs.reduce((a, b) => a + b, 0), cumCount: counts.reduce((a, b) => a + b, 0) };
  }, [monthlySummaryRows, monthlyMenuRows, useDemoMonthlySource, todayOrders, historicalOrders, todayISTStr, revenueTrendSplitDim, revenueTrendMetric, monthlyDateMode, monthlyRangeStart, monthlyRangeEnd]);

  // Loading until real data is actually ready — for "monthly" specifically,
  // that means waiting for the summary-table fetch to finish, not just the
  // initial page load, otherwise months would flash as zero before
  // correcting themselves a moment later. In demo mode there's no
  // summary-table fetch at all (see useDemoMonthlySource above), so
  // monthlySummaryRows would otherwise sit at null forever and this used
  // to get stuck showing the loading skeleton indefinitely — fall back to
  // the normal "has the base order data loaded" check in that case.
  const isRevenueTrendLoading =
    revenueTrendView === "monthly"
      ? useDemoMonthlySource
        ? !hasFetched || localRefreshing
        : monthlySummaryRows === null ||
          monthlySummaryLoading ||
          (revenueTrendSplitDim === "menu_category" && (monthlyMenuRows === null || monthlyMenuLoading))
      : !hasFetched || localRefreshing;

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
          .skel-title { width: 220px; max-width: 60vw; height: 28px; }
          .skel-badge { width: 95px; height: 22px; border-radius: 999px; }
          .skel-chip { width: 140px; max-width: 45vw; height: 22px; border-radius: 999px; }
          .skel-line-sm { width: 120px; height: 16px; margin-bottom: 8px; }
          .skel-num { width: 160px; height: 36px; margin-bottom: 12px; }
          .skel-line-full { width: 100%; height: 20px; }
          .skel-tabs { width: 340px; max-width: 100%; height: 38px; border-radius: 12px; }
          .skel-line-md { width: 50%; height: 20px; margin-bottom: 12px; }
          .skel-card-body { width: 100%; height: 50px; }
          .skel-line-lg { width: 45%; height: 26px; margin-bottom: 16px; }
          .skel-chart-box { width: 100%; height: 200px; border-radius: 12px; }
          @media (max-width: 640px) {
            .restaurant-iq-page {
              padding: 10px;
              overflow-x: hidden;
            }
          }
        `}</style>
      </div>
    );
  }

  if (revenueTrendView) {
    const data = revenueTrendView === "daily" ? totalDailyRevenue7 : totalMonthlyRevenueYear;
    const isOrdersMetric = revenueTrendMetric === "orders";
    const values = isOrdersMetric ? data.counts : data.revs;
    const cumValue = isOrdersMetric ? data.cumCount : data.cumRev;
    const splitLabels: Record<string, string> = {
      total: "Total",
      order_type: "Order type",
      menu_category: "Menu category",
      payment_mode: "Payment mode",
      hours: "Shift and hours",
    };
    const maxVal = Math.max(100, ...values) * 1.15;

    return (
      <div className="restaurant-iq-page">
        <div className="revenue-trend-page">
          <button className="revenue-trend-back-btn" onClick={() => setRevenueTrendView(null)}>
            ← Back to dashboard
          </button>

          <div className="revenue-trend-header">
            <h2>
              {isOrdersMetric ? "Total orders" : "Gross revenue"},{" "}
              {revenueTrendView === "daily"
                ? dailyDateMode === "custom"
                  ? `${dailyRangeStart} to ${dailyRangeEnd}`
                  : dailyDateMode === "30days"
                  ? "last 30 days"
                  : dailyDateMode === "thismonth"
                  ? "this month"
                  : "last 7 days"
                : monthlyDateMode === "custom"
                ? `${monthlyRangeStart} to ${monthlyRangeEnd}`
                : monthlyDateMode === "last7"
                ? "last 7 months"
                : monthlyDateMode === "last12"
                ? "last 12 months"
                : "this year by month"}
            </h2>
            <p>Total across every channel — not filtered to any one dimension.</p>
          </div>

          <div className="revenue-trend-date-controls">
            <div className="revenue-trend-view-pills">
              {revenueTrendView === "daily" ? (
                <>
                  <button
                    className={`revenue-trend-view-pill ${dailyDateMode === "7days" ? "active" : ""}`}
                    onClick={() => setDailyDateMode("7days")}
                  >
                    Last 7 days
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${dailyDateMode === "30days" ? "active" : ""}`}
                    onClick={() => setDailyDateMode("30days")}
                  >
                    Last 30 days
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${dailyDateMode === "thismonth" ? "active" : ""}`}
                    onClick={() => setDailyDateMode("thismonth")}
                  >
                    This month
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${dailyDateMode === "custom" ? "active" : ""}`}
                    onClick={() => setDailyDateMode("custom")}
                  >
                    Custom
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`revenue-trend-view-pill ${monthlyDateMode === "year" ? "active" : ""}`}
                    onClick={() => setMonthlyDateMode("year")}
                  >
                    This year
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${monthlyDateMode === "last7" ? "active" : ""}`}
                    onClick={() => setMonthlyDateMode("last7")}
                  >
                    Last 7
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${monthlyDateMode === "last12" ? "active" : ""}`}
                    onClick={() => setMonthlyDateMode("last12")}
                  >
                    Last 12
                  </button>
                  <button
                    className={`revenue-trend-view-pill ${monthlyDateMode === "custom" ? "active" : ""}`}
                    onClick={() => setMonthlyDateMode("custom")}
                  >
                    Custom
                  </button>
                </>
              )}
            </div>

            {revenueTrendView === "daily" && dailyDateMode === "custom" && (
              <div className="revenue-trend-date-inputs">
                <label>
                  From
                  <input
                    type="date"
                    value={dailyRangeStart}
                    max={dailyRangeEnd || todayISTStr}
                    onChange={(e) => e.target.value && setDailyRangeStart(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={dailyRangeEnd}
                    min={dailyRangeStart}
                    max={todayISTStr}
                    onChange={(e) => e.target.value && setDailyRangeEnd(e.target.value)}
                  />
                </label>
              </div>
            )}

            {revenueTrendView === "monthly" && monthlyDateMode === "custom" && (
              <div className="revenue-trend-date-inputs">
                <label>
                  From
                  <input
                    type="date"
                    value={monthlyRangeStart}
                    max={monthlyRangeEnd || todayISTStr}
                    onChange={(e) => e.target.value && setMonthlyRangeStart(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={monthlyRangeEnd}
                    min={monthlyRangeStart}
                    max={todayISTStr}
                    onChange={(e) => e.target.value && setMonthlyRangeEnd(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="revenue-trend-view-selector">
            <span className="revenue-trend-view-label">View</span>
            <div className="revenue-trend-view-pills">
              {(["total", "order_type", "menu_category", "payment_mode", "hours"] as const).map((dim) => (
                <button
                  key={dim}
                  className={`revenue-trend-view-pill ${revenueTrendSplitDim === dim ? "active" : ""}`}
                  onClick={() => setRevenueTrendSplitDim(dim)}
                >
                  {splitLabels[dim]}
                </button>
              ))}
            </div>
          </div>

          {isRevenueTrendLoading ? (
            <div className="revenue-trend-loading">
              <div className="skel-block skel-line-lg" />
              <div className="skel-block skel-chart-box" />
              <span className="revenue-trend-loading-text">
                {revenueTrendView === "monthly"
                  ? `Loading ${isOrdersMetric ? "orders" : "revenue"} history...`
                  : `Loading ${isOrdersMetric ? "orders" : "revenue"}...`}
              </span>
            </div>
          ) : (
            <>
              <div className="revenue-trend-total-card">
                <span className="revenue-trend-total-label">
                  Total {isOrdersMetric ? "orders" : "revenue"} {revenueTrendView === "daily" ? "this week" : "this year"}
                </span>
                <span className="revenue-trend-total-value">
                  {isOrdersMetric
                    ? Math.round(cumValue).toLocaleString("en-IN")
                    : `₹${Math.round(cumValue).toLocaleString("en-IN")}`}
                </span>
              </div>

              <div className="revenue-trend-chart-area">
                <div
                  className="revenue-trend-scroll-wrap"
                  style={{ minWidth: `${data.labels.length * 42}px` }}
                >
                  <div className="revenue-trend-bars-row">
                    {data.labels.map((label, i) => {
                      const heightPct = Math.max(2, Math.round((values[i] / maxVal) * 100));
                      const isLast = i === data.labels.length - 1;
                      const dataLabel = formatCompactNumber(values[i], !isOrdersMetric);
                      if (revenueTrendSplitDim === "total" || data.splitConfig.length === 0) {
                        return (
                          <div key={label} className="revenue-trend-bar-col">
                            <span className={`revenue-trend-bar-datalabel ${isLast ? "is-current" : ""}`}>
                              {dataLabel}
                            </span>
                            <div
                              className={`revenue-trend-bar ${isLast ? "is-current" : ""}`}
                              style={{ height: `${heightPct}%` }}
                              title={`${label}: ${isOrdersMetric ? `${values[i]} orders` : `₹${values[i].toLocaleString("en-IN")}`}`}
                            />
                          </div>
                        );
                      }
                      const dimValues = data.byDimSeries[i] || [];
                      return (
                        <div key={label} className="revenue-trend-bar-col">
                          <span className={`revenue-trend-bar-datalabel ${isLast ? "is-current" : ""}`}>
                            {dataLabel}
                          </span>
                          <div className="revenue-trend-stacked-bar" style={{ height: `${heightPct}%` }}>
                            {data.splitConfig.map((c, ci) => {
                              const segVal = dimValues[ci] || 0;
                              const segPct = values[i] > 0 ? (segVal / values[i]) * 100 : 0;
                              return segPct > 0 ? (
                                <div
                                  key={c.id}
                                  className="revenue-trend-bar-segment"
                                  style={{ height: `${segPct}%`, background: c.color }}
                                  title={`${c.name}: ${isOrdersMetric ? `${Math.round(segVal)} orders` : `₹${Math.round(segVal).toLocaleString("en-IN")}`}`}
                                />
                              ) : null;
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="revenue-trend-labels-row">
                    {data.labels.map((label, i) => (
                      <span
                        key={label}
                        className={`revenue-trend-day-label ${i === data.labels.length - 1 ? "is-current" : ""}`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {revenueTrendSplitDim !== "total" && data.splitConfig.length > 0 && (
                <div className="revenue-trend-legend">
                  {data.splitConfig.map((c) => (
                    <span key={c.id} className="revenue-trend-legend-item">
                      <span className="revenue-trend-legend-dot" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <style jsx>{`
          .revenue-trend-page {
            max-width: 640px;
            margin: 0 auto;
            padding: 24px 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .revenue-trend-back-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: none;
            border: none;
            padding: 0;
            color: #2563eb;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            width: fit-content;
          }
          .revenue-trend-header h2 {
            font-size: 18px;
            font-weight: 800;
            margin: 0;
            color: #0f172a;
          }
          .revenue-trend-header p {
            font-size: 13px;
            margin: 4px 0 0;
            color: #64748b;
          }
          .revenue-trend-date-controls {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-bottom: 10px;
            border-bottom: 1px dashed #e2e8f0;
          }
          .revenue-trend-date-inputs {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }
          .revenue-trend-date-inputs label {
            display: flex;
            flex-direction: column;
            gap: 3px;
            font-size: 11.5px;
            color: #64748b;
            font-weight: 600;
          }
          .revenue-trend-date-inputs input {
            height: 32px;
            padding: 0 8px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 12.5px;
          }
          .revenue-trend-view-selector {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .revenue-trend-view-label {
            font-size: 12px;
            color: #64748b;
          }
          .revenue-trend-view-pills {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }
          .revenue-trend-view-pill {
            font-size: 12px;
            padding: 6px 12px;
            border-radius: 8px;
            background: #f1f5f9;
            color: #475569;
            border: none;
            cursor: pointer;
            font-weight: 600;
          }
          .revenue-trend-view-pill.active {
            background: #dbeafe;
            color: #1d4ed8;
            border: 1.5px solid #93c5fd;
          }
          .revenue-trend-view-pill:disabled {
            opacity: 0.45;
            cursor: not-allowed;
          }
          .revenue-trend-loading {
            display: flex;
            flex-direction: column;
            gap: 12px;
            align-items: center;
            padding: 20px 0;
          }
          .revenue-trend-loading .skel-line-lg {
            width: 60%;
            height: 16px;
            border-radius: 6px;
          }
          .revenue-trend-loading .skel-chart-box {
            width: 100%;
            height: 160px;
            border-radius: 10px;
          }
          .revenue-trend-loading-text {
            font-size: 12.5px;
            color: #64748b;
            font-weight: 600;
          }
          .revenue-trend-total-card {
            background: #f8fafc;
            border-radius: 10px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .revenue-trend-total-label {
            font-size: 12px;
            color: #64748b;
          }
          .revenue-trend-total-value {
            font-size: 26px;
            font-weight: 800;
            color: #0f172a;
          }
          .revenue-trend-chart-area {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .revenue-trend-scroll-wrap {
            /* Mobile constraint: never widen the chart card to fit more
               bars/labels — scroll horizontally within it instead. */
            overflow-x: auto;
            overflow-y: hidden;
            -webkit-overflow-scrolling: touch;
          }
          .revenue-trend-bars-row {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            height: 160px;
          }
          .revenue-trend-bar-col {
            flex: 1 0 34px;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
          }
          .revenue-trend-bar-datalabel {
            font-size: 9.5px;
            font-weight: 700;
            color: #64748b;
            white-space: nowrap;
          }
          .revenue-trend-bar-datalabel.is-current {
            color: #047857;
          }
          .revenue-trend-bar {
            width: 100%;
            border-radius: 4px 4px 0 0;
            background: #5DCAA5;
          }
          .revenue-trend-bar.is-current {
            background: #1D9E75;
          }
          .revenue-trend-stacked-bar {
            width: 100%;
            display: flex;
            flex-direction: column-reverse;
            border-radius: 4px 4px 0 0;
            overflow: hidden;
          }
          .revenue-trend-bar-segment {
            width: 100%;
          }
          .revenue-trend-labels-row {
            display: flex;
            gap: 8px;
          }
          .revenue-trend-day-label {
            flex: 1 0 34px;
            text-align: center;
            font-size: 10.5px;
            color: #94a3b8;
          }
          .revenue-trend-day-label.is-current {
            font-weight: 800;
            color: #0f172a;
          }
          .revenue-trend-legend {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }
          .revenue-trend-legend-item {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            color: #475569;
          }
          .revenue-trend-legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 2px;
            display: inline-block;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="restaurant-iq-page">
      {/* 1. TOP BRANDED HEADER WITH LOGO & SUBSCRIPT */}
      <header className="iq-top-header">
        <div className="header-left">
          <div className="brand-logo-group">
            <div className="iq-logo-squircle">
              <span>IQ</span>
            </div>
            <div className="brand-names-column">
              <div className="restaurant-title-row">
                <h1 className="restaurant-title">{restaurantName}</h1>
                <span className="live-pacing-tag">
                  <span className="pulsing-live-dot" /> LIVE PACING
                </span>
              </div>
              <span className="brand-subscript">Restaurant IQ</span>
            </div>
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
            className="action-btn daily-summary-btn"
            onClick={() => setShowDailySummary(true)}
            title="Day-wise revenue, orders and running totals"
          >
            <Calendar size={15} />
            <span>Daily Summary</span>
          </button>

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

      {/* 2. TOP BENCHMARK CARD (REVENUE ON LEFT [TODAY TOP, MTD BELOW] | ORDERS ON RIGHT [TODAY TOP, MTD BELOW]) */}
      <section className="kpi-top-section">
        <div className="master-benchmark-card">
          <div className="kpi-boxes-split">
            {/* LEFT BOX: REVENUE (Today on top, MTD below) */}
            <div className={`kpi-box-tile revenue-box ${timeframeMode === "today" ? "focus-today" : "focus-mtd"}`}>
              <div
                className="box-header-row"
                onClick={jumpToLast15Days}
                title="Click to see the last 15 days — or pick a custom date range below"
                style={{ cursor: "pointer" }}
              >
                <span className="box-title">
                  <span>💰</span> Today's Revenue
                </span>
                <span className="status-pill revenue-pill">REVENUE</span>
              </div>

              {/* TOP: Today's Revenue */}
              <div
                className={`metric-tier-card ${timeframeMode === "today" ? "active-tier" : ""}`}
                onClick={() => {
                  setTimeframeMode("today");
                  setRevenueTrendMetric("revenue");
                  setRevenueTrendView("daily");
                }}
                title="Click to view the last 7 days' total daily revenue"
              >
                <div className="metric-tier-header">
                  <span className="tier-tag">Today ({topMetrics.monthShortName} {getFastISTParts(now).dateStr.slice(-2)})</span>
                  <span className="tier-subtext">vs Usual {weekdayName} Pacing</span>
                </div>
                <div className="metric-val-wrap">
                  <span className={`rev-number ${topMetrics.revUp ? "rev-up" : "rev-down"}`}>
                    ₹{topMetrics.todayRev.toLocaleString("en-IN")}
                  </span>
                  <span className={`growth-pill ${topMetrics.revUp ? "positive" : "negative"}`}>
                    {topMetrics.revUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    <span>{topMetrics.revGrowthPct}</span>
                  </span>
                </div>
              </div>

              <div className="box-inner-divider" />

              {/* BOTTOM: MTD Revenue */}
              <div
                className={`metric-tier-card mtd-tier ${timeframeMode === "mtd" ? "active-tier" : ""}`}
                onClick={() => {
                  setTimeframeMode("mtd");
                  setRevenueTrendMetric("revenue");
                  setRevenueTrendView("monthly");
                }}
                title="Click to view this year's total month-by-month revenue"
              >
                <div className="metric-tier-header">
                  <span className="tier-tag">{topMetrics.monthShortName} Month-To-Date</span>
                  <span className="chip-neutral-days">{topMetrics.mtdDays} Days</span>
                </div>
                <div className="metric-val-wrap">
                  <span className="rev-number rev-mtd-green">
                    ₹{topMetrics.mtdRev.toLocaleString("en-IN")}
                  </span>
                  <span className="mtd-runrate-text">
                    Avg ₹{Math.round(topMetrics.mtdAvgDailyRev / 1000)}k/day
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT BOX: ORDERS (Today on top, MTD below) */}
            <div className={`kpi-box-tile orders-box ${timeframeMode === "today" ? "focus-today" : "focus-mtd"}`}>
              <div
                className="box-header-row"
                onClick={jumpToLast15Days}
                title="Click to see the last 15 days — or pick a custom date range below"
                style={{ cursor: "pointer" }}
              >
                <span className="box-title">
                  <span>📦</span> Today's Orders
                </span>
                <span className="status-pill orders-pill">ORDERS</span>
              </div>

              {/* TOP: Today's Orders */}
              <div
                className={`metric-tier-card ${timeframeMode === "today" ? "active-tier" : ""}`}
                onClick={() => {
                  setTimeframeMode("today");
                  setRevenueTrendMetric("orders");
                  setRevenueTrendView("daily");
                }}
                title="Click to view the last 7 days' total daily orders"
              >
                <div className="metric-tier-header">
                  <span className="tier-tag">Today ({topMetrics.monthShortName} {getFastISTParts(now).dateStr.slice(-2)})</span>
                  <span className="tier-subtext">vs Usual {weekdayName} Pacing</span>
                </div>
                <div className="metric-val-wrap">
                  <div className="orders-count-group">
                    <span className="orders-number blue-orders">{topMetrics.todayCount}</span>
                    <span className="orders-unit-label">Orders</span>
                  </div>
                  <span className={`growth-pill ${topMetrics.ordersUp ? "positive" : "negative"}`}>
                    {topMetrics.ordersUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    <span>
                      {topMetrics.ordersGrowthPct} ({topMetrics.ordersDelta >= 0 ? "+" : ""}{topMetrics.ordersDelta})
                    </span>
                  </span>
                </div>
              </div>

              <div className="box-inner-divider" />

              {/* BOTTOM: MTD Orders */}
              <div
                className={`metric-tier-card mtd-tier ${timeframeMode === "mtd" ? "active-tier" : ""}`}
                onClick={() => {
                  setTimeframeMode("mtd");
                  setRevenueTrendMetric("orders");
                  setRevenueTrendView("monthly");
                }}
                title="Click to view this year's total month-by-month orders"
              >
                <div className="metric-tier-header">
                  <span className="tier-tag">{topMetrics.monthShortName} Month-To-Date</span>
                  <span className="chip-neutral-days">{topMetrics.mtdDays} Days</span>
                </div>
                <div className="metric-val-wrap">
                  <div className="orders-count-group">
                    <span className="orders-number blue-orders">{topMetrics.mtdOrders.toLocaleString("en-IN")}</span>
                    <span className="orders-unit-label">Orders MTD</span>
                  </div>
                  <span className="mtd-runrate-text blue">
                    Avg {topMetrics.mtdAvgDailyOrders} ord/day
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* COMBINED BENCHMARK FOOTER STRIP */}
          <div className="benchmark-combined-strip">
            <div className="bench-info-left">
              <span className="bench-label">Usual {weekdayName}:</span>
              <strong className="bench-stat-bold">
                ₹{Math.round(topMetrics.baselineRev).toLocaleString("en-IN")}
              </strong>
              <span className="bench-bullet">·</span>
              <strong className="bench-stat-bold">
                {topMetrics.baselineOrders} orders
              </strong>
            </div>
            <div className={`bench-delta-tag ${topMetrics.revUp && topMetrics.ordersUp ? "positive" : "negative"}`}>
              💡 {topMetrics.revDelta >= 0 ? "+" : "-"}₹{Math.abs(topMetrics.revDelta).toLocaleString("en-IN")} &amp; {topMetrics.ordersDelta >= 0 ? "+" : ""}{topMetrics.ordersDelta} Orders {topMetrics.revUp ? "UP" : "DOWN"}
            </div>
          </div>
          <p className="benchmark-footnote">
            *Compared to historical average of last 3 {weekdayName}s at this exact same hour of day.
          </p>
        </div>
      </section>

      {/* 3. SAME-DAY VERTICAL BAR CHART & 4-DIMENSION EXPLORER */}
      <section className="same-day-chart-section" id="barchart-overview-section">
        <div className="same-day-chart-card">
          {/* Chart Header Row */}
          <div className="chart-header-row">
            <div className="chart-header-left">
              <div className="chart-title-badge">
                <span className="live-dot" />
                <span className="badge-text">
                  {timeframeMode === "mtd" ? "MONTH-TO-DATE OVERVIEW" : "SAME-DAY OVERVIEW"}
                </span>
              </div>
              <h3 className="chart-main-title">
                {timeframeMode === "mtd" ? (
                  <>
                    {dimension === "order_type" && `${topMetrics.monthShortName} MTD Orders & Revenue by Order Type`}
                    {dimension === "menu_category" && `${topMetrics.monthShortName} MTD Items & Revenue by Menu Category`}
                    {dimension === "payment_mode" && `${topMetrics.monthShortName} MTD Collections & Volume by Payment Mode`}
                    {dimension === "hours" && `${topMetrics.monthShortName} MTD Flow & Revenue by Shift & Hours`}
                  </>
                ) : (
                  <>
                    {dimension === "order_type" && "Today's Orders & Revenue by Order Type"}
                    {dimension === "menu_category" && "Today's Items & Revenue by Menu Category"}
                    {dimension === "payment_mode" && "Today's Collections & Volume by Payment Mode"}
                    {dimension === "hours" && "Today's Flow & Revenue by Shift & Hours"}
                  </>
                )}
              </h3>
              <p className="chart-subtitle">
                Click any card below to drill down into its 7-day velocity pacing.
              </p>
            </div>
          </div>

          {/* 4 Interactive Dimension Tabs (Clean, bold, distinct buttons) */}
          <div className="dimension-tab-bar">
            <button
              className={`dim-tab-btn ${dimension === "order_type" ? "active" : ""}`}
              onClick={() => {
                setDimension("order_type");
                setSelectedItemId("ZOMATO");
              }}
            >
              <span className="dim-tab-icon">🛵</span>
              <span className="dim-tab-title">Order Type</span>
            </button>

            <button
              className={`dim-tab-btn ${dimension === "menu_category" ? "active" : ""}`}
              onClick={() => {
                setDimension("menu_category");
                setSelectedItemId("Rice & Biryani");
              }}
            >
              <span className="dim-tab-icon">🍛</span>
              <span className="dim-tab-title">Menu Category</span>
            </button>

            <button
              className={`dim-tab-btn ${dimension === "payment_mode" ? "active" : ""}`}
              onClick={() => {
                setDimension("payment_mode");
                setSelectedItemId("UPI");
              }}
            >
              <span className="dim-tab-icon">💳</span>
              <span className="dim-tab-title">Payment Mode</span>
            </button>

            <button
              className={`dim-tab-btn ${dimension === "hours" ? "active" : ""}`}
              onClick={() => {
                setDimension("hours");
                setSelectedItemId("evening");
              }}
            >
              <span className="dim-tab-icon">⏰</span>
              <span className="dim-tab-title">Shift & Hours</span>
            </button>
          </div>

          {/* HORIZONTAL BAR CHART — one bar per category in the active
              dimension. Clicking a bar opens the full-page drilldown
              below, exactly like clicking a Today's Revenue KPI opens
              revenueTrendView. Bars with a zero value for the active
              metric are dropped rather than drawn as a sliver. */}
          {(() => {
            const metricKey: "rev" | "orders" = chartMetric === "orders" ? "orders" : "rev";
            const barItems = currentDimensionCards.filter((item) => (item[metricKey] as number) > 0);
            const maxVal = Math.max(1, ...barItems.map((item) => item[metricKey] as number));

            return (
              <div className="horizontal-bar-chart">
                <div className="bar-chart-header-row">
                  <span className="bar-chart-header-label">
                    {chartMetric === "orders" ? "Orders" : "Revenue"} by {dimensionLabel}
                  </span>
                  <div className="chart-metric-toggle-group">
                    <div className="metric-toggle-pills">
                      <button
                        className={`toggle-btn ${chartMetric === "revenue" ? "active-revenue" : ""}`}
                        onClick={() => setChartMetric("revenue")}
                      >
                        Revenue
                      </button>
                      <button
                        className={`toggle-btn ${chartMetric === "orders" ? "active-orders" : ""}`}
                        onClick={() => setChartMetric("orders")}
                      >
                        Orders
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bar-chart-rows">
                  {barItems.length === 0 && (
                    <div className="bar-chart-empty">
                      No {chartMetric === "orders" ? "orders" : "revenue"} yet for {dimensionLabel.toLowerCase()} in this period.
                    </div>
                  )}
                  {barItems.map((item) => {
                    const val = item[metricKey] as number;
                    const pct = Math.max(4, Math.round((val / maxVal) * 100));
                    const isUp = metricKey === "orders" ? item.orderUp : item.revUp;
                    const growthLabel = metricKey === "orders" ? item.orderGrowth : item.revGrowth;
                    const displayVal = formatCompactNumber(val, metricKey !== "orders");
                    const isSelected = item.id === selectedItemId;

                    return (
                      <div
                        key={item.id}
                        className={`bar-chart-row ${isSelected ? "bar-row-selected" : ""}`}
                        onClick={() => {
                          setSelectedItemId(item.id);
                          setDimensionDrilldownOpen(true);
                        }}
                      >
                        <div className="bar-row-label">
                          <span className="bar-row-icon" style={{ backgroundColor: item.iconBg }}>
                            {item.icon}
                          </span>
                          <span className="bar-row-name">{item.name}</span>
                        </div>
                        <div className="bar-row-track">
                          <div
                            className={`bar-row-fill ${isUp ? "fill-up" : "fill-down"}`}
                            style={{ width: `${pct}%`, backgroundColor: item.iconBg }}
                          />
                        </div>
                        <div className="bar-row-value">
                          <span className="bar-row-num">{displayVal}</span>
                          <span className={`bar-row-growth ${isUp ? "positive" : "negative"}`}>
                            {growthLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* 4. FULL-PAGE CATEGORY DRILLDOWN — takes over from the bar chart
          section above, same pattern as revenueTrendView's own page. */}
      {dimensionDrilldownOpen && drilldownData && activeCard && (
        <div className="dimension-drilldown-page" id="drilldown-section">
          <button
            className="back-to-dashboard-btn"
            onClick={() => setDimensionDrilldownOpen(false)}
          >
            ← Back to dashboard
          </button>
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
                      dateRange === "15days" ? "active" : ""
                    }`}
                    onClick={() => setDateRange("15days")}
                  >
                    Last 15 Days
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
                        : dateRange === "15days"
                        ? "15 Days"
                        : dateRange === "30days"
                        ? "30 Days"
                        : dateRange === "year_by_month"
                        ? "This Year"
                        : "Selected"}
                    </span>
                  </div>
                </div>

                <div className="cumulative-card orders-cum">
                  <span className="cum-label">
                    {dimension === "menu_category" ? "Cumulative Items Sold" : "Cumulative Orders"}
                  </span>
                  <div className="cum-val-row">
                    <span className="cum-number">{drilldownData.cumOrders}</span>
                    <span className="cum-unit">{dimension === "menu_category" ? "items" : "orders"}</span>
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
                        : dateRange === "15days"
                        ? "15 Days"
                        : dateRange === "30days"
                        ? "30 Days"
                        : dateRange === "year_by_month"
                        ? "This Year"
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
                        : dateRange === "15days"
                        ? "Last 15 Days"
                        : dateRange === "30days"
                        ? "Last 4 Weeks"
                        : dateRange === "year_by_month"
                        ? "Month by Month, This Year"
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
                        0 orders were placed for {activeCard.name} during this {dateRange === "today" ? "shift today" : dateRange === "7days" ? "7-day period" : dateRange === "15days" ? "15-day period" : dateRange === "30days" ? "30-day period" : "selected custom range"}.
                      </div>
                    </div>
                  ) : (
                    <svg
                      key={`interactive-svg-${activeCard?.id || "card"}-${dateRange}-${customStart}-${customEnd}-${graphMetric}-${days.length}`}
                      viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
                      className="interactive-svg"
                      style={
                        needsHorizontalScroll
                          ? { width: `${chartWidth}px`, minWidth: `${chartWidth}px` }
                          : undefined
                      }
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
                          (dateRange === "15days" && i === days.length - 1) ||
                          (dateRange === "30days" && i === days.length - 1) ||
                          (dateRange === "year_by_month" && i === days.length - 1) ||
                          (dateRange === "custom" && customEnd === todayISTStr && i === days.length - 1);

                        // Clicking a month's bar in the year_by_month view
                        // drills into that month's own daily breakdown —
                        // reuses the existing "custom" range machinery
                        // (which already computes real day-by-day
                        // aggregation for any span) instead of a second,
                        // separate computation path.
                        const handleBarClick =
                          dateRange === "year_by_month"
                            ? () => {
                                const year = todayISTStr.slice(0, 4);
                                const monthStr = String(i + 1).padStart(2, "0");
                                const monthStart = `${year}-${monthStr}-01`;
                                const lastDayOfMonth = new Date(
                                  `${year}-${monthStr}-01T00:00:00+05:30`
                                );
                                lastDayOfMonth.setMonth(lastDayOfMonth.getMonth() + 1);
                                lastDayOfMonth.setDate(0);
                                const lastDayStr = getFastISTParts(
                                  lastDayOfMonth.getTime()
                                ).dateStr;
                                const monthEnd =
                                  lastDayStr > todayISTStr ? todayISTStr : lastDayStr;
                                setCustomStart(monthStart);
                                setCustomEnd(monthEnd);
                                setDateRange("custom");
                              }
                            : undefined;

                        return (
                          <g
                            key={`bar-group-${activeCard?.id}-${dateRange}-${i}-${day}`}
                            onClick={handleBarClick}
                            style={handleBarClick ? { cursor: "pointer" } : undefined}
                          >
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
                                      ? "#059669"
                                      : "rgba(16, 185, 129, 0.65)"
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
                                  {formatCompactNumber(r, true)}
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
                              fill={isTodayBar ? "#059669" : "currentColor"}
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
                              (dateRange === "15days" && i === days.length - 1) ||
                              (dateRange === "30days" && i === days.length - 1) ||
                              (dateRange === "year_by_month" && i === days.length - 1) ||
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
                              stroke="#2563eb"
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
                                      fill="#1e3a8a"
                                      stroke="#2563eb"
                                      strokeWidth="2"
                                    />
                                    <text
                                      x={pt.x}
                                      y={pt.y + (graphMetric === "orders" ? -8 : 13)}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontWeight="700"
                                      fill="#2563eb"
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
                        <span className="color-swatch orders" /> {dimension === "menu_category" ? "Items (Count)" : "Orders (Count)"}
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
        </div>
      )}

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

      {/* DAILY SUMMARY MODAL — day-wise revenue, orders and running totals */}
      {showDailySummary && (
        <div className="daily-summary-overlay" onClick={() => setShowDailySummary(false)}>
          <div className="daily-summary-modal" onClick={(e) => e.stopPropagation()}>
            <div className="daily-summary-drag-handle" />
            <div className="daily-summary-modal-header">
              <h3>Daily Summary</h3>
              <button
                className="daily-summary-close-btn"
                onClick={() => setShowDailySummary(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="daily-summary-subtitle">
              Day-wise revenue and orders, with running (cumulative) totals for {formatISTDate(dailySummaryMonthStart, { month: "long", year: "numeric" })} — starting from the 1st.
            </p>
            <div className="daily-summary-month-pills">
              <button
                className={`daily-summary-month-pill ${dailySummaryMonthOffset === 0 ? "active" : ""}`}
                onClick={() => setDailySummaryMonthOffset(0)}
              >
                This Month
              </button>
              <button
                className={`daily-summary-month-pill ${dailySummaryMonthOffset === 1 ? "active" : ""}`}
                onClick={() => setDailySummaryMonthOffset(1)}
              >
                Last Month
              </button>
            </div>
            <div className="daily-summary-table-wrap">
              <table className="daily-summary-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Revenue</th>
                    <th>Orders</th>
                    <th>Cumulative revenue</th>
                    <th>Cumulative orders</th>
                  </tr>
                </thead>
                <tbody>
                  {dailySummaryStillLoadingOlderMonth ? (
                    <tr>
                      <td colSpan={5} className="daily-summary-empty">
                        Loading last month's data...
                      </td>
                    </tr>
                  ) : dailySummaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="daily-summary-empty">
                        No data for this period.
                      </td>
                    </tr>
                  ) : (
                    [...dailySummaryRows]
                      .reverse()
                      .map((row) => (
                        <tr key={row.dateStr} className={row.dateStr === todayISTStr ? "is-today" : ""}>
                          <td>
                            {formatISTDate(row.dateStr, { day: "numeric", month: "short", year: "numeric" })}
                            {row.dateStr === todayISTStr ? " (Today)" : ""}
                          </td>
                          <td>₹{Math.round(row.rev).toLocaleString("en-IN")}</td>
                          <td>{row.count}</td>
                          <td>₹{Math.round(row.cumRev).toLocaleString("en-IN")}</td>
                          <td>{row.cumCount}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STYLED-JSX FOR ROCK-SOLID, ZERO-DEPENDENCY STYLING */}
      <style jsx>{`
        .restaurant-iq-page {
          min-height: 100vh;
          background: #f8fafc;
          color: #0f172a;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        /* 1. Top Header with Logo & Subscript */
        .iq-top-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 14px;
          background: #ffffff;
          padding: 16px 20px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .brand-logo-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .iq-logo-squircle {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: linear-gradient(145deg, #064e3b 0%, #065f46 45%, #059669 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.5px;
          box-shadow: 0 4px 10px rgba(5, 150, 105, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.25);
          flex-shrink: 0;
          font-family: Inter, system-ui, -apple-system, sans-serif;
        }

        .brand-names-column {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }

        .restaurant-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .restaurant-title {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin: 0;
          line-height: 1.2;
          letter-spacing: -0.3px;
        }

        .brand-subscript {
          font-size: 11.5px;
          font-weight: 700;
          color: #059669;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          line-height: 1;
        }

        .live-pacing-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 800;
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
          padding: 3px 9px;
          border-radius: 999px;
          letter-spacing: 0.4px;
        }

        .pulsing-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #059669;
          box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.25);
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
          flex-wrap: wrap;
        }

        .date-chip, .shift-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          font-weight: 600;
          color: #64748b;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          padding: 4px 10px;
          border-radius: 6px;
        }

        .shift-chip {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
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
          background: #0f172a;
          color: #ffffff;
        }

        .refresh-btn:hover {
          background: #1e293b;
        }

        .refresh-btn.spin svg {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .logout-btn {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #64748b;
        }

        .logout-btn:hover {
          background: #fef2f2;
          color: #ef4444;
          border-color: #fecaca;
        }

        .daily-summary-btn {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #334155;
        }

        .daily-summary-btn:hover {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
        }

        .daily-summary-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 1000;
          animation: daily-summary-fade-in 0.18s ease;
        }

        @keyframes daily-summary-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .daily-summary-modal {
          background: #ffffff;
          border-radius: 16px;
          width: 100%;
          max-width: 640px;
          max-height: 82vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          animation: daily-summary-pop-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes daily-summary-pop-in {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes daily-summary-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .daily-summary-drag-handle {
          display: none;
        }

        .daily-summary-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px 4px;
        }

        .daily-summary-modal-header h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
        }

        .daily-summary-close-btn {
          border: 0;
          background: #f1f5f9;
          color: #64748b;
          border-radius: 8px;
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .daily-summary-close-btn:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .daily-summary-subtitle {
          margin: 0;
          padding: 0 20px 10px;
          font-size: 12.5px;
          color: #64748b;
        }

        .daily-summary-month-pills {
          display: flex;
          gap: 8px;
          padding: 0 20px 14px;
        }

        .daily-summary-month-pill {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #475569;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .daily-summary-month-pill:hover {
          background: #f8fafc;
        }

        .daily-summary-month-pill.active {
          background: #0f172a;
          color: #ffffff;
          border-color: #0f172a;
        }

        .daily-summary-table-wrap {
          overflow-y: auto;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding: 0 20px 20px;
        }

        .daily-summary-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }

        .daily-summary-table thead th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          text-align: right;
          font-weight: 700;
          color: #64748b;
          padding: 8px 10px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }

        .daily-summary-table thead th:first-child {
          text-align: left;
        }

        .daily-summary-table tbody td {
          text-align: right;
          padding: 8px 10px;
          border-bottom: 1px solid #f1f5f9;
          color: #0f172a;
          white-space: nowrap;
        }

        .daily-summary-table tbody td:first-child {
          text-align: left;
          font-weight: 600;
          color: #334155;
        }

        .daily-summary-table tbody tr.is-today td {
          background: #eff6ff;
        }

        .daily-summary-empty {
          text-align: center !important;
          color: #94a3b8;
          padding: 24px 0 !important;
        }

        /* 2. Master Benchmark Card (Revenue Left | Orders Right) */
        .kpi-top-section {
          width: 100%;
        }

        .master-benchmark-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .kpi-boxes-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .kpi-box-tile {
          border-radius: 14px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
        }

        .kpi-box-tile.revenue-box {
          border: 2px solid #10b981;
          background: #f0fdf4;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12), 0 2px 4px rgba(16, 185, 129, 0.04);
        }

        .kpi-box-tile.orders-box {
          border: 2px solid #2563eb;
          background: #eff6ff;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12), 0 2px 4px rgba(37, 99, 235, 0.04);
        }

        .box-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .box-title {
          font-size: 12.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .revenue-box .box-title { color: #047857; }
        .orders-box .box-title { color: #1d4ed8; }

        .status-pill {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 7px;
          border-radius: 4px;
        }

        .status-pill.revenue-pill { background: #10b981; color: #ffffff; }
        .status-pill.orders-pill { background: #2563eb; color: #ffffff; }

        /* Metric Tier Cards (Today on top, MTD below) */
        .metric-tier-card {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.18s ease;
          border: 1px solid transparent;
        }

        .metric-tier-card:hover {
          background: rgba(255, 255, 255, 0.85);
          border-color: rgba(0, 0, 0, 0.08);
          transform: translateY(-1px);
        }

        .metric-tier-card.active-tier {
          background: #ffffff;
          border: 1.5px solid rgba(0, 0, 0, 0.12);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
        }

        .metric-tier-card.mtd-tier {
          background: rgba(255, 255, 255, 0.65);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }

        .metric-tier-card.mtd-tier.active-tier {
          background: #ffffff;
          border: 1.5px solid rgba(0, 0, 0, 0.14);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
        }

        .metric-tier-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .tier-tag {
          font-weight: 800;
          color: #0f172a;
        }

        .tier-subtext {
          font-size: 10.5px;
          color: #64748b;
          font-weight: 600;
        }

        .metric-val-wrap {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rev-number {
          font-size: 27px;
          font-weight: 900;
          letter-spacing: -0.5px;
          line-height: 1.1;
        }

        .rev-up { color: #047857; }
        .rev-down { color: #b91c1c; }
        .rev-mtd-green { color: #047857; }

        .orders-count-group {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .orders-number {
          font-size: 27px;
          font-weight: 900;
          letter-spacing: -0.5px;
          line-height: 1.1;
        }

        .blue-orders { color: #2563eb; }

        .orders-unit-label {
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
        }

        .growth-pill {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 11.5px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 999px;
          line-height: 1.2;
        }

        .growth-pill.positive {
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }

        .growth-pill.negative {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        .box-inner-divider {
          height: 1px;
          background: rgba(0, 0, 0, 0.07);
          margin: 2px 0;
        }

        .chip-neutral-days {
          font-size: 10.5px;
          font-weight: 700;
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
          padding: 2px 7px;
          border-radius: 6px;
        }

        .mtd-runrate-text {
          font-size: 11.5px;
          font-weight: 700;
          color: #047857;
        }

        .mtd-runrate-text.blue {
          color: #2563eb;
        }

        /* Combined Benchmark Footer Strip */
        .benchmark-combined-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f8fafc;
          border: 1px dashed #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .bench-info-left {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          flex-wrap: wrap;
        }

        .bench-label {
          color: #64748b;
        }

        .bench-stat-bold {
          font-weight: 800;
          color: #0f172a;
        }

        .bench-bullet {
          color: #cbd5e1;
          font-weight: 900;
        }

        .bench-delta-tag {
          font-weight: 800;
          font-size: 11.5px;
          padding: 4px 10px;
          border-radius: 6px;
        }

        .bench-delta-tag.negative {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        .bench-delta-tag.positive {
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }

        .benchmark-footnote {
          font-size: 10.5px;
          color: #94a3b8;
          margin: -4px 0 0 2px;
        }

        /* 3. SAME-DAY VERTICAL BAR CHART & 4-DIMENSION EXPLORER */
        .same-day-chart-section {
          width: 100%;
        }

        .same-day-chart-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 20px 22px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .chart-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 14px;
        }

        .chart-header-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .chart-title-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 3px 8px;
          border-radius: 999px;
          width: fit-content;
        }

        .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        }

        .badge-text {
          font-size: 10.5px;
          font-weight: 800;
          color: #475569;
          letter-spacing: 0.5px;
        }

        .chart-main-title {
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
          margin: 0;
          letter-spacing: -0.3px;
        }

        .chart-subtitle {
          font-size: 12px;
          color: #64748b;
          margin: 0;
        }

        .chart-metric-toggle-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .toggle-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }

        .metric-toggle-pills {
          display: flex;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 3px;
          gap: 2px;
        }

        .toggle-btn {
          border: 0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 7px;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .toggle-btn:hover {
          color: #0f172a;
        }

        .toggle-btn.active-orders {
          background: #2563eb;
          color: #ffffff;
          box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
        }

        .toggle-btn.active-revenue {
          background: #059669;
          color: #ffffff;
          box-shadow: 0 2px 4px rgba(5, 150, 105, 0.25);
        }

        .toggle-btn.active-both {
          background: #0f172a;
          color: #ffffff;
          box-shadow: 0 2px 4px rgba(15, 23, 42, 0.25);
        }

        /* 4 Dimension Category Buttons */
        .dimension-tab-bar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 6px;
        }

        .dim-tab-btn {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 9px;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.18s ease;
          text-align: center;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }

        .dim-tab-btn:hover {
          border-color: #cbd5e1;
          background: #f1f5f9;
        }

        .dim-tab-btn.active {
          background: #0f172a;
          border-color: #0f172a;
          color: #ffffff;
          box-shadow: 0 3px 8px rgba(15, 23, 42, 0.2);
        }

        .dim-tab-icon {
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
        }

        .dim-tab-title {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
        }

        .dim-tab-btn.active .dim-tab-title {
          color: #ffffff;
        }

        .dimension-summary-subbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .summary-guide-text {
          font-weight: 600;
          color: #334155;
        }

        .click-guide-pill {
          font-size: 11px;
          font-weight: 800;
          color: #047857;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 2px 8px;
          border-radius: 999px;
        }

        .click-to-inspect-badge {
          font-size: 9.5px;
          font-weight: 700;
          color: #64748b;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          padding: 2px 6px;
          border-radius: 999px;
          margin-top: 2px;
          transition: all 0.15s ease;
        }

        .bar-column-wrapper:hover .click-to-inspect-badge {
          background: #0f172a;
          color: #ffffff;
          border-color: #0f172a;
        }

        /* Vertical Bars Canvas */
        .vertical-bars-container {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 20px 16px 14px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .bars-scroll-track {
          display: flex;
          align-items: flex-end;
          justify-content: space-around;
          gap: 14px;
          min-width: fit-content;
        }

        .bar-column-wrapper {
          flex: 1;
          min-width: 110px;
          max-width: 180px;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          border-radius: 12px;
          padding: 10px 8px;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          background: transparent;
          border: 1px solid transparent;
        }

        .bar-column-wrapper:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          transform: translateY(-2px);
        }

        .bar-column-wrapper.is-selected-bar {
          background: #ffffff;
          border-color: #0f172a;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
        }

        .bar-top-metrics {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          margin-bottom: 8px;
          min-height: 40px;
          justify-content: flex-end;
        }

        .bar-val-primary {
          font-size: 13px;
          font-weight: 800;
          line-height: 1.2;
        }

        .bar-val-primary.blue-metric {
          color: #2563eb;
        }

        .bar-val-primary.green-metric {
          color: #059669;
        }

        .dual-metric-header {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 800;
        }

        .green-txt {
          color: #059669;
        }

        .blue-txt {
          color: #2563eb;
        }

        .divider {
          color: #cbd5e1;
        }

        .bar-delta-tag {
          font-size: 10.5px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
        }

        .bar-delta-tag.up {
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }

        .bar-delta-tag.down {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        /* Height Stage */
        .bars-height-stage {
          width: 100%;
          height: 150px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 0 4px;
        }

        .dual-bars-row {
          width: 100%;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 6px;
          height: 100%;
        }

        .single-bar {
          width: 20px;
          border-radius: 6px 6px 0 0;
          transition: height 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
        }

        .single-bar.full-width {
          width: 38px;
        }

        .single-bar.rev-bar {
          background: linear-gradient(180deg, #10b981 0%, #059669 100%);
        }

        .single-bar.order-bar {
          background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
        }

        .bar-column-wrapper:hover .single-bar {
          filter: brightness(1.08);
        }

        .bar-ground-line {
          width: 100%;
          height: 2px;
          background: #cbd5e1;
          margin-bottom: 10px;
        }

        /* Bottom Item Button */
        .bar-item-btn {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .bar-item-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          color: #ffffff;
          font-weight: 800;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .bar-item-name {
          font-size: 12px;
          font-weight: 800;
          color: #0f172a;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }

        .bar-item-share {
          font-size: 10px;
          color: #64748b;
          font-weight: 600;
        }

        .active-check-badge {
          font-size: 9.5px;
          font-weight: 800;
          color: #ffffff;
          background: #0f172a;
          padding: 2px 6px;
          border-radius: 999px;
          margin-top: 2px;
        }

        /* Chart Footer */
        .chart-footer-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid #e2e8f0;
          padding-top: 10px;
          font-size: 11.5px;
          color: #64748b;
          flex-wrap: wrap;
          gap: 8px;
        }

        .footer-legend-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .legend-indicator {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-weight: 600;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 2px;
        }

        .legend-dot.green-dot {
          background: #10b981;
        }

        .legend-dot.blue-dot {
          background: #2563eb;
        }

        .footer-click-hint {
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
        }

        /* Desktop vs Mobile Bar Display Toggles */
        .desktop-only-bars {
          display: block;
        }

        .mobile-only-bars {
          display: none;
        }

        /* Mobile Horizontal Bars Styling */
        .mobile-bars-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .mobile-hbar-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 11px 13px;
          display: flex;
          flex-direction: column;
          gap: 7px;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }

        .mobile-hbar-card:active,
        .mobile-hbar-card:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .mobile-hbar-card.selected {
          background: #ffffff;
          border-color: #0f172a;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.08);
        }

        .mobile-hbar-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .mobile-hbar-identity {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .mobile-hbar-icon {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #ffffff;
          font-weight: 800;
        }

        .mobile-hbar-name {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }

        .mobile-hbar-metrics {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .mobile-hbar-val {
          font-size: 13px;
          font-weight: 800;
        }

        .mobile-hbar-val.blue {
          color: #2563eb;
        }

        .mobile-hbar-val.green {
          color: #059669;
        }

        .mobile-hbar-delta {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
        }

        .mobile-hbar-delta.pos {
          background: #ecfdf5;
          color: #047857;
        }

        .mobile-hbar-delta.neg {
          background: #fef2f2;
          color: #b91c1c;
        }

        .mobile-hbar-track {
          position: relative;
          width: 100%;
          height: 7px;
          background: #f1f5f9;
          border-radius: 999px;
          overflow: hidden;
        }

        .mobile-hbar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.35s ease;
        }

        .mobile-hbar-fill.blue-fill {
          background: linear-gradient(90deg, #3b82f6, #2563eb);
        }

        .mobile-hbar-fill.green-fill {
          background: linear-gradient(90deg, #10b981, #059669);
        }

        .mobile-hbar-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10.5px;
          color: #64748b;
        }

        .mobile-selected-badge {
          font-size: 9px;
          font-weight: 800;
          color: #ffffff;
          background: #0f172a;
          padding: 2px 7px;
          border-radius: 999px;
        }

        .mobile-tap-hint {
          font-size: 10px;
          font-weight: 700;
          color: #2563eb;
        }

        .mobile-swipe-indicator {
          display: none;
          font-size: 10.5px;
          font-weight: 800;
          color: #047857;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.2px;
        }

        @media (max-width: 1024px) {
          .dimension-tab-bar {
            grid-template-columns: repeat(2, 1fr);
          }

          .chart-header-row {
            flex-direction: column;
          }

          .vertical-bars-container {
            padding: 16px 8px 10px;
          }

          .bars-scroll-track {
            justify-content: flex-start;
          }

          .mobile-swipe-indicator {
            display: inline-flex;
            align-items: center;
          }

          /* Switches to the stacked, one-per-row comparison view here —
             matching the same 1024px breakpoint the rest of the
             dashboard already collapses at, instead of waiting until
             768px. Below full desktop width, the 4-column bar chart has
             no room to breathe (labels/values clip, horizontal scroll
             appears) — the vertical list is the readable choice for
             comparing channels/categories anywhere narrower than that.
          */
          .desktop-only-bars {
            display: none;
          }

          .mobile-only-bars {
            display: flex;
          }
        }

        @media (max-width: 768px) {
          .dimension-tab-bar {
            grid-template-columns: 1fr 1fr;
            gap: 6px;
          }

          .dim-tab-btn {
            padding: 9px 8px;
            font-size: 12px;
          }
        }

        /* 4. Horizontal Bar Chart (replaces the old vertical card list —
           lives inside same-day-chart-card, right below the dimension tabs) */
        .horizontal-bar-chart {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding-top: 4px;
          border-top: 1px solid #e2e8f0;
        }

        .bar-chart-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .bar-chart-header-label {
          font-size: 12px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .bar-chart-rows {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .bar-chart-empty {
          font-size: 13px;
          color: #94a3b8;
          text-align: center;
          padding: 20px 12px;
          background: #f8fafc;
          border: 1px dashed #e2e8f0;
          border-radius: 10px;
        }

        .bar-chart-row {
          display: grid;
          grid-template-columns: 150px 1fr 165px;
          align-items: center;
          gap: 12px;
          padding: 6px;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 1.5px solid transparent;
        }

        .bar-chart-row:hover {
          background: #f8fafc;
        }

        .bar-chart-row.bar-row-selected {
          border-color: #10b981;
          background: #f0fdf4;
        }

        .bar-row-label {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .bar-row-icon {
          width: 24px;
          height: 24px;
          border-radius: 7px;
          display: grid;
          place-items: center;
          color: #ffffff;
          font-weight: 800;
          font-size: 12px;
          flex-shrink: 0;
        }

        .bar-row-name {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bar-row-track {
          background: #f1f5f9;
          border-radius: 7px;
          height: 30px;
          overflow: hidden;
        }

        .bar-row-fill {
          height: 100%;
          border-radius: 7px;
          transition: width 0.3s ease;
        }

        .bar-row-value {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          white-space: nowrap;
        }

        .bar-row-num {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }

        .bar-row-growth {
          font-size: 11.5px;
          font-weight: 700;
        }

        .bar-row-growth.positive {
          color: #059669;
        }

        .bar-row-growth.negative {
          color: #c23820;
        }

        @media (max-width: 640px) {
          .bar-chart-row {
            grid-template-columns: 100px 1fr 110px;
          }

          .bar-row-name {
            font-size: 12px;
          }
        }

        /* Full-page category drilldown (opened by clicking a bar) */
        .dimension-drilldown-page {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .back-to-dashboard-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          padding: 0;
          color: #2563eb;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          width: fit-content;
        }

        .back-to-dashboard-btn:hover {
          text-decoration: underline;
        }

        /* Drilldown Column */
        .drilldown-detail-column {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .drilldown-paper-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
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
          color: #0f172a;
          margin: 0 0 2px;
        }

        .drilldown-subtitle {
          font-size: 12px;
          color: #64748b;
        }

        .date-filter-group {
          display: flex;
          background: #f1f5f9;
          padding: 3px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          gap: 3px;
        }

        .filter-btn {
          border: 0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 7px;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .filter-btn.active {
          background: #0f172a;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
        }

        .custom-dates-bar {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 8px 14px;
          border-radius: 10px;
        }

        .date-input-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
        }

        .date-input-wrap input {
          border: 1px solid #e2e8f0;
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
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cumulative-card.orders-cum {
          background: #eff6ff;
          border-color: #bfdbfe;
        }

        .cum-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
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
          color: #0f172a;
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
          color: #64748b;
          margin-top: 4px;
          border-top: 1px dashed rgba(0, 0, 0, 0.08);
          padding-top: 6px;
        }

        .cum-period-tag {
          font-size: 10.5px;
          font-weight: 800;
          color: #059669;
        }

        .cum-period-tag.blue {
          color: #2563eb;
        }

        /* Trend Graph */
        .trend-graph-container {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
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
          color: #0f172a;
          margin: 0 0 2px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .graph-subheading {
          font-size: 11px;
          color: #64748b;
        }

        .graph-mode-toggle {
          display: flex;
          background: #ffffff;
          padding: 2px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }

        .mode-btn {
          border: 0;
          background: transparent;
          font-size: 10.5px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 6px;
          color: #64748b;
          cursor: pointer;
        }

        .mode-btn.active {
          background: #0f172a;
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
          border: 1px dashed #e2e8f0;
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
          color: #64748b;
          border-top: 1px solid #e2e8f0;
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
          background: #10b981;
        }

        .color-swatch.orders {
          background: #2563eb;
          border-radius: 50%;
        }

        .dashed-swatch {
          width: 14px;
          height: 0;
          border-top: 2px dashed #94a3b8;
        }

        /* Summary Box */
        .drilldown-summary-box {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 12px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .summary-badge {
          font-size: 11.5px;
          font-weight: 800;
          color: #15803d;
        }

        .summary-text {
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          margin: 0;
          line-height: 1.4;
        }

        /* 5. Creative Branded Ribbon Footer */
        .branded-ribbon-footer {
          position: relative;
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
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
          background: linear-gradient(90deg, transparent, #10b981, transparent);
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
          background: linear-gradient(135deg, #0f172a, #10b981);
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: -0.5px;
          box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
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
          color: #0f172a;
        }

        .bullet-sep {
          color: #10b981;
        }

        .brand-tagline {
          background: linear-gradient(90deg, #059669, #2563eb);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-weight: 800;
        }

        /* =========================================================
           MOBILE LAYOUT — phones and small tablets. Everything above
           already leans on flex-wrap in places, but wrapping alone
           doesn't make a dense analytics dashboard actually pleasant
           on a narrow screen — this tightens spacing, stacks what
           needs stacking, and turns a few horizontal button rows into
           swipeable strips instead of letting them wrap into a messy
           multi-line jumble.
        ========================================================= */
        @media (max-width: 640px) {
          .restaurant-iq-page {
            padding: 8px;
            gap: 10px;
            overflow-x: hidden;
          }

          .iq-top-header {
            flex-direction: column;
            align-items: stretch;
            padding: 8px 12px;
            gap: 6px;
          }

          .restaurant-title {
            font-size: 16px;
          }

          .brand-logo-group {
            gap: 8px;
          }

          .iq-logo-squircle {
            width: 32px;
            height: 32px;
            font-size: 16px;
            border-radius: 9px;
          }

          /* Pure branding text, not information — the one line an owner
             glancing at their phone can afford to lose in exchange for
             getting to the revenue number faster. */
          .brand-subscript {
            display: none;
          }

          .header-meta {
            margin-top: 0;
            gap: 6px;
          }

          .date-chip, .shift-chip {
            padding: 2px 6px;
            font-size: 10px;
          }

          .header-right {
            width: 100%;
            gap: 8px;
          }

          .header-right .action-btn {
            flex: 1;
            justify-content: center;
            padding: 9px 10px;
          }

          .master-benchmark-card {
            padding: 10px 12px;
            gap: 10px;
          }

          .kpi-boxes-split {
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .kpi-box-tile {
            padding: 10px 12px;
            gap: 8px;
          }

          /* This is the ONE number an owner opens this on their phone
             for — it should be the biggest, most unmissable thing on
             screen, not smaller than the desktop version. */
          .rev-number, .orders-number {
            font-size: 28px;
          }

          .benchmark-combined-strip {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            padding: 10px 12px;
          }

          .dimension-selector-section {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .dimension-pill-nav {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }

          .dimension-pill-nav::-webkit-scrollbar {
            display: none;
          }

          .dim-tab-btn {
            white-space: nowrap;
            flex-shrink: 0;
          }

          .bar-chart-row {
            grid-template-columns: 90px 1fr 100px;
          }

          .date-filter-group {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            width: 100%;
            scrollbar-width: none;
          }

          .date-filter-group::-webkit-scrollbar {
            display: none;
          }

          .filter-btn {
            white-space: nowrap;
            flex-shrink: 0;
          }

          .custom-dates-bar {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .date-input-wrap {
            justify-content: space-between;
          }

          .date-input-wrap input {
            flex: 1;
            min-width: 0;
          }

          .trend-graph-container {
            padding: 12px;
          }

          .graph-toolbar {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
          }

          .graph-mode-toggle {
            width: 100%;
          }

          .mode-btn {
            flex: 1;
            text-align: center;
          }

          .cumulative-cards-grid {
            gap: 10px;
          }

          .cum-number {
            font-size: 22px;
          }

          .drilldown-paper-card {
            padding: 14px;
          }

          .drilldown-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }

          .drilldown-title {
            font-size: 16px;
          }

          /* Three buttons (Daily Summary / Refresh / Logout) at equal
             flex:1 squeeze "Daily Summary" onto an unreadable sliver on a
             narrow phone — let them wrap onto a second row instead of
             shrinking further. */
          .header-right {
            flex-wrap: wrap;
          }

          .header-right .action-btn {
            flex: 1 1 auto;
            min-width: 100px;
          }

          /* Bottom sheet on mobile: anchored to the bottom edge and slides
             up, instead of popping into the center like on desktop — the
             more familiar mobile pattern, with a drag-handle affordance
             (visual only; tap outside or the X to close). */
          .daily-summary-overlay {
            align-items: flex-end;
            padding: 0;
          }

          .daily-summary-modal {
            max-width: 100%;
            max-height: 85vh;
            border-radius: 16px 16px 0 0;
            animation: daily-summary-slide-up 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          }

          .daily-summary-drag-handle {
            display: block;
            width: 36px;
            height: 4px;
            border-radius: 999px;
            background: #e2e8f0;
            margin: 10px auto 0;
            flex-shrink: 0;
          }

          .daily-summary-table {
            font-size: 11.5px;
          }

          .daily-summary-table thead th,
          .daily-summary-table tbody td {
            padding: 7px 8px;
          }
        }

        @media (max-width: 420px) {
          .restaurant-title {
            font-size: 16px;
          }

          .kpi-value {
            font-size: 21px;
          }

          .live-pacing-tag,
          .location-chip,
          .date-chip,
          .shift-chip {
            font-size: 10px;
            padding: 2px 7px;
          }

          .action-btn {
            font-size: 11px;
            padding: 8px;
          }
        }
      `}</style>
    </div>
  );
}
