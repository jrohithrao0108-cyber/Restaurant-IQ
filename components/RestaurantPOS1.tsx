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
  getLocalSettings,
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

const DEFAULT_CATEGORIES = [
  "All Dishes",
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

function normalizeCategory(category: any): string {
  if (!category) return "Starters";
  if (typeof category === "object") {
    category = category.name || category.category || category.title || "";
  }
  const raw = String(category).trim().toLowerCase().replace(/&/g, "and").replace(/[_-]/g, " ");

  if (raw.includes("starter")) return "Starters";
  if (raw.includes("main")) return "Mains";
  if (raw.includes("bread") || raw.includes("roti") || raw.includes("naan")) return "Breads";
  if (raw.includes("rice") || raw.includes("biryani") || raw.includes("pulao")) return "Rice & Biryani";
  if (raw.includes("dessert") || raw.includes("sweet") || raw.includes("ice cream")) return "Desserts";
  if (raw.includes("beverage") || raw.includes("drink") || raw.includes("shake") || raw.includes("tea") || raw.includes("coffee")) return "Beverages";

  return "Starters";
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
  const [isOnline, setIsOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const placingOrderRef = useRef(false);

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

  const activeTables = thirtyTables;

  const categoriesWithCounts = useMemo(() => {
    const counts: Record<string, number> = {
      "All Dishes": activeProducts.length,
    };
    DEFAULT_CATEGORIES.slice(1).forEach((cat) => {
      counts[cat] = 0;
    });

    activeProducts.forEach((p) => {
      const norm = normalizeCategory(p.category);
      counts[norm] = (counts[norm] || 0) + 1;
    });

    const list = [{ name: "All Dishes", count: counts["All Dishes"] || 0 }];
    Object.keys(counts)
      .filter((k) => k !== "All Dishes")
      .forEach((name) => {
        list.push({ name, count: counts[name] || 0 });
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
    if (chId === "DINE_IN") {
      setSource("DINE_IN");
    } else {
      setSource(chId);
      setTable(null);
      setActiveView("POS");
    }
  }

  function resetOrderForm() {
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

  function handleQuickSettleTable(order: Order) {
    if (!order) return;
    const cleanTable = (order.table || "").trim().toUpperCase();

    try {
      if (cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
        setSettlingTableNumber(cleanTable);
        removeActiveTableFromStorage(cleanTable);
      }

      if (table && table.trim().toUpperCase() === cleanTable) {
        setCart([]);
        setTable(null);
      }

      showToast(`Table ${cleanTable} settled & paid! Bill printing...`, "success");

      const billNo = getDailyBillNumber(order.id, order.databaseId);

      const closedOrder: Order = {
        ...order,
        status: "COMPLETED",
        closedAt: new Date().toISOString(),
      };
      onPlaced(closedOrder);

      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        if (cleanTable) {
          Promise.resolve(
            supabase
              .from("orders")
              .update({
                status: "COMPLETED",
                closed_at: new Date().toISOString(),
              })
              .eq("restaurant_id", restaurantId)
              .eq("table_number", cleanTable)
              .is("closed_at", null)
          )
            .then(() => setSettlingTableNumber(null))
            .catch(() => setSettlingTableNumber(null));
        }

        if (
          order.databaseId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            order.databaseId
          )
        ) {
          supabase
            .from("orders")
            .update({
              status: "COMPLETED",
              closed_at: new Date().toISOString(),
            })
            .eq("id", order.databaseId)
            .then();
        }
      } else {
        setSettlingTableNumber(null);
      }

      if (order && order.items && order.items.length > 0) {
        setTimeout(() => {
          try {
            printCustomerBillReceipt({
              restaurantName: restaurantName || "RestaurantIQ",
              orderNumber: order.id,
              billNo,
              tokenNo: billNo,
              table: cleanTable || order.table,
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
          } catch (printErr) {
            console.warn("Receipt print error on quick settle:", printErr);
          }
        }, 50);
      }
    } catch (e) {
      setSettlingTableNumber(null);
      showToast("Failed to settle table.", "error");
    }
  }

  function handleOpenTableOrder(tNum: string, order?: Order) {
    const cleanT = tNum.trim().toUpperCase();
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
    const settings = getLocalSettings();
    const orderNumber = `KOT-${Date.now().toString().slice(-4)}`;

    if (shouldPrintKot) {
      try {
        printKitchenOrderTicket({
          restaurantName,
          orderNumber,
          table: source === "DINE_IN" && targetTable ? targetTable : undefined,
          source,
          items: cart,
          serverName: serverName.trim() || undefined,
          paperWidth: settings.paperWidth,
        });
      } catch (e) {
        console.warn("KOT print skipped or dialog closed:", e);
      }
    }

    if (source === "DINE_IN" && targetTable) {
      const cleanTable = targetTable.trim().toUpperCase();
      setSettledTableNumbers((prev) => {
        if (!prev.has(cleanTable)) return prev;
        const next = new Set(prev);
        next.delete(cleanTable);
        return next;
      });

      const openOrder: Order = {
        id: `ORD-${Date.now().toString().slice(-5)}`,
        databaseId: `tbl-${cleanTable}-${Date.now()}`,
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source: "DINE_IN",
        table: cleanTable,
        items: [...cart],
        total: grandTotal,
        payment: paymentMode,
        createdAt: new Date().toISOString(),
        closedAt: null,
        serverName,
        customerPhone,
        customerName,
        discountAmount,
        subtotal,
      };

      onPlaced(openOrder);
      saveActiveTableToStorage(openOrder);

      // Local-first: always write to the durable queue immediately, never
      // block this action on a network round-trip. orderPhase "OPEN" tells
      // the sync manager to merge into the table's running order without
      // closing it (see offlineSync.ts's syncOneOrder) — identical end
      // result to the old inline Supabase block, just executed in the
      // background instead of inline here.
      const kotTempId = `kot-${cleanTable}-${Date.now()}`;
      enqueueOfflineOrder({
        tempId: kotTempId,
        restaurantId,
        createdByUserId: safeCreatedByUserId,
        orderNumber: openOrder.id,
        orderType: "DINE_IN",
        tableNumber: cleanTable,
        channel: "DINE_IN",
        paymentMode,
        total: grandTotal,
        status: "PENDING",
        items: cart.map((item) => ({
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

      // Fire-and-forget: pushes now if online, otherwise the 3.5s
      // background loop (or the next online/focus event) picks it up.
      // Never awaited — this function must return instantly regardless
      // of connectivity.
      offlineSyncManager.syncAll(undefined, restaurantId).catch(() => {});

      if (shouldPrintKot) {
        showToast(`KOT sent & Table ${cleanTable} order saved!`, "success");
      } else {
        showToast(`Table ${cleanTable} order saved! (No KOT printed)`, "success");
      }

      // Clear cart items but preserve the active table selection for waiter convenience
      setCart([]);
      setDiscountPercent(0);
      setDiscountFlat(0);
    } else {
      if (shouldPrintKot) {
        showToast(`KOT ${orderNumber} printed.`, "success");
      }
    }
  }

  async function executePrintKot(targetTable: string | null) {
    await executeSaveTableOrder(targetTable, true);
  }

  async function handleSaveTableWithoutKot() {
    if (cart.length === 0) {
      showToast("Cart is empty. Please add items to save.", "info");
      return;
    }
    if (!table) {
      setPendingSaveOnTableSelect(true);
      setShowTablePickerModal(true);
      showToast("Please select a table to save items.", "info");
      return;
    }
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

    const cleanTable = source === "DINE_IN" ? (table ? table.trim().toUpperCase() : null) : null;
    const orderNumber = `ORD-${Date.now().toString().slice(-5)}`;
    const settings = getLocalSettings();

    placingOrderRef.current = true;
    setSaving(true);

    function queueOffline() {
      const tempId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      try {
        enqueueOfflineOrder({
          tempId,
          restaurantId,
          orderNumber,
          createdByUserId: safeCreatedByUserId,
          orderType: source,
          tableNumber: source === "DINE_IN" ? cleanTable : null,
          channel: source,
          paymentMode,
          total: grandTotal,
          status: "COMPLETED",
          items: cart.map((c) => ({
            id: c.id,
            name: c.name,
            price: c.price,
            qty: c.qty,
            notes: c.notes,
            category: c.category,
          })),
          createdAt: nowIso,
          syncAttempts: 0,
        });
      } catch (e) {}

      const newOrder: Order = {
        id: orderNumber,
        databaseId: tempId,
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source,
        table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
        items: cart,
        total: grandTotal,
        payment: paymentMode,
        createdAt: nowIso,
        closedAt: nowIso, // Marked closed immediately
        serverName,
        customerPhone,
        customerName,
        discountAmount,
        subtotal,
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
              ? `Table ${cleanTable} settled in Demo Mode. Bill printed.`
              : `Table ${cleanTable} queued in Offline Mode. Bill printed.`)
          : (isDemo
              ? `Order ${orderNumber} settled in Demo Mode. Bill printed.`
              : `Order ${orderNumber} queued in Offline Mode. Bill printed.`),
        "success"
      );

      const billNo = getDailyBillNumber(orderNumber, newOrder.databaseId);
      setTimeout(() => {
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
            items: cart,
            subtotal,
            discountAmount,
            taxCgstPercent: applyGst ? 2.5 : 0,
            taxSgstPercent: applyGst ? 2.5 : 0,
            total: grandTotal,
            paperWidth: settings.paperWidth,
          });
        } catch (e) {}

        if (autoPrintKot) {
          try {
            printKitchenOrderTicket({
              restaurantName,
              orderNumber,
              table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
              source,
              items: cart,
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
    // and prints the bill — all synchronous/local. Sync to Supabase happens
    // afterward via the same background sync loop used everywhere else
    // (continuous 3.5s drain, online/focus triggers), so a flaky-but-not-
    // technically-offline connection can never make this action hang.
    try {
      queueOffline();
      offlineSyncManager.syncAll(undefined, restaurantId).catch(() => {});
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

            <div className="tables-30-grid">
              {thirtyTables.map((t) => {
                const isOccupied = occupiedTableNumbers.has(t.tableNumber);
                const activeOrder = tableOrderMap.get(t.tableNumber);
                const isCurrent = table === t.tableNumber;

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
                      <span className={`tile-badge ${isOccupied ? "occupied" : "vacant"}`}>
                        {isOccupied ? "Occupied" : "Vacant"}
                      </span>
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
                            className="tile-btn settle-pay-btn"
                            onClick={() => handleQuickSettleTable(activeOrder)}
                            disabled={settlingTableNumber === t.tableNumber}
                            title="Settle Bill & Pay (Prints Bill Receipt)"
                          >
                            {settlingTableNumber === t.tableNumber ? (
                              <>
                                <RefreshCw size={11} className="spin" />
                                <span>Settling...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={11} />
                                <span>Settle & Pay</span>
                              </>
                            )}
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
                <button
                  type="button"
                  className="quick-add-dish-btn bulk-btn"
                  onClick={() => setShowBulkModal(true)}
                  style={{
                    background: "#fef9ee",
                    borderColor: "#fde68a",
                    color: "#c88719",
                    fontWeight: 700,
                  }}
                  title="Create multiple menu items at once"
                >
                  <Plus size={13} />
                  <span>⚡ Bulk Create Menu</span>
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
                    disabled={cart.length === 0}
                    title="Save items for table without printing KOT"
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
                        <span>Settle & Pay</span>
                      </>
                    )}
                  </button>
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
              <select
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value)}
              >
                {DEFAULT_CATEGORIES.slice(1).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
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
              {DEFAULT_CATEGORIES.slice(1).map((cat) => (
                <option key={cat} value={cat} />
              ))}
              <option value="Rice & Biryani" />
              <option value="Tandoori" />
              <option value="Snacks" />
              <option value="Combo Meals" />
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

              <label className="settings-row">
                <span>Auto-Print KOT on Settle:</span>
                <input
                  type="checkbox"
                  checked={autoPrintKot}
                  onChange={(e) => {
                    setAutoPrintKot(e.target.checked);
                    saveLocalSettings({ autoPrintKot: e.target.checked });
                  }}
                />
              </label>
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
          background: #090e1a;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #1c1917;
          overflow: hidden;
          margin: 0;
          padding: 0;
        }

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

        nextjs-portal, [data-nextjs-toast], #__next-build-watcher {
          pointer-events: none !important;
          opacity: 0.15 !important;
          transform: scale(0.65) !important;
          transform-origin: bottom left !important;
        }

        .pos-top-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          height: 46px;
          min-height: 46px;
          background: #090e1a;
          color: #ffffff;
          border-bottom: 1px solid #1c1917;
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
          color: #ffffff;
        }

        .pos-brand-meta span {
          font-size: 10px;
          color: #a8a29e;
          display: block;
          line-height: 1.1;
        }

        .top-divider {
          width: 1px;
          height: 22px;
          background: #1c1917;
        }

        .pos-channel-group {
          display: flex;
          gap: 2px;
          background: rgba(255, 255, 255, 0.05);
          padding: 2px;
          border-radius: 7px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .pos-channel-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          border-radius: 5px;
          border: none;
          background: transparent;
          color: #a8a29e;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-channel-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.06);
        }

        .pos-channel-btn.active {
          background: #d99726;
          color: #ffffff;
          font-weight: 700;
          box-shadow: 0 1px 4px rgba(217, 151, 38, 0.4);
        }

        .pos-view-switcher {
          display: flex;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
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
          color: #a8a29e;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-view-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }

        .pos-view-btn.active {
          background: #d99726;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(217, 151, 38, 0.4);
        }

        .pos-dinein-nav-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 11px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.08);
          color: #ede7dc;
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
          box-shadow: 0 2px 6px rgba(217, 151, 38, 0.4);
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
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          color: #ffffff;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-table-selector-trigger.no-table {
          border-color: rgba(226, 160, 52, 0.4);
          background: rgba(226, 160, 52, 0.12);
          color: #93c5fd;
        }

        .pos-table-selector-trigger.has-table {
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.12);
          color: #a7f3d0;
        }

        .no-table-prompt {
          font-weight: 700;
          color: #ede7dc;
        }

        .table-optional-hint {
          font-size: 10px;
          font-weight: 700;
          background: rgba(255, 255, 255, 0.12);
          padding: 1px 5px;
          border-radius: 4px;
          color: #e7e0d3;
          margin-left: 2px;
        }

        .pos-table-clear-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .pos-table-clear-btn:hover {
          background: #ef4444;
          color: #ffffff;
        }

        .pos-table-selector-trigger:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        .table-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
}
