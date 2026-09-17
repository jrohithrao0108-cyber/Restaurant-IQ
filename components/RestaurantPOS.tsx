"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit2,
  FileText,
  History,
  LogOut,
  Minus,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
  Trash2,
  User,
  Utensils,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { DEMO_PRODUCTS, DEMO_TABLES } from "@/lib/demoData";
import { printKitchenOrderTicket } from "@/lib/printing/kotPrinter";
import { printCustomerBillReceipt } from "@/lib/printing/receiptPrinter";
import {
  enqueueOfflineOrder,
  getOfflineOrdersQueue,
  getCachedMenuItems,
  getCachedTables,
  getLocalSettings,
  getNextDailyKotNumber,
  removeOfflineOrder,
  retryOfflineOrder,
  type QueuedOfflineOrder,
  saveLocalSettings,
} from "@/lib/offline/offlineStorage";
import { offlineSyncManager } from "@/lib/offline/offlineSync";

export type Role = "SUPER_ADMIN" | "ADMIN" | "POC";

export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
};

export type Item = Product & {
  qty: number;
  notes?: string;
};

export type OrderSource = "ZOMATO" | "DINE_IN" | "SWIGGY" | "TAKEAWAY";

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
  serverName?: string;
  customerPhone?: string;
  customerName?: string;
  discountAmount?: number;
  subtotal?: number;
  // Number of KOT rounds printed so far for this table's current sitting
  // (R1, R2, R3...). Only meaningful for DINE_IN orders with a table.
  kotRoundCount?: number;
  // What was actually NEW in each round — round 1's items, then round 2's
  // additions on top, etc. (not the running cart total at that point).
  // Lets staff see "what came in R1 vs R2 vs R3" instead of just one merged
  // list. Reset when the sitting ends (Settle/Quick Settle/Delete).
  roundBreakdown?: Array<{
    round: number;
    items: Array<{ id: string; name: string; qty: number; notes?: string }>;
  }>;
};

export type RestaurantTable = {
  id: string;
  tableNumber: string;
  capacity: number;
  isActive: boolean;
};

type HeldOrder = {
  id: string;
  savedAt: string;
  customerPhone: string;
  customerName: string;
  serverName: string;
  source: OrderSource;
  table: string;
  items: Item[];
  discountPercent: number;
  discountFlat: number;
  applyGst: boolean;
  paymentMode: string;
};

// Only used as a nicety (icons + a few starter suggestions for a brand-new,
// empty menu) — never to restrict or rewrite what a restaurant's actual
// menu categories are. See normalizeCategory below.
const SUGGESTED_CATEGORIES = [
  "Starters",
  "Mains",
  "Breads",
  "Rice & Biryani",
  "Desserts",
  "Beverages",
];

const CATEGORY_ICONS: Record<string, string> = {
  "All Dishes": "🍽️",
  "Starters": "🍢",
  "Mains": "🍲",
  "Breads": "🫓",
  "Rice & Biryani": "🍚",
  "Desserts": "🍨",
  "Beverages": "🥤",
  "Soups": "🍜",
  "Salads": "🥗",
  "Snacks": "🍟",
  "Chinese": "🥡",
  "Pizza": "🍕",
  "Combos": "🍱",
  "Uncategorized": "🍴",
};

const ORDER_CHANNELS: Array<{ id: OrderSource; label: string; icon: string }> = [
  { id: "DINE_IN", label: "Dine In", icon: "🍽️" },
  { id: "TAKEAWAY", label: "Takeaway", icon: "🛍️" },
  { id: "SWIGGY", label: "Swiggy", icon: "🛵" },
  { id: "ZOMATO", label: "Zomato", icon: "🛵" },
];

const PAYMENT_MODES = [
  { id: "UPI", label: "UPI", icon: "📱" },
  { id: "CASH", label: "Cash", icon: "💵" },
  { id: "CARD", label: "Card", icon: "💳" },
] as const;

