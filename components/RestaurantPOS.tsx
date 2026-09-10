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
  { id: "DUE", label: "Due", icon: "📝" },
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

// Auto-detect veg/non-veg from Indian menu conventions
function isVeg(name: string, category: string): boolean {
  const text = `${name} ${category}`.toLowerCase();
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

export function RestaurantPOS({
  products,
  restaurantId,
  restaurantName,
  isPoc,
  createdByUserId,
  initialTable,
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
  restaurantTables: RestaurantTable[];
  orders?: Order[];
  onPlaced: (o: Order) => void;
  onMenuChanged?: () => Promise<void> | void;
  onLogout?: () => void;
}) {
  // View Switcher: POS Menu & Billing vs Tables Floor (30 tables)
  const [activeView, setActiveView] = useState<"POS" | "TABLES">("POS");

  // Navigation & Filtering
  const [selectedCat, setSelectedCat] = useState("All Dishes");
  const [vegFilter, setVegFilter] = useState<"ALL" | "VEG" | "NON_VEG">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Order Details: table defaults to null for Dine-In unless specially selected
  const [source, setSource] = useState<OrderSource>("DINE_IN");
  const [table, setTable] = useState<string | null>(initialTable || null);
  const [serverName, setServerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");

  // Cart & Bill
  const [cart, setCart] = useState<Item[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountFlat, setDiscountFlat] = useState<number>(0);
  const [applyGst, setApplyGst] = useState(true);
  const [paymentMode, setPaymentMode] = useState<string>("UPI");
  const [cashTendered, setCashTendered] = useState<string>("");

  // Item cooking notes state
  const [editingItemNoteId, setEditingItemNoteId] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState("");

  // Hold / Recall queue
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [showHeldModal, setShowHeldModal] = useState(false);

  // Table Picker modal & Recent Bills modal
  const [showTablePickerModal, setShowTablePickerModal] = useState(false);
  const [pendingKotOnTableSelect, setPendingKotOnTableSelect] = useState(false);
  const [showRecentBillsModal, setShowRecentBillsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Item management modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Starters");
  const [addingItem, setAddingItem] = useState(false);

  // Bulk menu creation state
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

  // Status
  const [autoPrintKot, setAutoPrintKot] = useState(
    () => getLocalSettings().autoPrintKot
  );
  const [isOnline, setIsOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const placingOrderRef = useRef(false);

  // Optimistic instant clearing for tables
  const [settledTableNumbers, setSettledTableNumbers] = useState<Set<string>>(new Set());
  const [settlingTableNumber, setSettlingTableNumber] = useState<string | null>(null);

  // Non-blocking toast notifications
  const [toast, setToast] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  function showToast(
    text: string,
    type: "success" | "error" | "info" = "success"
  ) {
    setToast({ text, type });
    setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current));
    }, 2800);
  }

  // Active products with deduplication and fallback
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

  // 30 Tables floor layout (T1 to T30 guaranteed)
  const thirtyTables = useMemo(() => {
    const existingMap = new Map<string, RestaurantTable>();
    (restaurantTables && restaurantTables.length > 0
      ? restaurantTables
      : DEMO_TABLES
    ).forEach((t) => {
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

  // Active running dine-in order by table number
  const tableOrderMap = useMemo(() => {
    const map = new Map<string, Order>();
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

  // Dynamic Categories list with live counts
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

  // Sync initial table if passed
  useEffect(() => {
    if (initialTable) {
      setSource("DINE_IN");
      setTable(initialTable);
    }
  }, [initialTable]);

  // Ensure that under Takeaway, Swiggy, or Zomato, NO tables or table floor can ever be shown
  useEffect(() => {
    if (source !== "DINE_IN") {
      if (activeView === "TABLES") {
        setActiveView("POS");
      }
      if (table !== null) {
        setTable(null);
      }
    }
  }, [source, activeView, table]);

  // Track online/offline status
  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load held orders from storage
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

  // Cart operations
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

  // Bill totals calculation
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    if (discountFlat > 0) return Math.min(subtotal, discountFlat);
    if (discountPercent > 0) return Math.round((subtotal * discountPercent) / 100);
    return 0;
  }, [subtotal, discountPercent, discountFlat]);

  const taxableAmount = Math.max(0, subtotal - discountAmount);
  // Standard Restaurant 5% GST (2.5% CGST + 2.5% SGST)
  const gstAmount = applyGst ? Math.round(taxableAmount * 0.05) : 0;
  const grandTotal = Math.round(taxableAmount + gstAmount);

  // Cash change calculation
  const tenderNumber = Number(cashTendered) || 0;
  const changeDue = tenderNumber > grandTotal ? tenderNumber - grandTotal : 0;

  // Filter products
  const filteredProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      // Category filter
      if (selectedCat !== "All Dishes") {
        if (normalizeCategory(p.category) !== selectedCat) return false;
      }
      // Veg / Non-Veg filter
      const veg = isVeg(p.name, p.category);
      if (vegFilter === "VEG" && !veg) return false;
      if (vegFilter === "NON_VEG" && veg) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [activeProducts, selectedCat, vegFilter, searchQuery]);

  // Cart item quantity map for quick badge on cards
  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach((i) => map.set(i.id, i.qty));
    return map;
  }, [cart]);

  // HOLD & RECALL
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
      table,
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
      // TAKEAWAY, SWIGGY, ZOMATO: strictly NO TABLE shown or attached
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

  // Local cache of unique order keys placed in the active session for strict sequential bill numbering
  const localPlacedOrderKeysRef = useRef<string[]>([]);

  // Sequential Bill No: strictly the count of unique order_id for the day
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

  // Quick actions for the 30 Tables screen
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
      showToast(`Bill #${billNo} printed for Table ${order.table || ""}`, "success");
    } catch (e) {
      showToast("Bill receipt sent to printer.", "info");
    }
  }

  function handleQuickSettleTable(order: Order) {
    if (!order) return;
    const cleanTable = (order.table || "").trim().toUpperCase();

    try {
      // 1. INSTANT OPTIMISTIC UI CLEARING (0ms):
      // Mark table vacant immediately in UI without waiting for network
      if (cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
        setSettlingTableNumber(cleanTable);
      }

      if (table && table.trim().toUpperCase() === cleanTable) {
        setCart([]);
        setTable(null);
      }

      showToast(`Table ${cleanTable} settled & paid! Bill printing...`, "success");

      const billNo = getDailyBillNumber(order.id, order.databaseId);

      // 2. Mark order completed in parent state
      const closedOrder: Order = {
        ...order,
        status: "COMPLETED",
        closedAt: new Date().toISOString(),
      };
      onPlaced(closedOrder);

      // 3. PERSIST TO SUPABASE (Non-blocking background update)
      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        // A. Close by table number (instant via idx_orders_active_table)
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
            .then(() => {
              setSettlingTableNumber(null);
            })
            .catch(() => {
              setSettlingTableNumber(null);
            });
        }

        // B. Also close by UUID if order.databaseId is a valid UUID
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

      // 4. NON-BLOCKING ASYNC PRINTING (Does NOT freeze the screen)
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
      // Vacant table selected: preserve existing cart dishes so they get tagged to this table!
      showToast(`Table ${cleanT} selected`, "success");
    }
    setActiveView("POS");
  }

  // 1. PRINT KOT (Kitchen Order Ticket & Save Active Table Order)
  async function executePrintKot(targetTable: string | null) {
    const settings = getLocalSettings();
    const orderNumber = `KOT-${Date.now().toString().slice(-4)}`;

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

    // Save running order for table so it remains occupied on the floor
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

      // Persist to Supabase if connected
      if (isSupabaseConfigured && !restaurantId.startsWith("demo-")) {
        try {
          const { data: existingOpen } = await supabase
            .from("orders")
            .select("id, order_number, total")
            .eq("restaurant_id", restaurantId)
            .eq("table_number", cleanTable)
            .is("closed_at", null)
            .neq("status", "CANCELLED")
            .limit(1)
            .maybeSingle();

          if (existingOpen) {
            openOrder.databaseId = existingOpen.id;
            onPlaced({ ...openOrder, databaseId: existingOpen.id });

            await supabase
              .from("orders")
              .update({ total: grandTotal })
              .eq("id", existingOpen.id);

            const orderItems = cart.map((item) => ({
              order_id: existingOpen.id,
              menu_item_id: item.id,
              name_snapshot: item.name,
              price_snapshot: item.price,
              qty: item.qty,
            }));
            await supabase.from("order_items").insert(orderItems);
          } else {
            const { data: insertedOrder } = await supabase
              .from("orders")
              .insert({
                restaurant_id: restaurantId,
                created_by: createdByUserId || null,
                order_number: openOrder.id,
                order_type: "DINE_IN",
                table_number: cleanTable,
                channel: "DINE_IN",
                payment_mode: paymentMode,
                total: grandTotal,
                status: "PENDING",
                closed_at: null,
              })
              .select()
              .maybeSingle();

            if (insertedOrder) {
              openOrder.databaseId = insertedOrder.id;
              onPlaced({ ...openOrder, databaseId: insertedOrder.id });

              const orderItems = cart.map((item) => ({
                order_id: insertedOrder.id,
                menu_item_id: item.id,
                name_snapshot: item.name,
                price_snapshot: item.price,
                qty: item.qty,
              }));
              await supabase.from("order_items").insert(orderItems);
            }
          }
        } catch (dbErr) {
          console.warn("KOT cloud sync warning:", dbErr);
        }
      }

      showToast(`KOT sent & Table ${cleanTable} order saved!`, "success");
      resetOrderForm();
    } else {
      showToast(`KOT ${orderNumber} printed.`, "success");
    }
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

    const activeOrd = tableOrderMap.get(cleanT);
    if (activeOrd && activeOrd.items && activeOrd.items.length > 0 && cart.length === 0) {
      setCart(activeOrd.items);
      if (activeOrd.customerName) setCustomerName(activeOrd.customerName);
      if (activeOrd.customerPhone) setCustomerPhone(activeOrd.customerPhone);
      if (activeOrd.serverName) setServerName(activeOrd.serverName);
      showToast(`Table ${cleanT} order loaded (${activeOrd.items.length} items)`, "info");
    } else {
      showToast(`Tagged to Table ${cleanT}`, "success");
    }
  }

  // 2. PRINT BILL (Customer Check / Receipt Preview)
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

  // 3. SETTLE & BILL (Completes transaction & clears table)
  async function handleSaveOrder() {
    if (placingOrderRef.current || saving) return;
    if (cart.length === 0) {
      showToast("Cart is empty! Please add dishes before settling.", "info");
      return;
    }

    const cleanTable = source === "DINE_IN" ? (table ? table.trim() : null) : null;
    const orderNumber = `ORD-${Date.now().toString().slice(-5)}`;
    const settings = getLocalSettings();

    placingOrderRef.current = true;
    setSaving(true);

    // Guaranteed unlock safety timer
    const safetyTimer = setTimeout(() => {
      placingOrderRef.current = false;
      setSaving(false);
    }, 8000);

    function queueOffline() {
      const tempId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        enqueueOfflineOrder({
          tempId,
          restaurantId,
          orderNumber,
          createdByUserId: createdByUserId || null,
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
          createdAt: new Date().toISOString(),
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
        createdAt: new Date().toISOString(),
        closedAt: null,
        serverName,
        customerPhone,
        customerName,
        discountAmount,
        subtotal,
      };

      onPlaced(newOrder);

      if (source === "DINE_IN" && cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
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
              table: source === "DINE_IN" ? cleanTable : undefined,
              source,
              items: cart,
              serverName,
              paperWidth: settings.paperWidth,
            });
          } catch (e) {}
        }
      }, 50);
    }

    try {
      if (
        !isSupabaseConfigured ||
        restaurantId.startsWith("demo-") ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      ) {
        queueOffline();
        return;
      }

      let orderRecord: any;
      let finalItems: Item[] = cart;
      let finalTotal = grandTotal;
      let finalOrderNumber = orderNumber;

      // ATTEMPT FAST-PATH: Single-roundtrip atomic database procedure (<250ms)
      let rpcSucceeded = false;
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          "create_complete_order",
          {
            p_restaurant_id: restaurantId,
            p_order_number: orderNumber,
            p_order_type: source,
            p_table_number: cleanTable,
            p_channel: source,
            p_payment_mode: paymentMode,
            p_subtotal: subtotal,
            p_discount: discountAmount,
            p_tax: gstAmount,
            p_total: grandTotal,
            p_created_by: createdByUserId || null,
            p_items: cart.map((c) => ({
              menu_item_id: c.id,
              name: c.name,
              price: c.price,
              qty: c.qty,
            })),
            p_is_settled: true,
          }
        );

        if (!rpcError && rpcData && rpcData.id) {
          orderRecord = rpcData;
          finalOrderNumber = rpcData.order_number || orderNumber;
          finalTotal = Number(rpcData.total) || grandTotal;
          rpcSucceeded = true;
        }
      } catch (e) {
        rpcSucceeded = false;
      }

      // FALLBACK: Sequential 3-hop waterfall if RPC function is not yet installed in Supabase
      if (!rpcSucceeded) {
        let targetOrderId: string | null = null;
        let existingTotal = 0;

        if (source === "DINE_IN" && cleanTable) {
          const { data: existingOpenOrder } = await supabase
            .from("orders")
            .select("id, order_number, total")
            .eq("restaurant_id", restaurantId)
            .eq("table_number", cleanTable)
            .is("closed_at", null)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingOpenOrder) {
            targetOrderId = existingOpenOrder.id;
            existingTotal = Number(existingOpenOrder.total) || 0;
          }
        }

        if (targetOrderId) {
          finalTotal = existingTotal + grandTotal;
          const { data: updatedOrder, error: updateError } = await supabase
            .from("orders")
            .update({
              total: finalTotal,
              payment_mode: paymentMode,
              status: "COMPLETED",
              closed_at: new Date().toISOString(),
            })
            .eq("id", targetOrderId)
            .select()
            .maybeSingle();

          if (updateError) throw updateError;
          orderRecord = updatedOrder;
          finalOrderNumber = updatedOrder.order_number;

          const orderItems = cart.map((item) => ({
            order_id: targetOrderId,
            menu_item_id: item.id,
            name_snapshot: item.name,
            price_snapshot: item.price,
            qty: item.qty,
          }));

          const { error: itemError } = await supabase
            .from("order_items")
            .insert(orderItems);
          if (itemError) throw itemError;
        } else {
          const { data: newOrder, error: orderError } = await supabase
            .from("orders")
            .insert({
              restaurant_id: restaurantId,
              created_by: createdByUserId || null,
              order_number: orderNumber,
              order_type: source,
              table_number: source === "DINE_IN" ? cleanTable : null,
              channel: source,
              payment_mode: paymentMode,
              total: grandTotal,
              status: "COMPLETED",
              closed_at: new Date().toISOString(),
            })
            .select()
            .maybeSingle();

          if (orderError) throw orderError;
          orderRecord = newOrder;

          const orderItems = cart.map((item) => ({
            order_id: newOrder.id,
            menu_item_id: item.id,
            name_snapshot: item.name,
            price_snapshot: item.price,
            qty: item.qty,
          }));

          const { error: itemError } = await supabase
            .from("order_items")
            .insert(orderItems);
          if (itemError) throw itemError;
        }
      }

      const placedOrder: Order = {
        id: finalOrderNumber,
        databaseId: orderRecord.id,
        time: new Date(orderRecord.created_at).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source,
        table: source === "DINE_IN" ? (cleanTable || undefined) : undefined,
        items: finalItems,
        total: finalTotal,
        payment: paymentMode,
        createdAt: orderRecord.created_at,
        closedAt: orderRecord.closed_at,
        serverName,
        customerPhone,
        customerName,
        discountAmount,
        subtotal,
      };

      onPlaced(placedOrder);

      if (source === "DINE_IN" && cleanTable) {
        setSettledTableNumbers((prev) => new Set([...prev, cleanTable]));
      }

      resetOrderForm();
      showToast(
        cleanTable
          ? `Order ${finalOrderNumber} (Table ${cleanTable}) settled successfully! Bill printed.`
          : `Order ${finalOrderNumber} settled successfully! Bill printed.`,
        "success"
      );

      const billNo = getDailyBillNumber(finalOrderNumber, orderRecord?.id);
      setTimeout(() => {
        try {
          printCustomerBillReceipt({
            restaurantName,
            orderNumber: finalOrderNumber,
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
              orderNumber: finalOrderNumber,
              table: source === "DINE_IN" ? cleanTable : undefined,
              source,
              items: cart,
              serverName,
              paperWidth: settings.paperWidth,
            });
          } catch (e) {}
        }
      }, 50);
    } catch (err: any) {
      console.error("Order error:", err);
      const isNet =
        !navigator.onLine ||
        err?.message?.includes("fetch") ||
        err?.message?.includes("Failed to fetch");
      if (isNet) {
        try { queueOffline(); } catch (e) {}
      } else {
        showToast(err?.message || "Failed to settle order.", "error");
      }
    } finally {
      clearTimeout(safetyTimer);
      placingOrderRef.current = false;
      setSaving(false);
    }
  }

  // Update item price
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
      showToast(`Price updated to ₹${priceNum} for ${editingItem.name}`, "success");
    } catch (e: any) {
      showToast(e?.message || "Could not update price.", "error");
    }
  }

  // Add new dish
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

  // Bulk Menu Helpers
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
      // Ignore common header lines if user pasted with header
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
      {/* Toast Notification Banner */}
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
        {/* Left Brand Badge */}
        <div className="pos-brand-cluster">
          <div className="pos-brand-logo">R</div>
          <div className="pos-brand-meta">
            <b>RestaurantIQ</b>
            <span>{restaurantName || "Terminal"}</span>
          </div>
        </div>

        {/* View Switcher: ONLY shown for DINE_IN since Takeaway / Swiggy / Zomato have NO tables */}
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

        {/* Order Channel Selector */}
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

        {/* Dine-In Table Picker Trigger */}
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

        {/* Server input */}
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

        {/* Spacer */}
        <div className="top-spacer" />

        {/* Top Right Utility Actions: Only Logout retained */}
        <div className="pos-top-actions">
          {/* Logout Button */}
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

      {/* 2. MAIN BODY (POS MENU & BILLING OR 30 TABLES FLOOR SCREEN) */}
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
                background: "#eff6ff",
                borderColor: "#bfdbfe",
                color: "#1d4ed8",
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
          {/* Catalog Toolbar */}
          <div className="catalog-toolbar">
            <div className="catalog-title-wrap">
              <h2>{selectedCat}</h2>
              <span className="item-count-sub">
                {filteredProducts.length} items
              </span>
            </div>

            {/* FSSAI Veg / Non-Veg Standard Filter */}
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

            {/* Instant Search Bar */}
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

            {/* Bulk Menu Create Button */}
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

          {/* Dishes Cards Grid */}
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
                    {/* FSSAI Standard Indicator */}
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
          {/* Order Ticket Header */}
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

          {/* Cart Items List */}
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
                      {/* Left: Veg Dot, Dish Name, Inline Note */}
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

                      {/* Right: Quantity Stepper, Price & Remove Trash Icon */}
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

          {/* Bill Calculation & Settlements */}
          <div className="bill-calculations-section">
            {/* Subtotal */}
            <div className="calc-row">
              <span>Subtotal ({cart.reduce((s, i) => s + i.qty, 0)} items)</span>
              <b>{money(subtotal)}</b>
            </div>

            {/* Discount Selector */}
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

            {/* GST Calculation (5% total: 2.5% CGST + 2.5% SGST) */}
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

            {/* Grand Total */}
            <div className="calc-row grand-total-row">
              <span>GRAND TOTAL</span>
              <strong className="grand-total-amount">
                {money(grandTotal)}
              </strong>
            </div>

            {/* Payment Mode Selector */}
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
            </div>

            {/* Cash Tendered & Change Return Calculator */}
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

            {/* 3-CLICK ACTION BAR */}
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
                      className={`table-select-card ${
                        isCurrent ? "current" : ""
                      } ${isOccupied ? "occupied" : "vacant"}`}
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
                        <small style={{ color: "#64748b", fontWeight: 600, fontSize: "10.5px" }}>({o.id})</small>
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
                            taxCgstPercent: 2.5,
                            taxSgstPercent: 2.5,
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

            {/* Mode Switcher */}
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

      {/* =========================================================
          STYLES: Neat, Tight, Dense, Pixel-Perfect Layout
      ========================================================= */}
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
          color: #0f172a;
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
          background: #cbd5e1;
          border-radius: 4px;
        }
        .restaurant-iq-pos *::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
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
          background: #090e1a;
          color: #ffffff;
          border-bottom: 1px solid #1e293b;
          flex-shrink: 0;
        }

        .pos-brand-cluster {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pos-brand-logo {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: linear-gradient(135deg, #10b981, #059669);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 14px;
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
          color: #94a3b8;
          display: block;
          line-height: 1.1;
        }

        .top-divider {
          width: 1px;
          height: 22px;
          background: #1e293b;
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
          color: #94a3b8;
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
          background: #2563eb;
          color: #ffffff;
          font-weight: 700;
          box-shadow: 0 1px 4px rgba(37, 99, 235, 0.4);
        }

        /* VIEW SWITCHER IN TOP BAR */
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
          color: #94a3b8;
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
          background: #2563eb;
          color: #ffffff;
          box-shadow: 0 1px 4px rgba(37, 99, 235, 0.4);
        }

        .pos-dinein-nav-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 11px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-dinein-nav-btn:hover {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.4);
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
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(59, 130, 246, 0.12);
          color: #93c5fd;
        }

        .pos-table-selector-trigger.has-table {
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.12);
          color: #a7f3d0;
        }

        .no-table-prompt {
          font-weight: 700;
          color: #e2e8f0;
        }

        .table-optional-hint {
          font-size: 10px;
          font-weight: 700;
          background: rgba(255, 255, 255, 0.12);
          padding: 1px 5px;
          border-radius: 4px;
          color: #cbd5e1;
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

        .table-status-dot.vacant {
          background: #10b981;
        }

        .table-status-dot.occupied {
          background: #ef4444;
        }

        .table-status-text {
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
        }

        .chev-icon {
          color: #64748b;
        }

        .server-input {
          display: flex;
          align-items: center;
          gap: 5px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          padding: 3px 8px;
          color: #94a3b8;
          width: 105px;
        }

        .server-input input {
          border: none;
          background: transparent;
          color: #ffffff;
          font-size: 11px;
          width: 100%;
          outline: none;
        }

        .server-input input::placeholder {
          color: #64748b;
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
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: #cbd5e1;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pos-tool-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
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
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.4);
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
          background: #f8fafc;
          overflow: hidden;
          padding: 8px 12px;
        }

        .tables-screen-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px 8px 6px;
          border-bottom: 1px solid #e2e8f0;
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
          color: #0f172a;
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
          background: #2563eb;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tables-toolbar-btn:hover {
          background: #1d4ed8;
        }

        /* 6 COLUMNS X 5 ROWS TO FIT EXACTLY 30 TABLES ON SCREEN */
        .tables-30-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          grid-template-rows: repeat(5, 1fr);
          gap: 6px;
          overflow-y: auto;
        }

        .table-tile-card {
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
          border-radius: 7px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.12s ease;
          min-height: 0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }

        .table-tile-card:hover {
          border-color: #93c5fd;
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(37, 99, 235, 0.08);
        }

        .table-tile-card.current {
          border-color: #2563eb;
          box-shadow: 0 0 0 1.5px #2563eb;
        }

        .table-tile-card.vacant {
          border-left: 3.5px solid #10b981;
        }

        .table-tile-card.occupied {
          border-left: 3.5px solid #ef4444;
          background: #fffafa;
        }

        .tile-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          line-height: 1.1;
        }

        .tile-title b {
          font-size: 13.5px;
          font-weight: 900;
          color: #0f172a;
          margin-right: 4px;
        }

        .tile-title small {
          font-size: 10px;
          color: #64748b;
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
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tile-vacant-content {
          font-size: 10.5px;
          color: #94a3b8;
          font-weight: 600;
        }

        .tile-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          border-top: 1px dashed #f1f5f9;
          padding-top: 3px;
          margin-top: 1px;
        }

        .tile-action-btns {
          display: flex;
          align-items: center;
          gap: 3px;
          width: 100%;
          justify-content: flex-end;
        }

        .tile-btn {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 2px 5px;
          height: 20px;
          border-radius: 4px;
          border: none;
          font-size: 9.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .tile-btn.settle-pay-btn {
          background: #16a34a;
          color: #ffffff;
          padding: 2px 7px;
          height: 20px;
          font-size: 9.5px;
          font-weight: 800;
          border-radius: 4px;
          box-shadow: 0 1px 2px rgba(22, 163, 74, 0.2);
        }

        .tile-btn.settle-pay-btn:hover {
          background: #15803d;
        }

        .tile-new-order-btn {
          border: none;
          background: transparent;
          color: #2563eb;
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
          border-right: 1px solid #e2e8f0;
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
          border-bottom: 1px solid #f1f5f9;
          flex-shrink: 0;
        }

        .rail-title {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748b;
        }

        .rail-count {
          font-size: 10.5px;
          font-weight: 700;
          background: #f1f5f9;
          color: #64748b;
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
          color: #334155;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
          width: 100%;
        }

        .vertical-cat-btn:hover {
          background: #f8fafc;
          color: #0f172a;
        }

        .vertical-cat-btn.active {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
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
          background: #f1f5f9;
          color: #64748b;
          padding: 1px 5px;
          border-radius: 4px;
        }

        .vertical-cat-btn.active .cat-badge {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .cat-active-indicator {
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 4px;
          background: #2563eb;
          border-radius: 0 3px 3px 0;
        }

        .vertical-cat-footer {
          padding: 8px 8px 24px 8px;
          border-top: 1px solid #f1f5f9;
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
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          border-radius: 6px;
          color: #334155;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .quick-add-dish-btn:hover {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #2563eb;
        }

        .terminal-shift-pill {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
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
          color: #64748b;
        }

        /* COLUMN 2: DISH CATALOG PANEL */
        .pos-catalog-panel {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #f8fafc;
          border-right: 1px solid #e2e8f0;
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
          border-bottom: 1px solid #e2e8f0;
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
          color: #0f172a;
        }

        .item-count-sub {
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
        }

        .veg-filter-pills {
          display: flex;
          gap: 2px;
          background: #f1f5f9;
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
          color: #64748b;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .veg-pill.active {
          background: #ffffff;
          color: #0f172a;
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
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
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
          color: #0f172a;
        }

        .clear-search {
          border: none;
          background: transparent;
          color: #94a3b8;
          cursor: pointer;
          padding: 0;
        }

        .dishes-grid {
          flex: 1;
          overflow-y: auto;
          padding: 8px 10px 16px 10px;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          align-content: start;
        }

        @media (max-width: 1080px) {
          .dishes-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        .dish-card {
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
          border-radius: 7px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.12s ease;
          min-height: 84px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
          position: relative;
          overflow: hidden;
        }

        .dish-card:hover {
          border-color: #93c5fd;
          transform: translateY(-1px);
          box-shadow: 0 3px 6px rgba(37, 99, 235, 0.07);
        }

        .dish-card.in-cart {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 0 0 1px #2563eb;
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
          color: #94a3b8;
          text-transform: capitalize;
        }

        .dish-price {
          font-size: 13.5px;
          font-weight: 800;
          color: #0f172a;
          font-variant-numeric: tabular-nums;
        }

        .dish-card.in-cart .dish-price {
          color: #1d4ed8;
        }

        .dish-info {
          margin-bottom: 3px;
          flex: 1;
        }

        .dish-name {
          margin: 0;
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.25;
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
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          color: #334155;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .dish-card:hover .card-add-btn {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
        }

        .card-stepper {
          display: flex;
          align-items: center;
          gap: 1px;
          background: #2563eb;
          border-radius: 5px;
          padding: 1px 2px;
          color: #ffffff;
          height: 22px;
        }

        .card-step-btn {
          border: none;
          background: transparent;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 19px;
          height: 19px;
          cursor: pointer;
          border-radius: 3px;
        }

        .card-step-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .card-qty {
          font-size: 11.5px;
          font-weight: 800;
          min-width: 16px;
          text-align: center;
        }

        .edit-dish-price-btn {
          border: none;
          background: transparent;
          color: #cbd5e1;
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
          color: #2563eb;
        }

        .empty-catalog-state {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 30px 10px;
          color: #94a3b8;
          text-align: center;
          gap: 6px;
        }

        .reset-filters-btn {
          padding: 5px 12px;
          background: #2563eb;
          color: #ffffff;
          border: none;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        /* COLUMN 3: BILLING & CHECKOUT TERMINAL */
        .pos-checkout-panel {
          width: 350px;
          min-width: 335px;
          max-width: 365px;
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
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
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
          background: #dbeafe;
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
          color: #64748b;
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
          color: #94a3b8;
          text-align: center;
          gap: 4px;
        }

        .empty-cart-message b {
          color: #475569;
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
          height: 25px;
          min-height: 25px;
          max-height: 25px;
          padding: 0 6px;
          border-bottom: 1px solid #f1f5f9;
          background: #ffffff;
          box-sizing: border-box;
          transition: background 0.1s ease;
        }

        .cart-item-row:hover {
          background: #f8fafc;
        }

        .cart-item-left {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          margin-right: 4px;
        }

        .cart-veg-dot {
          width: 5px;
          height: 5px;
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
          font-size: 11px;
          font-weight: 600;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1;
        }

        .add-note-btn.inline {
          border: none;
          background: transparent;
          color: #3b82f6;
          font-size: 9px;
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
          font-size: 8.5px;
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
          gap: 5px;
          flex-shrink: 0;
        }

        .cart-stepper {
          display: flex;
          align-items: center;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          padding: 0;
          background: #ffffff;
          height: 18px;
        }

        .cart-stepper button {
          border: none;
          background: transparent;
          color: #475569;
          padding: 0 3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .cart-stepper button:hover {
          background: #f1f5f9;
        }

        .cart-stepper span {
          font-size: 11px;
          font-weight: 700;
          color: #0f172a;
          min-width: 14px;
          text-align: center;
        }

        .cart-item-price {
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          font-variant-numeric: tabular-nums;
          min-width: 44px;
          text-align: right;
          white-space: nowrap;
        }

        .remove-item-btn {
          border: none;
          background: transparent;
          color: #cbd5e1;
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
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          flex-shrink: 0;
        }

        .calc-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          margin-bottom: 3px;
          color: #475569;
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
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          background: #ffffff;
          color: #475569;
          font-size: 9.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .disc-pill.active {
          background: #2563eb;
          color: #ffffff;
          border-color: #2563eb;
        }

        .discount-applied-val {
          color: #16a34a;
          font-weight: 700;
        }

        .tax-row {
          border-top: 1px dashed #e2e8f0;
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
          border-top: 1.5px solid #e2e8f0;
          padding-top: 6px;
          margin-top: 2px;
          font-size: 12px;
          font-weight: 800;
          color: #0f172a;
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
          border: 1px solid #cbd5e1;
          background: #ffffff;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .payment-mode-btn.active {
          border-color: #2563eb;
          background: #2563eb;
        }

        .pay-icon {
          font-size: 12px;
        }

        .pay-label {
          font-size: 11px;
          font-weight: 700;
          color: #334155;
        }

        .payment-mode-btn.active .pay-label {
          color: #ffffff;
        }

        /* CASH CALCULATOR */
        .cash-calculator-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
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
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          outline: none;
        }

        .quick-tender-pills {
          display: flex;
          gap: 2px;
        }

        .quick-tender-pills button {
          border: 1px solid #e2e8f0;
          background: #f8fafc;
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
          border-top: 1px dashed #f1f5f9;
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
          background: #f1f5f9;
          color: #334155;
          border: 1px solid #cbd5e1;
        }

        .kot-btn:hover:not(:disabled) {
          background: #e2e8f0;
          color: #0f172a;
        }

        .bill-btn {
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
        }

        .bill-btn:hover:not(:disabled) {
          background: #dbeafe;
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
          background: rgba(15, 23, 42, 0.65);
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
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .modal-head h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
        }

        .modal-head button {
          border: none;
          background: transparent;
          color: #64748b;
          cursor: pointer;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          padding: 10px 14px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .cancel-btn {
          padding: 6px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          background: #ffffff;
          color: #475569;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .confirm-btn {
          padding: 6px 14px;
          border: none;
          border-radius: 5px;
          background: #2563eb;
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
          border: 1.5px solid #cbd5e1;
          border-radius: 8px;
          background: #f8fafc;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
        }

        .quick-notable-card:hover {
          border-color: #3b82f6;
          background: #eff6ff;
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
          color: #0f172a;
        }

        .quick-notable-sub {
          font-size: 11px;
          color: #64748b;
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
          color: #2563eb;
          background: #dbeafe;
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
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .table-picker-divider::before,
        .table-picker-divider::after {
          content: "";
          flex: 1;
          border-bottom: 1px solid #e2e8f0;
        }

        .table-picker-divider span {
          padding: 0 8px;
        }

        .no-tables-available-prompt {
          padding: 24px 16px;
          text-align: center;
          color: #64748b;
        }

        .no-tables-available-prompt p {
          font-weight: 700;
          color: #1e293b;
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
          border: 1.5px solid #e2e8f0;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .table-select-card:hover {
          border-color: #3b82f6;
          transform: translateY(-1px);
        }

        .table-select-card.current {
          border-color: #2563eb;
          background: #eff6ff;
        }

        .table-num {
          font-size: 16px;
          font-weight: 900;
          color: #0f172a;
        }

        .table-seats {
          font-size: 10.5px;
          color: #64748b;
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
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #f8fafc;
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
          background: #f1f5f9;
          color: #475569;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 9.5px;
          font-weight: 600;
        }

        .recent-order-items-snippet {
          font-size: 10.5px;
          color: #64748b;
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
          border: 1px solid #cbd5e1;
          background: #ffffff;
          border-radius: 4px;
          font-size: 10.5px;
          font-weight: 600;
          color: #334155;
          cursor: pointer;
        }

        .reprint-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .no-bills-msg,
        .no-held-msg {
          text-align: center;
          color: #94a3b8;
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
          border: 1px solid #cbd5e1;
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
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 3px 7px;
          border-radius: 4px;
          font-size: 10.5px;
          color: #475569;
          cursor: pointer;
        }

        .quick-instruction-pills button:hover {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
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
          color: #475569;
        }

        .add-dish-form input,
        .add-dish-form select {
          padding: 6px 8px;
          border: 1px solid #cbd5e1;
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
          color: #334155;
          font-weight: 600;
        }

        .settings-row select {
          padding: 4px 6px;
          border: 1px solid #cbd5e1;
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
          background: #1e293b;
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
          color: #0f172a;
        }

        .bulk-subtitle {
          font-size: 11px;
          color: #64748b;
          font-weight: 500;
        }

        .bulk-tabs-bar {
          display: flex;
          gap: 6px;
          padding: 8px 14px 4px 14px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          flex-shrink: 0;
        }

        .bulk-tab-btn {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #64748b;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .bulk-tab-btn.active {
          background: #2563eb;
          color: #ffffff;
          border-color: #2563eb;
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
          color: #64748b;
          background: #f8fafc;
          padding: 6px 8px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
        }

        .bulk-entry-table tbody td {
          padding: 4px 6px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .row-num {
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          text-align: center;
        }

        .bulk-cell-input {
          width: 100%;
          padding: 5px 8px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          font-size: 12px;
          color: #0f172a;
          outline: none;
          box-sizing: border-box;
        }

        .bulk-cell-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 1px #2563eb;
        }

        .cost-input-wrapper {
          display: flex;
          align-items: center;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          overflow: hidden;
          background: #ffffff;
        }

        .cost-input-wrapper:focus-within {
          border-color: #2563eb;
          box-shadow: 0 0 0 1px #2563eb;
        }

        .rupee-sym {
          padding-left: 7px;
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
        }

        .bulk-cell-input.cost-input {
          border: none;
          padding-left: 3px;
        }

        .bulk-row-del-btn {
          border: none;
          background: transparent;
          color: #94a3b8;
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
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #334155;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .add-row-btn.secondary {
          background: #f1f5f9;
        }

        .add-row-btn:hover {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #2563eb;
        }

        .clear-rows-btn {
          margin-left: auto;
          border: none;
          background: transparent;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .clear-rows-btn:hover {
          color: #ef4444;
        }

        .bulk-text-hint {
          font-size: 11px;
          color: #64748b;
          margin-bottom: 6px;
        }

        .bulk-text-hint code {
          background: #f1f5f9;
          padding: 1px 5px;
          border-radius: 4px;
          color: #0f172a;
          font-weight: 600;
        }

        .bulk-textarea {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 8px;
          font-size: 12px;
          font-family: monospace;
          color: #0f172a;
          outline: none;
          box-sizing: border-box;
          resize: vertical;
        }

        .parse-text-btn {
          margin-top: 8px;
          padding: 6px 12px;
          background: #2563eb;
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
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
          flex-shrink: 0;
        }

        .valid-count-pill {
          font-size: 11.5px;
          color: #475569;
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
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 6px;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }

        .toolbar-bulk-btn:hover {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
        }
      `}</style>
    </div>
  );
}