function money(n: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

// This used to bucket every category into one of 6 fixed names by keyword
// match, and silently dumped anything that didn't match (Soups, Salads,
// Pizza, Chinese, Combos, South Indian, whatever the restaurant actually
// calls its sections...) into "Starters" — so a menu with real, varied
// categories from the DB would misfile most of them. Categories are the
// restaurant's own data: just clean up formatting/whitespace and use them
// as-is, so the category list always matches the DB exactly.
function normalizeCategory(category: any): string {
  if (typeof category === "object" && category) {
    category = category.name || category.category || category.title || "";
  }
  const raw = String(category || "").trim();
  if (!raw) return "Uncategorized";
  // Collapse stray whitespace and normalize casing lightly (Title Case) so
  // "starters", "Starters", " STARTERS " etc. from inconsistent DB entries
  // still group into one category instead of three.
  return raw
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

function isVeg(name: string, category: string): boolean {
  const text = `${name}${category}`.toLowerCase();
  const nonVegKeywords = [
    "chicken", "mutton", "fish", "prawn", "egg", "meat", "lamb", "pork",
    "beef", "keema", "wings", "tandoori chicken", "tikka chicken", "seafood",
    "crabs", "bacon", "sausage", "ham", "seekh kebab"
  ];
  return !nonVegKeywords.some((kw) => text.includes(kw));
}

function cleanDishDisplayName(name: string, category?: string): string {
  let clean = (name || "").trim();
  if (category) {
    const cat = category.trim();
    if (clean.toLowerCase().startsWith(cat.toLowerCase())) {
      clean = clean.slice(cat.length).replace(/^[-:•\s]+/, "").trim();
    }
  }
  const commonCategoryPrefixes = [
    "starters", "starter", "mains", "main course", "breads", "bread",
    "rice & biryani", "rice and biryani", "biryani", "rice",
    "desserts", "dessert", "beverages", "beverage", "drinks", "drink",
    "chinese", "tandoor", "soups", "salads"
  ];
  for (const pfx of commonCategoryPrefixes) {
    if (clean.toLowerCase().startsWith(pfx)) {
      const candidate = clean.slice(pfx.length).replace(/^[-:•\s]+/, "").trim();
      if (candidate.length > 1) {
        clean = candidate;
        break;
      }
    }
  }
  return clean || name;
}

const HELD_ORDERS_STORAGE_KEY = "restaurant_iq_held_orders";
const ACTIVE_TABLES_STORAGE_KEY = "restaurant_iq_active_tables";
const TABLES_CONFIG_STORAGE_KEY = "restaurant_iq_cached_tables_config";

function loadActiveTablesFromStorage(): Order[] {
  try {
    const raw = localStorage.getItem(ACTIVE_TABLES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveActiveTableToStorage(tableOrder: Order) {
  try {
    const list = loadActiveTablesFromStorage();
    const cleanT = (tableOrder.table || "").trim().toUpperCase();
    const filtered = list.filter((o) => (o.table || "").trim().toUpperCase() !== cleanT);
    filtered.push(tableOrder);
    localStorage.setItem(ACTIVE_TABLES_STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {}
}

function removeActiveTableFromStorage(tableNumber: string) {
  try {
    const list = loadActiveTablesFromStorage();
    const cleanT = tableNumber.trim().toUpperCase();
    const filtered = list.filter((o) => (o.table || "").trim().toUpperCase() !== cleanT);
    localStorage.setItem(ACTIVE_TABLES_STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {}
}

function loadCachedTablesConfig(): RestaurantTable[] {
  try {
    const raw = localStorage.getItem(TABLES_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveTablesConfigToStorage(tables: RestaurantTable[]) {
  try {
    if (tables && tables.length > 0) {
      localStorage.setItem(TABLES_CONFIG_STORAGE_KEY, JSON.stringify(tables));
    }
  } catch (e) {}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value?: string | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function RestaurantPOS({
  products,
  restaurantId,
  restaurantName,
  isPoc,
  createdByUserId,
  initialTable,
  tableSelectionToken,
  restaurantTables,
  orders,
  onPlaced,
  onMenuChanged,
  onLogout,
}: {
  products: Product[];
  restaurantId: string;
  restaurantName: string;
  isPoc: boolean;
  createdByUserId: string;
  initialTable?: string;
  tableSelectionToken?: number;
  restaurantTables: RestaurantTable[];
  orders?: Order[];
  onPlaced: (o: Order) => void;
  onMenuChanged?: () => Promise<void> | void;
  onLogout?: () => void;
}) {
  const safeCreatedByUserId = isValidUuid(createdByUserId) ? createdByUserId : null;

  const [activeView, setActiveView] = useState<"POS" | "TABLES">("POS");

  const [selectedCat, setSelectedCat] = useState("All Dishes");
  const [vegFilter, setVegFilter] = useState<"ALL" | "VEG" | "NON_VEG">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [source, setSource] = useState<OrderSource>("DINE_IN");
  const [table, setTable] = useState<string | null>(initialTable || null);
  const [serverName, setServerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");

  const [cart, setCart] = useState<Item[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountFlat, setDiscountFlat] = useState<number>(0);
  const [applyGst, setApplyGst] = useState(true);
  const [paymentMode, setPaymentMode] = useState<string>("UPI");
  const [cashTendered, setCashTendered] = useState<string>("");

  const [editingItemNoteId, setEditingItemNoteId] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState("");

  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [showHeldModal, setShowHeldModal] = useState(false);

  const [showTablePickerModal, setShowTablePickerModal] = useState(false);
  const [pendingKotOnTableSelect, setPendingKotOnTableSelect] = useState(false);
  const [pendingSaveOnTableSelect, setPendingSaveOnTableSelect] = useState(false);
  const [showRecentBillsModal, setShowRecentBillsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Starters");
  const [addingItem, setAddingItem] = useState(false);

  type BulkDishRow = {
    id: string;
    category: string;
    name: string;
    cost: string;
  };
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkMode, setBulkMode] = useState<"GRID" | "TEXT">("GRID");
  const [bulkRows, setBulkRows] = useState<BulkDishRow[]>([
    { id: "b-1", category: "Mains", name: "", cost: "" },
    { id: "b-2", category: "Mains", name: "", cost: "" },
    { id: "b-3", category: "Starters", name: "", cost: "" },
    { id: "b-4", category: "Breads", name: "", cost: "" },
    { id: "b-5", category: "Beverages", name: "", cost: "" },
  ]);
  const [bulkText, setBulkText] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);

  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [editPrice, setEditPrice] = useState("");

  const [autoPrintKot, setAutoPrintKot] = useState(() => getLocalSettings().autoPrintKot);
  const [autoPrintBillOnSettle, setAutoPrintBillOnSettle] = useState(
    () => getLocalSettings().autoPrintBillOnSettle
  );
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [queuedOrders, setQueuedOrders] = useState<QueuedOfflineOrder[]>([]);
  // --- Live storage debug panel: shows every localStorage key and IndexedDB
  // store this app owns, refreshed on a timer while open. Read-only, for
  // watching how each value actually changes during real use.
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<{
    localStorage: Record<string, any>;
    indexedDB: { queued_orders: QueuedOfflineOrder[]; menu_cache: any; tables_cache: any };
  } | null>(null);
  const [debugUpdatedAt, setDebugUpdatedAt] = useState<number | null>(null);
  const [debugExpanded, setDebugExpanded] = useState<Record<string, boolean>>({});
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const placingOrderRef = useRef(false);
  // Saving a running table order changes both the cart and the table's
  // local/remote representation. Keep a synchronous lock as React state
  // alone cannot prevent two very fast clicks from creating two rounds.
  const savingTableOrderRef = useRef(false);
  // Identity for a Dine-In order with NO table attached (a "default table"
  // / walk-in / instant order). Since there's no table number to match on,
  // this ref is what lets a second KOT/Save before Settle replace the same
  // local record instead of creating a separate one each time. Cleared
  // after settle or whenever the cart is explicitly reset.
  const noTableOrderRef = useRef<{ id: string; tempId: string; kotRoundCount: number } | null>(null);
  const [savingTableOrder, setSavingTableOrder] = useState(false);

  const [settledTableNumbers, setSettledTableNumbers] = useState<Set<string>>(new Set());
  const [settlingTableNumber, setSettlingTableNumber] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  function showToast(text: string, type: "success" | "error" | "info" = "success") {
    setToast({ text, type });
    setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current));
    }, 2800);
  }

  // Cache table configuration whenever props arrive
  useEffect(() => {
    if (restaurantTables && restaurantTables.length > 0) {
      saveTablesConfigToStorage(restaurantTables);
    }
  }, [restaurantTables]);

  const activeProducts = useMemo(() => {
    const raw = products && products.length > 0 ? products : DEMO_PRODUCTS;
    const seen = new Set<string>();
    return raw.filter((p) => {
      const cleanName = (p.name || "").trim().toLowerCase();
      const cleanCat = normalizeCategory(p.category);
      const cleanPrice = Math.round(Number(p.price) || 0);
      const key = `${cleanName}_${cleanCat}_${cleanPrice}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [products]);

  // 30 Tables floor layout with cached tables fallback
  const thirtyTables = useMemo(() => {
    const existingMap = new Map<string, RestaurantTable>();
    const baseTables =
      restaurantTables && restaurantTables.length > 0
        ? restaurantTables
        : loadCachedTablesConfig().length > 0
        ? loadCachedTablesConfig()
        : DEMO_TABLES;

    baseTables.forEach((t) => {
      existingMap.set(t.tableNumber.trim().toUpperCase(), t);
    });

    const list: RestaurantTable[] = [];
    for (let i = 1; i <= 30; i++) {
      const num = `T${i}`;
      if (existingMap.has(num)) {
        list.push(existingMap.get(num)!);
      } else {
        const cap = i % 5 === 0 ? 8 : i % 3 === 0 ? 6 : i % 2 === 0 ? 2 : 4;
        list.push({
          id: `tbl-${i}`,
          tableNumber: num,
          capacity: cap,
          isActive: true,
        });
      }
    }
    return list;
  }, [restaurantTables]);

  const tableOrderMap = useMemo(() => {
    const map = new Map<string, Order>();
    const savedActive = loadActiveTablesFromStorage();

    savedActive.forEach((o) => {
      const cleanT = (o.table || "").trim().toUpperCase();
      if (cleanT && !settledTableNumbers.has(cleanT)) {
        map.set(cleanT, o);
      }
    });

    (orders || [])
      .filter(
        (o) =>
          o.source === "DINE_IN" &&
          o.table &&
          !o.closedAt &&
          !settledTableNumbers.has((o.table as string).trim().toUpperCase())
      )
      .forEach((o) => {
        const cleanT = (o.table as string).trim().toUpperCase();
        if (!map.has(cleanT)) {
          map.set(cleanT, o);
        }
      });
    return map;
  }, [orders, settledTableNumbers]);

  const occupiedTableNumbers = useMemo(() => {
    return new Set(tableOrderMap.keys());
  }, [tableOrderMap]);

  const pendingSyncOrders = useMemo(
    () => queuedOrders.filter((order) => !order.permanentlyFailed),
    [queuedOrders]
  );

  const failedSyncOrders = useMemo(
    () => queuedOrders.filter((order) => order.permanentlyFailed),
    [queuedOrders]
  );

  const [retryingTempId, setRetryingTempId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [showRoundBreakdown, setShowRoundBreakdown] = useState(false);

  // Resets a permanently-failed order back into rotation and immediately
  // asks the sync manager to try it, rather than waiting for the next
  // 3.5s tick — retry should feel instant when someone deliberately taps it.
  async function handleRetryFailedOrder(tempId: string) {
    setRetryingTempId(tempId);
    try {
      await retryOfflineOrder(tempId);
      await (offlineSyncManager as any).syncAll?.(undefined, restaurantId || undefined);
      showToast("Retrying order...", "info");
    } catch (err) {
      console.error("Failed to retry order:", err);
      showToast("Couldn't retry that order. Please try again.", "error");
    } finally {
      setRetryingTempId(null);
    }
  }

  async function handleRetryAllFailed() {
    if (failedSyncOrders.length === 0) return;
    setRetryingAll(true);
    try {
      await Promise.all(failedSyncOrders.map((o) => retryOfflineOrder(o.tempId)));
      await (offlineSyncManager as any).syncAll?.(undefined, restaurantId || undefined);
      showToast(`Retrying ${failedSyncOrders.length} failed order(s)...`, "info");
    } catch (err) {
      console.error("Failed to retry all failed orders:", err);
      showToast("Couldn't retry all orders. Please try again.", "error");
    } finally {
      setRetryingAll(false);
    }
  }

  function getTableSyncStatus(tableNumber: string): {
    label: string;
    tone: "synced" | "pending" | "failed" | "syncing";
  } {
    const matching = queuedOrders.filter(
      (order) => order.orderType === "DINE_IN" && order.tableNumber === tableNumber
    );
    if (matching.some((order) => order.permanentlyFailed)) {
      return { label: "Sync failed", tone: "failed" };
    }
    if (matching.length > 0) {
      return isSyncingQueue
        ? { label: "Syncing", tone: "syncing" }
        : { label: isOnline ? "Waiting to sync" : "Saved offline", tone: "pending" };
    }
    return { label: "Cloud synced", tone: "synced" };
  }

  const activeTables = thirtyTables;

  const categoriesWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    activeProducts.forEach((p) => {
      const norm = normalizeCategory(p.category);
      counts[norm] = (counts[norm] || 0) + 1;
    });

    const list = [{ name: "All Dishes", count: activeProducts.length }];
    Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        list.push({ name, count: counts[name] });
      });

    return list;
  }, [activeProducts]);

  useEffect(() => {
    if (initialTable) {
      const cleanT = initialTable.trim().toUpperCase();
      setSource("DINE_IN");
      setTable(cleanT);
      const activeOrd = tableOrderMap.get(cleanT);
      if (activeOrd && activeOrd.items && activeOrd.items.length > 0) {
        setCart(activeOrd.items);
        if (activeOrd.customerName) setCustomerName(activeOrd.customerName);
        if (activeOrd.customerPhone) setCustomerPhone(activeOrd.customerPhone);
        if (activeOrd.serverName) setServerName(activeOrd.serverName);
        showToast(`Table ${cleanT} active order loaded`, "info");
      } else {
        setCart([]);
        setDiscountPercent(0);
        setDiscountFlat(0);
        setCustomerPhone("");
        setCustomerName("");
        setServerName("");
      }
    }
  }, [initialTable, tableSelectionToken]);

  useEffect(() => {
    if (source !== "DINE_IN") {
      if (activeView === "TABLES") setActiveView("POS");
      if (table !== null) setTable(null);
    }
  }, [source, activeView, table]);

  // Scope offlineSyncManager's own internal triggers (3.5s interval, focus,
  // visibilitychange, its own online listener) to this restaurant. Without
  // this, those background triggers run with an unscoped queue lookup —
  // harmless on a single-restaurant device, but this keeps behavior
  // correct if the same browser/device is ever used for more than one
  // restaurant (e.g. a shared demo machine).
  useEffect(() => {
    if (restaurantId && typeof (offlineSyncManager as any).setActiveRestaurantId === "function") {
      (offlineSyncManager as any).setActiveRestaurantId(restaurantId);
    }
  }, [restaurantId]);

  // The Tables view doubles as the floor manager's operational view. Read
  // the durable queue here so every table can say whether its latest changes
  // are already in the cloud or still waiting on this device.
  useEffect(() => {
    let active = true;
    const refreshQueue = async () => {
      const queue = await getOfflineOrdersQueue(restaurantId || undefined);
      if (active) setQueuedOrders(queue);
    };

    const unsubscribe = offlineSyncManager.subscribe((state) => {
      if (!active) return;
      setIsSyncingQueue(state.isSyncing);
      refreshQueue();
    });

    refreshQueue();
    const interval = window.setInterval(refreshQueue, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [restaurantId]);

  // Track network and trigger background sync on reconnect
  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      if (offlineSyncManager && typeof (offlineSyncManager as any).syncAll === "function") {
        (offlineSyncManager as any).syncAll(undefined, restaurantId || undefined);
      }
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      handleOnline();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [restaurantId]);

  // Debug panel: only polls while actually open, so it costs nothing the
  // rest of the time. Every key/store this app owns is re-read each tick.
  useEffect(() => {
    if (!showDebugPanel) return;
    let cancelled = false;

    const LS_KEYS = [
      "restaurant_iq_active_tables",
      "restaurant_iq_held_orders",
      "restaurant_iq_cached_tables_config",
      "restaurant_iq_local_settings_v1",
      "restaurant_iq_daily_kot_counter_v1",
      "restaurant_iq_user",
      "supabase.auth.token",
    ];

    async function refresh() {
      const ls: Record<string, any> = {};
      LS_KEYS.forEach((k) => {
        const raw = typeof window !== "undefined" ? localStorage.getItem(k) : null;
        if (raw === null) {
          ls[k] = null;
          return;
        }
        try {
          ls[k] = JSON.parse(raw);
        } catch {
          ls[k] = raw; // not JSON (e.g. a raw auth token string)
        }
      });

      let queue: QueuedOfflineOrder[] = [];
      let menuCache: any = null;
      let tablesCache: any = null;
      try {
        queue = await getOfflineOrdersQueue(restaurantId || undefined);
      } catch {}
      try {
        menuCache = restaurantId ? await getCachedMenuItems(restaurantId) : null;
      } catch {}
      try {
        tablesCache = restaurantId ? await getCachedTables(restaurantId) : null;
      } catch {}

      if (!cancelled) {
        setDebugSnapshot({
          localStorage: ls,
          indexedDB: { queued_orders: queue, menu_cache: menuCache, tables_cache: tablesCache },
        });
        setDebugUpdatedAt(Date.now());
      }
    }

    refresh();
    const id = setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showDebugPanel, restaurantId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELD_ORDERS_STORAGE_KEY);
      if (raw) setHeldOrders(JSON.parse(raw));
    } catch (e) {}
  }, []);

  function persistHeldOrders(updated: HeldOrder[]) {
    setHeldOrders(updated);
    try {
      localStorage.setItem(HELD_ORDERS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {}
  }

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === p.id);
      if (existing) {
        return prev.map((item) =>
          item.id === p.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...p, qty: 1 }];
    });
  }

  function decrementCart(productId: string) {
    setCart((prev) => {
      const target = prev.find((item) => item.id === productId);
      if (!target) return prev;
      if (target.qty <= 1) {
        return prev.filter((item) => item.id !== productId);
      }
      return prev.map((item) =>
        item.id === productId ? { ...item, qty: item.qty - 1 } : item
      );
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  }

  function saveItemNote(productId: string, noteText: string) {
    setCart((prev) =>
      prev.map((item) =>
        item.id === productId ? { ...item, notes: noteText.trim() } : item
      )
    );
    setEditingItemNoteId(null);
    setTempNoteText("");
  }

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    if (discountFlat > 0) return Math.min(subtotal, discountFlat);
    if (discountPercent > 0) return Math.round((subtotal * discountPercent) / 100);
    return 0;
  }, [subtotal, discountPercent, discountFlat]);

  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const gstAmount = applyGst ? Math.round(taxableAmount * 0.05) : 0;
  const grandTotal = Math.round(taxableAmount + gstAmount);

  const tenderNumber = Number(cashTendered) || 0;
  const changeDue = tenderNumber > grandTotal ? tenderNumber - grandTotal : 0;

  const filteredProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      if (selectedCat !== "All Dishes") {
        if (normalizeCategory(p.category) !== selectedCat) return false;
      }
      const veg = isVeg(p.name, p.category);
      if (vegFilter === "VEG" && !veg) return false;
      if (vegFilter === "NON_VEG" && veg) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [activeProducts, selectedCat, vegFilter, searchQuery]);

  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach((i) => map.set(i.id, i.qty));
    return map;
  }, [cart]);

  function handleHoldOrder() {
    if (cart.length === 0) {
      showToast("Cart is empty. Add items before holding an order.", "info");
      return;
    }
    const newHeld: HeldOrder = {
      id: `HOLD-${Date.now().toString().slice(-4)}`,
      savedAt: new Date().toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
      }),
      customerPhone,
      customerName,
      serverName,
      source,
      table: table || "",
      items: [...cart],
      discountPercent,
      discountFlat,
      applyGst,
      paymentMode,
    };
    persistHeldOrders([newHeld, ...heldOrders]);
    resetOrderForm();
    showToast(`Order ${newHeld.id} held successfully!`, "success");
  }

  function handleRecallOrder(held: HeldOrder) {
    if (cart.length > 0) {
      const confirmDiscard = window.confirm(
        "Recalling will replace the current active cart. Proceed?"
      );
      if (!confirmDiscard) return;
    }
    setCart(held.items);
    setSource(held.source);
    setTable(held.source === "DINE_IN" ? (held.table || null) : null);
    setCustomerPhone(held.customerPhone || "");
    setCustomerName(held.customerName || "");
    setServerName(held.serverName || "");
    setDiscountPercent(held.discountPercent || 0);
    setDiscountFlat(held.discountFlat || 0);
    setApplyGst(held.applyGst !== false);
    setPaymentMode(held.paymentMode || "UPI");

    persistHeldOrders(heldOrders.filter((h) => h.id !== held.id));
    setShowHeldModal(false);
  }

  function handleDeleteHeld(id: string) {
    persistHeldOrders(heldOrders.filter((h) => h.id !== id));
  }

  function handleSelectChannel(chId: OrderSource) {
    if (chId === source) return; // already on this channel — nothing to do

    // Switching channels used to leave the cart exactly as-is, so items
    // added under one channel (e.g. Swiggy) could silently ride along into
    // another (e.g. Zomato or Dine-In) and get billed to the wrong place.
    // Every channel keeps its own state: a Dine-In table's order lives in
    // the offline queue/tableOrderMap (untouched by this), everything else
    // only exists in the on-screen cart until Settled — so leaving a
    // channel with unsaved items means those specific items are gone.
    if (cart.length > 0) {
      const destLabel = ORDER_CHANNELS.find((c) => c.id === chId)?.label || chId;
      const confirmed = window.confirm(
        `Switch to ${destLabel}? The current cart (${cart.length} item${
          cart.length === 1 ? "" : "s"
        }) will be cleared so orders don't get mixed between channels. Any already-saved table order is not affected.`
      );
      if (!confirmed) return;
    }

    setCart([]);
    setDiscountPercent(0);
    setDiscountFlat(0);
    noTableOrderRef.current = null;
    setTable(null);

    if (chId === "DINE_IN") {
      setSource("DINE_IN");
    } else {
      setSource(chId);
      setActiveView("POS");
    }
  }

  function resetOrderForm() {
    noTableOrderRef.current = null;
    setCart([]);
    setDiscountPercent(0);
    setDiscountFlat(0);
    setCashTendered("");
    setCustomerPhone("");
    setCustomerName("");
    setServerName("");
    setTable(null);
    setSource("DINE_IN");
  }

  const localPlacedOrderKeysRef = useRef<string[]>([]);

  function getDailyBillNumber(targetOrderId?: string, targetDbId?: string): number {
    const list = (orders || []).slice();
    list.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    const uniqueOrderKeys: string[] = [];
    const seen = new Set<string>();
    list.forEach((o) => {
      const key = o.id || o.databaseId;
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueOrderKeys.push(key);
      }
    });

    localPlacedOrderKeysRef.current.forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        uniqueOrderKeys.push(k);
      }
    });

    if (targetOrderId || targetDbId) {
      const matchIndex = uniqueOrderKeys.findIndex(
        (key) => key === targetOrderId || (targetDbId && key === targetDbId)
      );
      if (matchIndex !== -1) {
        return matchIndex + 1;
      }
      const newKey = targetOrderId || targetDbId!;
      uniqueOrderKeys.push(newKey);
      if (!localPlacedOrderKeysRef.current.includes(newKey)) {
        localPlacedOrderKeysRef.current.push(newKey);
      }
      return uniqueOrderKeys.length;
    }

    return uniqueOrderKeys.length + 1;
  }

  function handleQuickPrintTable(order: Order) {
    try {
      if (!order || !order.items || order.items.length === 0) {
        showToast("No items found on this table order.", "info");
        return;
      }
      const billNo = getDailyBillNumber(order.id, order.databaseId);
      printCustomerBillReceipt({
        restaurantName: restaurantName || "RestaurantIQ",
        orderNumber: order.id,
        billNo,
        tokenNo: billNo,
        table: order.table,
        source: order.source || "DINE_IN",
        paymentMode: order.payment || "CASH",
        customerName: order.customerName || undefined,
        cashierName: order.serverName || serverName.trim() || "biller",
        items: order.items,
        subtotal: order.subtotal || order.total,
        discountAmount: order.discountAmount || 0,
        taxCgstPercent: applyGst ? 2.5 : 0,
        taxSgstPercent: applyGst ? 2.5 : 0,
        total: order.total,
        paperWidth: "80mm",
      });
      showToast(`Bill #${billNo} printed for Table${order.table || ""}`, "success");
    } catch (e) {
      showToast("Bill receipt sent to printer.", "info");
    }
  }

  async function handleQuickSettleTable(order: Order) {
    if (!order) return;
    // Table number must never be written for anything but a genuine
    // Dine-In order — even though this function is currently only ever
    // called with orders sourced from tableOrderMap (already filtered to
    // dine-in-with-table), that's an incidental property of today's one
    // call site, not something this function enforces on its own. Gating
    // explicitly here, the same way handleSaveOrder already does, closes
    // that off regardless of how this gets called in the future.
    const isDineIn = order.source === "DINE_IN";
    const cleanTable = isDineIn ? (order.table || "").trim().toUpperCase() : "";

    const itemCount = (order.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const confirmedSettle = window.confirm(
      `Settle Table ${cleanTable || order.table}?\n\nDine-In${
        cleanTable ? ` · Table ${cleanTable}` : ""
      }\n${itemCount} item${itemCount === 1 ? "" : "s"} · ${money(
        order.total
      )}\n\nThis closes the order — it can't be added to after this.`
    );
    if (!confirmedSettle) return;

    if (cleanTable) setSettlingTableNumber(cleanTable);

    try {
      // Write to the durable queue FIRST. The old order marked the table
      // vacant/settled (and wiped its localStorage cache) *before*
      // attempting this — so a failed write left the table looking empty
      // in the UI with no trace anywhere that an order had existed, worse
      // than just an easy-to-miss error toast during a busy service.
      const tempId = `quick-settle-${cleanTable || "notable"}-${Date.now()}`;
      await enqueueOfflineOrder({
        tempId,
        restaurantId,
        createdByUserId: safeCreatedByUserId,
        orderNumber: order.id,
        orderType: order.source || "DINE_IN",
        tableNumber: isDineIn && cleanTable ? cleanTable : null,
        channel: order.source || "DINE_IN",
        paymentMode: order.payment || "CASH",
        total: order.total,
        status: "COMPLETED",
        items: (order.items || []).map((c) => ({
          id: c.id,
          name: c.name,
          price: c.price,
          qty: c.qty,
          notes: c.notes,
          category: c.category,
        })),
        createdAt: order.createdAt || new Date().toISOString(),
        syncAttempts: 0,
        orderPhase: "SETTLED",
      });

      if (cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
        removeActiveTableFromStorage(cleanTable);
      }

      if (table && table.trim().toUpperCase() === cleanTable) {
        setCart([]);
        setTable(null);
      }

      const closedOrder: Order = {
        ...order,
        status: "COMPLETED",
        closedAt: new Date().toISOString(),
      };
      onPlaced(closedOrder);

      // No print here on purpose — Bill and Settle are separate actions on
      // the table tile now. Use the Bill button (handleQuickPrintTable) for
      // a receipt, before or after settling.
      showToast(`Table ${cleanTable} settled!`, "success");
    } catch (err) {
      console.error("Failed to queue quick-settle:", err);
      showToast(`Couldn't settle Table ${cleanTable} — it's still open. Please try again.`, "error");
    } finally {
      setSettlingTableNumber(null);
    }
  }

  /**
   * Fully deletes a table's saved order — distinct from Settle & Pay (closes
   * as paid) and from the "Clear Table" pill in the cart header (that only
   * unassigns the *current on-screen cart* from a table number, it doesn't
   * touch any order already saved for that table). This is for voiding an
   * order opened by mistake, a walk-out, a duplicate table pick, etc.
   * Always confirms first since it can't be undone from here.
   */
  async function handleClearTableOrder(tableNumber: string) {
    const cleanTable = tableNumber.trim().toUpperCase();
    const activeOrder = tableOrderMap.get(cleanTable);
    const itemCount = (activeOrder?.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);

    const confirmed = window.confirm(
      itemCount > 0
        ? `Delete Table ${cleanTable}'s saved order (${itemCount} item${itemCount === 1 ? "" : "s"}, ${money(
            activeOrder?.total || 0
          )})? This cannot be undone and no bill will be generated.`
        : `Clear Table ${cleanTable}? This removes it from the occupied list.`
    );
    if (!confirmed) return;

    try {
      // Drop the local OPEN record for this table — it's local-only by
      // design (see offlineStorage.ts / offlineSync.ts) so this alone is
      // enough if it never reached Supabase.
      const queue = await getOfflineOrdersQueue(restaurantId || undefined);
      const localOpenRecord = queue.find(
        (q) => !q.permanentlyFailed && q.orderType === "DINE_IN" && q.tableNumber === cleanTable
      );
      if (localOpenRecord) {
        await removeOfflineOrder(localOpenRecord.tempId);
      }

      // The table may already have a synced, open order in Supabase from an
      // earlier sitting — queue a CANCELLED closing record through the same
      // durable path Settle & Pay / Quick Settle use, so the background
      // sync voids it there too if it exists.
      if (activeOrder) {
        await enqueueOfflineOrder({
          tempId: `clear-${cleanTable}-${Date.now()}`,
          restaurantId,
          createdByUserId: safeCreatedByUserId,
          orderNumber: activeOrder.id,
          orderType: "DINE_IN",
          tableNumber: cleanTable,
          channel: "DINE_IN",
          paymentMode: activeOrder.payment || "CASH",
          total: activeOrder.total,
          status: "CANCELLED",
          items: activeOrder.items || [],
          createdAt: activeOrder.createdAt || new Date().toISOString(),
          syncAttempts: 0,
          orderPhase: "SETTLED",
        });
      }

      setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
      removeActiveTableFromStorage(cleanTable);

      if (activeOrder) {
        onPlaced({ ...activeOrder, status: "CANCELLED", closedAt: new Date().toISOString() });
      }

      if (table && table.trim().toUpperCase() === cleanTable) {
        setCart([]);
        setTable(null);
        setDiscountPercent(0);
        setDiscountFlat(0);
      }

      showToast(`Table ${cleanTable} order deleted.`, "info");
    } catch (err) {
      console.error("Failed to clear table order:", err);
      showToast("Failed to clear table. Please try again.", "error");
    }
  }

  // True when the current Dine-In cart has changes that haven't been Saved/
  // KOT'd for the currently selected table yet — used to warn before a table
  // switch would silently discard them.
  function hasUnsavedCartChanges(): boolean {
    if (source !== "DINE_IN" || !table) return false;
    const savedItems = tableOrderMap.get(table.trim().toUpperCase())?.items || [];
    if (savedItems.length !== cart.length) return true;
    const savedQtyByKey = new Map(savedItems.map((i) => [`${i.id}-${i.notes || ""}`, i.qty]));
    return cart.some((i) => savedQtyByKey.get(`${i.id}-${i.notes || ""}`) !== i.qty);
  }

  function confirmDiscardUnsavedCart(nextTableLabel: string): boolean {
    if (!hasUnsavedCartChanges()) return true;
    return window.confirm(
      `Table ${table} has unsaved changes that haven't been Saved or KOT'd. Switching to ${nextTableLabel} will discard them. Continue?`
    );
  }

  function handleOpenTableOrder(tNum: string, order?: Order) {
    const cleanT = tNum.trim().toUpperCase();
    if (cleanT !== table && !confirmDiscardUnsavedCart(`Table ${cleanT}`)) return;
    setSettledTableNumbers((prev) => {
      if (!prev.has(cleanT)) return prev;
      const next = new Set(prev);
      next.delete(cleanT);
      return next;
    });
    setTable(cleanT);
    setSource("DINE_IN");
    if (order && order.items && order.items.length > 0) {
      setCart(order.items);
      if (order.customerName) setCustomerName(order.customerName);
      if (order.customerPhone) setCustomerPhone(order.customerPhone);
      if (order.serverName) setServerName(order.serverName);
      showToast(`Table ${cleanT} active order loaded`, "info");
    } else {
      setCart([]);
      setDiscountPercent(0);
      setDiscountFlat(0);
      setCustomerPhone("");
      setCustomerName("");
      setServerName("");
      showToast(`Table ${cleanT} selected (Available)`, "success");
    }
    setActiveView("POS");
  }

  // 1. SAVE RUNNING TABLE ORDER & OPTIONAL KOT PRINTING
  async function executeSaveTableOrder(targetTable: string | null, shouldPrintKot: boolean) {
    if (savingTableOrderRef.current) return;
    savingTableOrderRef.current = true;
    setSavingTableOrder(true);

    // savedItems/savedGrandTotal always represent the FULL current state of
    // this cart, not a delta — this is the invariant offlineStorage.ts's
    // enqueueOfflineOrder and offlineSync.ts's syncOneOrder now rely on to
    // replace (not add to) the table's queued/remote record on every save.
    const savedItems = cart.map((item) => ({ ...item }));
    const savedSubtotal = subtotal;
    const savedDiscountAmount = discountAmount;
    const savedGrandTotal = grandTotal;
    const settings = getLocalSettings();
    const cleanTable = source === "DINE_IN" && targetTable ? targetTable.trim().toUpperCase() : null;
    const existingOrderForTable = cleanTable ? tableOrderMap.get(cleanTable) : undefined;

    try {
      if (cleanTable) {
        // --- DINE-IN WITH A TABLE: rounds R1/R2/R3..., same order id, local-only until settled ---
        setSettledTableNumbers((prev) => {
          if (!prev.has(cleanTable)) return prev;
          const next = new Set(prev);
          next.delete(cleanTable);
          return next;
        });

        const priorRoundCount = existingOrderForTable?.kotRoundCount || 0;
        const priorRoundBreakdown = existingOrderForTable?.roundBreakdown || [];
        let newRoundCount = priorRoundCount;
        let newRoundBreakdown = priorRoundBreakdown;

        // Diff against everything already recorded for THIS TABLE (whether
        // that came from a prior Save or a prior KOT — both count as a
        // round now), so a dish already logged never gets counted twice.
        //
        // This is reconstructed by summing every prior round's items from
        // the PERSISTED roundBreakdown — not from an in-memory ref. A
        // ref-based cache reset on every page reload/remount, which meant
        // a reload between R1 and R2 made R1's items look "new" again:
        // duplicated in the round breakdown AND reprinted as a second
        // physical KOT ticket for dishes already cooking. roundBreakdown
        // survives reload (it's saved on the Order object the same way
        // kotRoundCount is), so this can't happen anymore.
        const alreadySentQtyByKey = new Map<string, number>();
        priorRoundBreakdown.forEach((r) => {
          r.items.forEach((i) => {
            const key = `${i.id}-${i.notes || ""}`;
            alreadySentQtyByKey.set(key, (alreadySentQtyByKey.get(key) || 0) + i.qty);
          });
        });
        const diffItems = savedItems
          .map((item) => {
            const key = `${item.id}-${item.notes || ""}`;
            const deltaQty = item.qty - (alreadySentQtyByKey.get(key) || 0);
            return deltaQty > 0 ? { ...item, qty: deltaQty } : null;
          })
          .filter((i): i is (typeof savedItems)[number] => i !== null);

        if (diffItems.length > 0) {
          newRoundCount = priorRoundCount + 1;
          // Record exactly what was NEW in this round — not the running
          // cart total — so the on-screen breakdown can show "R1: X, Y"
          // then "R2: Z" underneath, instead of one merged list. This
          // happens on Save too, not just KOT: Save = KOT-print, so a
          // round is a round whether or not a physical ticket fired.
          newRoundBreakdown = [
            ...newRoundBreakdown,
            {
              round: newRoundCount,
              items: diffItems.map((i) => ({ id: i.id, name: i.name, qty: i.qty, notes: i.notes })),
            },
          ];

          // The daily KOT counter and the physical print stay strictly
          // tied to an actual print happening — Save creating a round
          // must never advance "today's Nth KOT printed" count or fire
          // anything at the kitchen printer.
          if (shouldPrintKot) {
            const globalKotNumber = getNextDailyKotNumber();
            const kotLabel = `KOT #${globalKotNumber} · Table ${cleanTable} · Round ${newRoundCount}`;
            try {
              printKitchenOrderTicket({
                restaurantName,
                orderNumber: kotLabel,
                table: cleanTable,
                source,
                items: diffItems,
                serverName: serverName.trim() || undefined,
                paperWidth: settings.paperWidth,
              });
            } catch (e) {
              console.warn("KOT print skipped or dialog closed:", e);
            }
          }
        } else if (shouldPrintKot) {
          showToast("No new items to send to the kitchen since the last KOT.", "info");
        }

        // Reuse the SAME order id across every round of this sitting —
        // never mint a new one per Save/KOT — so Supabase (once settled)
        // and every printed KOT ticket for this table agree on one order.
        const orderId = existingOrderForTable?.id || `ORD-${Date.now().toString().slice(-5)}`;

        const openOrder: Order = {
          id: orderId,
          databaseId: existingOrderForTable?.databaseId || `tbl-${cleanTable}-${Date.now()}`,
          time: new Date().toLocaleTimeString("en-IN", {
            hour: "numeric",
            minute: "2-digit",
          }),
          source: "DINE_IN",
          table: cleanTable,
          items: savedItems,
          total: savedGrandTotal,
          payment: paymentMode,
          createdAt: existingOrderForTable?.createdAt || new Date().toISOString(),
          closedAt: null,
          serverName,
          customerPhone,
          customerName,
          discountAmount: savedDiscountAmount,
          subtotal: savedSubtotal,
          kotRoundCount: newRoundCount,
          roundBreakdown: newRoundBreakdown,
        };

        // Write to the durable queue FIRST, before touching UI/localStorage
        // state. Doing onPlaced()/saveActiveTableToStorage() first (the old
        // order) meant that if this enqueue failed, the Tables screen and
        // localStorage cache would already show the table as saved with the
        // new items — the UI would be lying about persistence, and since
        // getTableSyncStatus() only checks the IndexedDB-backed queue, it
        // would even show a reassuring "Cloud synced" badge for an order
        // that was never written anywhere durable.
        const kotTempId = `kot-${cleanTable}`;
        try {
          await enqueueOfflineOrder({
            tempId: kotTempId,
            restaurantId,
            createdByUserId: safeCreatedByUserId,
            orderNumber: orderId,
            orderType: "DINE_IN",
            tableNumber: cleanTable,
            channel: "DINE_IN",
            paymentMode,
            total: savedGrandTotal,
            status: "PENDING",
            items: savedItems.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              qty: item.qty,
              notes: item.notes,
              category: item.category,
            })),
            createdAt: openOrder.createdAt,
            syncAttempts: 0,
            orderPhase: "OPEN",
          });
        } catch (error) {
          showToast(
            `Couldn't save Table ${cleanTable}'s order on this device. Check storage/permissions and try again before leaving the table.`,
            "error"
          );
          return;
        }

        // Cart intentionally stays populated (not cleared) after Save/KOT —
        // it always reflects the table's current running total. This is what
        // lets a second Save safely REPLACE the queued/remote record instead
        // of needing to merge deltas together (see enqueueOfflineOrder /
        // syncOneOrder), and it's also what makes decrementing or removing an
        // already-saved item actually take effect on the next Save.
        onPlaced(openOrder);
        saveActiveTableToStorage(openOrder);

        // No immediate syncAll() here on purpose, and no sync at all yet —
        // OPEN records are local-only by design (see offlineSync.ts) until
        // this table is settled.

        if (shouldPrintKot) {
          showToast(`KOT sent & Table ${cleanTable} order saved!`, "success");
        } else {
          showToast(`Table ${cleanTable} order saved! (No KOT printed)`, "success");
        }

        // Table selection and populated cart are both preserved for waiter
        // convenience — the cart now IS the table's running order.
      } else if (source === "DINE_IN") {
        // --- DINE-IN, NO TABLE (default/instant order): print-only, exactly
        // like Takeaway/Swiggy/Zomato below. Deliberately NOT written to the
        // offline queue here. There's no table to key an OPEN record on, so
        // if this order were queued now and the sync manager correctly
        // leaves OPEN records local-only until Settled, a no-table order
        // that never gets Settled (forgotten, shift change, etc.) would sit
        // in IndexedDB forever — invisible in any table list, never synced,
        // never cleaned up. Settle & Pay is the only place a no-table
        // Dine-In order gets written, exactly like the other walk-up
        // channels, so an abandoned cart simply never becomes a record.
        const globalKotNumber = shouldPrintKot ? getNextDailyKotNumber() : null;

        if (shouldPrintKot) {
          try {
            printKitchenOrderTicket({
              restaurantName,
              orderNumber: `KOT #${globalKotNumber}`,
              table: undefined,
              source,
              items: savedItems,
              serverName: serverName.trim() || undefined,
              paperWidth: settings.paperWidth,
            });
            showToast(`KOT #${globalKotNumber} printed. Remember to Settle to save this order.`, "success");
          } catch (e) {
            console.warn("KOT print skipped or dialog closed:", e);
          }
        } else {
          showToast("Dine-In (no table) items noted. Settle to save this order.", "info");
        }
      } else {
        // --- TAKEAWAY / SWIGGY / ZOMATO: just print, no local persistence here.
        // Placing/settling these goes through the normal Settle & Pay flow. ---
        if (shouldPrintKot) {
          const globalKotNumber = getNextDailyKotNumber();
          try {
            printKitchenOrderTicket({
              restaurantName,
              orderNumber: `KOT #${globalKotNumber}`,
              table: undefined,
              source,
              items: savedItems,
              serverName: serverName.trim() || undefined,
              paperWidth: settings.paperWidth,
            });
            showToast(`KOT #${globalKotNumber} printed.`, "success");
          } catch (e) {
            console.warn("KOT print skipped or dialog closed:", e);
          }
        }
      }
    } finally {
      savingTableOrderRef.current = false;
      setSavingTableOrder(false);
    }
  }

  async function executePrintKot(targetTable: string | null) {
    await executeSaveTableOrder(targetTable, true);
  }

  async function handleSaveTableWithoutKot() {
    if (source !== "DINE_IN") {
      showToast("Save is only available for Dine-In table orders.", "info");
      return;
    }
    if (cart.length === 0) {
      showToast("Cart is empty. Please add items to save.", "info");
      return;
    }
    // Table is optional — proceeding with `table` as-is (a real table, or
    // null for a default/instant Dine-In order) rather than forcing a
    // table pick first.
    await executeSaveTableOrder(table, false);
  }

  async function handlePrintKot() {
    if (cart.length === 0) {
      showToast("Cart is empty. Please add items to print KOT.", "info");
      return;
    }
    await executePrintKot(table);
  }

  function handleSelectTableFromPicker(tNum: string | null) {
    if (!tNum) {
      if (!pendingKotOnTableSelect && !pendingSaveOnTableSelect && !confirmDiscardUnsavedCart("no table")) {
        return;
      }
      setTable(null);
      setSource("DINE_IN");
      setShowTablePickerModal(false);
      showToast("Dine-In without table selected", "info");

      if (pendingKotOnTableSelect) {
        setPendingKotOnTableSelect(false);
        executePrintKot(null);
      }
      if (pendingSaveOnTableSelect) {
        setPendingSaveOnTableSelect(false);
      }
      return;
    }

    const cleanT = tNum.trim().toUpperCase();

    // A pending Save/KOT means "this cart (built without a table) needs a
    // table assigned to it." If that table is already occupied, the cart in
    // hand doesn't include that table's existing saved items — proceeding
    // would REPLACE (not merge into) that table's order, silently wiping
    // out whatever was already saved there. Block it and point the waiter
    // at the normal way to add to an occupied table instead.
    if ((pendingKotOnTableSelect || pendingSaveOnTableSelect) && occupiedTableNumbers.has(cleanT)) {
      showToast(
        `Table ${cleanT} already has an order. Open it from the Tables screen to add these items, or pick a vacant table.`,
        "error"
      );
      return;
    }

    if (
      cleanT !== table &&
      !pendingKotOnTableSelect &&
      !pendingSaveOnTableSelect &&
      !confirmDiscardUnsavedCart(`Table ${cleanT}`)
    ) {
      return;
    }

    setTable(cleanT);
    setSource("DINE_IN");
    setShowTablePickerModal(false);

    if (pendingKotOnTableSelect) {
      setPendingKotOnTableSelect(false);
      executePrintKot(cleanT);
      return;
    }

    if (pendingSaveOnTableSelect) {
      setPendingSaveOnTableSelect(false);
      executeSaveTableOrder(cleanT, false);
      return;
    }

    const activeOrd = tableOrderMap.get(cleanT);
    if (activeOrd && activeOrd.items && activeOrd.items.length > 0) {
      setCart(activeOrd.items);
      if (activeOrd.customerName) setCustomerName(activeOrd.customerName);
      if (activeOrd.customerPhone) setCustomerPhone(activeOrd.customerPhone);
      if (activeOrd.serverName) setServerName(activeOrd.serverName);
      showToast(`Table ${cleanT} active order loaded (${activeOrd.items.length} items)`, "info");
    } else {
      setCart([]);
      setDiscountPercent(0);
      setDiscountFlat(0);
      setCustomerPhone("");
      setCustomerName("");
      setServerName("");
      showToast(`Table ${cleanT} selected (Available)`, "success");
    }
  }

  function handlePrintCustomerBill() {
    if (cart.length === 0) {
      showToast("Cart is empty. Please add items to print bill.", "info");
      return;
    }
    const settings = getLocalSettings();
    const cleanTable = source === "DINE_IN" && table ? table.trim().toUpperCase() : null;
    const activeOrder = cleanTable ? tableOrderMap.get(cleanTable) : null;
    const orderNumber = activeOrder?.id || `BILL-${Date.now().toString().slice(-4)}`;
    const billNo = getDailyBillNumber(activeOrder?.id, activeOrder?.databaseId);

    try {
      printCustomerBillReceipt({
        restaurantName,
        orderNumber,
        billNo,
        tokenNo: billNo,
        table: source === "DINE_IN" && table ? table : undefined,
        source,
        paymentMode,
        customerName: customerName.trim() || undefined,
        cashierName: serverName.trim() || "biller",
        items: cart,
        subtotal,
        discountAmount,
        taxCgstPercent: applyGst ? 2.5 : 0,
        taxSgstPercent: applyGst ? 2.5 : 0,
        total: grandTotal,
        paperWidth: settings.paperWidth,
      });
      showToast(`Bill #${billNo} printed.`, "success");
    } catch (e) {
      showToast("Bill sent to printer.", "info");
    }
  }

  // 3. SETTLE & BILL WITH FAIL-SAFE 3.5s TIMEOUT & OFFLINE QUEUE
  async function handleSaveOrder() {
    if (placingOrderRef.current || saving) return;
    if (cart.length === 0) {
      showToast("Cart is empty! Please add dishes before settling.", "info");
      return;
    }

    // Settle closes the order out for good — confirm exactly what's being
    // closed (channel, table, total) before it happens, so a mis-tap can't
    // silently close the wrong table's or the wrong channel's order.
    const confirmLabel =
      source === "DINE_IN"
        ? table
          ? `Dine-In · Table ${table}`
          : "Dine-In (no table)"
        : source === "TAKEAWAY"
          ? "Takeaway"
          : source === "SWIGGY"
            ? "Swiggy"
            : "Zomato";
    const itemCount = cart.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const confirmedSettle = window.confirm(
      `Settle this order?\n\n${confirmLabel}\n${itemCount} item${itemCount === 1 ? "" : "s"} · ${money(
        grandTotal
      )}\n\nThis closes the order — it can't be added to after this.`
    );
    if (!confirmedSettle) return;

    const cleanTable = source === "DINE_IN" ? (table ? table.trim().toUpperCase() : null) : null;
    const existingOrderForSitting =
      source === "DINE_IN"
        ? cleanTable
          ? tableOrderMap.get(cleanTable)
          : noTableOrderRef.current
            ? { id: noTableOrderRef.current.id }
            : undefined
        : undefined;
    // Reuse the sitting's existing order id (from its OPEN local record, if
    // any) instead of minting a new one — keeps one consistent order
    // number across every KOT print and the final bill.
    const orderNumber = existingOrderForSitting?.id || `ORD-${Date.now().toString().slice(-5)}`;
    const settings = getLocalSettings();
    const savedItems = cart.map((item) => ({ ...item }));
    const savedSubtotal = subtotal;
    const savedDiscountAmount = discountAmount;
    const savedGrandTotal = grandTotal;

    placingOrderRef.current = true;
    setSaving(true);

    async function queueOffline() {
      // Reuse the same local record identity as the OPEN sitting (if any),
      // so this call REPLACES it (flipping it to SETTLED) instead of
      // leaving it behind as an orphan that never gets cleaned up.
      const tempId = cleanTable
        ? `kot-${cleanTable}`
        : source === "DINE_IN" && noTableOrderRef.current
          ? noTableOrderRef.current.tempId
          : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      try {
        await enqueueOfflineOrder({
          tempId,
          restaurantId,
          orderNumber,
          createdByUserId: safeCreatedByUserId,
          orderType: source,
          tableNumber: source === "DINE_IN" ? cleanTable : null,
          channel: source,
          paymentMode,
          total: savedGrandTotal,
          status: "COMPLETED",
          items: savedItems.map((c) => ({
            id: c.id,
            name: c.name,
            price: c.price,
            qty: c.qty,
            notes: c.notes,
            category: c.category,
          })),
          createdAt: nowIso,
          syncAttempts: 0,
          orderPhase: "SETTLED",
        });
      } catch (e) {
        showToast("Order was not saved locally. Please try again.", "error");
        return;
      }

      const newOrder: Order = {
        id: orderNumber,
        databaseId: tempId,
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source,
        table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
        items: savedItems,
        total: savedGrandTotal,
        payment: paymentMode,
        createdAt: nowIso,
        closedAt: nowIso, // Marked closed immediately
        serverName,
        customerPhone,
        customerName,
        discountAmount: savedDiscountAmount,
        subtotal: savedSubtotal,
      };

      onPlaced(newOrder);

      if (source === "DINE_IN" && cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
        removeActiveTableFromStorage(cleanTable);
      }

      resetOrderForm();
      const isDemo = !isSupabaseConfigured || restaurantId.startsWith("demo-");
      showToast(
        cleanTable
          ? (isDemo
              ? `Table ${cleanTable} settled in Demo Mode.${autoPrintBillOnSettle ? " Bill printed." : ""}`
              : `Table ${cleanTable} queued in Offline Mode.${autoPrintBillOnSettle ? " Bill printed." : ""}`)
          : (isDemo
              ? `Order ${orderNumber} settled in Demo Mode.${autoPrintBillOnSettle ? " Bill printed." : ""}`
              : `Order ${orderNumber} queued in Offline Mode.${autoPrintBillOnSettle ? " Bill printed." : ""}`),
        "success"
      );

      const billNo = getDailyBillNumber(orderNumber, newOrder.databaseId);
      setTimeout(() => {
        if (autoPrintBillOnSettle) {
          try {
            printCustomerBillReceipt({
              restaurantName,
              orderNumber,
              billNo,
              tokenNo: billNo,
              table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
              source,
              paymentMode,
              customerName: customerName.trim() || undefined,
              cashierName: serverName.trim() || "biller",
              items: savedItems,
              subtotal: savedSubtotal,
              discountAmount: savedDiscountAmount,
              taxCgstPercent: applyGst ? 2.5 : 0,
              taxSgstPercent: applyGst ? 2.5 : 0,
              total: savedGrandTotal,
              paperWidth: settings.paperWidth,
            });
          } catch (e) {}
        }

        if (autoPrintKot) {
          try {
            const settleKotNumber = getNextDailyKotNumber();
            printKitchenOrderTicket({
              restaurantName,
              orderNumber: `KOT #${settleKotNumber}`,
              table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
              source,
              items: savedItems,
              serverName,
              paperWidth: settings.paperWidth,
            });
          } catch (e) {}
        }
      }, 50);
    }

    // Local-first: settling a table is now always an instant local write,
    // never a network round-trip. queueOffline() above already builds the
    // Order, updates React state, marks the table settled, resets the form,
    // and prints the bill — all synchronous/local. The item is durably in
    // IndexedDB the instant queueOffline() returns, so nothing is lost even
    // if this tab closes immediately after. Pushing to Supabase is left to
    // offlineSyncManager's own 3.5s interval (plus its online/focus
    // recovery) rather than an extra call from here, so a quick run of
    // saves-then-settles on the same table batches into one push instead of
    // firing a separate Supabase round-trip per action.
    try {
      await queueOffline();
    } finally {
      placingOrderRef.current = false;
      setSaving(false);
    }
  }

  async function handleUpdatePrice() {
    if (!editingItem) return;
    const priceNum = Number(editPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast("Enter a valid positive price.", "error");
      return;
    }
    try {
      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        const { error } = await supabase
          .from("menu_items")
          .update({ price: priceNum })
          .eq("id", editingItem.id);
        if (error) throw error;
      }
      if (onMenuChanged) await onMenuChanged();
      setEditingItem(null);
      showToast(`Price updated to ₹${priceNum} for${editingItem.name}`, "success");
    } catch (e: any) {
      showToast(e?.message || "Could not update price.", "error");
    }
  }

  async function handleAddDish() {
    if (!newItemName.trim() || !newItemPrice || Number(newItemPrice) <= 0) {
      showToast("Provide a dish name and valid price.", "error");
      return;
    }
    setAddingItem(true);
    try {
      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        const { error } = await supabase.from("menu_items").insert({
          restaurant_id: restaurantId,
          name: newItemName.trim(),
          price: Number(newItemPrice),
          category: newItemCategory,
          is_veg: isVeg(newItemName.trim(), newItemCategory),
          active: true,
        });
        if (error) throw error;
      }
      if (onMenuChanged) await onMenuChanged();
      setShowAddModal(false);
      setNewItemName("");
      setNewItemPrice("");
      showToast(`Dish "${newItemName}" added successfully!`, "success");
    } catch (e: any) {
      showToast(e?.message || "Failed to add dish.", "error");
    } finally {
      setAddingItem(false);
    }
  }

  function handleAddBulkRow() {
    const lastCat = bulkRows.length > 0 ? bulkRows[bulkRows.length - 1].category : "Mains";
    setBulkRows((prev) => [
      ...prev,
      {
        id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        category: lastCat,
        name: "",
        cost: "",
      },
    ]);
  }

  function handleAddMultipleBulkRows(count = 5) {
    const lastCat = bulkRows.length > 0 ? bulkRows[bulkRows.length - 1].category : "Mains";
    const newRows: BulkDishRow[] = Array.from({ length: count }, (_, i) => ({
      id: `b-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      category: lastCat,
      name: "",
      cost: "",
    }));
    setBulkRows((prev) => [...prev, ...newRows]);
  }

  function handleRemoveBulkRow(id: string) {
    setBulkRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function handleBulkRowChange(
    id: string,
    field: "category" | "name" | "cost",
    value: string
  ) {
    setBulkRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  function handleParseBulkText() {
    if (!bulkText.trim()) {
      showToast("Please paste or type items in: Category, Dish Name, Cost", "info");
      return;
    }
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: BulkDishRow[] = [];

    lines.forEach((line, idx) => {
      if (/^(category|dish|name|item|cost|price)/i.test(line)) return;

      const delimiter = line.includes("\t") ? "\t" : line.includes(",") ? "," : ";";
      const parts = line.split(delimiter).map((p) => p.trim());

      if (parts.length >= 3) {
        parsed.push({
          id: `b-p-${Date.now()}-${idx}`,
          category: parts[0] || "Mains",
          name: parts[1] || "",
          cost: parts[2].replace(/[^0-9.]/g, "") || "",
        });
      } else if (parts.length === 2) {
        parsed.push({
          id: `b-p-${Date.now()}-${idx}`,
          category: "Mains",
          name: parts[0] || "",
          cost: parts[1].replace(/[^0-9.]/g, "") || "",
        });
      }
    });

    if (parsed.length === 0) {
      showToast("Could not parse items. Format: Category, Dish Name, Cost", "error");
      return;
    }

    setBulkRows(parsed);
    setBulkMode("GRID");
    showToast(`Loaded ${parsed.length} dishes into table! Review and save.`, "success");
  }

  async function handleSaveBulkMenu() {
    const validRows = bulkRows.filter(
      (r) => r.name.trim() !== "" && Number(r.cost) > 0
    );

    if (validRows.length === 0) {
      showToast("Please enter at least one dish name and valid cost.", "error");
      return;
    }

    setSavingBulk(true);
    try {
      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        const toInsert = validRows.map((r) => ({
          restaurant_id: restaurantId,
          name: r.name.trim(),
          price: Math.round(Number(r.cost)),
          category: r.category.trim() || "Mains",
          is_veg: isVeg(r.name.trim(), r.category.trim() || "Mains"),
          active: true,
        }));

        const { error } = await supabase.from("menu_items").insert(toInsert);
        if (error) throw error;
      }

      if (onMenuChanged) await onMenuChanged();
      setShowBulkModal(false);
      showToast(`Successfully added ${validRows.length} dishes to menu!`, "success");

      setBulkRows([
        { id: "b-1", category: "Mains", name: "", cost: "" },
        { id: "b-2", category: "Mains", name: "", cost: "" },
        { id: "b-3", category: "Starters", name: "", cost: "" },
        { id: "b-4", category: "Breads", name: "", cost: "" },
        { id: "b-5", category: "Beverages", name: "", cost: "" },
      ]);
      setBulkText("");
    } catch (e: any) {
      showToast(e?.message || "Failed to save bulk menu items.", "error");
    } finally {
      setSavingBulk(false);
    }
  }

  return (
    <div className="restaurant-iq-pos">
      {toast && (
        <div className={`pos-toast-banner ${toast.type}`}>
          <span className="toast-icon">
            {toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}
          </span>
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* 1. TOP CONTROL BAR */}
      <header className="pos-top-bar">
        <div className="pos-brand-cluster">
          <div className="pos-brand-logo">
            <img src="/logo.png" alt="RestaurantIQ" className="pos-brand-img" />
          </div>
          <div className="pos-brand-meta">
            <b>RestaurantIQ</b>
            <span>{restaurantName || "Terminal"}</span>
          </div>
        </div>

        {source === "DINE_IN" ? (
          <div className="pos-view-switcher">
            <button
              type="button"
              className={`pos-view-btn ${activeView === "POS" ? "active" : ""}`}
              onClick={() => setActiveView("POS")}
            >
              <Utensils size={13} />
              <span>Menu & Billing</span>
            </button>
            <button
              type="button"
              className={`pos-view-btn ${activeView === "TABLES" ? "active" : ""}`}
              onClick={() => setActiveView("TABLES")}
            >
              <TableIcon size={13} />
              <span>Tables ({occupiedTableNumbers.size}/30)</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="pos-dinein-nav-btn"
            onClick={() => handleSelectChannel("DINE_IN")}
            title="Navigate to Dine-In Tables"
          >
            <TableIcon size={13} />
            <span>← Go to Dine In (Tables)</span>
          </button>
        )}

        <div className="top-divider" />

        <div className="pos-channel-group">
          {ORDER_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              className={`pos-channel-btn ${source === ch.id ? "active" : ""}`}
              onClick={() => handleSelectChannel(ch.id)}
            >
              <span className="channel-icon">{ch.icon}</span>
              <span className="channel-label">{ch.label}</span>
            </button>
          ))}
        </div>

        {source === "DINE_IN" && (
          <div className="pos-table-selector-container">
            <button
              type="button"
              className={`pos-table-selector-trigger ${!table ? "no-table" : "has-table"}`}
              onClick={() => setShowTablePickerModal(true)}
              title={table ? `Table ${table} assigned (Click to change or clear)` : "Dine-In without table (Click to assign table)"}
            >
              <TableIcon size={14} />
              <span className="table-current-label">
                {table ? (
                  <>Table <b>{table}</b></>
                ) : (
                  <span className="no-table-prompt">No Table (Direct)</span>
                )}
              </span>
              {table ? (
                <span
                  className={`table-status-dot ${
                    occupiedTableNumbers.has(table) ? "occupied" : "vacant"
                  }`}
                />
              ) : (
                <span className="table-optional-hint">Tables</span>
              )}
              <ChevronDown size={13} className="chev-icon" />
            </button>
            {table && (
              <button
                type="button"
                className="pos-table-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setTable(null);
                  showToast("Table unassigned (Dine-In without table)", "info");
                }}
                title="Unassign table (Switch to tableless dine-in)"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {source === "DINE_IN" && (
          <div className="pos-mini-input server-input">
            <Utensils size={12} />
            <input
              placeholder="Captain"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>
        )}

        <div className="top-spacer" />

        <div className="pos-top-actions">
          <button
            type="button"
            className={`pos-tool-btn debug-panel-btn ${showDebugPanel ? "active" : ""}`}
            onClick={() => setShowDebugPanel((v) => !v)}
            title="Live view of localStorage + IndexedDB values"
          >
            <span>🐞</span>
            <span>Storage</span>
          </button>
          <button
            type="button"
            className="pos-tool-btn logout-btn"
            onClick={() => {
              if (onLogout) {
                onLogout();
              } else {
                try {
                  localStorage.removeItem("restaurant_iq_user");
                  localStorage.removeItem("supabase.auth.token");
                  sessionStorage.clear();
                } catch (e) {}
                window.location.reload();
              }
            }}
            title="Logout from Terminal"
          >
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* DEBUG PANEL: live localStorage + IndexedDB viewer, side drawer */}
      {showDebugPanel && (
        <aside className="debug-storage-panel">
          <div className="debug-panel-head">
            <div>
              <strong>Storage inspector</strong>
              <span className="debug-updated-at">
                {debugUpdatedAt ? `updated ${new Date(debugUpdatedAt).toLocaleTimeString()}` : "loading…"}
              </span>
            </div>
            <button type="button" onClick={() => setShowDebugPanel(false)} title="Close">
              ✕
            </button>
          </div>

          <div className="debug-panel-body">
            <div className="debug-section-title">localStorage</div>
            {debugSnapshot &&
              Object.entries(debugSnapshot.localStorage).map(([key, value]) => {
                const isOpen = debugExpanded[`ls:${key}`] !== false; // default open
                return (
                  <div className="debug-entry" key={key}>
                    <button
                      type="button"
                      className="debug-entry-head"
                      onClick={() =>
                        setDebugExpanded((prev) => ({ ...prev, [`ls:${key}`]: !isOpen }))
                      }
                    >
                      <span className="debug-caret">{isOpen ? "▾" : "▸"}</span>
                      <span className="debug-key">{key}</span>
                      <span className="debug-badge">
                        {value === null ? "empty" : Array.isArray(value) ? `${value.length} item(s)` : "object"}
                      </span>
                    </button>
                    {isOpen && (
                      <pre className="debug-value">
                        {value === null ? "null" : JSON.stringify(value, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}

            <div className="debug-section-title">IndexedDB — restaurant_iq_offline</div>
            {debugSnapshot &&
              (
                [
                  ["queued_orders", debugSnapshot.indexedDB.queued_orders],
                  ["menu_cache", debugSnapshot.indexedDB.menu_cache],
                  ["tables_cache", debugSnapshot.indexedDB.tables_cache],
                ] as const
              ).map(([key, value]) => {
                const isOpen = debugExpanded[`idb:${key}`] !== false;
                return (
                  <div className="debug-entry" key={key}>
                    <button
                      type="button"
                      className="debug-entry-head"
                      onClick={() =>
                        setDebugExpanded((prev) => ({ ...prev, [`idb:${key}`]: !isOpen }))
                      }
                    >
                      <span className="debug-caret">{isOpen ? "▾" : "▸"}</span>
                      <span className="debug-key">{key}</span>
                      <span className="debug-badge">
                        {value == null ? "empty" : Array.isArray(value) ? `${value.length} item(s)` : "cached"}
                      </span>
                    </button>
                    {isOpen && (
                      <pre className="debug-value">
                        {value == null ? "null" : JSON.stringify(value, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
          </div>
        </aside>
      )}

      {/* 2. MAIN BODY */}
      <div className="pos-main-body">
        {activeView === "TABLES" && source === "DINE_IN" ? (
          <div className="pos-tables-screen">
            <div className="tables-screen-toolbar">
              <div className="tables-toolbar-left">
                <h2>Tables Floor (30 Tables)</h2>
                <div className="tables-stat-badge vacant">
                  <span className="status-dot green" />
                  <span>Vacant: <b>{30 - occupiedTableNumbers.size}</b></span>
                </div>
                <div className="tables-stat-badge occupied">
                  <span className="status-dot red" />
                  <span>Occupied: <b>{occupiedTableNumbers.size}</b></span>
                </div>
                <button
                  type="button"
                  className={`tables-stat-badge sync-summary ${failedSyncOrders.length > 0 ? "failed" : pendingSyncOrders.length > 0 ? "pending" : "synced"}`}
                  onClick={() => setShowSyncDetails((current) => !current)}
                  title="Show orders waiting to sync"
                >
                  <span className="status-dot" />
                  <span>
                    {failedSyncOrders.length > 0
                      ? `Failed: ${failedSyncOrders.length}`
                      : pendingSyncOrders.length > 0
                      ? `${isSyncingQueue ? "Syncing" : "Waiting"}: ${pendingSyncOrders.length}`
                      : "Cloud synced"}
                  </span>
                </button>
              </div>

              <div className="tables-toolbar-right">
                <button
                  type="button"
                  className="tables-toolbar-btn"
                  onClick={() => setActiveView("POS")}
                >
                  <Utensils size={14} />
                  <span>Back to Menu & Billing</span>
                </button>
              </div>
            </div>

            {showSyncDetails && (
              <div className="sync-detail-panel">
                <div className="sync-detail-head">
                  <div>
                    <b>Order sync status</b>
                    <span>Saved on this device, awaiting cloud confirmation.</span>
                  </div>
                  {failedSyncOrders.length > 0 && (
                    <button
                      type="button"
                      className="retry-all-btn"
                      onClick={handleRetryAllFailed}
                      disabled={retryingAll}
                    >
                      <RefreshCw size={12} className={retryingAll ? "spin" : ""} />
                      <span>{retryingAll ? "Retrying..." : `Retry All (${failedSyncOrders.length})`}</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setShowSyncDetails(false)} aria-label="Close sync details">
                    <X size={16} />
                  </button>
                </div>
                {queuedOrders.length === 0 ? (
                  <div className="sync-empty-state">All saved orders are synced to the cloud.</div>
                ) : (
                  <div className="sync-order-list">
                    {queuedOrders.map((order) => {
                      const itemCount = order.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
                      const failed = Boolean(order.permanentlyFailed);
                      return (
                        <div className={`sync-order-row ${failed ? "failed" : "pending"}`} key={order.tempId}>
                          <span className="sync-order-status">{failed ? "Needs review" : isSyncingQueue ? "Syncing" : isOnline ? "Waiting to sync" : "Saved offline"}</span>
                          <b>{order.tableNumber ? `Table ${order.tableNumber}` : order.orderType}</b>
                          <span>{itemCount} item{itemCount === 1 ? "" : "s"} · {money(order.total)}</span>
                          <small>{new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{failed && order.lastError ? ` · ${order.lastError}` : ""}</small>
                          {failed && (
                            <button
                              type="button"
                              className="retry-one-btn"
                              onClick={() => handleRetryFailedOrder(order.tempId)}
                              disabled={retryingTempId === order.tempId || retryingAll}
                            >
                              <RefreshCw size={11} className={retryingTempId === order.tempId ? "spin" : ""} />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="tables-30-grid">
              {thirtyTables.map((t) => {
                const isOccupied = occupiedTableNumbers.has(t.tableNumber);
                const activeOrder = tableOrderMap.get(t.tableNumber);
                const isCurrent = table === t.tableNumber;
                const syncStatus = isOccupied ? getTableSyncStatus(t.tableNumber) : null;

                return (
                  <div
                    key={t.tableNumber}
                    className={`table-tile-card ${isOccupied ? "occupied" : "vacant"} ${
                      isCurrent ? "current" : ""
                    }`}
                    onClick={() => handleOpenTableOrder(t.tableNumber, activeOrder)}
                  >
                    <div className="tile-head">
                      <div className="tile-title">
                        <b>{t.tableNumber}</b>
                        <small>{t.capacity} Seats</small>
                      </div>
                      <div className="tile-badge-group">
                        <span className={`tile-badge ${isOccupied ? "occupied" : "vacant"}`}>
                          {isOccupied ? "Occupied" : "Vacant"}
                        </span>
                        {isOccupied && (activeOrder?.kotRoundCount || 0) > 0 && (
                          <span className="tile-round-badge">R{activeOrder!.kotRoundCount}</span>
                        )}
                      </div>
                    </div>

                    <div className="tile-body">
                      {isOccupied && activeOrder ? (
                        <div className="tile-order-data">
                          <span className="tile-amount">{money(activeOrder.total)}</span>
                          <span className="tile-sub">
                            {((activeOrder && activeOrder.items) || []).reduce(
                              (s, i) => s + (Number(i.qty) || 0),
                              0
                            )}{" "}
                            items • {activeOrder.time || ""}
                          </span>
                          {syncStatus && (
                            <span className={`tile-sync-status ${syncStatus.tone}`}>
                              {syncStatus.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="tile-vacant-content">
                          <span>Available</span>
                        </div>
                      )}
                    </div>

                    <div className="tile-footer" onClick={(e) => e.stopPropagation()}>
                      {isOccupied && activeOrder ? (
                        <div className="tile-action-btns">
                          <button
                            type="button"
                            className="tile-btn bill-print-btn"
                            onClick={() => handleQuickPrintTable(activeOrder)}
                            disabled={settlingTableNumber === t.tableNumber}
                            title="Print customer bill (does not settle)"
                          >
                            <FileText size={11} />
                            <span>Bill</span>
                          </button>
                          <button
                            type="button"
                            className="tile-btn settle-pay-btn"
                            onClick={() => handleQuickSettleTable(activeOrder)}
                            disabled={settlingTableNumber === t.tableNumber}
                            title="Settle this table (does not print)"
                          >
                            {settlingTableNumber === t.tableNumber ? (
                              <>
                                <RefreshCw size={11} className="spin" />
                                <span>Settling...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={11} />
                                <span>Settle</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            className="tile-btn delete-order-btn"
                            onClick={() => handleClearTableOrder(t.tableNumber)}
                            disabled={settlingTableNumber === t.tableNumber}
                            title="Delete this table's saved order (asks to confirm)"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="tile-new-order-btn"
                          onClick={() => handleOpenTableOrder(t.tableNumber)}
                        >
                          + New Order
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* COLUMN 1: VERTICAL CATEGORY RAIL */}
            <aside className="pos-vertical-category-rail">
              <div className="vertical-cat-header">
                <span className="rail-title">Categories</span>
                <span className="rail-count">{categoriesWithCounts.length}</span>
              </div>

              <div className="vertical-cat-list">
                {categoriesWithCounts.map((cat) => {
                  const icon = CATEGORY_ICONS[cat.name] || "🍴";
                  const isSelected = selectedCat === cat.name;

                  return (
                    <button
                      key={cat.name}
                      type="button"
                      className={`vertical-cat-btn ${isSelected ? "active" : ""}`}
                      onClick={() => setSelectedCat(cat.name)}
                    >
                      <span className="cat-icon">{icon}</span>
                      <span className="cat-name">{cat.name}</span>
                      <span className="cat-badge">{cat.count}</span>
                      {isSelected && <div className="cat-active-indicator" />}
                    </button>
                  );
                })}
              </div>

              <div className="vertical-cat-footer">
                <button
                  type="button"
                  className="quick-add-dish-btn"
                  onClick={() => setShowAddModal(true)}
                >
                  <Plus size={13} />
                  <span>+ Add Dish</span>
                </button>

                <div className="terminal-shift-pill">
                  <div className="shift-dot-row">
                    <span className="live-dot" />
                    <span>POS Active</span>
                  </div>
                  <div className="shift-info-row">
                    <span>Shift: <b>{restaurantName || "Counter"}</b></span>
                    <span>Bills: <b>{orders?.length || 0}</b></span>
                  </div>
                </div>
              </div>
            </aside>

            {/* COLUMN 2: DISH CATALOG GRID */}
            <main className="pos-catalog-panel">
              <div className="catalog-toolbar">
                <div className="catalog-title-wrap">
                  <h2>{selectedCat}</h2>
                  <span className="item-count-sub">
                    {filteredProducts.length} items
                  </span>
                </div>

                <div className="veg-filter-pills">
                  <button
                    type="button"
                    className={`veg-pill ${vegFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setVegFilter("ALL")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`veg-pill veg ${vegFilter === "VEG" ? "active" : ""}`}
                    onClick={() => setVegFilter("VEG")}
                  >
                    <span className="veg-dot" />
                    Veg
                  </button>
                  <button
                    type="button"
                    className={`veg-pill non-veg ${
                      vegFilter === "NON_VEG" ? "active" : ""
                    }`}
                    onClick={() => setVegFilter("NON_VEG")}
                  >
                    <span className="non-veg-triangle" />
                    Non-Veg
                  </button>
                </div>

                <div className="pos-search-box">
                  <Search size={14} />
                  <input
                    placeholder="Search dish name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="clear-search"
                      onClick={() => setSearchQuery("")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className="toolbar-bulk-btn"
                  onClick={() => setShowBulkModal(true)}
                  title="Bulk create dishes with category, name and cost"
                >
                  <Plus size={12} />
                  <span>⚡ Bulk Menu</span>
                </button>
              </div>

              <div className="dishes-grid">
                {filteredProducts.map((p) => {
                  const veg = isVeg(p.name, p.category);
                  const qtyInCart = cartQtyMap.get(p.id) || 0;

                  return (
                    <div
                      key={p.id}
                      className={`dish-card ${qtyInCart > 0 ? "in-cart" : ""}`}
                      onClick={() => addToCart(p)}
                    >
                      <div className="dish-card-top">
                        <div className={`fssai-symbol ${veg ? "veg" : "non-veg"}`}>
                          <div className="symbol-inner" />
                        </div>
                        <span className="dish-price">{money(p.price)}</span>
                      </div>

                      <div className="dish-info">
                        <h3 className="dish-name" title={cleanDishDisplayName(p.name, p.category)}>
                          {cleanDishDisplayName(p.name, p.category)}
                        </h3>
                      </div>

                      <div className="dish-card-bottom">
                        {qtyInCart > 0 ? (
                          <div
                            className="card-stepper"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="card-step-btn minus"
                              onClick={() => decrementCart(p.id)}
                              title="Decrease"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="card-qty">{qtyInCart}</span>
                            <button
                              type="button"
                              className="card-step-btn plus"
                              onClick={() => addToCart(p)}
                              title="Increase"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="card-add-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCart(p);
                            }}
                          >
                            <Plus size={11} />
                            <span>Add</span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="edit-dish-price-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem(p);
                            setEditPrice(String(p.price));
                          }}
                          title="Edit Price"
                        >
                          <Edit2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <div className="empty-catalog-state">
                    <Utensils size={32} />
                    <p>No dishes found matching your filter.</p>
                    <button
                      type="button"
                      className="reset-filters-btn"
                      onClick={() => {
                        setSelectedCat("All Dishes");
                        setVegFilter("ALL");
                        setSearchQuery("");
                      }}
                    >
                      Reset Filters
                    </button>
                  </div>
                )}
              </div>
            </main>

            {/* COLUMN 3: BILLING & CHECKOUT TERMINAL */}
            <aside className="pos-checkout-panel">
              <div className="ticket-header">
                <div className="ticket-channel-info">
                  <span
                    className="ticket-channel-badge clickable"
                    onClick={() => {
                      if (source === "DINE_IN") {
                        setShowTablePickerModal(true);
                      } else {
                        handleSelectChannel("DINE_IN");
                      }
                    }}
                    title={
                      source === "DINE_IN"
                        ? "Click to pick or change table"
                        : "Click to switch to Dine-In Tables"
                    }
                    style={{ cursor: "pointer" }}
                  >
                    {source === "DINE_IN"
                      ? (table ? `🍽️ Dine-In • Table ${table}` : "🍽️ Dine-In (No Table)")
                      : source === "TAKEAWAY"
                      ? "🛍️ Takeaway (No Table)"
                      : source === "SWIGGY"
                      ? "🛵 Swiggy (No Table)"
                      : "🛵 Zomato (No Table)"}
                  </span>
                  {source === "DINE_IN" && table && (
                    <button
                      type="button"
                      className="round-badge"
                      onClick={() => setShowRoundBreakdown((v) => !v)}
                      title="Click to see what was added in each round"
                    >
                      Round {tableOrderMap.get(table.trim().toUpperCase())?.kotRoundCount || 0}
                    </button>
                  )}
                  {source === "DINE_IN" && table && (
                    <button
                      type="button"
                      className="ticket-clear-table-pill"
                      onClick={() => {
                        setTable(null);
                        showToast("Table unassigned (Dine-In without table)", "info");
                      }}
                      title="Unassign table number"
                    >
                      Clear Table
                    </button>
                  )}
                  <span className="ticket-clock">
                    <Clock size={11} />
                    {new Date().toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {cart.length > 0 && (
                  <button
                    type="button"
                    className="clear-cart-btn"
                    onClick={() => setCart([])}
                    title="Clear Cart"
                  >
                    Clear
                  </button>
                )}
              </div>

              {showRoundBreakdown && source === "DINE_IN" && table && (
                <div className="round-breakdown-panel">
                  {(tableOrderMap.get(table.trim().toUpperCase())?.roundBreakdown || []).length === 0 ? (
                    <div className="round-breakdown-empty">No KOT sent yet for this sitting.</div>
                  ) : (
                    (tableOrderMap.get(table.trim().toUpperCase())?.roundBreakdown || []).map((r) => (
                      <div className="round-breakdown-group" key={r.round}>
                        <div className="round-breakdown-label">R{r.round}</div>
                        <div className="round-breakdown-items">
                          {r.items.map((i, idx) => (
                            <div className="round-breakdown-item" key={`${i.id}-${idx}`}>
                              <span>{i.name}</span>
                              <span className="round-breakdown-qty">x{i.qty}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="cart-items-container">
                {cart.length === 0 ? (
                  <div className="empty-cart-message">
                    <Utensils size={28} />
                    <b>Order Cart is Empty</b>
                    <span>Click any dish to add to the bill</span>
                  </div>
                ) : (
                  <div className="cart-items-list">
                    {cart.map((item) => {
                      const veg = isVeg(item.name, item.category);
                      const displayName = cleanDishDisplayName(item.name, item.category);
                      return (
                        <div key={item.id} className="cart-item-row">
                          <div className="cart-item-left" title={displayName}>
                            <span
                              className={`cart-veg-dot ${
                                veg ? "veg" : "non-veg"
                              }`}
                            />
                            <span className="cart-item-name">{displayName}</span>
                            {item.notes ? (
                              <span
                                className="item-note-pill inline"
                                onClick={() => {
                                  setEditingItemNoteId(item.id);
                                  setTempNoteText(item.notes || "");
                                }}
                                title={`Note: ${item.notes} (Click to edit)`}
                              >
                                <span>{item.notes}</span>
                                <X
                                  size={9}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveItemNote(item.id, "");
                                  }}
                                />
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="add-note-btn inline"
                                onClick={() => {
                                  setEditingItemNoteId(item.id);
                                  setTempNoteText("");
                                }}
                                title="Add cooking note"
                              >
                                +note
                              </button>
                            )}
                          </div>

                          <div className="cart-item-right">
                            <div className="cart-stepper">
                              <button
                                type="button"
                                onClick={() => decrementCart(item.id)}
                                title="Decrease quantity"
                              >
                                <Minus size={10} />
                              </button>
                              <span>{item.qty}</span>
                              <button
                                type="button"
                                onClick={() => addToCart(item)}
                                title="Increase quantity"
                              >
                                <Plus size={10} />
                              </button>
                            </div>

                            <span className="cart-item-price">
                              {money(item.price * item.qty)}
                            </span>

                            <button
                              type="button"
                              className="remove-item-btn"
                              onClick={() => removeFromCart(item.id)}
                              title="Remove item"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bill-calculations-section">
                <div className="calc-row">
                  <span>Subtotal ({cart.reduce((s, i) => s + i.qty, 0)} items)</span>
                  <b>{money(subtotal)}</b>
                </div>

                <div className="calc-row discount-row">
                  <div className="discount-label-group">
                    <span>Discount:</span>
                    <div className="discount-pills">
                      {[0, 5, 10, 15].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className={`disc-pill ${
                            discountPercent === pct && discountFlat === 0
                              ? "active"
                              : ""
                          }`}
                          onClick={() => {
                            setDiscountPercent(pct);
                            setDiscountFlat(0);
                          }}
                        >
                          {pct}%
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`disc-pill ${discountFlat > 0 ? "active" : ""}`}
                        onClick={() => {
                          const flat = prompt("Enter flat discount in ₹:", "50");
                          if (flat && !isNaN(Number(flat))) {
                            setDiscountFlat(Number(flat));
                            setDiscountPercent(0);
                          }
                        }}
                      >
                        {discountFlat > 0 ? `₹${discountFlat}` : "Flat ₹"}
                      </button>
                    </div>
                  </div>
                  {discountAmount > 0 && (
                    <span className="discount-applied-val">
                      −{money(discountAmount)}
                    </span>
                  )}
                </div>

                <div className="calc-row tax-row">
                  <label className="gst-toggle-label">
                    <input
                      type="checkbox"
                      checked={applyGst}
                      onChange={(e) => setApplyGst(e.target.checked)}
                    />
                    <span>Apply 5% GST (2.5% + 2.5%)</span>
                  </label>
                  <span>{money(gstAmount)}</span>
                </div>

                <div className="calc-row grand-total-row">
                  <span>GRAND TOTAL</span>
                  <strong className="grand-total-amount">
                    {money(grandTotal)}
                  </strong>
                </div>

                <div className="payment-modes-grid">
                  {PAYMENT_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`payment-mode-btn ${
                        paymentMode === mode.id ? "active" : ""
                      }`}
                      onClick={() => setPaymentMode(mode.id)}
                    >
                      <span className="pay-icon">{mode.icon}</span>
                      <span className="pay-label">{mode.label}</span>
                    </button>
                  ))}

                  <button
                    key="SAVE_TABLE_BTN"
                    type="button"
                    className="payment-mode-btn save-table-mode-btn"
                    onClick={handleSaveTableWithoutKot}
                    disabled={cart.length === 0 || savingTableOrder || source !== "DINE_IN"}
                    title={
                      source !== "DINE_IN"
                        ? "Save is only available for Dine-In table orders"
                        : "Save items for table without printing KOT"
                    }
                  >
                    <span className="pay-icon">💾</span>
                    <span className="pay-label">Save</span>
                  </button>
                </div>

                {paymentMode === "CASH" && (
                  <div className="cash-calculator-box">
                    <div className="cash-input-row">
                      <label>Tendered:</label>
                      <input
                        type="number"
                        placeholder="₹"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(e.target.value)}
                      />
                      <div className="quick-tender-pills">
                        {[100, 200, 500, 2000].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setCashTendered(String(amt))}
                          >
                            ₹{amt}
                          </button>
                        ))}
                      </div>
                    </div>
                    {tenderNumber > 0 && (
                      <div className="change-due-row">
                        <span>Change:</span>
                        <strong
                          className={
                            tenderNumber >= grandTotal ? "change-ok" : "change-short"
                          }
                        >
                          {tenderNumber >= grandTotal
                            ? money(changeDue)
                            : `Short by ${money(grandTotal - tenderNumber)}`}
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                <div className="action-buttons-grid">
                  <button
                    type="button"
                    className="action-btn kot-btn"
                    onClick={handlePrintKot}
                    disabled={cart.length === 0}
                    title="Print Kitchen Order Ticket"
                  >
                    <Printer size={14} />
                    <span>KOT</span>
                  </button>

                  <button
                    type="button"
                    className="action-btn bill-btn"
                    onClick={handlePrintCustomerBill}
                    disabled={cart.length === 0}
                    title="Print Customer Check Receipt"
                  >
                    <FileText size={14} />
                    <span>Bill</span>
                  </button>

                  <button
                    type="button"
                    className="action-btn settle-btn"
                    onClick={handleSaveOrder}
                    disabled={cart.length === 0 || saving}
                  >
                    {saving ? (
                      <>
                        <RefreshCw size={14} className="spin" />
                        <span>Settling...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        <span>Settle</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="print-on-settle-group">
                  <label className="print-on-settle-toggle">
                    <input
                      type="checkbox"
                      checked={autoPrintBillOnSettle}
                      onChange={(e) => {
                        setAutoPrintBillOnSettle(e.target.checked);
                        saveLocalSettings({ autoPrintBillOnSettle: e.target.checked });
                      }}
                    />
                    <span>Print bill on Settle</span>
                  </label>
                  <label className="print-on-settle-toggle">
                    <input
                      type="checkbox"
                      checked={autoPrintKot}
                      onChange={(e) => {
                        setAutoPrintKot(e.target.checked);
                        saveLocalSettings({ autoPrintKot: e.target.checked });
                      }}
                    />
                    <span>Print KOT on Settle</span>
                  </label>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* MODAL 1: DINE-IN TABLE PICKER */}
      {showTablePickerModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => {
            setShowTablePickerModal(false);
            setPendingKotOnTableSelect(false);
          }}
        >
          <div
            className="pos-modal-card table-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Select Dine-In Table (T1 - T30)</h3>
              <button
                type="button"
                onClick={() => {
                  setShowTablePickerModal(false);
                  setPendingKotOnTableSelect(false);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="table-picker-quick-actions">
              <button
                type="button"
                className={`quick-notable-card ${!table ? "active" : ""}`}
                onClick={() => handleSelectTableFromPicker(null)}
              >
                <div className="quick-notable-left">
                  <span className="quick-notable-icon">🍽️</span>
                  <div>
                    <div className="quick-notable-title">Dine-In Without Table (Direct / Random)</div>
                    <div className="quick-notable-sub">For venues without tables, food courts, or random seating</div>
                  </div>
                </div>
                {!table ? (
                  <span className="quick-notable-badge">Active</span>
                ) : (
                  <span className="quick-notable-action">Choose No Table</span>
                )}
              </button>
            </div>

            <div className="table-picker-divider">
              <span>{activeTables.length > 0 ? "Or Assign a Specific Table (Optional)" : "Tables Floor"}</span>
            </div>

            {activeTables.length === 0 ? (
              <div className="no-tables-available-prompt">
                <p>No tables configured for this restaurant.</p>
                <small>Orders will be processed as Dine-In (No Table).</small>
              </div>
            ) : (
              <div className="tables-selection-grid">
                {activeTables.map((t) => {
                  const isOccupied = occupiedTableNumbers.has(t.tableNumber);
                  const isCurrent = table === t.tableNumber;

                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`table-select-card ${                         isCurrent ? "current" : ""                       } ${isOccupied ? "occupied" : "vacant"}`}
                      onClick={() => handleSelectTableFromPicker(t.tableNumber)}
                    >
                      <span className="table-num">{t.tableNumber}</span>
                      <span className="table-seats">{t.capacity} Seats</span>
                      <span
                        className={`table-badge ${
                          isOccupied ? "occupied" : "vacant"
                        }`}
                      >
                        {isOccupied ? "Occupied" : "Available"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: RECENT BILLS / ORDER HISTORY */}
      {showRecentBillsModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => setShowRecentBillsModal(false)}
        >
          <div
            className="pos-modal-card recent-bills-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Today's Orders & Bills</h3>
              <button
                type="button"
                onClick={() => setShowRecentBillsModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="recent-orders-list">
              {(!orders || orders.length === 0) ? (
                <p className="no-bills-msg">No orders placed today yet.</p>
              ) : (
                orders.slice(0, 15).map((o) => (
                  <div key={o.id} className="recent-order-item">
                    <div className="recent-order-main">
                      <div className="recent-order-top">
                        <b>Bill #{getDailyBillNumber(o.id, o.databaseId)}</b>
                        <small style={{ color: "#78716c", fontWeight: 600, fontSize: "10.5px" }}>({o.id})</small>
                        <span className="recent-time">{o.time}</span>
                        <span className="recent-channel">{o.source}</span>
                        {o.table ? (
                          <span className="recent-table">Table {o.table}</span>
                        ) : o.source === "DINE_IN" ? (
                          <span className="recent-table no-table">No Table</span>
                        ) : null}
                      </div>
                      <div className="recent-order-items-snippet">
                        {o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                      </div>
                    </div>

                    <div className="recent-order-right">
                      <strong>{money(o.total)}</strong>
                      <button
                        type="button"
                        className="reprint-btn"
                        onClick={() => {
                          const settings = getLocalSettings();
                          const billNo = getDailyBillNumber(o.id, o.databaseId);
                          printCustomerBillReceipt({
                            restaurantName,
                            orderNumber: o.id,
                            billNo,
                            tokenNo: billNo,
                            table: o.table,
                            source: o.source,
                            paymentMode: o.payment,
                            customerName: o.customerName || undefined,
                            cashierName: o.serverName || "biller",
                            items: o.items,
                            subtotal: o.subtotal || o.total,
                            discountAmount: o.discountAmount || 0,
                            taxCgstPercent: applyGst ? 2.5 : 0,
                            taxSgstPercent: applyGst ? 2.5 : 0,
                            total: o.total,
                            paperWidth: settings.paperWidth,
                          });
                        }}
                      >
                        <Printer size={12} />
                        <span>Reprint</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: HELD ORDERS QUEUE */}
      {showHeldModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => setShowHeldModal(false)}
        >
          <div
            className="pos-modal-card held-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Held Orders ({heldOrders.length})</h3>
              <button type="button" onClick={() => setShowHeldModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="held-list">
              {heldOrders.length === 0 ? (
                <p className="no-held-msg">No orders on hold.</p>
              ) : (
                heldOrders.map((h) => (
                  <div key={h.id} className="held-item">
                    <div>
                      <b>{h.id}</b>
                      <span>
                        {h.source} {h.table ? `• ${h.table}` : ""} • {h.savedAt}
                      </span>
                      <small>
                        {h.items.map((i) => `${i.name} (${i.qty})`).join(", ")}
                      </small>
                    </div>
                    <div className="held-actions">
                      <button
                        type="button"
                        className="recall-btn"
                        onClick={() => handleRecallOrder(h)}
                      >
                        <PlayCircle size={13} />
                        <span>Recall</span>
                      </button>
                      <button
                        type="button"
                        className="delete-held-btn"
                        onClick={() => handleDeleteHeld(h.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: ITEM COOKING NOTE */}
      {editingItemNoteId && (
        <div
          className="pos-modal-overlay"
          onClick={() => setEditingItemNoteId(null)}
        >
          <div
            className="pos-modal-card note-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Kitchen Cooking Instructions</h3>
              <button
                type="button"
                onClick={() => setEditingItemNoteId(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="note-body">
              <input
                autoFocus
                placeholder="e.g. Less spicy, Extra crispy, No onion..."
                value={tempNoteText}
                onChange={(e) => setTempNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveItemNote(editingItemNoteId, tempNoteText);
                  }
                }}
              />
              <div className="quick-instruction-pills">
                {[
                  "Less spicy",
                  "Extra spicy",
                  "No onion",
                  "No garlic",
                  "Jain preparation",
                  "Serve piping hot",
                ].map((txt) => (
                  <button
                    key={txt}
                    type="button"
                    onClick={() => setTempNoteText(txt)}
                  >
                    {txt}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setEditingItemNoteId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-btn"
                onClick={() => saveItemNote(editingItemNoteId, tempNoteText)}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: EDIT PRICE */}
      {editingItem && (
        <div
          className="pos-modal-overlay"
          onClick={() => setEditingItem(null)}
        >
          <div
            className="pos-modal-card edit-price-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Edit Price: {editingItem.name}</h3>
              <button type="button" onClick={() => setEditingItem(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="note-body">
              <label>New Price (₹):</label>
              <input
                autoFocus
                type="number"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setEditingItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-btn"
                onClick={handleUpdatePrice}
              >
                Update Price
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: ADD DISH */}
      {showAddModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="pos-modal-card add-dish-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Add New Menu Dish</h3>
              <button type="button" onClick={() => setShowAddModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="add-dish-form">
              <label>Dish Name:</label>
              <input
                placeholder="e.g. Paneer Lababdar"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
              />
              <label>Price (₹):</label>
              <input
                type="number"
                placeholder="e.g. 280"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
              />
              <label>Category:</label>
              <input
                type="text"
                list="add-dish-category-options"
                placeholder="e.g. Starters, Soups, Chinese..."
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value)}
              />
              <datalist id="add-dish-category-options">
                {(categoriesWithCounts.length > 1
                  ? categoriesWithCounts.filter((c) => c.name !== "All Dishes").map((c) => c.name)
                  : SUGGESTED_CATEGORIES
                ).map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-btn"
                disabled={addingItem}
                onClick={handleAddDish}
              >
                {addingItem ? "Adding..." : "Add to Menu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BULK MENU CREATION */}
      {showBulkModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => setShowBulkModal(false)}
        >
          <div
            className="pos-modal-card bulk-menu-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="bulk-title-cluster">
                <h3>⚡ Bulk Menu Creation</h3>
                <span className="bulk-subtitle">
                  Create dishes with Item Category, Name, and Cost all at once
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowBulkModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="bulk-tabs-bar">
              <button
                type="button"
                className={`bulk-tab-btn ${bulkMode === "GRID" ? "active" : ""}`}
                onClick={() => setBulkMode("GRID")}
              >
                <span>📋 Table Grid Entry</span>
              </button>
              <button
                type="button"
                className={`bulk-tab-btn ${bulkMode === "TEXT" ? "active" : ""}`}
                onClick={() => setBulkMode("TEXT")}
              >
                <span>📝 Quick Paste / CSV</span>
              </button>
            </div>

            <datalist id="bulk-category-suggestions">
              {(categoriesWithCounts.length > 1
                ? categoriesWithCounts.filter((c) => c.name !== "All Dishes").map((c) => c.name)
                : SUGGESTED_CATEGORIES
              ).map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>

            <div className="bulk-modal-body">
              {bulkMode === "GRID" ? (
                <div className="bulk-grid-container">
                  <table className="bulk-entry-table">
                    <thead>
                      <tr>
                        <th style={{ width: "36px" }}>#</th>
                        <th style={{ width: "28%" }}>Category</th>
                        <th style={{ width: "42%" }}>Dish Name</th>
                        <th style={{ width: "22%" }}>Cost (₹)</th>
                        <th style={{ width: "36px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, idx) => (
                        <tr key={row.id}>
                          <td className="row-num">{idx + 1}</td>
                          <td>
                            <input
                              list="bulk-category-suggestions"
                              placeholder="Category..."
                              className="bulk-cell-input"
                              value={row.category}
                              onChange={(e) =>
                                handleBulkRowChange(row.id, "category", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              placeholder="e.g. Butter Chicken"
                              className="bulk-cell-input name-input"
                              value={row.name}
                              onChange={(e) =>
                                handleBulkRowChange(row.id, "name", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <div className="cost-input-wrapper">
                              <span className="rupee-sym">₹</span>
                              <input
                                type="number"
                                placeholder="320"
                                className="bulk-cell-input cost-input"
                                value={row.cost}
                                onChange={(e) =>
                                  handleBulkRowChange(row.id, "cost", e.target.value)
                                }
                              />
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="bulk-row-del-btn"
                              title="Remove row"
                              onClick={() => handleRemoveBulkRow(row.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="bulk-row-actions">
                    <button
                      type="button"
                      className="add-row-btn"
                      onClick={handleAddBulkRow}
                    >
                      <Plus size={13} />
                      <span>+ Add Row</span>
                    </button>
                    <button
                      type="button"
                      className="add-row-btn secondary"
                      onClick={() => handleAddMultipleBulkRows(5)}
                    >
                      <span>+ Add 5 Rows</span>
                    </button>
                    <button
                      type="button"
                      className="clear-rows-btn"
                      onClick={() =>
                        setBulkRows([
                          { id: `b-${Date.now()}-1`, category: "Mains", name: "", cost: "" },
                          { id: `b-${Date.now()}-2`, category: "Mains", name: "", cost: "" },
                          { id: `b-${Date.now()}-3`, category: "Starters", name: "", cost: "" },
                        ])
                      }
                    >
                      Reset Rows
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bulk-text-container">
                  <div className="bulk-text-hint">
                    Paste from Excel, Google Sheets, or type lines formatted as:{" "}
                    <code>Category, Dish Name, Cost</code>
                  </div>
                  <textarea
                    rows={9}
                    className="bulk-textarea"
                    placeholder={`Mains, Butter Chicken, 320\nMains, Paneer Butter Masala, 280\nStarters, Chicken Tikka, 280\nBreads, Butter Naan, 55\nBeverages, Cold Coffee, 140`}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                  />
                  <button
                    type="button"
                    className="parse-text-btn"
                    onClick={handleParseBulkText}
                  >
                    <span>📋 Parse & Load into Table</span>
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer bulk-footer">
              <div className="valid-count-pill">
                <b>
                  {
                    bulkRows.filter(
                      (r) => r.name.trim() !== "" && Number(r.cost) > 0
                    ).length
                  }
                </b>{" "}
                valid dishes ready
              </div>

              <div className="footer-btns">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setShowBulkModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="confirm-btn"
                  disabled={savingBulk}
                  onClick={handleSaveBulkMenu}
                >
                  {savingBulk ? "Saving..." : "Save to Menu"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: PRINTER SETTINGS */}
      {showSettingsModal && (
        <div
          className="pos-modal-overlay"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="pos-modal-card settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Thermal Printer Settings</h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-body">
              <label className="settings-row">
                <span>Receipt Paper Width:</span>
                <select
                  value={getLocalSettings().paperWidth}
                  onChange={(e) => {
                    const next = e.target.value as "58mm" | "80mm";
                    saveLocalSettings({ paperWidth: next });
                  }}
                >
                  <option value="58mm">58mm (2-inch)</option>
                  <option value="80mm">80mm (3-inch / Standard)</option>
                </select>
              </label>
              {/* Print-on-Settle toggles (bill + KOT) live at the bottom of
                  the cart panel now, next to the Settle button — visible
                  where they're actually used, instead of buried here where
                  a KOT could fire on Settle with no visible sign why. */}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="confirm-btn"
                onClick={() => setShowSettingsModal(false)}
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STYLES PRESERVED EXACTLY AS PROVIDED */}
      <style jsx>{`
        .restaurant-iq-pos {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-height: 100vh;
          width: 100vw;
          max-width: 100vw;
          background: #faf7f2;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #1c1917;
          overflow: hidden;
          margin: 0;
          padding: 0;
        }

        /* Sleek modern POS scrollbars */
        .restaurant-iq-pos *::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .restaurant-iq-pos *::-webkit-scrollbar-track {
          background: transparent;
        }
        .restaurant-iq-pos *::-webkit-scrollbar-thumb {
          background: #e7e0d3;
          border-radius: 4px;
        }
        .restaurant-iq-pos *::-webkit-scrollbar-thumb:hover {
          background: #a8a29e;
        }

        /* Prevent Next.js Turbopack dev badge from blocking bottom-left actions */
        nextjs-portal, [data-nextjs-toast], #__next-build-watcher {
          pointer-events: none !important;
          opacity: 0.15 !important;
          transform: scale(0.65) !important;
          transform-origin: bottom left !important;
        }

        /* 1. TOP BAR */
        .pos-top-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          height: 46px;
          min-height: 46px;
          background: #ffffff;
          color: #1c1917;
          border-bottom: 1px solid #ede7dc;
          flex-shrink: 0;
        }

        .pos-brand-cluster {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pos-brand-logo {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .pos-brand-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .pos-brand-meta b {
          font-size: 13px;
          font-weight: 800;
          letter-spacing: -0.01em;
          display: block;
          line-height: 1.1;
          color: #1c1917;
        }

        .pos-brand-meta span {
          font-size: 10px;
          color: #78716c;
          display: block;
          line-height: 1.1;
        }

        .top-divider {
          width: 1px;
          height: 22px;
          background: #ede7dc;
        }

        .pos-channel-group {
          display: flex;
          gap: 2px;
          background: #faf7f2;
          padding: 2px;
          border-radius: 7px;
          border: 1px solid #ede7dc;
        }

        .pos-channel-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          border-radius: 5px;
          border: none;
          background: transparent;
          color: #78716c;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-channel-btn:hover {
          color: #1c1917;
          background: #ffffff;
        }

        .pos-channel-btn.active {
          background: #d99726;
          color: #ffffff;
          font-weight: 700;
          box-shadow: 0 1px 4px rgba(217, 151, 38, 0.3);
        }

        /* VIEW SWITCHER IN TOP BAR */
        .pos-view-switcher {
          display: flex;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 7px;
          padding: 2px;
          gap: 2px;
        }

        .pos-view-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 5px;
          border: none;
          background: transparent;
          color: #78716c;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-view-btn:hover {
          color: #1c1917;
          background: #ffffff;
        }

        .pos-view-btn.active {
          background: #d99726;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(217, 151, 38, 0.3);
        }

        .pos-dinein-nav-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 11px;
          border-radius: 6px;
          border: 1px solid #ede7dc;
          background: #faf7f2;
          color: #44403c;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-dinein-nav-btn:hover {
          background: #d99726;
          border-color: #d99726;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(217, 151, 38, 0.3);
        }

        .pos-table-selector-container {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .pos-table-selector-trigger {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          color: #1c1917;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-table-selector-trigger.no-table {
          border-color: #fde68a;
          background: #fef9ee;
          color: #b45309;
        }

        .pos-table-selector-trigger.has-table {
          border-color: #bbf7d0;
          background: #ecfdf5;
          color: #15803d;
        }

        .no-table-prompt {
          font-weight: 700;
          color: #44403c;
        }

        .table-optional-hint {
          font-size: 10px;
          font-weight: 700;
          background: #ede7dc;
          padding: 1px 5px;
          border-radius: 4px;
          color: #57534e;
          margin-left: 2px;
        }

        .pos-table-clear-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .pos-table-clear-btn:hover {
          background: #ef4444;
          color: #ffffff;
        }

        .pos-table-selector-trigger:hover {
          background: #ffffff;
        }

        .table-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }

        .table-status-dot.vacant {
          background: #10b981;
        }

        .table-status-dot.occupied {
          background: #ef4444;
        }

        .table-status-text {
          font-size: 10px;
          font-weight: 700;
          color: #78716c;
          text-transform: uppercase;
        }

        .chev-icon {
          color: #78716c;
        }

        .server-input {
          display: flex;
          align-items: center;
          gap: 5px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          padding: 3px 8px;
          color: #78716c;
          width: 105px;
        }

        .server-input input {
          border: none;
          background: transparent;
          color: #1c1917;
          font-size: 11px;
          width: 100%;
          outline: none;
        }

        .server-input input::placeholder {
          color: #a8a29e;
        }

        .top-spacer {
          flex: 1;
        }

        .pos-top-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .pos-tool-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          border-radius: 6px;
          border: 1px solid #ede7dc;
          background: #faf7f2;
          color: #44403c;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-tool-btn:hover {
          background: #ffffff;
          border-color: #d99726;
          color: #1c1917;
        }

        .pos-tool-btn.icon-only {
          padding: 4px 7px;
        }

        .pos-tool-btn.has-held {
          background: #d97706;
          color: #ffffff;
          border-color: #f59e0b;
          font-weight: 700;
        }

        .logout-btn:hover {
          background: #fef2f2;
          color: #dc2626;
          border-color: #fecaca;
        }

        .debug-panel-btn.active {
          background: #7c3aed;
          border-color: #7c3aed;
          color: #ffffff;
        }

        .debug-storage-panel {
          position: fixed;
          top: 46px;
          right: 0;
          bottom: 0;
          width: 380px;
          max-width: 92vw;
          background: #1c1917;
          color: #e7e0d3;
          z-index: 500;
          display: flex;
          flex-direction: column;
          box-shadow: -6px 0 18px rgba(0, 0, 0, 0.25);
          font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
        }

        .debug-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          flex-shrink: 0;
        }

        .debug-panel-head strong {
          font-size: 13px;
          display: block;
        }

        .debug-updated-at {
          font-size: 10px;
          color: #a8a29e;
        }

        .debug-panel-head button {
          background: transparent;
          border: none;
          color: #e7e0d3;
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
        }

        .debug-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px 10px 20px;
        }

        .debug-section-title {
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #a78bfa;
          margin: 14px 0 6px;
        }

        .debug-entry {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          margin-bottom: 6px;
          overflow: hidden;
        }

        .debug-entry-head {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.04);
          border: none;
          color: #e7e0d3;
          cursor: pointer;
          font-family: inherit;
          font-size: 11px;
          text-align: left;
        }

        .debug-caret {
          color: #a8a29e;
          width: 10px;
        }

        .debug-key {
          flex: 1;
          font-weight: 700;
          word-break: break-all;
        }

        .debug-badge {
          font-size: 9.5px;
          color: #a8a29e;
          background: rgba(255, 255, 255, 0.06);
          padding: 1px 6px;
          border-radius: 10px;
          flex-shrink: 0;
        }

        .debug-value {
          margin: 0;
          padding: 8px;
          font-size: 10.5px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 260px;
          overflow-y: auto;
          background: #0c0a09;
          color: #86efac;
        }

        .pos-status-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
        }

        .pos-status-badge .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .pos-status-badge.online {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .pos-status-badge.online .live-dot {
          background: #10b981;
        }

        .pos-status-badge.offline {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .pos-status-badge.offline .live-dot {
          background: #ef4444;
        }

        /* 2. MAIN 3-COLUMN LAYOUT */
        .pos-main-body {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          align-items: stretch;
          flex: 1;
          width: 100%;
          max-width: 100vw;
          height: calc(100vh - 46px);
          max-height: calc(100vh - 46px);
          overflow: hidden;
          background: #ffffff;
          margin: 0;
          padding: 0;
          gap: 0;
          box-sizing: border-box;
        }

        /* TABLES FLOOR SCREEN (30 TABLES) */
        .pos-tables-screen {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #faf7f2;
          overflow: hidden;
          padding: 8px 12px;
        }

        .tables-screen-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px 8px 6px;
          border-bottom: 1px solid #ede7dc;
          margin-bottom: 8px;
          flex-shrink: 0;
        }

        .tables-toolbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .tables-toolbar-left h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 800;
          color: #1c1917;
        }

        .tables-stat-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .tables-stat-badge.vacant {
          background: #dcfce7;
          color: #15803d;
        }

        .tables-stat-badge.occupied {
          background: #fee2e2;
          color: #b91c1c;
        }

        button.tables-stat-badge {
          border: 0;
          cursor: pointer;
        }

        .tables-stat-badge.sync-summary.synced {
          background: #dcfce7;
          color: #15803d;
        }

        .tables-stat-badge.sync-summary.pending {
          background: #fef3c7;
          color: #a16207;
        }

        .tables-stat-badge.sync-summary.failed {
          background: #fee2e2;
          color: #b91c1c;
        }

        .sync-summary.synced .status-dot { background: #16a34a; }
        .sync-summary.pending .status-dot { background: #d97706; }
        .sync-summary.failed .status-dot { background: #dc2626; }

        .sync-detail-panel {
          flex-shrink: 0;
          margin: 0 6px 8px;
          padding: 10px 12px;
          border: 1px solid #e7ded1;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 2px 7px rgba(45, 35, 20, 0.06);
        }

        .sync-detail-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          color: #292524;
        }

        .sync-detail-head b, .sync-detail-head span { display: block; }
        .sync-detail-head span { margin-top: 2px; font-size: 11px; color: #78716c; }
        .sync-detail-head button { border: 0; background: transparent; color: #78716c; cursor: pointer; padding: 0; }
        .sync-empty-state { padding-top: 9px; font-size: 12px; color: #15803d; font-weight: 600; }

        .retry-all-btn {
          display: flex !important;
          align-items: center;
          gap: 4px;
          padding: 5px 10px !important;
          border-radius: 6px !important;
          background: #dc2626 !important;
          color: #ffffff !important;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .retry-all-btn:hover {
          background: #b91c1c !important;
        }

        .retry-all-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .retry-one-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
          padding: 4px 8px;
          border-radius: 5px;
          border: 1px solid #fca5a5;
          background: #ffffff;
          color: #b91c1c;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
          width: fit-content;
        }

        .retry-one-btn:hover {
          background: #fee2e2;
        }

        .retry-one-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sync-order-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 7px;
          margin-top: 9px;
        }

        .sync-order-row {
          position: relative;
          padding: 7px 8px;
          border-radius: 6px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          display: grid;
          gap: 2px;
          font-size: 11px;
          color: #57534e;
        }

        .sync-order-row.failed { border-color: #fecaca; background: #fff1f2; }
        .sync-order-row b { color: #292524; font-size: 12px; }
        .sync-order-row small { color: #78716c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sync-order-status { font-size: 10px; font-weight: 800; color: #a16207; }
        .sync-order-row.failed .sync-order-status { color: #be123c; }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }

        .status-dot.green {
          background: #16a34a;
        }

        .status-dot.red {
          background: #dc2626;
        }

        .tables-toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .tables-toolbar-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          background: #d99726;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tables-toolbar-btn:hover {
          background: #c88719;
        }

        /* 6 COLUMNS X 5 ROWS TO FIT EXACTLY 30 TABLES ON SCREEN */
        .tables-30-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          grid-auto-rows: minmax(0, 1fr);
          gap: 5px;
          overflow-y: auto;
        }

        .table-tile-card {
          border-radius: 6px;
          padding: 4px 6px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.12s ease;
          min-height: 0;
        }

        .table-tile-card:hover {
          transform: translateY(-1px);
        }

        .table-tile-card.current {
          border-color: #d99726 !important;
          box-shadow: 0 0 0 2px #d99726 !important;
          opacity: 1 !important;
        }

        .table-tile-card.vacant {
          background: #f4f2ee;
          border: 1.5px solid #e5e0d5;
          border-left: 3.5px solid #10b981;
          box-shadow: none;
        }

        .table-tile-card.vacant:hover {
          background: #ffffff;
          border-color: #93c5fd;
          box-shadow: 0 3px 8px rgba(217, 151, 38, 0.1);
        }

        .table-tile-card.vacant .tile-title b,
        .table-tile-card.vacant .tile-title small {
          color: #9a938a;
        }

        .table-tile-card.occupied {
          background: #fef2f2;
          border: 2px solid #ef4444;
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
        }

        .table-tile-card.occupied:hover {
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
        }

        .tile-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          line-height: 1.1;
        }

        .tile-title b {
          font-size: 12.5px;
          font-weight: 900;
          color: #1c1917;
          margin-right: 4px;
        }

        .tile-title small {
          font-size: 9px;
          color: #78716c;
          font-weight: 600;
        }

        .tile-badge {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 3px;
          text-transform: uppercase;
        }

        .tile-badge.vacant {
          background: #dcfce7;
          color: #15803d;
        }

        .tile-badge.occupied {
          background: #fee2e2;
          color: #b91c1c;
        }

        .tile-badge-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .tile-round-badge {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 3px;
          background: #ede9fe;
          color: #6d28d9;
        }

        .round-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 10px;
          background: #ede9fe;
          color: #6d28d9;
          white-space: nowrap;
          border: none;
          cursor: pointer;
          transition: background 0.12s ease;
        }

        .round-badge:hover {
          background: #ddd6fe;
        }

        .round-breakdown-panel {
          margin: 0 10px 6px;
          padding: 6px 9px;
          border-radius: 8px;
          background: #faf5ff;
          border: 1px solid #ede9fe;
          max-height: 96px;
          overflow-y: auto;
        }

        .round-breakdown-empty {
          font-size: 10.5px;
          color: #78716c;
          font-weight: 600;
        }

        .round-breakdown-group + .round-breakdown-group {
          margin-top: 5px;
          padding-top: 5px;
          border-top: 1px dashed #ddd6fe;
        }

        .round-breakdown-label {
          font-size: 10px;
          font-weight: 800;
          color: #6d28d9;
          margin-bottom: 2px;
          letter-spacing: 0.02em;
        }

        .round-breakdown-item {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-size: 10.5px;
          color: #44403c;
          padding: 0;
          line-height: 1.4;
        }

        .round-breakdown-qty {
          font-weight: 700;
          color: #57534e;
          flex-shrink: 0;
        }

        .tile-body {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 22px;
          margin: 2px 0;
        }

        .tile-order-data {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 4px;
        }

        .tile-amount {
          font-size: 13px;
          font-weight: 800;
          color: #16a34a;
          font-variant-numeric: tabular-nums;
        }

        .tile-sub {
          font-size: 9.5px;
          color: #78716c;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tile-sync-status {
          display: inline-flex;
          width: fit-content;
          margin-top: 3px;
          padding: 2px 5px;
          border-radius: 999px;
          font-size: 8.5px;
          font-weight: 800;
          line-height: 1;
        }

        .tile-sync-status.synced { background: #dcfce7; color: #15803d; }
        .tile-sync-status.pending, .tile-sync-status.syncing { background: #fef3c7; color: #a16207; }
        .tile-sync-status.failed { background: #fee2e2; color: #b91c1c; }

        .tile-vacant-content {
          font-size: 10.5px;
          color: #a8a29e;
          font-weight: 600;
        }

        .tile-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          border-top: 1px dashed #faf7f2;
          padding-top: 3px;
          margin-top: 1px;
        }

        .tile-action-btns {
          display: flex;
          align-items: center;
          gap: 3px;
          width: 100%;
        }

        .tile-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 2px 5px;
          height: 20px;
          border-radius: 4px;
          border: none;
          font-size: 9px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .tile-btn.bill-print-btn {
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
          flex: 1;
        }

        .tile-btn.bill-print-btn:hover {
          background: #dbeafe;
        }

        .tile-btn.settle-pay-btn {
          background: #16a34a;
          color: #ffffff;
          padding: 2px 6px;
          height: 20px;
          font-size: 9px;
          font-weight: 800;
          border-radius: 4px;
          box-shadow: 0 1px 2px rgba(22, 163, 74, 0.2);
          flex: 1;
        }

        .tile-btn.settle-pay-btn:hover {
          background: #15803d;
        }

        .tile-btn.delete-order-btn {
          background: #fef2f2;
          color: #dc2626;
          width: 20px;
          height: 20px;
          padding: 0;
          justify-content: center;
          border: 1px solid #fecaca;
          flex-shrink: 0;
        }

        .tile-btn.delete-order-btn:hover {
          background: #fee2e2;
          color: #b91c1c;
        }

        .tile-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .tile-new-order-btn {
          border: none;
          background: transparent;
          color: #d99726;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          padding: 1px 4px;
        }

        .tile-new-order-btn:hover {
          text-decoration: underline;
        }

        /* COLUMN 1: VERTICAL CATEGORY RAIL */
        .pos-vertical-category-rail {
          width: 175px;
          min-width: 175px;
          max-width: 175px;
          background: #ffffff;
          border-right: 1px solid #ede7dc;
          display: flex;
          flex-direction: column;
          height: 100%;
          flex-shrink: 0;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .vertical-cat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 10px;
          height: 40px;
          border-bottom: 1px solid #faf7f2;
          flex-shrink: 0;
        }

        .rail-title {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #78716c;
        }

        .rail-count {
          font-size: 10.5px;
          font-weight: 700;
          background: #faf7f2;
          color: #78716c;
          padding: 1px 6px;
          border-radius: 999px;
        }

        .vertical-cat-list {
          flex: 1;
          overflow-y: auto;
          padding: 5px 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .vertical-cat-btn {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          padding: 0 8px;
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: #44403c;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
          width: 100%;
        }

        .vertical-cat-btn:hover {
          background: #faf7f2;
          color: #1c1917;
        }

        .vertical-cat-btn.active {
          background: #fef9ee;
          color: #c88719;
          border-color: #fde68a;
          font-weight: 700;
        }

        .cat-icon {
          font-size: 16px;
          line-height: 1;
          flex-shrink: 0;
        }

        .cat-name {
          flex: 1;
          font-size: 12.5px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cat-badge {
          font-size: 10.5px;
          font-weight: 700;
          background: #faf7f2;
          color: #78716c;
          padding: 1px 5px;
          border-radius: 4px;
        }

        .vertical-cat-btn.active .cat-badge {
          background: #fde68a;
          color: #c88719;
        }

        .cat-active-indicator {
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 4px;
          background: #d99726;
          border-radius: 0 3px 3px 0;
        }

        .vertical-cat-footer {
          padding: 8px 8px 24px 8px;
          border-top: 1px solid #faf7f2;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .quick-add-dish-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 32px;
          background: #faf7f2;
          border: 1px dashed #e7e0d3;
          border-radius: 6px;
          color: #44403c;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .quick-add-dish-btn:hover {
          background: #fef9ee;
          border-color: #e2a034;
          color: #d99726;
        }

        .terminal-shift-pill {
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .shift-dot-row {
          display: flex;
          align-items: center;
          gap: 5px;
          font-weight: 700;
          color: #10b981;
          font-size: 10.5px;
        }

        .shift-dot-row .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
        }

        .shift-info-row {
          display: flex;
          justify-content: space-between;
          font-size: 9.5px;
          color: #78716c;
        }

        /* COLUMN 2: DISH CATALOG PANEL */
        .pos-catalog-panel {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #faf7f2;
          border-right: 1px solid #ede7dc;
          height: 100%;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .catalog-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 42px;
          background: #ffffff;
          border-bottom: 1px solid #ede7dc;
          gap: 10px;
          flex-shrink: 0;
        }

        .catalog-title-wrap {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .catalog-title-wrap h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: #1c1917;
        }

        .item-count-sub {
          font-size: 11px;
          color: #78716c;
          font-weight: 600;
        }

        .veg-filter-pills {
          display: flex;
          gap: 2px;
          background: #faf7f2;
          padding: 2px;
          border-radius: 6px;
        }

        .veg-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 4px;
          border: none;
          background: transparent;
          color: #78716c;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .veg-pill.active {
          background: #ffffff;
          color: #1c1917;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          font-weight: 700;
        }

        .veg-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #16a34a;
        }

        .non-veg-triangle {
          width: 0;
          height: 0;
          border-left: 3.5px solid transparent;
          border-right: 3.5px solid transparent;
          border-bottom: 7px solid #dc2626;
        }

        .pos-search-box {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          padding: 0 8px;
          height: 28px;
          width: 170px;
        }

        .pos-search-box input {
          border: none;
          background: transparent;
          font-size: 11.5px;
          width: 100%;
          outline: none;
          color: #1c1917;
        }

        .clear-search {
          border: none;
          background: transparent;
          color: #a8a29e;
          cursor: pointer;
          padding: 0;
        }

        .dishes-grid {
          flex: 1;
          overflow-y: auto;
          padding: 8px 10px 16px 10px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          align-content: start;
        }

        @media (max-width: 1080px) {
          .dishes-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        .dish-card {
          background: #ffffff;
          border: 1.5px solid #ede7dc;
          border-radius: 7px;
          padding: 5px 7px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.12s ease;
          min-height: 80px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
          position: relative;
          overflow: hidden;
        }

        .dish-card:hover {
          border-color: #93c5fd;
          transform: translateY(-1px);
          box-shadow: 0 3px 6px rgba(217, 151, 38, 0.07);
        }

        .dish-card.in-cart {
          border-color: #d99726;
          background: #fef9ee;
          box-shadow: 0 0 0 1px #d99726;
        }

        .dish-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }

        .dish-indicator-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* FSSAI Standard Indicator */
        .fssai-symbol {
          width: 12px;
          height: 12px;
          border: 1.2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .fssai-symbol.veg {
          border-color: #16a34a;
        }

        .fssai-symbol.veg .symbol-inner {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #16a34a;
        }

        .fssai-symbol.non-veg {
          border-color: #dc2626;
        }

        .fssai-symbol.non-veg .symbol-inner {
          width: 0;
          height: 0;
          border-left: 3px solid transparent;
          border-right: 3px solid transparent;
          border-bottom: 6px solid #dc2626;
        }

        .dish-cat-tag {
          font-size: 9.5px;
          font-weight: 600;
          color: #a8a29e;
          text-transform: capitalize;
        }

        .dish-price {
          font-size: 13.5px;
          font-weight: 800;
          color: #1c1917;
          font-variant-numeric: tabular-nums;
        }

        .dish-card.in-cart .dish-price {
          color: #c88719;
        }

        .dish-info {
          margin-bottom: 3px;
          flex: 1;
        }

        .dish-name {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          color: #1c1917;
          line-height: 1.28;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
        }

        .dish-card-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: auto;
          height: 22px;
        }

        .card-add-btn {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 7px;
          height: 22px;
          background: #faf7f2;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
          color: #44403c;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .dish-card:hover .card-add-btn {
          background: #d99726;
          border-color: #d99726;
          color: #ffffff;
        }

        .card-stepper {
          display: flex;
          align-items: center;
          gap: 1px;
          background: #d99726;
          border-radius: 6px;
          padding: 1px 2px;
          color: #ffffff;
          height: 28px;
        }

        .card-step-btn {
          border: none;
          background: transparent;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          cursor: pointer;
          border-radius: 4px;
        }

        .card-step-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .card-qty {
          font-size: 12.5px;
          font-weight: 800;
          min-width: 20px;
          text-align: center;
        }

        .edit-dish-price-btn {
          border: none;
          background: transparent;
          color: #e7e0d3;
          padding: 1px;
          cursor: pointer;
          opacity: 0;
          transition: all 0.12s ease;
        }

        .dish-card:hover .edit-dish-price-btn {
          opacity: 0.7;
        }

        .edit-dish-price-btn:hover {
          opacity: 1 !important;
          color: #d99726;
        }

        .empty-catalog-state {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 30px 10px;
          color: #a8a29e;
          text-align: center;
          gap: 6px;
        }

        .reset-filters-btn {
          padding: 5px 12px;
          background: #d99726;
          color: #ffffff;
          border: none;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        /* COLUMN 3: BILLING & CHECKOUT TERMINAL */
        .pos-checkout-panel {
          width: 420px;
          min-width: 400px;
          max-width: 440px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          margin: 0;
          height: 100%;
          border: none;
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          flex-shrink: 0;
          box-sizing: border-box;
        }

        .ticket-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 10px;
          height: 38px;
          border-bottom: 1px solid #ede7dc;
          background: #faf7f2;
          flex-shrink: 0;
        }

        .ticket-channel-info {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ticket-channel-badge {
          font-size: 11px;
          font-weight: 800;
          background: #fde68a;
          color: #1e40af;
          padding: 2px 7px;
          border-radius: 4px;
        }

        .ticket-clear-table-pill {
          font-size: 10px;
          font-weight: 700;
          color: #ef4444;
          background: #fee2e2;
          border: 1px solid #fca5a5;
          border-radius: 4px;
          padding: 2px 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .ticket-clear-table-pill:hover {
          background: #ef4444;
          color: #ffffff;
        }

        .ticket-clock {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 10.5px;
          color: #78716c;
        }

        .clear-cart-btn {
          border: none;
          background: transparent;
          color: #ef4444;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .cart-items-container {
          flex: 1;
          overflow-y: auto;
          padding: 0;
        }

        .empty-cart-message {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          color: #a8a29e;
          text-align: center;
          gap: 4px;
        }

        .empty-cart-message b {
          color: #57534e;
          font-size: 13px;
        }

        .empty-cart-message span {
          font-size: 11px;
        }

        .cart-items-list {
          display: flex;
          flex-direction: column;
          width: 100%;
        }

        .cart-item-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 32px;
          min-height: 32px;
          max-height: 32px;
          padding: 0 6px;
          border-bottom: 1px solid #faf7f2;
          background: #ffffff;
          box-sizing: border-box;
          transition: background 0.1s ease;
        }

        .cart-item-row:hover {
          background: #faf7f2;
        }

        .cart-item-left {
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          margin-right: 4px;
        }

        .cart-veg-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .cart-veg-dot.veg {
          background: #16a34a;
        }

        .cart-veg-dot.non-veg {
          background: #dc2626;
        }

        .cart-item-name {
          font-size: 13.5px;
          font-weight: 600;
          color: #1c1917;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1;
        }

        .add-note-btn.inline {
          border: none;
          background: transparent;
          color: #e2a034;
          font-size: 10px;
          font-weight: 600;
          padding: 0 2px;
          margin: 0;
          cursor: pointer;
          flex-shrink: 0;
          opacity: 0.75;
        }

        .add-note-btn.inline:hover {
          opacity: 1;
          text-decoration: underline;
        }

        .item-note-pill.inline {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 0 3px;
          background: #fef3c7;
          color: #92400e;
          font-size: 9.5px;
          font-weight: 600;
          border-radius: 3px;
          max-width: 70px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
        }

        .cart-item-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .cart-stepper {
          display: flex;
          align-items: center;
          border: 1px solid #e7e0d3;
          border-radius: 4px;
          padding: 0;
          background: #ffffff;
          height: 24px;
        }

        .cart-stepper button {
          border: none;
          background: transparent;
          color: #57534e;
          padding: 0 5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .cart-stepper button:hover {
          background: #faf7f2;
        }

        .cart-stepper span {
          font-size: 13px;
          font-weight: 700;
          color: #1c1917;
          min-width: 18px;
          text-align: center;
        }

        .cart-item-price {
          font-size: 14px;
          font-weight: 700;
          color: #1c1917;
          font-variant-numeric: tabular-nums;
          min-width: 52px;
          text-align: right;
          white-space: nowrap;
        }

        .remove-item-btn {
          border: none;
          background: transparent;
          color: #e7e0d3;
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.12s ease;
        }

        .remove-item-btn:hover {
          color: #ef4444;
        }

        /* BILL CALCULATIONS */
        .bill-calculations-section {
          padding: 6px 10px 10px 10px;
          background: #faf7f2;
          border-top: 1px solid #ede7dc;
          flex-shrink: 0;
        }

        .calc-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          margin-bottom: 3px;
          color: #57534e;
        }

        .discount-row {
          align-items: center;
        }

        .discount-label-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .discount-pills {
          display: flex;
          gap: 2px;
        }

        .disc-pill {
          padding: 1px 4px;
          height: 18px;
          border: 1px solid #e7e0d3;
          border-radius: 3px;
          background: #ffffff;
          color: #57534e;
          font-size: 9.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .disc-pill.active {
          background: #d99726;
          color: #ffffff;
          border-color: #d99726;
        }

        .discount-applied-val {
          color: #16a34a;
          font-weight: 700;
        }

        .tax-row {
          border-top: 1px dashed #ede7dc;
          padding-top: 4px;
        }

        .gst-toggle-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          cursor: pointer;
        }

        .grand-total-row {
          border-top: 1.5px solid #ede7dc;
          padding-top: 6px;
          margin-top: 2px;
          font-size: 12px;
          font-weight: 800;
          color: #1c1917;
        }

        .grand-total-amount {
          font-size: 18px;
          font-weight: 900;
          color: #16a34a;
        }

        .payment-modes-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 3px;
          margin: 6px 0;
        }

        .payment-mode-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          height: 28px;
          border: 1px solid #e7e0d3;
          background: #ffffff;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .payment-mode-btn.active {
          border-color: #d99726;
          background: #d99726;
        }

        .pay-icon {
          font-size: 12px;
        }

        .pay-label {
          font-size: 11px;
          font-weight: 700;
          color: #44403c;
        }

        .payment-mode-btn.active .pay-label {
          color: #ffffff;
        }

        .payment-mode-btn.save-table-mode-btn {
          border-color: #10b981;
          background: #ecfdf5;
        }

        .payment-mode-btn.save-table-mode-btn .pay-label {
          color: #047857;
          font-weight: 800;
        }

        .payment-mode-btn.save-table-mode-btn:hover:not(:disabled) {
          background: #10b981;
          border-color: #059669;
        }

        .payment-mode-btn.save-table-mode-btn:hover:not(:disabled) .pay-label {
          color: #ffffff;
        }

        .payment-mode-btn.save-table-mode-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          border-color: #e7e0d3;
          background: #f5f5f4;
        }

        /* CASH CALCULATOR */
        .cash-calculator-box {
          background: #ffffff;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          padding: 5px 8px;
          margin-bottom: 6px;
        }

        .cash-input-row {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .cash-input-row label {
          font-size: 10.5px;
          font-weight: 600;
          white-space: nowrap;
        }

        .cash-input-row input {
          width: 65px;
          padding: 2px 5px;
          font-size: 11px;
          border: 1px solid #e7e0d3;
          border-radius: 4px;
          outline: none;
        }

        .quick-tender-pills {
          display: flex;
          gap: 2px;
        }

        .quick-tender-pills button {
          border: 1px solid #ede7dc;
          background: #faf7f2;
          border-radius: 3px;
          padding: 1px 4px;
          font-size: 9.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .change-due-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          border-top: 1px dashed #faf7f2;
          padding-top: 3px;
          margin-top: 3px;
        }

        .change-ok {
          color: #16a34a;
          font-weight: 800;
        }

        .change-short {
          color: #dc2626;
          font-weight: 700;
        }

        /* 3-CLICK ACTION BAR */
        .action-buttons-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1.5fr;
          gap: 5px;
          margin-top: 4px;
        }

        .print-on-settle-group {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px 18px;
        }

        .print-on-settle-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          padding: 6px 4px 2px;
          font-size: 11px;
          font-weight: 600;
          color: #57534e;
          cursor: pointer;
          user-select: none;
        }

        .print-on-settle-toggle input[type="checkbox"] {
          width: 15px;
          height: 15px;
          accent-color: #16a34a;
          cursor: pointer;
        }

        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 38px;
          border-radius: 6px;
          border: none;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .kot-btn {
          background: #faf7f2;
          color: #44403c;
          border: 1px solid #e7e0d3;
        }

        .kot-btn:hover:not(:disabled) {
          background: #ede7dc;
          color: #1c1917;
        }

        .bill-btn {
          background: #fef9ee;
          color: #c88719;
          border: 1px solid #fde68a;
        }

        .bill-btn:hover:not(:disabled) {
          background: #fde68a;
        }

        .settle-btn {
          background: #16a34a;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(22, 163, 74, 0.3);
          font-size: 13px;
        }

        .settle-btn:hover:not(:disabled) {
          background: #15803d;
        }

        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* MODALS */
        .pos-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(28, 25, 23, 0.65);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999;
        }

        .pos-modal-card {
          background: #ffffff;
          border-radius: 10px;
          width: 90%;
          max-width: 480px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 85vh;
        }

        .modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-bottom: 1px solid #ede7dc;
          background: #faf7f2;
        }

        .modal-head h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: #1c1917;
        }

        .modal-head button {
          border: none;
          background: transparent;
          color: #78716c;
          cursor: pointer;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          padding: 10px 14px;
          border-top: 1px solid #ede7dc;
          background: #faf7f2;
        }

        .cancel-btn {
          padding: 6px 12px;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
          background: #ffffff;
          color: #57534e;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .confirm-btn {
          padding: 6px 14px;
          border: none;
          border-radius: 5px;
          background: #d99726;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }

        /* TABLE SELECTION MODAL */
        .table-picker-quick-actions {
          padding: 12px 14px 4px 14px;
        }

        .quick-notable-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 14px;
          border: 1.5px solid #e7e0d3;
          border-radius: 8px;
          background: #faf7f2;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
        }

        .quick-notable-card:hover {
          border-color: #e2a034;
          background: #fef9ee;
          transform: translateY(-1px);
        }

        .quick-notable-card.active {
          border-color: #10b981;
          background: #ecfdf5;
          box-shadow: 0 0 0 1px #10b981;
        }

        .quick-notable-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .quick-notable-icon {
          font-size: 20px;
          line-height: 1;
        }

        .quick-notable-title {
          font-size: 13px;
          font-weight: 800;
          color: #1c1917;
        }

        .quick-notable-sub {
          font-size: 11px;
          color: #78716c;
          margin-top: 1px;
        }

        .quick-notable-badge {
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 3px 8px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .quick-notable-action {
          font-size: 11px;
          font-weight: 700;
          color: #d99726;
          background: #fde68a;
          padding: 3px 8px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .table-picker-divider {
          display: flex;
          align-items: center;
          text-align: center;
          margin: 8px 14px 4px;
          font-size: 11px;
          font-weight: 700;
          color: #a8a29e;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .table-picker-divider::before,
        .table-picker-divider::after {
          content: "";
          flex: 1;
          border-bottom: 1px solid #ede7dc;
        }

        .table-picker-divider span {
          padding: 0 8px;
        }

        .no-tables-available-prompt {
          padding: 24px 16px;
          text-align: center;
          color: #78716c;
        }

        .no-tables-available-prompt p {
          font-weight: 700;
          color: #1c1917;
          margin-bottom: 4px;
        }

        .tables-selection-grid {
          padding: 12px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          overflow-y: auto;
        }

        .table-select-card {
          padding: 10px 6px;
          border-radius: 7px;
          border: 1.5px solid #ede7dc;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .table-select-card:hover {
          border-color: #e2a034;
          transform: translateY(-1px);
        }

        .table-select-card.current {
          border-color: #d99726;
          background: #fef9ee;
        }

        .table-num {
          font-size: 16px;
          font-weight: 900;
          color: #1c1917;
        }

        .table-seats {
          font-size: 10.5px;
          color: #78716c;
        }

        .table-badge {
          font-size: 9.5px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 3px;
          text-transform: uppercase;
          margin-top: 2px;
        }

        .table-badge.vacant {
          background: #dcfce7;
          color: #15803d;
        }

        .table-badge.occupied {
          background: #fee2e2;
          color: #b91c1c;
        }

        /* RECENT ORDERS MODAL */
        .recent-orders-list {
          padding: 10px 14px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .recent-order-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
          border: 1px solid #ede7dc;
          border-radius: 6px;
          background: #faf7f2;
        }

        .recent-order-top {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          margin-bottom: 2px;
        }

        .recent-channel {
          background: #e0f2fe;
          color: #0369a1;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 9.5px;
          font-weight: 700;
        }

        .recent-table {
          background: #faf7f2;
          color: #57534e;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 9.5px;
          font-weight: 600;
        }

        .recent-order-items-snippet {
          font-size: 10.5px;
          color: #78716c;
        }

        .recent-order-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
        }

        .reprint-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 3px 6px;
          border: 1px solid #e7e0d3;
          background: #ffffff;
          border-radius: 4px;
          font-size: 10.5px;
          font-weight: 600;
          color: #44403c;
          cursor: pointer;
        }

        .reprint-btn:hover {
          background: #faf7f2;
          color: #1c1917;
        }

        .no-bills-msg,
        .no-held-msg {
          text-align: center;
          color: #a8a29e;
          padding: 20px;
          font-size: 12px;
        }

        /* HELD MODAL */
        .held-list {
          padding: 10px 14px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .held-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
          border: 1px solid #fed7aa;
          background: #fffaf5;
          border-radius: 6px;
        }

        .held-item b {
          font-size: 12px;
          color: #9a3412;
          display: block;
        }

        .held-item span {
          font-size: 10.5px;
          color: #78350f;
          display: block;
        }

        .held-item small {
          font-size: 10px;
          color: #a16207;
          display: block;
        }

        .held-actions {
          display: flex;
          gap: 4px;
        }

        .recall-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 4px 8px;
          background: #f97316;
          color: #ffffff;
          border: none;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }

        .delete-held-btn {
          border: 1px solid #fed7aa;
          background: #ffffff;
          color: #dc2626;
          border-radius: 5px;
          padding: 4px 6px;
          cursor: pointer;
        }

        /* NOTE MODAL */
        .note-body {
          padding: 12px 14px;
        }

        .note-body input {
          width: 100%;
          padding: 7px 10px;
          border: 1px solid #e7e0d3;
          border-radius: 6px;
          font-size: 12px;
          margin-bottom: 8px;
          outline: none;
        }

        .quick-instruction-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .quick-instruction-pills button {
          border: 1px solid #ede7dc;
          background: #faf7f2;
          padding: 3px 7px;
          border-radius: 4px;
          font-size: 10.5px;
          color: #57534e;
          cursor: pointer;
        }

        .quick-instruction-pills button:hover {
          background: #fef9ee;
          border-color: #fde68a;
          color: #c88719;
        }

        /* ADD DISH FORM */
        .add-dish-form {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .add-dish-form label {
          font-size: 11px;
          font-weight: 600;
          color: #57534e;
        }

        .add-dish-form input,
        .add-dish-form select {
          padding: 6px 8px;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
          font-size: 12px;
        }

        /* SETTINGS MODAL */
        .settings-body {
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .settings-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          color: #44403c;
          font-weight: 600;
        }

        .settings-row select {
          padding: 4px 6px;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
        }

        /* TOAST BANNER NOTIFICATION */
        .pos-toast-banner {
          position: fixed;
          top: 48px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 700;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          animation: slideDown 0.2s ease-out;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translate(-50%, -10px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }

        .pos-toast-banner.success {
          background: #15803d;
          color: #ffffff;
        }

        .pos-toast-banner.error {
          background: #dc2626;
          color: #ffffff;
        }

        .pos-toast-banner.info {
          background: #1c1917;
          color: #ffffff;
        }

        .toast-icon {
          font-size: 14px;
        }

        .toast-text {
          letter-spacing: 0.01em;
        }

        .toast-close {
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.75);
          font-size: 16px;
          cursor: pointer;
          padding: 0 0 0 6px;
          line-height: 1;
        }

        .toast-close:hover {
          color: #ffffff;
        }

        /* BULK MENU MODAL */
        .bulk-menu-modal {
          width: 720px;
          max-width: 95vw;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }

        .bulk-title-cluster {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .bulk-title-cluster h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 800;
          color: #1c1917;
        }

        .bulk-subtitle {
          font-size: 11px;
          color: #78716c;
          font-weight: 500;
        }

        .bulk-tabs-bar {
          display: flex;
          gap: 6px;
          padding: 8px 14px 4px 14px;
          background: #faf7f2;
          border-bottom: 1px solid #ede7dc;
          flex-shrink: 0;
        }

        .bulk-tab-btn {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid #ede7dc;
          background: #ffffff;
          color: #78716c;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .bulk-tab-btn.active {
          background: #d99726;
          color: #ffffff;
          border-color: #d99726;
        }

        .bulk-modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px 14px;
          min-height: 260px;
          max-height: 52vh;
        }

        .bulk-entry-table {
          width: 100%;
          border-collapse: collapse;
        }

        .bulk-entry-table thead th {
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          color: #78716c;
          background: #faf7f2;
          padding: 6px 8px;
          border-bottom: 1px solid #ede7dc;
          text-align: left;
        }

        .bulk-entry-table tbody td {
          padding: 4px 6px;
          border-bottom: 1px solid #faf7f2;
          vertical-align: middle;
        }

        .row-num {
          font-size: 11px;
          font-weight: 700;
          color: #a8a29e;
          text-align: center;
        }

        .bulk-cell-input {
          width: 100%;
          padding: 5px 8px;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
          font-size: 12px;
          color: #1c1917;
          outline: none;
          box-sizing: border-box;
        }

        .bulk-cell-input:focus {
          border-color: #d99726;
          box-shadow: 0 0 0 1px #d99726;
        }

        .cost-input-wrapper {
          display: flex;
          align-items: center;
          border: 1px solid #e7e0d3;
          border-radius: 5px;
          overflow: hidden;
          background: #ffffff;
        }

        .cost-input-wrapper:focus-within {
          border-color: #d99726;
          box-shadow: 0 0 0 1px #d99726;
        }

        .rupee-sym {
          padding-left: 7px;
          font-size: 12px;
          font-weight: 700;
          color: #78716c;
        }

        .bulk-cell-input.cost-input {
          border: none;
          padding-left: 3px;
        }

        .bulk-row-del-btn {
          border: none;
          background: transparent;
          color: #a8a29e;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
        }

        .bulk-row-del-btn:hover {
          color: #ef4444;
          background: #fee2e2;
        }

        .bulk-row-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
        }

        .add-row-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 5px;
          border: 1px solid #e7e0d3;
          background: #faf7f2;
          color: #44403c;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .add-row-btn.secondary {
          background: #faf7f2;
        }

        .add-row-btn:hover {
          background: #fef9ee;
          border-color: #e2a034;
          color: #d99726;
        }

        .clear-rows-btn {
          margin-left: auto;
          border: none;
          background: transparent;
          color: #a8a29e;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .clear-rows-btn:hover {
          color: #ef4444;
        }

        .bulk-text-hint {
          font-size: 11px;
          color: #78716c;
          margin-bottom: 6px;
        }

        .bulk-text-hint code {
          background: #faf7f2;
          padding: 1px 5px;
          border-radius: 4px;
          color: #1c1917;
          font-weight: 600;
        }

        .bulk-textarea {
          width: 100%;
          border: 1px solid #e7e0d3;
          border-radius: 6px;
          padding: 8px;
          font-size: 12px;
          font-family: monospace;
          color: #1c1917;
          outline: none;
          box-sizing: border-box;
          resize: vertical;
        }

        .parse-text-btn {
          margin-top: 8px;
          padding: 6px 12px;
          background: #d99726;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .bulk-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-top: 1px solid #ede7dc;
          background: #faf7f2;
          flex-shrink: 0;
        }

        .valid-count-pill {
          font-size: 11.5px;
          color: #57534e;
        }

        .valid-count-pill b {
          color: #16a34a;
          font-size: 13px;
        }

        .toolbar-bulk-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 28px;
          padding: 0 9px;
          background: #fef9ee;
          border: 1px solid #fde68a;
          border-radius: 6px;
          color: #c88719;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }

        .toolbar-bulk-btn:hover {
          background: #d99726;
          border-color: #d99726;
          color: #ffffff;
        }
      `}</style>
    </div>
  );
}
