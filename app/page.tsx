"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Bell,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  LogOut,
  Menu as MenuIcon,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  DEMO_PRODUCTS,
  DEMO_TABLES,
  DEMO_RESTAURANTS,
  DEMO_TODAY_ORDERS,
  getDemoHistoricalOrders,
  getDemoDayWiseTrend,
  getDemoHourlyBuckets,
  getDemoCategoryDailyBreakdown,
} from "@/lib/demoData";
import { printKitchenOrderTicket } from "@/lib/printing/kotPrinter";
import { printCustomerBillReceipt } from "@/lib/printing/receiptPrinter";
import {
  enqueueOfflineOrder,
  cacheMenuItems,
  getCachedMenuItems,
  cacheTables,
  getCachedTables,
  getLocalSettings,
  saveLocalSettings,
} from "@/lib/offline/offlineStorage";
import { OfflineBanner } from "@/components/OfflineBanner";
import { WhatsAppDigestModal } from "@/components/WhatsAppDigestModal";
import { SuperAdminRemindersPanel } from "@/components/SuperAdminRemindersPanel";
import { RestaurantPOS } from "@/components/RestaurantPOS";
import { ModernLogin } from "@/components/ModernLogin";
/* =========================================================
   TYPES
========================================================= */

type Role = "SUPER_ADMIN" | "ADMIN" | "POC";

type Tab =
  | "new"
  | "orders"
  | "tables"
  | "insights"
  | "restaurants"
  | "users"
  | "reminders";

type CurrentUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
  restaurantId: string | null;
  restaurantName: string;
};

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
};

type Item = Product & {
  qty: number;
  notes?: string;
};

type OrderSource =
  | "ZOMATO"
  | "DINE_IN"
  | "SWIGGY"
  | "TAKEAWAY";

type Order = {
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
};

type RestaurantRow = {
  id: string;
  name: string;
};

type RestaurantTable = {
  id: string;
  tableNumber: string;
  capacity: number;
  isActive: boolean;
};

type UserRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  restaurant_id: string | null;
  is_active: boolean;
  auth_user_id?: string;
  restaurants?: {
    name: string;
  } | null;
};

/* =========================================================
   CONSTANTS
========================================================= */

const CATEGORIES = [
  "Starters",
  "Mains",
  "Breads",
  "Rice & Biryani",
  "Desserts",
  "Beverages",
];

const ORDER_SOURCES: OrderSource[] = [
  "ZOMATO",
  "DINE_IN",
  "SWIGGY",
  "TAKEAWAY",
];

const PAYMENT_MODES = [
  "UPI",
  "CASH",
  "CARD",
] as const;

/* =========================================================
   HELPERS
========================================================= */

function money(n: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

function formatCompactNumber(
  n: number,
  isCurrency: boolean
) {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const prefix = isCurrency ? "₹" : "";

  if (abs < 1000) {
    return `${sign}${prefix}${abs}`;
  }

  if (abs < 100000) {
    const val = abs / 1000;
    const formatted = Number.isInteger(
      val
    )
      ? String(val)
      : val.toFixed(1);
    return `${sign}${prefix}${formatted}K`;
  }

  const val = abs / 100000;
  const formatted = Number.isInteger(
    val
  )
    ? String(val)
    : val.toFixed(1);
  return `${sign}${prefix}${formatted}L`;
}

function moneyCompact(n: number) {
  return formatCompactNumber(n, true);
}

function numberCompact(n: number) {
  return formatCompactNumber(n, false);
}

function todayISO() {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offsetMs)
    .toISOString()
    .slice(0, 10);
}

function localDateKey(d: Date) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function timeGreeting() {
  const h = new Date().getHours();

  if (h < 12) return "morning";
  if (h < 17) return "afternoon";

  return "evening";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);

  const a = parts[0]?.[0] || "";
  const b = parts[1]?.[0] || "";

  return (a + b).toUpperCase() || "U";
}

/* =========================================================
   CATEGORY NORMALIZATION
========================================================= */

function normalizeCategory(category: any): string {
  if (category === null || category === undefined) {
    return "";
  }

  if (typeof category === "object") {
    category =
      category.name ||
      category.category ||
      category.title ||
      "";
  }

  const raw = String(category)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");

  if (
    raw === "starter" ||
    raw === "starters" ||
    raw.includes("starter")
  ) {
    return "Starters";
  }

  if (
    raw === "main" ||
    raw === "mains" ||
    raw === "main course" ||
    raw === "main courses" ||
    raw.includes("main course")
  ) {
    return "Mains";
  }

  if (
    raw === "bread" ||
    raw === "breads" ||
    raw.includes("bread")
  ) {
    return "Breads";
  }

  if (
    raw === "rice" ||
    raw === "biryani" ||
    raw === "rice biryani" ||
    raw === "rice and biryani" ||
    raw.includes("biryani") ||
    raw.includes("rice")
  ) {
    return "Rice & Biryani";
  }

  if (
    raw === "dessert" ||
    raw === "desserts" ||
    raw.includes("dessert")
  ) {
    return "Desserts";
  }

  if (
    raw === "beverage" ||
    raw === "beverages" ||
    raw === "drink" ||
    raw === "drinks" ||
    raw.includes("beverage") ||
    raw.includes("drink")
  ) {
    return "Beverages";
  }

  const direct = CATEGORIES.find(
    (c) =>
      c.toLowerCase() ===
      String(category).trim().toLowerCase()
  );

  return direct || String(category).trim();
}

/* =========================================================
   MENU HELPERS
========================================================= */

function isActiveMenuItem(row: any) {
  if (
    row.active === undefined ||
    row.active === null
  ) {
    return true;
  }

  if (typeof row.active === "boolean") {
    return row.active;
  }

  if (typeof row.active === "string") {
    return (
      row.active.toLowerCase() === "true" ||
      row.active === "1" ||
      row.active.toLowerCase() === "yes"
    );
  }

  if (typeof row.active === "number") {
    return row.active === 1;
  }

  return true;
}

function getMenuName(row: any) {
  return (
    row.name ||
    row.item_name ||
    row.menu_item_name ||
    row.title ||
    row.product_name ||
    "Unnamed item"
  );
}

function getMenuPrice(row: any) {
  return Number(
    row.price ??
      row.item_price ??
      row.selling_price ??
      row.sale_price ??
      row.amount ??
      0
  );
}

function getMenuCategory(row: any) {
  return normalizeCategory(
    row.category ??
      row.category_name ??
      row.menu_category ??
      row.category_title ??
      ""
  );
}

/* =========================================================
   ORDER HELPERS
========================================================= */

function deriveSource(o: any): OrderSource {
  if (ORDER_SOURCES.includes(o.channel)) {
    return o.channel;
  }

  if (o.order_type === "DINE_IN") {
    return "DINE_IN";
  }

  if (o.order_type === "TAKEAWAY") {
    return "TAKEAWAY";
  }

  return "TAKEAWAY";
}

function formatOrder(o: any): Order {
  // Aggregate order_items rows by (menu item + price) instead of a raw
  // 1:1 map. When a dish is ordered again in a later round on the same
  // table order, the DB legitimately has two order_items rows for it —
  // mapping those 1:1 produced two Items sharing the same id, which
  // both duplicated the bill line and broke React keys wherever items
  // are rendered (e.g. "duplicate key" warnings in the Orders list).
  const itemMap = new Map<string, Item>();

  (o.order_items || []).forEach((i: any) => {
    const id = i.menu_item_id || i.id;
    const price = Number(i.price_snapshot) || 0;
    const key = `${id}-${price}`;
    const qty = Number(i.qty) || 0;
    const existing = itemMap.get(key);

    if (existing) {
      existing.qty += qty;
    } else {
      itemMap.set(key, {
        id,
        name: i.name_snapshot || "Unknown item",
        price,
        category: getMenuCategory(
          Array.isArray(i.menu_items)
            ? i.menu_items[0]
            : i.menu_items
        ),
        qty,
      });
    }
  });

  return {
    id: o.order_number,
    databaseId: o.id,

    time: new Date(
      o.created_at
    ).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    }),

    source: deriveSource(o),

    table: o.table_number || undefined,

    items: Array.from(itemMap.values()),

    total: Number(o.total) || 0,

    payment:
      o.payment_mode || "UPI",

    createdAt:
      o.created_at,

    closedAt:
      o.closed_at || null,
  };
}

const ORDER_SELECT = `
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

const TREND_ORDER_SELECT = `
  id,
  order_number,
  order_type,
  channel,
  payment_mode,
  total,
  status,
  created_at
`;

/* =========================================================
   LOGIN
========================================================= */

function Login({
  onLogin,
}: {
  onLogin: (u: CurrentUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] =
    useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      alert(
        "Enter your email and password to continue."
      );
      return;
    }

    setChecking(true);

    try {
      const {
        data: authData,
        error: authError,
      } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        throw authError;
      }

      if (!authData.user) {
        throw new Error("Could not verify your login.");
      }

      const { data, error } = await supabase
        .from("users")
        .select(`
          id,
          name,
          phone,
          email,
          role,
          restaurant_id,
          is_active,
          restaurants (
            name
          )
        `)
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        alert(
          "Your authenticated account is not linked to a RestaurantIQ user profile."
        );
        return;
      }

      const row =
        data as unknown as UserRow;

      if (row.is_active === false) {
        await supabase.auth.signOut();
        alert(
          "This account has been disabled. Contact your administrator for access."
        );
        return;
      }

      const userObj: CurrentUser = {
        id: row.id,
        name: row.name,
        phone: row.phone || "",
        role: row.role,
        restaurantId: row.restaurant_id,
        restaurantName: row.restaurants?.name || "",
      };
      try {
        localStorage.setItem("restaurant_iq_user", JSON.stringify(userObj));
      } catch (e) {}
      onLogin(userObj);
    } catch (err: any) {
      console.error(
        "LOGIN ERROR:",
        err
      );

      alert(
        err?.message ||
          "Could not log in. Please try again."
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">

        <div className="brand big">
          <div className="logo">
            R
          </div>

          <span>
            RestaurantIQ
          </span>
        </div>

        <p className="login-sub">
          AI-Powered Business Intelligence
          For Restaurants
        </p>

        <label>Email</label>

        <input
          type="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          suppressHydrationWarning
          placeholder="admin@restaurant.com"
          onKeyDown={(e) =>
            e.key === "Enter" &&
            handleLogin()
          }
        />

        <label>
          Password
        </label>

        <input
          type="password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          suppressHydrationWarning
          placeholder="Enter Your Password"
          onKeyDown={(e) =>
            e.key === "Enter" &&
            handleLogin()
          }
        />

        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={checking}
          suppressHydrationWarning
        >
          {checking
            ? "Checking..."
            : "Login"}
        </button>

        <small>
          Access Is Managed By Your
          Super Admin
        </small>

      </div>
    </div>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

function Sidebar({
  tab,
  setTab,
  user,
  onLogout,
  mobile,
  setMobile,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  user: CurrentUser;
  onLogout: () => void;
  mobile: boolean;
  setMobile: (v: boolean) => void;
}) {
  const go = (t: Tab) => {
    setTab(t);
    setMobile(false);
  };

  return (
    <>
      <aside
        className={
          mobile
            ? "side open"
            : "side"
        }
      >

        <div className="brand">

          <div className="logo">
            R
          </div>

          <span>
            RestaurantIQ
          </span>

          <button
            className="close"
            onClick={() =>
              setMobile(false)
            }
          >
            <X />
          </button>

        </div>

        {user.role ===
        "SUPER_ADMIN" ? (
          <div className="restaurant-id platform">

            <div className="restaurant-id-badge platform-badge">
              <Store size={18} />
            </div>

            <div>
              <b>Platform</b>

              <small>
                All restaurants
              </small>
            </div>

          </div>
        ) : (
          <div className="restaurant-id">

            <div className="restaurant-id-badge">
              {initials(
                user.restaurantName ||
                  "R"
              )}
            </div>

            <div>
              <b>
                {user.restaurantName ||
                  "Your restaurant"}
              </b>

              <small>
                {user.role ===
                "ADMIN"
                  ? "Admin access"
                  : "POC access"}
              </small>
            </div>

          </div>
        )}

        {user.role ===
        "SUPER_ADMIN" ? (
          <nav>

            <a
              className={
                tab === "restaurants"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("restaurants")
              }
            >
              <Store size={18} />
              Restaurants
            </a>

            <a
              className={
                tab === "users"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("users")
              }
            >
              <Users size={18} />
              Users
            </a>

            <a
              className={
                tab === "reminders"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("reminders")
              }
            >
              <Bell size={18} />
              Owner Reminders
            </a>

          </nav>
        ) : user.role === "ADMIN" ? (
          <nav>
            <a
              className={
                tab === "insights"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("insights")
              }
            >
              <TrendingUp size={18} />
              Analytics & Insights
            </a>
          </nav>
        ) : (
          <nav>
            <a
              className={
                tab === "new"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("new")
              }
            >
              <Plus size={18} />
              POS Terminal
            </a>
          </nav>
        )}

        <div className="bottom">

          <a onClick={onLogout}>
            <LogOut size={18} />
            Logout
          </a>

        </div>

      </aside>

      {mobile && (
        <div
          className="overlay"
          onClick={() =>
            setMobile(false)
          }
        />
      )}
    </>
  );
}

/* =========================================================
   HEADER
========================================================= */

function Header({
  user,
  onMenu,
  onRefresh,
  lastUpdated,
  isRefreshing,
  tab,
}: {
  user: CurrentUser;
  onMenu: () => void;
  onRefresh?: () => void;
  lastUpdated?: string;
  isRefreshing?: boolean;
  tab?: Tab;
}) {
  if (user.role === "ADMIN") {
    const today = new Date();
    const dateFormatted = today.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const greetingTime = timeGreeting();
    const formattedGreeting =
      greetingTime.charAt(0).toUpperCase() + greetingTime.slice(1);

    const headingText =
      user.name.toLowerCase().includes("rohith") ||
      user.restaurantName.toLowerCase().includes("shubham") ||
      user.name.toLowerCase().includes("rajesh")
        ? `Good ${formattedGreeting} Rohith, Shubham Today's Performance 👋`
        : `Good ${formattedGreeting} ${firstName(user.name)}, ${user.restaurantName} Today's Performance 👋`;

    return (
      <header className="admin-unified-header">
        <button className="hamb" onClick={onMenu}>
          <MenuIcon />
        </button>

        <div className="admin-header-title-box">
          <h1>{headingText}</h1>
        </div>

        <div className="admin-header-meta-group">
          <div className="header-meta-chip">
            <Calendar size={13} />
            <span>{dateFormatted}</span>
          </div>

          <div className="header-meta-chip live">
            <span className="pulsing-live-dot" />
            <span>{lastUpdated ? `Live as of ${lastUpdated}` : "Live updated"}</span>
          </div>

          {onRefresh && (
            <button
              type="button"
              className="header-refresh-action"
              onClick={onRefresh}
              title="Refresh live data"
              disabled={isRefreshing}
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "spin-icon" : ""}
              />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Data"}</span>
            </button>
          )}

          <div className="profile">{initials(user.name)}</div>
        </div>
      </header>
    );
  }

  return (
    <header>
      <button className="hamb" onClick={onMenu}>
        <MenuIcon />
      </button>

      <div>
        <h1>
          Good {timeGreeting()}, {firstName(user.name)} 👋
        </h1>
        <p>
          {user.role === "SUPER_ADMIN"
            ? "Platform overview"
            : `${user.restaurantName} · Live database`}
        </p>
      </div>

      <div className="profile">{initials(user.name)}</div>
    </header>
  );
}

/* =========================================================
   NEW ORDER
========================================================= */

function NewOrder({
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
}) {
  const [cat, setCat] =
    useState("Starters");

  const [cart, setCart] =
    useState<Item[]>([]);

  const [source, setSource] =
    useState<
      OrderSource | ""
    >("");

  const [paymentMode, setPaymentMode] =
    useState<(typeof PAYMENT_MODES)[number]>("UPI");

  const [table, setTable] =
    useState("");

  useEffect(() => {
    if (initialTable) {
      setSource("DINE_IN");
      setTable(initialTable);
    }
  }, [initialTable]);

  const [saving, setSaving] =
    useState(false);

  const [autoPrintKot, setAutoPrintKot] = useState(
    () => getLocalSettings().autoPrintKot
  );

  const placingOrderRef = useRef(false);

  const [editingItem, setEditingItem] =
    useState<Product | null>(null);
  const [editPrice, setEditPrice] =
    useState("");

  const [showAddModal, setShowAddModal] =
    useState(false);
  const [newItemName, setNewItemName] =
    useState("");
  const [newItemPrice, setNewItemPrice] =
    useState("");
  const [newItemCategory, setNewItemCategory] =
    useState("Starters");
  const [addingItem, setAddingItem] =
    useState(false);

  const [disablingItem, setDisablingItem] =
    useState(false);

  const [showDisabledModal, setShowDisabledModal] =
    useState(false);
  const [disabledItems, setDisabledItems] =
    useState<
      Array<{
        id: string;
        name: string;
        price: number;
        category: string;
      }>
    >([]);
  const [loadingDisabled, setLoadingDisabled] =
    useState(false);
  const [reEnablingId, setReEnablingId] =
    useState<string | null>(null);

  async function loadDisabledItems() {
    setLoadingDisabled(true);

    try {
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq(
          "restaurant_id",
          restaurantId
        )
        .order("name");

      if (error) throw error;

      const inactive = (data || [])
        .filter(
          (row: any) =>
            !isActiveMenuItem(row)
        )
        .map((row: any) => ({
          id: String(row.id),
          name: getMenuName(row),
          price: getMenuPrice(row),
          category:
            getMenuCategory(row),
        }));

      setDisabledItems(inactive);
    } catch (err: any) {
      console.error(
        "LOAD DISABLED ITEMS ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not load disabled items."
      );
    } finally {
      setLoadingDisabled(false);
    }
  }

  async function handleReEnableItem(
    itemId: string
  ) {
    setReEnablingId(itemId);

    try {
      const { error } = await supabase
        .from("menu_items")
        .update({ active: true })
        .eq("id", itemId);

      if (error) throw error;

      setDisabledItems((prev) =>
        prev.filter(
          (i) => i.id !== itemId
        )
      );

      if (onMenuChanged) {
        await onMenuChanged();
      }
    } catch (err: any) {
      console.error(
        "RE-ENABLE ITEM ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not re-enable this item."
      );
    } finally {
      setReEnablingId(null);
    }
  }

  async function handleDisableItem() {
    if (!editingItem) return;

    const confirmed = window.confirm(
      `Remove "${editingItem.name}" from the menu? It won't appear for ordering until re-enabled from the menu management screen.`
    );
    if (!confirmed) return;

    setDisablingItem(true);

    try {
      const { error } = await supabase
        .from("menu_items")
        .update({ active: false })
        .eq("id", editingItem.id);

      if (error) throw error;

      setEditingItem(null);
      setEditPrice("");

      if (onMenuChanged) {
        await onMenuChanged();
      }
    } catch (err: any) {
      console.error(
        "DISABLE ITEM ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not remove this item."
      );
    } finally {
      setDisablingItem(false);
    }
  }

  async function handleUpdatePrice() {
    if (!editingItem || !editPrice.trim()) {
      alert("Enter a price.");
      return;
    }

    const price = Number(editPrice);
    if (isNaN(price) || price < 0) {
      alert("Enter a valid price.");
      return;
    }

    try {
      const { error } = await supabase
        .from("menu_items")
        .update({ price })
        .eq("id", editingItem.id);

      if (error) throw error;

      alert("Price updated successfully.");
      setEditingItem(null);
      setEditPrice("");
    } catch (err: any) {
      console.error(
        "UPDATE PRICE ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not update price."
      );
    }
  }

  async function handleAddItem() {
    if (
      !newItemName.trim() ||
      !newItemPrice.trim()
    ) {
      alert(
        "Enter item name and price."
      );
      return;
    }

    const price = Number(newItemPrice);
    if (isNaN(price) || price < 0) {
      alert("Enter a valid price.");
      return;
    }

    setAddingItem(true);

    try {
      const { error } = await supabase
        .from("menu_items")
        .insert({
          restaurant_id:
            restaurantId,
          name: newItemName.trim(),
          price,
          category:
            newItemCategory,
          active: true,
        });

      if (error) throw error;

      alert(
        "Item added successfully."
      );

      setNewItemName("");
      setNewItemPrice("");
      setNewItemCategory(
        "Starters"
      );
      setShowAddModal(false);
    } catch (err: any) {
      console.error(
        "ADD ITEM ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not add item."
      );
    } finally {
      setAddingItem(false);
    }
  }

  const add = (p: Product) => {
    setCart((current) => {

      const existing =
        current.find(
          (i) => i.id === p.id
        );

      if (existing) {
        return current.map(
          (i) =>
            i.id === p.id
              ? {
                  ...i,
                  qty:
                    i.qty + 1,
                }
              : i
        );
      }

      return [
        ...current,
        {
          ...p,
          qty: 1,
        },
      ];
    });
  };

  const total =
    cart.reduce(
      (sum, i) =>
        sum +
        Number(i.price) *
          i.qty,
      0
    );

  const itemCount =
    cart.reduce(
      (sum, i) =>
        sum + i.qty,
      0
    );

  const filteredProducts =
    products.filter(
      (p) =>
        normalizeCategory(
          p.category
        ) === cat
    );

  // Tables available for the dine-in dropdown: every active table, with
  // currently occupied ones flagged so the POC can still pick one to add
  // more items to an ongoing order (occupied orders auto-merge on save).
  const activeRestaurantTables = restaurantTables
    .filter((t) => t.isActive)
    .sort((a, b) =>
      a.tableNumber.localeCompare(b.tableNumber, undefined, {
        numeric: true,
      })
    );

  const occupiedTableNumbers = new Set(
    (orders || [])
      .filter(
        (o) =>
          o.source === "DINE_IN" &&
          o.table &&
          !o.closedAt
      )
      .map((o) => (o.table as string).trim())
  );

  const displayNumber = (value: string | number) => String(value);

  async function placeOrder(shouldPrintKot?: boolean) {
    if (placingOrderRef.current) return;

    if (!cart.length) {
      alert("Please select at least one item.");
      return;
    }

    if (!source) {
      alert("Choose an order source.");
      return;
    }

    if (!restaurantId) {
      alert("Restaurant is not mapped.");
      return;
    }

    placingOrderRef.current = true;
    setSaving(true);

    const cleanTable = table ? table.trim() : null;
    const settings = getLocalSettings();
    const willPrintKot = shouldPrintKot ?? settings.autoPrintKot;

    const selectedSource = source as OrderSource;

    function saveOfflineOrder(targetOrderNumber: string) {
      const tempId = `OFFLINE-${Date.now()}`;
      const orderType =
        selectedSource === "DINE_IN"
          ? "DINE_IN"
          : selectedSource === "TAKEAWAY"
          ? "TAKEAWAY"
          : "DELIVERY";

      enqueueOfflineOrder({
        tempId,
        restaurantId,
        createdByUserId: createdByUserId || null,
        orderNumber: targetOrderNumber,
        orderType,
        tableNumber: selectedSource === "DINE_IN" ? cleanTable : null,
        channel: selectedSource,
        paymentMode,
        total,
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

      const newOrder: Order = {
        id: targetOrderNumber,
        databaseId: tempId,
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source: selectedSource,
        table: selectedSource === "DINE_IN" ? cleanTable : undefined,
        items: cart,
        total,
        payment: paymentMode,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };

      onPlaced(newOrder);

      if (willPrintKot) {
        printKitchenOrderTicket({
          restaurantName,
          orderNumber: targetOrderNumber,
          table: source === "DINE_IN" ? cleanTable : undefined,
          source,
          items: cart,
          paperWidth: settings.paperWidth,
        });
      }

      setCart([]);
      setSource("");
      setPaymentMode("UPI");
      setTable("");
      alert(
        `Order ${targetOrderNumber} queued in Offline Mode. It will sync automatically when cloud reconnects.`
      );
    }

    // Check offline status first
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const offlineOrderNumber = `OFF-${Date.now().toString().slice(-6)}`;
      saveOfflineOrder(offlineOrderNumber);
      placingOrderRef.current = false;
      setSaving(false);
      return;
    }

    try {
      let targetOrderId: string | null = null;
      let targetOrderNumber: string = "";
      let existingTotal = 0;

      // 1. Check for an open dine-in order on this table
      if (source === "DINE_IN" && cleanTable) {
        const { data: existingOpenOrder, error: fetchError } = await supabase
          .from("orders")
          .select("id, order_number, total")
          .eq("restaurant_id", restaurantId)
          .eq("table_number", cleanTable)
          .is("closed_at", null)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existingOpenOrder) {
          targetOrderId = existingOpenOrder.id;
          targetOrderNumber = existingOpenOrder.order_number;
          existingTotal = Number(existingOpenOrder.total) || 0;
        }
      }

      let orderRecord;
      let finalItems: Item[] = cart;
      let finalTotal = total;

      if (targetOrderId) {
        // 2. APPEND ITEMS TO EXISTING ORDER
        const updatedTotal = existingTotal + total;

        const { data: updatedOrder, error: updateError } = await supabase
          .from("orders")
          .update({ total: updatedTotal })
          .eq("id", targetOrderId)
          .select()
          .maybeSingle();

        if (updateError) throw updateError;
        orderRecord = updatedOrder;

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

        const previousOrder = (orders || []).find(
          (o) => o.databaseId === targetOrderId
        );

        const mergedItemsMap = new Map<string, Item>();

        (previousOrder?.items || []).forEach((item) => {
          mergedItemsMap.set(`${item.id}-${item.price}`, { ...item });
        });

        cart.forEach((item) => {
          const key = `${item.id}-${item.price}`;
          const existing = mergedItemsMap.get(key);

          mergedItemsMap.set(
            key,
            existing
              ? { ...existing, qty: existing.qty + item.qty }
              : { ...item }
          );
        });

        finalItems = Array.from(mergedItemsMap.values());
        finalTotal = updatedTotal;
      } else {
        // 3. CREATE NEW ORDER
        const orderNumber = `S${Date.now().toString().slice(-6)}`;
        const orderType =
          source === "DINE_IN"
            ? "DINE_IN"
            : source === "TAKEAWAY"
            ? "TAKEAWAY"
            : "DELIVERY";

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .insert({
            restaurant_id: restaurantId,
            created_by: createdByUserId || null,
            order_number: orderNumber,
            order_type: orderType,
            table_number: source === "DINE_IN" ? cleanTable : null,
            channel: source,
            payment_mode: paymentMode,
            total,
            status: "COMPLETED",
          })
          .select()
          .maybeSingle();

        if (orderError) throw orderError;
        orderRecord = order;

        const orderItems = cart.map((item) => ({
          order_id: order.id,
          menu_item_id: item.id,
          name_snapshot: item.name,
          price_snapshot: item.price,
          qty: item.qty,
        }));

        const { error: itemError } = await supabase
          .from("order_items")
          .insert(orderItems);

        if (itemError) throw itemError;
        targetOrderNumber = orderNumber;
      }

      const newOrder: Order = {
        id: targetOrderNumber,
        databaseId: orderRecord.id,
        time: new Date(orderRecord.created_at).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        source,
        table: source === "DINE_IN" ? cleanTable : undefined,
        items: finalItems,
        total: finalTotal,
        payment: paymentMode,
        createdAt: orderRecord.created_at,
        closedAt: null,
      };

      onPlaced(newOrder);

      // Print KOT for the new items
      if (willPrintKot) {
        printKitchenOrderTicket({
          restaurantName,
          orderNumber: targetOrderNumber,
          table: source === "DINE_IN" ? cleanTable : undefined,
          source,
          items: cart,
          paperWidth: settings.paperWidth,
        });
      }

      setCart([]);
      setSource("");
      setPaymentMode("UPI");
      setTable("");

      alert(`Order ${targetOrderNumber} saved successfully.`);
    } catch (error: any) {
      console.error("ORDER ERROR:", error);
      const isNetwork =
        !navigator.onLine ||
        error?.message?.toLowerCase().includes("fetch") ||
        error?.message?.toLowerCase().includes("network");

      if (isNetwork) {
        const offlineNum = `OFF-${Date.now().toString().slice(-6)}`;
        saveOfflineOrder(offlineNum);
      } else {
        alert(error?.message || error?.details || "Could not save order.");
      }
    } finally {
      placingOrderRef.current = false;
      setSaving(false);
    }
  }

  function printBill() {
    if (!cart.length) {
      alert("Please select at least one item before printing.");
      return;
    }

    const settings = getLocalSettings();
    printCustomerBillReceipt({
      restaurantName,
      orderNumber: `DRAFT-${Date.now().toString().slice(-4)}`,
      table: source === "DINE_IN" ? table.trim() : undefined,
      source: source || "DINE_IN",
      paymentMode,
      items: cart,
      total,
      paperWidth: settings.paperWidth,
    });
  }

  return (
    <div className="new-layout">

      <section className="card menu-card">

        <div className="section-title">

          <div>
            <h2>Menu</h2>

            <span>
              Tap a dish to add it
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
            }}
          >
            <button
              className="secondary-btn"
              onClick={() => {
                setShowDisabledModal(
                  true
                );
                loadDisabledItems();
              }}
            >
              Disabled items
            </button>

            <button
              className="primary-btn"
              onClick={() =>
                setShowAddModal(
                  true
                )
              }
            >
              <Plus size={16} />
              Add Item
            </button>
          </div>

        </div>

        <div className="cats">

          {CATEGORIES.map(
            (c) => {

              const count =
                products.filter(
                  (p) =>
                    normalizeCategory(
                      p.category
                    ) === c
                ).length;

              return (
                <button
                  key={c}
                  className={
                    cat === c
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setCat(c)
                  }
                >
                  {c}

                  <small>
                    {displayNumber(count)}
                  </small>
                </button>
              );
            }
          )}

        </div>

        <div className="menu-grid">

          {filteredProducts.length ===
          0 ? (
            <div className="empty">

              No menu items found in{" "}
              <b>{cat}</b>

              <br />

              <small>
                Loaded{" "}
                {products.length}{" "}
                menu items from
                Supabase.
              </small>

            </div>
          ) : (
            filteredProducts.map(
              (p) => (
                <div
                  className="menu-item-wrapper"
                  key={p.id}
                >
                  <button
                    className="menu-item"
                    onClick={() =>
                      add(p)
                    }
                  >

                    <b>
                      {p.name}
                    </b>

                    <span>
                      {displayNumber(money(p.price))}

                      <Plus
                        size={15}
                      />
                    </span>

                  </button>

                  <button
                    className="edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingItem(
                        p
                      );
                      setEditPrice(
                        String(
                          p.price
                        )
                      );
                    }}
                  >
                    Edit Price
                  </button>
                </div>
              )
            )
          )}

        </div>

      </section>

      <section className="card cart">

        <div className="section-title">

          <div>

            <h2>
              Current order
            </h2>

            <span>
              {source
                ? source.replace(/_/g, " ")
                :
                "Choose order source"}
            </span>

          </div>

          <b>
            {displayNumber(itemCount)} items
          </b>

        </div>

        {cart.length === 0 ? (
          <div className="empty">
            Select items from
            the menu.
          </div>
        ) : (
          <div className="cart-items">

            {cart.map((i) => (

              <div
                className="cart-row"
                key={i.id}
              >

                <div>
                  <b>
                    {i.name}
                  </b>

                  <small>
                    {displayNumber(money(i.price))}{" "}
                    each
                  </small>
                </div>

                <div className="qty">

                  <button
                    onClick={() =>
                      setCart(
                        (current) =>
                          current.flatMap(
                            (x) =>
                              x.id ===
                              i.id
                                ? x.qty >
                                  1
                                  ? [
                                      {
                                        ...x,
                                        qty:
                                          x.qty -
                                          1,
                                      },
                                    ]
                                  : []
                                : [x]
                          )
                      )
                    }
                  >
                    −
                  </button>

                  <b>
                    {displayNumber(i.qty)}
                  </b>

                  <button
                    onClick={() =>
                      add(i)
                    }
                  >
                    +
                  </button>

                </div>

                <strong>
                  {displayNumber(money(i.price * i.qty))}
                </strong>

              </div>
            ))}

          </div>
        )}

        <div className="total">

          <span>
            Total
          </span>

          <strong>
            {displayNumber(money(total))}
          </strong>

        </div>

        <div className="source-pills">

          {ORDER_SOURCES.map(
            (s) => (
              <button
                key={s}
                className={
                  source === s
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setSource(s)
                }
              >
                {s.replace(/_/g, " ")}
              </button>
            )
          )}

        </div>

        {source ===
          "DINE_IN" &&
          (activeRestaurantTables.length > 0 ? (
            <select
              className="table-input"
              value={table}
              onChange={(e) =>
                setTable(
                  e.target.value
                )
              }
            >
              <option value="">
                Select a table
              </option>

              {activeRestaurantTables.map((t) => (
                <option key={t.id} value={t.tableNumber}>
                  Table {t.tableNumber}
                  {occupiedTableNumbers.has(t.tableNumber)
                    ? " · Occupied"
                    : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="table-input"
              type="text"
              value={table}
              onChange={(e) =>
                setTable(
                  e.target.value
                )
              }
              placeholder="Table number"
            />
          ))}

        <div className="payment-pills">
          {PAYMENT_MODES.map((mode) => (
            <button
              key={mode}
              className={paymentMode === mode ? "active" : ""}
              onClick={() => setPaymentMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          className="place"
          disabled={!cart.length || saving}
          onClick={() => placeOrder()}
          style={{ marginTop: "12px" }}
        >
          {saving
            ? "SAVING ORDER..."
            : `PLACE ORDER · ${displayNumber(money(total))}`}
        </button>

        {cart.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 4px 0",
              fontSize: "12px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                color: "#64748b",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={autoPrintKot}
                onChange={(e) => {
                  setAutoPrintKot(e.target.checked);
                  saveLocalSettings({ autoPrintKot: e.target.checked });
                }}
              />
              <span>Print KOT to Kitchen</span>
            </label>

            <button
              type="button"
              onClick={printBill}
              style={{
                background: "transparent",
                border: "none",
                color: "#2563eb",
                fontWeight: 700,
                cursor: "pointer",
                padding: "2px 6px",
                textDecoration: "underline",
              }}
            >
              Print Bill
            </button>
          </div>
        )}

      </section>

      {/* Edit Price Modal */}
      {editingItem && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>
              Edit Price
            </h3>

            <p>
              {editingItem.name}
            </p>

            <label>
              Price
            </label>

            <input
              type="number"
              step="0.01"
              value={editPrice}
              onChange={(e) =>
                setEditPrice(
                  e.target.value
                )
              }
              placeholder="0"
            />

            <div className="modal-actions">
              <button
                className="primary-btn"
                onClick={
                  handleUpdatePrice
                }
              >
                Update
              </button>
              <button
                className="secondary-btn"
                onClick={() =>
                  setEditingItem(
                    null
                  )
                }
              >
                Cancel
              </button>
            </div>

            <button
              className="danger-link-btn"
              disabled={disablingItem}
              onClick={
                handleDisableItem
              }
            >
              {disablingItem
                ? "Removing..."
                : "Remove from menu"}
            </button>
          </div>
        </div>
      )}

      {/* Disabled Items Modal */}
      {showDisabledModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>
              Disabled items
            </h3>

            <p>
              Items removed from the
              menu. Re-enable one to
              bring it back for
              ordering.
            </p>

            <div className="disabled-items-list">
              {loadingDisabled ? (
                <p className="disabled-items-empty">
                  Loading...
                </p>
              ) : disabledItems.length ===
                0 ? (
                <p className="disabled-items-empty">
                  No disabled items.
                </p>
              ) : (
                disabledItems.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="disabled-item-row"
                    >
                      <div>
                        <b>
                          {item.name}
                        </b>
                        <span>
                          {item.category}{" "}
                          ·{" "}
                          {money(
                            item.price
                          )}
                        </span>
                      </div>

                      <button
                        className="icon-action-btn enable"
                        disabled={
                          reEnablingId ===
                          item.id
                        }
                        onClick={() =>
                          handleReEnableItem(
                            item.id
                          )
                        }
                      >
                        <CheckCircle2
                          size={14}
                        />
                        {reEnablingId ===
                        item.id
                          ? "..."
                          : "Re-enable"}
                      </button>
                    </div>
                  )
                )
              )}
            </div>

            <div className="modal-actions">
              <button
                className="secondary-btn"
                onClick={() =>
                  setShowDisabledModal(
                    false
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>
              Add New Item
            </h3>

            <label>
              Item Name
            </label>

            <input
              type="text"
              value={newItemName}
              onChange={(e) =>
                setNewItemName(
                  e.target.value
                )
              }
              placeholder="Enter item name"
            />

            <label>
              Price
            </label>

            <input
              type="number"
              step="0.01"
              value={newItemPrice}
              onChange={(e) =>
                setNewItemPrice(
                  e.target.value
                )
              }
              placeholder="0"
            />

            <label>
              Category
            </label>

            <select
              value={newItemCategory}
              onChange={(e) =>
                setNewItemCategory(
                  e.target.value
                )
              }
            >
              {CATEGORIES.map(
                (c) => (
                  <option
                    key={c}
                    value={c}
                  >
                    {c}
                  </option>
                )
              )}
            </select>

            <div className="modal-actions">
              <button
                className="primary-btn"
                onClick={
                  handleAddItem
                }
                disabled={addingItem}
              >
                {addingItem
                  ? "Adding..."
                  : "Add Item"}
              </button>
              <button
                className="secondary-btn"
                onClick={() =>
                  setShowAddModal(
                    false
                  )
                }
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* =========================================================
   ORDERS & TABLE VIEW
========================================================= */

function printExistingBill(
  order: Order,
  restaurantName: string
): boolean {
  const settings = getLocalSettings();
  return printCustomerBillReceipt({
    restaurantName,
    orderNumber: order.id,
    table: order.table,
    source: order.source,
    paymentMode: order.payment,
    items: order.items,
    total: order.total,
    timestamp: order.createdAt,
    isReprint: true,
    paperWidth: settings.paperWidth,
  });
}

function printExistingKot(
  order: Order,
  restaurantName: string
): boolean {
  const settings = getLocalSettings();
  return printKitchenOrderTicket({
    restaurantName,
    orderNumber: order.id,
    table: order.table,
    source: order.source,
    items: order.items,
    timestamp: order.createdAt,
    paperWidth: settings.paperWidth,
  });
}

function TableView({
  tables,
  orders,
  restaurantId,
  restaurantName,
  onAddOrder,
  onCloseTable,
  onTableAdded,
}: {
  tables: RestaurantTable[];
  orders: Order[];
  restaurantId: string;
  restaurantName: string;
  onAddOrder: (table?: string) => void;
  onCloseTable: (table: string) => Promise<void> | void;
  onTableAdded: () => Promise<void> | void;
}) {
  const [closingTable, setClosingTable] = useState<string | null>(null);
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("4");
  const [addingTable, setAddingTable] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const activeTables = tables.filter((table) => table.isActive);

  // Combine every open order's items for a table into one item-level
  // list (item, qty, price) so the POC can see everything ordered at a
  // glance, even if it came in across multiple rounds/orders.
  function aggregateTableItems(tableOrders: Order[]) {
    const map = new Map<
      string,
      { name: string; qty: number; price: number }
    >();

    tableOrders.forEach((order) => {
      order.items.forEach((item) => {
        const key = `${item.id}-${item.price}`;
        const existing = map.get(key);

        if (existing) {
          existing.qty += item.qty;
        } else {
          map.set(key, {
            name: item.name,
            qty: item.qty,
            price: item.price,
          });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  // Filter only open/unclosed dine-in orders
  const dineInOrders = orders.filter(
    (order) =>
      order.source === "DINE_IN" &&
      order.table &&
      !order.closedAt
  );

  async function handleCloseTable(tableNumber: string) {
    const cleanTable = tableNumber.trim();
    const confirmed = window.confirm(
      `Close out Table ${cleanTable}? This marks the table Available again.`
    );
    if (!confirmed) return;

    setClosingTable(tableNumber);
    try {
      // Find all open orders matching this exact table number
      const openOrderIds = orders
        .filter(
          (order) =>
            order.source === "DINE_IN" &&
            order.table?.trim() === cleanTable &&
            !order.closedAt &&
            order.databaseId
        )
        .map((order) => order.databaseId as string);

      if (openOrderIds.length === 0) {
        alert(`No open orders found for Table ${cleanTable}.`);
        return;
      }

      const closedAtIso = new Date().toISOString();

      const { error } = await supabase
        .from("orders")
        .update({ closed_at: closedAtIso })
        .in("id", openOrderIds);

      if (error) throw error;

      // Call parent close handler or trigger state update
      await onCloseTable(cleanTable);

      alert(`Table ${cleanTable} closed successfully.`);
    } catch (err: any) {
      console.error("CLOSE TABLE ERROR:", err);
      alert(err?.message || "Could not close this table's order.");
    } finally {
      setClosingTable(null);
    }
  }

  async function handleCreateRealtimeTable() {
    if (!newTableNumber.trim()) {
      alert("Enter a table number.");
      return;
    }

    const capacity = Number(newTableCapacity);
    if (isNaN(capacity) || capacity <= 0) {
      alert("Enter a valid seating capacity.");
      return;
    }

    setAddingTable(true);
    try {
      const { error } = await supabase.from("restaurant_tables").insert({
        restaurant_id: restaurantId,
        table_number: newTableNumber.trim(),
        capacity,
        is_active: true,
      });

      if (error) throw error;

      alert(`Table ${newTableNumber.trim()} added successfully.`);
      setNewTableNumber("");
      setNewTableCapacity("4");
      setShowAddTableModal(false);
      await onTableAdded();
    } catch (err: any) {
      console.error("ADD TABLE ERROR:", err);
      alert(err?.message || "Could not add table.");
    } finally {
      setAddingTable(false);
    }
  }

  return (
    <section className="card table-view-card">
      <div className="section-title">
        <div>
          <h2>Table View</h2>
          <span>Live status for today&apos;s restaurant tables</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="secondary-btn"
            onClick={() => setShowAddTableModal(true)}
          >
            <Plus size={16} />
            Add Table
          </button>

          <button className="primary-btn" onClick={() => onAddOrder()}>
            <Plus size={16} />
            Add Order
          </button>
        </div>
      </div>

      <div className="table-view-summary" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div>
          <span>Occupied</span>
          <strong>
            {activeTables.filter((table) =>
              dineInOrders.some(
                (order) => order.table === table.tableNumber
              )
            ).length}
          </strong>
        </div>
        <div>
          <span>Available</span>
          <strong>
            {activeTables.filter((table) =>
              !dineInOrders.some(
                (order) => order.table === table.tableNumber
              )
            ).length}
          </strong>
        </div>
      </div>

      {activeTables.length === 0 ? (
        <div className="empty table-view-empty">
          No active restaurant tables found.
        </div>
      ) : (
        <div className="table-grid">
          {activeTables.map((table) => {
            const tableOrders = dineInOrders.filter(
              (order) => order.table === table.tableNumber
            );
            const tableTotal = tableOrders.reduce(
              (sum, order) => sum + order.total,
              0
            );
            const occupied = tableOrders.length > 0;
            const isClosing = closingTable === table.tableNumber;
            const isExpanded = expandedTable === table.tableNumber;
            const itemizedList = occupied
              ? aggregateTableItems(tableOrders)
              : [];

            return (
              <article className="table-card" key={table.id}>
                <div className="table-card-top">
                  <div>
                    <span className="table-label">TABLE</span>
                    <h3>{table.tableNumber}</h3>
                  </div>
                  <span className={`table-status ${occupied ? "occupied" : "available"}`}>
                    {occupied ? "Occupied" : "Available"}
                  </span>
                </div>

                <div className="table-card-meta">
                  <span>Seats {table.capacity}</span>
                  <span>{tableOrders.length} order{tableOrders.length === 1 ? "" : "s"}</span>
                </div>

                {occupied && (
                  <div className="table-card-total-row">
                    <strong className="table-total">{money(tableTotal)}</strong>

                    <button
                      type="button"
                      className="table-items-toggle"
                      onClick={() =>
                        setExpandedTable(
                          isExpanded ? null : table.tableNumber
                        )
                      }
                    >
                      {isExpanded ? "Hide items" : "View items"}
                      <ChevronDown
                        size={14}
                        className={isExpanded ? "rot" : ""}
                      />
                    </button>
                  </div>
                )}

                {occupied && isExpanded && (
                  <div className="table-items-detail">
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Qty</th>
                          <th>Amount</th>
                        </tr>
                      </thead>

                      <tbody>
                        {itemizedList.map((item) => (
                          <tr key={`${item.name}-${item.price}`}>
                            <td>{item.name}</td>
                            <td>{item.qty}</td>
                            <td>{money(item.price * item.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="table-card-actions">
                  <button className="primary-btn" onClick={() => onAddOrder(table.tableNumber)}>
                    <Plus size={15} />
                    {occupied ? "Add Items" : "Take Order"}
                  </button>

                  {occupied && (
                    <>
                      <button
                        className="secondary-btn"
                        onClick={() =>
                          printExistingBill(
                            tableOrders[tableOrders.length - 1],
                            restaurantName
                          )
                        }
                      >
                        Print Bill
                      </button>

                      <button
                        className="secondary-btn close-table-btn"
                        disabled={isClosing}
                        onClick={() => handleCloseTable(table.tableNumber)}
                      >
                        {isClosing ? "Closing..." : "Close Table"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showAddTableModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add New Table</h3>
            <label>Table Number / Name</label>
            <input
              type="text"
              value={newTableNumber}
              onChange={(e) => setNewTableNumber(e.target.value)}
              placeholder="e.g. 12 or Patio 1"
            />

            <label>Seating Capacity</label>
            <input
              type="number"
              value={newTableCapacity}
              onChange={(e) => setNewTableCapacity(e.target.value)}
              placeholder="4"
            />

            <div className="modal-actions">
              <button
                className="primary-btn"
                disabled={addingTable}
                onClick={handleCreateRealtimeTable}
              >
                {addingTable ? "Creating..." : "Save Table"}
              </button>
              <button
                className="secondary-btn"
                onClick={() => setShowAddTableModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Orders({
  restaurantId,
  restaurantName,
  refreshKey,
  isPoc = false,
}: {
  restaurantId: string;
  restaurantName: string;
  refreshKey: number;
  isPoc?: boolean;
}) {
  const [q, setQ] =
    useState("");

  const [open, setOpen] =
    useState<string | null>(
      null
    );

  const [start, setStart] =
    useState(todayISO());

  const [end, setEnd] =
    useState(todayISO());

  const [orders, setOrders] =
    useState<Order[]>([]);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    if (!restaurantId) return;

    loadOrders();
  }, [
    restaurantId,
    start,
    end,
    refreshKey,
  ]);

  useEffect(() => {
    if (!restaurantId) return;

    const channel = supabase
      .channel(`orders-live-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          loadOrders();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantId, start, end]);

  async function loadOrders() {
    setLoading(true);

    try {
      const startDate =
        new Date(
          `${start}T00:00:00`
        );

      const endDate =
        new Date(
          `${end}T23:59:59`
        );

      const {
        data,
        error,
      } = await supabase
        .from("orders")
        .select(
          ORDER_SELECT
        )
        .eq(
          "restaurant_id",
          restaurantId
        )
        .gte(
          "created_at",
          startDate.toISOString()
        )
        .lte(
          "created_at",
          endDate.toISOString()
        )
        .neq(
          "status",
          "CANCELLED"
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        );

      if (error) {
        throw error;
      }

      setOrders(
        (data || []).map(
          formatOrder
        )
      );
    } catch (err: any) {
      console.error(
        "ORDERS LOAD ERROR:",
        err
      );

      alert(
        err?.message ||
          "Could not load orders."
      );
    } finally {
      setLoading(false);
    }
  }

  const filtered =
    orders.filter((o) =>
      (
        o.id +
        " " +
        o.items
          .map(
            (i) =>
              i.name
          )
          .join(" ")
      )
        .toLowerCase()
        .includes(
          q.toLowerCase()
        )
    );

  const revenue =
    orders.reduce(
      (sum, o) =>
        sum + o.total,
      0
    );

  const itemsSold = orders.reduce(
    (sum, order) =>
      sum + order.items.reduce((itemSum, item) => itemSum + item.qty, 0),
    0
  );
  const averageOrderValue = orders.length ? revenue / orders.length : 0;

  function printClosingReport() {
    const reportWindow = window.open(
      "",
      "daily-closing-report",
      "width=520,height=720"
    );

    if (!reportWindow) {
      alert("Allow pop-ups to print the closing report.");
      return;
    }

    reportWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Daily closing report</title>
          <style>
            body { font: 14px Arial, sans-serif; color: #2b2013; padding: 24px; }
            main { max-width: 440px; margin: auto; }
            h1 { font: 700 24px Georgia, serif; margin: 0 0 5px; }
            p { color: #6b5d48; margin: 4px 0 20px; }
            .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #ede4d3; }
            .row strong { font-size: 16px; }
            .total { border-top: 2px solid #2b2013; margin-top: 8px; font-size: 19px; }
            @media print { body { padding: 8px; } }
          </style>
        </head>
        <body>
          <main>
            <h1>Daily Closing Report</h1>
            <p>${start} to ${end}</p>
            <div class="row"><span>Orders</span><strong>${orders.length}</strong></div>
            <div class="row"><span>Items Sold</span><strong>${itemsSold}</strong></div>
            <div class="row"><span>Average Order Value</span><strong>${money(averageOrderValue)}</strong></div>
            <div class="row total"><span>Total Revenue</span><strong>${money(revenue)}</strong></div>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.onafterprint = () => reportWindow.close();
    window.setTimeout(() => reportWindow.print(), 250);
  }

  function exportOrdersCsv() {
    if (!orders.length) {
      alert("There are no orders to export for this period.");
      return;
    }

    const csvCell = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`;

    const rows = [
      [
        "Order Number",
        "Date",
        "Source",
        "Table",
        "Items",
        "Payment",
        "Total",
      ],
      ...orders.map((order) => [
        order.id,
        new Date(order.createdAt).toLocaleString("en-IN"),
        order.source.replace(/_/g, " "),
        order.table || "",
        order.items
          .map((item) => `${item.name} x ${item.qty}`)
          .join("; "),
        order.payment,
        order.total,
      ]),
    ];

    const csv = rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${start}-to-${end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card orders-card">

      <div className="section-title">

        <div>

          <h2>
            Orders
          </h2>

          <span>
            {isPoc ? "••••••" : `${orders.length} orders · ${money(revenue)}`}
          </span>

        </div>

        <div className="search">

          <Search size={16} />

          <input
            value={q}
            onChange={(e) =>
              setQ(
                e.target.value
              )
            }
            placeholder="Search order or item"
          />

        </div>

        {!isPoc && (
          <>
            <button
              className="closing-report-btn"
              onClick={printClosingReport}
              disabled={loading}
            >
              Print Closing Report
            </button>

            <button
              className="export-orders-btn"
              onClick={exportOrdersCsv}
              disabled={loading || !orders.length}
            >
              Export CSV
            </button>
          </>
        )}

      </div>

      <div className="closing-summary">
        <div><span>Revenue</span><strong>{isPoc ? "••••••" : money(revenue)}</strong></div>
        <div><span>Orders</span><strong>{isPoc ? "••••••" : orders.length}</strong></div>
        <div><span>Items Sold</span><strong>{isPoc ? "••••••" : itemsSold}</strong></div>
        <div><span>Avg Order Value</span><strong>{isPoc ? "••••••" : money(averageOrderValue)}</strong></div>
      </div>

      <div className="date-filter">

        <Calendar size={15} />

        <label>
          From
        </label>

        <input
          type="date"
          value={start}
          max={end}
          onChange={(e) =>
            setStart(
              e.target.value
            )
          }
        />

        <label>
          To
        </label>

        <input
          type="date"
          value={end}
          min={start}
          onChange={(e) =>
            setEnd(
              e.target.value
            )
          }
        />

      </div>

      <div className="ledger">

        {loading ? (
          <div className="empty">
            Loading orders...
          </div>
        ) : filtered.length ===
          0 ? (
          <div className="empty">
            No orders found.
          </div>
        ) : (
          filtered.map(
            (o) => (
              <div
                className="order-wrap"
                key={o.id}
              >

                <button
                  className="order-row"
                  onClick={() =>
                    setOpen(
                      open ===
                        o.id
                        ? null
                        : o.id
                    )
                  }
                >

                  <span className="order-id">
                    {o.id}
                  </span>

                  <span>
                    {o.time}
                  </span>

                  <span className="order-items">
                    {o.items.reduce(
                      (s, i) =>
                        s + i.qty,
                      0
                    )}{" "}
                    items —{" "}
                    {o.items
                      .map(
                        (i) =>
                          `${i.name} × ${i.qty}`
                      )
                      .join(
                        ", "
                      )}
                  </span>

                  <span className="order-source">
                    {o.source}
                    {o.table
                      ? ` · T${o.table}`
                      : ""}
                  </span>

                  <strong>
                    {money(
                      o.total
                    )}
                  </strong>

                  <ChevronDown
                    size={17}
                    className={
                      open ===
                      o.id
                        ? "rot"
                        : ""
                    }
                  />

                </button>

                {open ===
                  o.id && (
                  <div className="order-detail">

                    {o.items.map(
                      (i, idx) => (
                        <div
                          key={
                            `${i.id}-${i.price}-${idx}`
                          }
                        >

                          <span>
                            {i.name} ×{" "}
                            {i.qty}
                          </span>

                          <b>
                            {money(
                              i.price *
                                i.qty
                            )}
                          </b>

                        </div>
                      )
                    )}

                    <hr />

                    <div>

                      <span>
                        {o.source}
                        {o.table
                          ? ` · Table ${o.table}`
                          : ""}{" "}
                        ·{" "}
                        {o.payment}
                      </span>

                      <b>
                        {money(
                          o.total
                        )}
                      </b>

                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="reprint-bill"
                        onClick={() =>
                          printExistingBill(
                            o,
                            restaurantName
                          )
                        }
                      >
                        Reprint Bill
                      </button>
                      <button
                        className="reprint-bill"
                        style={{ background: "#0f172a", color: "#fff", border: "none" }}
                        onClick={() =>
                          printExistingKot(
                            o,
                            restaurantName
                          )
                        }
                      >
                        Print KOT
                      </button>
                    </div>

                  </div>
                )}

              </div>
            )
          )
        )}

      </div>

    </section>
  );
}

/* =========================================================
   INSIGHTS
========================================================= */

const globalAnalyticsCache: {
  restaurantId?: string;
  historicalOrders?: Order[];
  historicalTimestamp?: number;
  dayWiseRows?: any[];
  dayWiseRangeKey?: string;
  hourlyBuckets?: any[];
  hourlyRangeKey?: string;
} = {};

function computeLinearTrend(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];

  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, v) => sum + v, 0) / n;

  let xVariance = 0;
  let covariance = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    xVariance += xDiff * xDiff;
    covariance += xDiff * (values[i] - yMean);
  }

  const slope = xVariance > 0 ? covariance / xVariance : 0;
  const intercept = yMean - slope * xMean;

  return values.map((_, i) => Math.max(0, Math.round(slope * i + intercept)));
}

function Insights({
  orders,
  restaurantId,
  restaurantName,
  currentUserPhone,
}: {
  orders: Order[];
  restaurantId: string;
  restaurantName?: string;
  currentUserPhone?: string;
}) {
  const [historicalOrders, setHistoricalOrders] = useState<Order[]>(() => {
    if (
      globalAnalyticsCache.restaurantId === restaurantId &&
      globalAnalyticsCache.historicalOrders
    ) {
      return globalAnalyticsCache.historicalOrders;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    return !(
      globalAnalyticsCache.restaurantId === restaurantId &&
      globalAnalyticsCache.historicalOrders &&
      globalAnalyticsCache.historicalOrders.length > 0
    );
  });

  const latestRequestId = useRef(0);

  const today = new Date();
  const dayOfWeek = today.toLocaleDateString(
    "en-IN",
    { weekday: "short" }
  );
  const date = today.toLocaleDateString(
    "en-IN",
    { day: "numeric", month: "long" }
  );
  const dateDisplay = `${dayOfWeek}, ${date}`;
  const currentDayOfWeek = today.getDay();

  type AnalyticsRangePreset =
    | "today"
    | "yesterday"
    | "last7"
    | "last30"
    | "thisMonth"
    | "lastMonth"
    | "thisYear"
    | "lastYear"
    | "custom";

  const [
    analyticsRangePreset,
    setAnalyticsRangePreset,
  ] = useState<AnalyticsRangePreset>(
    "last7"
  );
  const [customRangeStart, setCustomRangeStart] =
    useState(() => {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return d.toISOString().split(
        "T"
      )[0];
    });
  const [customRangeEnd, setCustomRangeEnd] =
    useState(
      today.toISOString().split("T")[0]
    );

  function refreshAllAnalytics() {
    if (!restaurantId) return;
    loadHistoricalData();
    loadDayWiseTrend();
    loadHourlyBuckets();
  }

  useEffect(() => {
    refreshAllAnalytics();
  }, [restaurantId, analyticsRangePreset, customRangeStart, customRangeEnd]);

  const historicalRefreshTimer =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  useEffect(() => {
    if (
      !restaurantId ||
      !isSupabaseConfigured ||
      restaurantId === "demo-restaurant-1"
    ) {
      return;
    }

    const channel = supabase
      .channel(
        `historical-orders-live-${restaurantId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          if (
            historicalRefreshTimer.current
          ) {
            clearTimeout(
              historicalRefreshTimer.current
            );
          }
          historicalRefreshTimer.current =
            setTimeout(() => {
              refreshAllAnalytics();
            }, 800);
        }
      )
      .subscribe();

    return () => {
      if (
        historicalRefreshTimer.current
      ) {
        clearTimeout(
          historicalRefreshTimer.current
        );
      }
      void supabase.removeChannel(
        channel
      );
    };
  }, [restaurantId, analyticsRangePreset, customRangeStart, customRangeEnd]);

  async function loadHistoricalData() {
    const requestId = ++latestRequestId.current;

    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
      const demoOrders = getDemoHistoricalOrders();
      globalAnalyticsCache.restaurantId = restaurantId;
      globalAnalyticsCache.historicalOrders = demoOrders;
      globalAnalyticsCache.historicalTimestamp = Date.now();
      setHistoricalOrders(demoOrders);
      setLoading(false);
      return;
    }

    // Use cached data immediately if available
    const hasCache =
      globalAnalyticsCache.restaurantId === restaurantId &&
      globalAnalyticsCache.historicalOrders &&
      globalAnalyticsCache.historicalOrders.length > 0;

    if (hasCache) {
      setHistoricalOrders(globalAnalyticsCache.historicalOrders!);
      setLoading(false);
      if (
        globalAnalyticsCache.historicalTimestamp &&
        Date.now() - globalAnalyticsCache.historicalTimestamp < 180000
      ) {
        return;
      }
    } else {
      setLoading(true);
    }

    const allRows: any[] = [];

    try {
      const lookbackDays = 60;

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - lookbackDays);

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);
      endDate.setHours(0, 0, 0, 0);

      const PAGE_SIZE = 1000;
      let cursor = startDate.toISOString();
      const endIso = endDate.toISOString();

      while (true) {
        const { data: page, error } = await supabase
          .from("orders")
          .select(TREND_ORDER_SELECT)
          .eq("restaurant_id", restaurantId)
          .gte("created_at", cursor)
          .lt("created_at", endIso)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: true })
          .limit(PAGE_SIZE);

        if (error) {
          throw error;
        }

        allRows.push(...(page || []));

        if (!page || page.length < PAGE_SIZE) {
          break;
        }

        const lastCreatedAt =
          page[page.length - 1].created_at;
        cursor = new Date(
          new Date(lastCreatedAt).getTime() + 1
        ).toISOString();

        if (allRows.length > 50000) {
          break;
        }
      }

      const formatted = allRows.map(
        formatOrder
      );

      if (requestId !== latestRequestId.current) {
        return;
      }

      globalAnalyticsCache.restaurantId = restaurantId;
      globalAnalyticsCache.historicalOrders = formatted;
      globalAnalyticsCache.historicalTimestamp = Date.now();

      setHistoricalOrders(formatted);
    } catch (err: any) {
      console.error(
        "HISTORICAL DATA ERROR:",
        err.message || err
      );

      if (
        allRows.length > 0 &&
        requestId === latestRequestId.current
      ) {
        setHistoricalOrders(allRows.map(formatOrder));
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
      }
    }
  }

  function getOrdersByDate(
    date: Date,
    ordersList: Order[],
    cutoffMs?: number
  ) {
    const dateStr = date
      .toISOString()
      .split("T")[0];

    return ordersList.filter((o) => {
      const oDateObj = new Date(
        o.createdAt
      );
      const oDate = oDateObj
        .toISOString()
        .split("T")[0];

      if (oDate !== dateStr) {
        return false;
      }

      if (cutoffMs !== undefined) {
        const msIntoDay =
          oDateObj.getHours() *
            3600000 +
          oDateObj.getMinutes() *
            60000 +
          oDateObj.getSeconds() *
            1000 +
          oDateObj.getMilliseconds();
        return msIntoDay <= cutoffMs;
      }

      return true;
    });
  }

  function calculateMetrics(
    dateOrders: Order[]
  ) {
    const rev =
      dateOrders.reduce(
        (s, o) => s + o.total,
        0
      ) || 0;
    const cnt = dateOrders.length || 0;
    const av = cnt ? rev / cnt : 0;
    const itemCount =
      dateOrders.reduce(
        (s, o) =>
          s +
          o.items.reduce(
            (x, i) => x + i.qty,
            0
          ),
        0
      ) || 0;

    return {
      revenue: rev,
      count: cnt,
      aov: av,
      items: itemCount,
    };
  }

  const todayMetrics =
    calculateMetrics(orders);

  const nowMsIntoDay =
    today.getHours() * 3600000 +
    today.getMinutes() * 60000 +
    today.getSeconds() * 1000 +
    today.getMilliseconds();

  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(
    lastWeekDate.getDate() - 7
  );
  const lastWeekMetricsFullDay =
    calculateMetrics(
      getOrdersByDate(
        lastWeekDate,
        historicalOrders
      )
    );
  const lastWeekMetricsSameTime =
    calculateMetrics(
      getOrdersByDate(
        lastWeekDate,
        historicalOrders,
        nowMsIntoDay
      )
    );

  function buildWeeklyAverage(
    metricKey:
      | "revenue"
      | "count"
      | "aov"
      | "items",
    cutoffMs?: number
  ) {
    const values: number[] = [];
    for (let w = 1; w <= 7; w++) {
      const checkDate = new Date(
        today
      );
      checkDate.setDate(
        checkDate.getDate() - 7 * w
      );
      if (
        checkDate.getDay() ===
        currentDayOfWeek
      ) {
        const m = calculateMetrics(
          getOrdersByDate(
            checkDate,
            historicalOrders,
            cutoffMs
          )
        );
        values.push(m[metricKey]);
      }
    }
    return values.length
      ? values.reduce(
          (a, b) => a + b,
          0
        ) / values.length
      : 0;
  }

  const revenueWeeklyAvg =
    buildWeeklyAverage("revenue");
  const orderCountWeeklyAvg =
    buildWeeklyAverage("count");
  const aovWeeklyAvg =
    buildWeeklyAverage("aov");
  const itemsWeeklyAvg =
    buildWeeklyAverage("items");

  const revenueWeeklyAvgSameTime =
    buildWeeklyAverage(
      "revenue",
      nowMsIntoDay
    );
  const orderCountWeeklyAvgSameTime =
    buildWeeklyAverage(
      "count",
      nowMsIntoDay
    );
  const aovWeeklyAvgSameTime =
    buildWeeklyAverage(
      "aov",
      nowMsIntoDay
    );
  const itemsWeeklyAvgSameTime =
    buildWeeklyAverage(
      "items",
      nowMsIntoDay
    );

  const REVENUE_HIGHLIGHT_GRADIENT_ID =
    "revenueHighlightGradient";
  const REVENUE_MUTED_GRADIENT_ID =
    "revenueMutedGradient";
  const REVENUE_TODAY_STROKE = "#c2410c";

  function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function dayAfter(d: Date) {
    const x = startOfDay(d);
    x.setDate(x.getDate() + 1);
    return x;
  }

  const analyticsRange = useMemo(() => {
    switch (analyticsRangePreset) {
      case "today":
        return {
          start: startOfDay(today),
          end: dayAfter(today),
        };
      case "yesterday": {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return {
          start: startOfDay(y),
          end: dayAfter(y),
        };
      }
      case "last7": {
        const s = new Date(today);
        s.setDate(s.getDate() - 6);
        return {
          start: startOfDay(s),
          end: dayAfter(today),
        };
      }
      case "last30": {
        const s = new Date(today);
        s.setDate(s.getDate() - 29);
        return {
          start: startOfDay(s),
          end: dayAfter(today),
        };
      }
      case "thisMonth": {
        const s = new Date(
          today.getFullYear(),
          today.getMonth(),
          1
        );
        return {
          start: s,
          end: dayAfter(today),
        };
      }
      case "lastMonth": {
        const s = new Date(
          today.getFullYear(),
          today.getMonth() - 1,
          1
        );
        const e = new Date(
          today.getFullYear(),
          today.getMonth(),
          1
        );
        return { start: s, end: e };
      }
      case "thisYear": {
        const s = new Date(
          today.getFullYear(),
          0,
          1
        );
        return {
          start: s,
          end: dayAfter(today),
        };
      }
      case "lastYear": {
        const s = new Date(
          today.getFullYear() - 1,
          0,
          1
        );
        const e = new Date(
          today.getFullYear(),
          0,
          1
        );
        return { start: s, end: e };
      }
      case "custom":
      default: {
        const s = customRangeStart
          ? startOfDay(
              new Date(
                customRangeStart +
                  "T00:00:00"
              )
            )
          : startOfDay(today);
        const eBase = customRangeEnd
          ? new Date(
              customRangeEnd +
                "T00:00:00"
            )
          : today;
        return {
          start: s,
          end: dayAfter(eBase),
        };
      }
    }
  }, [
    analyticsRangePreset,
    customRangeStart,
    customRangeEnd,
    today,
  ]);

  function analyticsRangeLabel() {
    const opts: Intl.DateTimeFormatOptions =
      {
        month: "short",
        day: "numeric",
      };
    const startLabel =
      analyticsRange.start.toLocaleDateString(
        "en-IN",
        opts
      );
    const endLabel = new Date(
      analyticsRange.end.getTime() -
        86400000
    ).toLocaleDateString(
      "en-IN",
      opts
    );
    return `${startLabel} – ${endLabel}`;
  }

  const [dayWiseMetric, setDayWiseMetric] =
    useState<
      "revenue" | "orderCount" | "aov"
    >("revenue");

  function dayWiseMetricLabel(
    m: "revenue" | "orderCount" | "aov"
  ) {
    if (m === "revenue")
      return "Revenue";
    if (m === "orderCount")
      return "Orders";
    return "Avg Order Value";
  }

  function dayWiseValueFormatter(
    v: number
  ) {
    return dayWiseMetric === "orderCount"
      ? numberCompact(v)
      : moneyCompact(v);
  }

  const [dayWiseTrendData, setDayWiseTrendData] =
    useState<
      Array<{
        dateKey: string;
        label: string;
        weekday: number;
        revenue: number;
        orderCount: number;
        aov: number;
        isToday: boolean;
      }>
    >(() => globalAnalyticsCache.dayWiseRows || []);

  const [trendViewMode, setTrendViewMode] =
    useState<"continuous" | "weekday">("continuous");

  // Continuous trend data with 3-week same-weekday MTD moving baseline
  const continuousTrendWithMtd = useMemo(() => {
    return dayWiseTrendData.map((item, index) => {
      const priorSameWeekdays = dayWiseTrendData
        .slice(0, index)
        .filter((d) => d.weekday === item.weekday);
      const last3 = priorSameWeekdays.slice(-3);

      let mtdBaselineVal = 0;
      if (last3.length > 0) {
        const sum = last3.reduce((acc, cur) => {
          const val =
            dayWiseMetric === "revenue"
              ? cur.revenue
              : dayWiseMetric === "orderCount"
                ? cur.orderCount
                : cur.aov;
          return acc + val;
        }, 0);
        mtdBaselineVal = Math.round(sum / last3.length);
      } else {
        const val =
          dayWiseMetric === "revenue"
            ? item.revenue
            : dayWiseMetric === "orderCount"
              ? item.orderCount
              : item.aov;
        mtdBaselineVal = Math.round(val * 0.94);
      }

      return {
        ...item,
        mtdBaseline: mtdBaselineVal,
      };
    });
  }, [dayWiseTrendData, dayWiseMetric]);

  // Aggregated data by weekday (Monday to Sunday)
  const weekdayAggregatedData = useMemo(() => {
    const days = [
      { dayIdx: 1, name: "Mon" },
      { dayIdx: 2, name: "Tue" },
      { dayIdx: 3, name: "Wed" },
      { dayIdx: 4, name: "Thu" },
      { dayIdx: 5, name: "Fri" },
      { dayIdx: 6, name: "Sat" },
      { dayIdx: 0, name: "Sun" },
    ];

    return days.map(({ dayIdx, name }) => {
      const match = dayWiseTrendData.filter((d) => d.weekday === dayIdx);
      const count = match.length || 1;
      const totRev = match.reduce((s, d) => s + (d.revenue || 0), 0);
      const totOrders = match.reduce((s, d) => s + (d.orderCount || 0), 0);
      const avgRev = Math.round(totRev / count);
      const avgOrders = Math.round(totOrders / count);
      const avgAov = avgOrders > 0 ? Math.round(avgRev / avgOrders) : 0;

      const curMetricVal =
        dayWiseMetric === "revenue"
          ? avgRev
          : dayWiseMetric === "orderCount"
            ? avgOrders
            : avgAov;

      const last3Match = match.slice(-3);
      const mtdVal =
        last3Match.length > 0
          ? Math.round(
              last3Match.reduce((s, d) => {
                const val =
                  dayWiseMetric === "revenue"
                    ? d.revenue
                    : dayWiseMetric === "orderCount"
                      ? d.orderCount
                      : d.aov;
                return s + val;
              }, 0) / last3Match.length
            )
          : curMetricVal;

      return {
        dateKey: `weekday-${dayIdx}`,
        label: name,
        fullLabel: `${name} (${match.length} occurrences avg)`,
        weekday: dayIdx,
        revenue: avgRev,
        orderCount: avgOrders,
        aov: avgAov,
        mtdBaseline: mtdVal,
        isToday: dayIdx === currentDayOfWeek,
      };
    });
  }, [dayWiseTrendData, dayWiseMetric, currentDayOfWeek]);

  const displayTrendChartData = continuousTrendWithMtd;

  const [selectedWeekdayFilter, setSelectedWeekdayFilter] = useState<number>(() => currentDayOfWeek);

  const WEEKDAYS_LIST = [
    { dayIdx: 1, name: "Mon", fullName: "Monday" },
    { dayIdx: 2, name: "Tue", fullName: "Tuesday" },
    { dayIdx: 3, name: "Wed", fullName: "Wednesday" },
    { dayIdx: 4, name: "Thu", fullName: "Thursday" },
    { dayIdx: 5, name: "Fri", fullName: "Friday" },
    { dayIdx: 6, name: "Sat", fullName: "Saturday" },
    { dayIdx: 0, name: "Sun", fullName: "Sunday" },
  ];

  const selectedWeekdayObj =
    WEEKDAYS_LIST.find((w) => w.dayIdx === selectedWeekdayFilter) ||
    WEEKDAYS_LIST[3];
  const selectedWeekdayName = selectedWeekdayObj.fullName;

  // 7-Week Same Day Data: Both Same-Time Cutoff and Full-Day
  const sevenWeeksSameDayData = useMemo(() => {
    const result: Array<{
      date: Date;
      dateKey: string;
      label: string;
      relativeLabel: string;
      isToday: boolean;
      sameTimeValue: number;
      fullDayValue: number;
      projectedRemaining: number;
      projectedTotal: number;
      isLaggingSameTime: boolean;
      pctDiffVsLwSameTime: number;
      sameTimeTrend: number;
      fullDayTrend: number;
    }> = [];

    const d = new Date(today);
    const diff = (today.getDay() - selectedWeekdayFilter + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);

    const relativeLabels = [
      "6 Wks Ago",
      "5 Wks Ago",
      "4 Wks Ago",
      "3 Wks Ago",
      "2 Wks Ago",
      "Last Week",
      "Today",
    ];

    // Compute projection ratio from Last Week's same weekday
    const lastWkDate = new Date(d);
    lastWkDate.setDate(lastWkDate.getDate() - 7);
    const lwSameTimeOrders = getOrdersByDate(lastWkDate, historicalOrders, nowMsIntoDay);
    const lwFullOrders = getOrdersByDate(lastWkDate, historicalOrders);
    const lwSameTimeMetrics = calculateMetrics(lwSameTimeOrders);
    const lwFullMetrics = calculateMetrics(lwFullOrders);

    const lwSameTimeRev = lwSameTimeMetrics.revenue;
    const lwFullRev = lwFullMetrics.revenue;
    const revShare = lwFullRev > 0 ? lwSameTimeRev / lwFullRev : 0.55;

    const lwSameTimeCnt = lwSameTimeMetrics.count;
    const lwFullCnt = lwFullMetrics.count;
    const cntShare = lwFullCnt > 0 ? lwSameTimeCnt / lwFullCnt : 0.55;

    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(d);
      targetDate.setDate(d.getDate() - i * 7);
      const isDayToday = targetDate.toDateString() === today.toDateString();
      const dateFormatted = targetDate.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      });

      let sameTimeVal = 0;
      let fullDayVal = 0;
      let projRemaining = 0;
      let projTotal = 0;

      if (isDayToday) {
        sameTimeVal =
          dayWiseMetric === "revenue"
            ? todayMetrics.revenue
            : dayWiseMetric === "orderCount"
              ? todayMetrics.count
              : todayMetrics.aov;

        if (dayWiseMetric === "revenue") {
          projTotal =
            revShare > 0.1 && revShare < 0.95
              ? Math.round(todayMetrics.revenue / revShare)
              : Math.round(todayMetrics.revenue * 1.5);
          projRemaining = Math.max(0, projTotal - sameTimeVal);
        } else if (dayWiseMetric === "orderCount") {
          projTotal =
            cntShare > 0.1 && cntShare < 0.95
              ? Math.round(todayMetrics.count / cntShare)
              : Math.round(todayMetrics.count * 1.5);
          projRemaining = Math.max(0, projTotal - sameTimeVal);
        } else {
          projTotal = todayMetrics.aov;
          projRemaining = 0;
        }
        fullDayVal = sameTimeVal;
      } else {
        const sameTimeOrders = getOrdersByDate(targetDate, historicalOrders, nowMsIntoDay);
        const fullOrders = getOrdersByDate(targetDate, historicalOrders);
        const sameTimeM = calculateMetrics(sameTimeOrders);
        const fullM = calculateMetrics(fullOrders);

        sameTimeVal =
          dayWiseMetric === "revenue"
            ? sameTimeM.revenue
            : dayWiseMetric === "orderCount"
              ? sameTimeM.count
              : sameTimeM.aov;

        fullDayVal =
          dayWiseMetric === "revenue"
            ? fullM.revenue
            : dayWiseMetric === "orderCount"
              ? fullM.count
              : fullM.aov;

        projTotal = fullDayVal;
        projRemaining = 0;
      }

      result.push({
        date: targetDate,
        dateKey: `7wk-${targetDate.toISOString().slice(0, 10)}`,
        label: isDayToday ? `Today (${dateFormatted})` : dateFormatted,
        relativeLabel: isDayToday ? "Today" : relativeLabels[6 - i],
        isToday: isDayToday,
        sameTimeValue: sameTimeVal,
        fullDayValue: fullDayVal,
        projectedRemaining: projRemaining,
        projectedTotal: projTotal,
        isLaggingSameTime: false,
        pctDiffVsLwSameTime: 0,
        sameTimeTrend: 0,
        fullDayTrend: 0,
      });
    }

    // Compare index 6 (Today / latest) with index 5 (Last Week)
    const latestItem = result[6];
    const lwItem = result[5];
    if (latestItem && lwItem && lwItem.sameTimeValue > 0) {
      latestItem.isLaggingSameTime = latestItem.sameTimeValue < lwItem.sameTimeValue;
      latestItem.pctDiffVsLwSameTime = Math.round(
        ((latestItem.sameTimeValue - lwItem.sameTimeValue) / lwItem.sameTimeValue) * 100
      );
    }

    // Power BI-style Linear Regression Trend Lines
    const stTrends = computeLinearTrend(result.map((d) => d.sameTimeValue));
    const fdTrends = computeLinearTrend(result.map((d) => d.projectedTotal));

    result.forEach((item, i) => {
      item.sameTimeTrend = stTrends[i] ?? item.sameTimeValue;
      item.fullDayTrend = fdTrends[i] ?? item.projectedTotal;
    });

    return result;
  }, [
    today,
    selectedWeekdayFilter,
    historicalOrders,
    todayMetrics,
    nowMsIntoDay,
    dayWiseMetric,
  ]);

  const latestWeekItem = sevenWeeksSameDayData[6];

  const [dayWiseLoading, setDayWiseLoading] =
    useState(() => !(globalAnalyticsCache.dayWiseRows && globalAnalyticsCache.dayWiseRows.length > 0));
  const latestDayWiseRequestId = useRef(0);

  async function loadDayWiseTrend() {
    if (!restaurantId) return;

    const rangeKey = `${restaurantId}_${analyticsRange.start.toISOString()}_${analyticsRange.end.toISOString()}`;
    const requestId =
      ++latestDayWiseRequestId.current;

    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
      const demoTrend = getDemoDayWiseTrend(analyticsRange.start, analyticsRange.end);
      globalAnalyticsCache.dayWiseRows = demoTrend;
      globalAnalyticsCache.dayWiseRangeKey = rangeKey;
      setDayWiseTrendData(demoTrend);
      setDayWiseLoading(false);
      return;
    }

    if (globalAnalyticsCache.dayWiseRows && globalAnalyticsCache.dayWiseRangeKey === rangeKey) {
      setDayWiseTrendData(globalAnalyticsCache.dayWiseRows);
      setDayWiseLoading(false);
    } else {
      setDayWiseLoading(true);
    }

    try {
      const numDays = Math.max(
        1,
        Math.round(
          (analyticsRange.end.getTime() -
            analyticsRange.start.getTime()) /
            86400000
        )
      );

      const { data, error } =
        await supabase.rpc(
          "get_order_period_trends",
          {
            p_restaurant_id: restaurantId,
            p_period_type: "day",
            p_num_periods: numDays,
            p_end: analyticsRange.end.toISOString(),
          }
        );

      if (error) throw error;

      const todayKey = localDateKey(today);

      const formatted = (
        data || []
      ).map((row: any) => {
        const d = new Date(
          row.period_start
        );
        return {
          dateKey: localDateKey(d),
          label: d.toLocaleDateString(
            "en-IN",
            {
              month: "short",
              day: "numeric",
            }
          ),
          weekday: d.getDay(),
          revenue:
            Number(row.revenue) || 0,
          orderCount:
            Number(
              row.order_count
            ) || 0,
          aov: Number(row.aov) || 0,
          isToday: localDateKey(d) === todayKey,
        };
      });

      if (
        requestId !==
        latestDayWiseRequestId.current
      ) {
        return;
      }

      globalAnalyticsCache.dayWiseRows = formatted;
      globalAnalyticsCache.dayWiseRangeKey = rangeKey;
      setDayWiseTrendData(formatted);
    } catch (err: any) {
      console.error(
        "DAY-WISE TREND ERROR:",
        err.message || err
      );
    } finally {
      if (
        requestId ===
        latestDayWiseRequestId.current
      ) {
        setDayWiseLoading(false);
      }
    }
  }

  useEffect(() => {
    loadDayWiseTrend();
  }, [
    restaurantId,
    analyticsRange.start.getTime(),
    analyticsRange.end.getTime(),
  ]);

  const [hourlyBucketMetric, setHourlyBucketMetric] =
    useState<
      "revenue" | "orderCount" | "aov" | "items"
    >("revenue");

  function hourlyBucketMetricLabel(
    m: "revenue" | "orderCount" | "aov" | "items"
  ) {
    if (m === "revenue") return "Revenue";
    if (m === "orderCount") return "Orders";
    if (m === "aov") return "Avg Order Value";
    return "Items Sold";
  }

  function hourlyBucketValueFormatter(
    v: number
  ) {
    return hourlyBucketMetric === "revenue" ||
      hourlyBucketMetric === "aov"
      ? moneyCompact(v)
      : numberCompact(v);
  }

  function formatBucketHour12(
    hour: number
  ) {
    const period =
      hour < 12 ? "AM" : "PM";
    const displayHour =
      hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}${period}`;
  }

  function bucketRangeLabel(
    startHour: number
  ) {
    const endHour = (startHour + 2) % 24;
    return `${formatBucketHour12(
      startHour
    )}-${formatBucketHour12(endHour)}`;
  }

  const [hourlyBucketData, setHourlyBucketData] =
    useState<
      Array<{
        bucket: number;
        label: string;
        revenue: number;
        orderCount: number;
        aov: number;
        items: number;
      }>
    >(() => globalAnalyticsCache.hourlyBuckets || []);
  const [
    hourlyBucketLoading,
    setHourlyBucketLoading,
  ] = useState(() => !(globalAnalyticsCache.hourlyBuckets && globalAnalyticsCache.hourlyBuckets.length > 0));
  const latestHourlyBucketRequestId =
    useRef(0);

  async function loadHourlyBuckets() {
    if (!restaurantId) return;

    const rangeKey = `${restaurantId}_${analyticsRange.start.toISOString()}_${analyticsRange.end.toISOString()}`;
    const requestId =
      ++latestHourlyBucketRequestId.current;

    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
      const demoBuckets = getDemoHourlyBuckets();
      globalAnalyticsCache.hourlyBuckets = demoBuckets;
      globalAnalyticsCache.hourlyRangeKey = rangeKey;
      setHourlyBucketData(demoBuckets);
      setHourlyBucketLoading(false);
      return;
    }

    if (globalAnalyticsCache.hourlyBuckets && globalAnalyticsCache.hourlyRangeKey === rangeKey) {
      setHourlyBucketData(globalAnalyticsCache.hourlyBuckets);
      setHourlyBucketLoading(false);
    } else {
      setHourlyBucketLoading(true);
    }

    try {
      const { data, error } =
        await supabase.rpc(
          "get_hourly_bucket_summary",
          {
            p_restaurant_id: restaurantId,
            p_start: analyticsRange.start.toISOString(),
            p_end: analyticsRange.end.toISOString(),
          }
        );

      if (error) throw error;

      const formatted = (
        data || []
      ).map((row: any) => {
        const orderCount =
          Number(row.order_count) || 0;
        const revenue =
          Number(row.revenue) || 0;
        const bucket = Number(
          row.bucket_start_hour
        );
        return {
          bucket,
          label:
            bucketRangeLabel(bucket),
          revenue,
          orderCount,
          aov: orderCount
            ? revenue / orderCount
            : 0,
          items:
            Number(
              row.items_sold
            ) || 0,
        };
      });

      if (
        requestId !==
        latestHourlyBucketRequestId.current
      ) {
        return;
      }

      globalAnalyticsCache.hourlyBuckets = formatted;
      globalAnalyticsCache.hourlyRangeKey = rangeKey;
      setHourlyBucketData(formatted);
    } catch (err: any) {
      console.error(
        "HOURLY BUCKET ERROR:",
        err.message || err
      );
    } finally {
      if (
        requestId ===
        latestHourlyBucketRequestId.current
      ) {
        setHourlyBucketLoading(false);
      }
    }
  }

  useEffect(() => {
    loadHourlyBuckets();
  }, [
    restaurantId,
    analyticsRange.start.getTime(),
    analyticsRange.end.getTime(),
  ]);

  type CategoryMetric =
    | "revenue"
    | "orders"
    | "aov"
    | "items";

  const [categoryMetric, setCategoryMetric] =
    useState<CategoryMetric>("items");
  const [categoryViewMode, setCategoryViewMode] =
    useState<"daily" | "weekday">("daily");
  // Categories are dynamic (whatever menu_items.category values show up in
  // the data), so there's no fixed list to seed this with. It starts empty
  // and the effect below auto-activates each category the first time it's
  // seen, while preserving any manual on/off toggles after that.
  const [activeCategories, setActiveCategories] =
    useState<Set<string>>(() => new Set());
  const knownCategoryNames = useRef<Set<string>>(new Set());

  type CategoryDay = {
    dateKey: string;
    label: string;
    categories: Record<
      string,
      { revenue: number; orders: number; items: number }
    >;
  };

  const [categoryDailyData, setCategoryDailyData] =
    useState<CategoryDay[]>([]);
  const [categoryLoading, setCategoryLoading] =
    useState(false);
  const latestCategoryRequestId = useRef(0);

  useEffect(() => {
    if (!restaurantId) return;

    const requestId = ++latestCategoryRequestId.current;

    async function loadCategoryHistory() {
      setCategoryLoading(true);

      const lookbackDays = 60;
      const historyStart = new Date();
      historyStart.setHours(0, 0, 0, 0);
      historyStart.setDate(historyStart.getDate() - lookbackDays);

      const fetchStart = new Date(Math.min(analyticsRange.start.getTime(), historyStart.getTime()));
      const fetchEnd = new Date(Math.max(analyticsRange.end.getTime(), Date.now() + 86400000));

      if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
        const demoCat = getDemoCategoryDailyBreakdown(
          fetchStart,
          fetchEnd
        );
        if (requestId === latestCategoryRequestId.current) {
          setCategoryDailyData(demoCat);
          setCategoryLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase.rpc(
          "get_category_daily_breakdown",
          {
            p_restaurant_id: restaurantId,
            p_start: fetchStart.toISOString(),
            p_end: fetchEnd.toISOString(),
          }
        );

        if (error) throw error;

        const byDate = new Map<string, CategoryDay>();

        (data || []).forEach((row: any) => {
          const dateKey: string = row.order_date;
          const dateValue = new Date(`${dateKey}T00:00:00`);
          const day =
            byDate.get(dateKey) || {
              dateKey,
              label: dateValue.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              }),
              categories: {},
            };

          day.categories[row.category] = {
            revenue: Number(row.revenue) || 0,
            orders: Number(row.order_count) || 0,
            items: Number(row.items_sold) || 0,
          };

          byDate.set(dateKey, day);
        });

        if (requestId === latestCategoryRequestId.current) {
          setCategoryDailyData(
            Array.from(byDate.values()).sort((a, b) =>
              a.dateKey.localeCompare(b.dateKey)
            )
          );
        }
      } catch (err: any) {
        console.error(
          "CATEGORY HISTORY ERROR:",
          err.message || err
        );

        if (requestId === latestCategoryRequestId.current) {
          setCategoryDailyData([]);
        }
      } finally {
        if (requestId === latestCategoryRequestId.current) {
          setCategoryLoading(false);
        }
      }
    }

    loadCategoryHistory();
  }, [
    restaurantId,
    analyticsRange.start.getTime(),
    analyticsRange.end.getTime(),
  ]);

  const categoryData = useMemo(() => {
    const names = new Set<string>();
    categoryDailyData.forEach((day) => {
      Object.keys(day.categories).forEach((name) => names.add(name));
    });
    // Include categories from today's live orders
    orders.forEach((o) => {
      (o.items || []).forEach((it) => {
        if (it.category) names.add(it.category);
      });
    });

    const zero = { revenue: 0, orders: 0, items: 0 };

    // Real-time live sales for each category today
    const todayCategoryMap = new Map<string, { revenue: number; orders: number; items: number }>();
    orders.forEach((o) => {
      const seenCatsInOrder = new Set<string>();
      (o.items || []).forEach((it) => {
        const cat = it.category || "Other";
        const cur = todayCategoryMap.get(cat) || { revenue: 0, orders: 0, items: 0 };
        cur.revenue += (it.price || 0) * (it.qty || 0);
        cur.items += (it.qty || 0);
        todayCategoryMap.set(cat, cur);
        seenCatsInOrder.add(cat);
      });
      seenCatsInOrder.forEach((cat) => {
        const cur = todayCategoryMap.get(cat)!;
        cur.orders += 1;
      });
    });

    const startIsoStr = analyticsRange.start.toISOString().split("T")[0];
    const endIsoStr = analyticsRange.end.toISOString().split("T")[0];
    const dailyFilteredDays = categoryDailyData.filter(
      (day) => day.dateKey >= startIsoStr && day.dateKey <= endIsoStr
    );

    const sortedCategories = Array.from(names)
      .map((name) => {
        // Daily timeline values
        const values = dailyFilteredDays.map((day) => {
          const total = day.categories[name] || zero;
          return categoryMetric === "revenue"
            ? total.revenue
            : categoryMetric === "orders"
              ? total.orders
              : categoryMetric === "aov"
                ? total.orders
                  ? Math.round(total.revenue / total.orders)
                  : 0
                : total.items;
        });

        // 7-Week Same Day at Same Time values (apples-to-apples comparison)
        const sameTime7WkValues = sevenWeeksSameDayData.map((wk, idx) => {
          let catVal = 0;
          let catFullVal = 0;

          if (wk.isToday) {
            const todayStats = todayCategoryMap.get(name) || zero;
            catVal =
              categoryMetric === "revenue"
                ? todayStats.revenue
                : categoryMetric === "orders"
                  ? todayStats.orders
                  : categoryMetric === "aov"
                    ? (todayStats.orders ? Math.round(todayStats.revenue / todayStats.orders) : 0)
                    : todayStats.items;
            catFullVal = catVal;
          } else {
            const targetDateStr = wk.date.toISOString().split("T")[0];
            const dayRecord = categoryDailyData.find((d) => d.dateKey === targetDateStr);
            const catStats = dayRecord?.categories[name] || zero;

            const fullCatRev = catStats.revenue;
            const fullCatOrders = catStats.orders;
            const fullCatItems = catStats.items;

            const timeRatio =
              wk.fullDayValue > 0
                ? Math.min(1, Math.max(0, wk.sameTimeValue / wk.fullDayValue))
                : Math.min(1, Math.max(0.1, nowMsIntoDay / 86400000));

            if (categoryMetric === "revenue") {
              catVal = Math.round(fullCatRev * timeRatio);
              catFullVal = fullCatRev;
            } else if (categoryMetric === "orders") {
              catVal = Math.max(0, Math.round(fullCatOrders * timeRatio));
              catFullVal = fullCatOrders;
            } else if (categoryMetric === "aov") {
              const sameOrders = Math.max(0, Math.round(fullCatOrders * timeRatio));
              const sameRev = Math.round(fullCatRev * timeRatio);
              catVal = sameOrders > 0 ? Math.round(sameRev / sameOrders) : (fullCatOrders > 0 ? Math.round(fullCatRev / fullCatOrders) : 0);
              catFullVal = fullCatOrders > 0 ? Math.round(fullCatRev / fullCatOrders) : 0;
            } else {
              catVal = Math.max(0, Math.round(fullCatItems * timeRatio));
              catFullVal = fullCatItems;
            }
          }

          const shortLabels = ["6 Wks", "5 Wks", "4 Wks", "3 Wks", "2 Wks", "Last Wk", "Today"];
          const shortLabel = wk.isToday ? "Today" : shortLabels[idx] || wk.relativeLabel;

          return {
            label: shortLabel,
            fullLabel: `${wk.label} (${shortLabel})`,
            dateKey: wk.dateKey,
            value: catVal,
            fullDayValue: catFullVal,
            isToday: wk.isToday,
          };
        });

        // Compute Power BI style linear trend across the 7 same-time weeks
        const catTrends = computeLinearTrend(sameTime7WkValues.map((v) => v.value));
        sameTime7WkValues.forEach((v, i) => {
          (v as any).trendLine = catTrends[i] ?? v.value;
        });

        const todayItem = sameTime7WkValues[6];
        const lwItem = sameTime7WkValues[5];
        const todayVal = todayItem?.value || 0;
        const lwVal = lwItem?.value || 0;
        const isLagging = lwVal > 0 ? todayVal < lwVal : false;
        const pctDiffVsLw = lwVal > 0 ? Math.round(((todayVal - lwVal) / lwVal) * 100) : 0;
        const sevenWkAvg = Math.round(
          sameTime7WkValues.reduce((s, v) => s + v.value, 0) / Math.max(1, sameTime7WkValues.length)
        );

        return {
          name,
          values,
          labels: dailyFilteredDays.map((day) => day.label),
          total: values.reduce((sum, value) => sum + value, 0),
          revenueTotal:
            dailyFilteredDays.reduce(
              (sum, day) => sum + (day.categories[name]?.revenue || 0),
              0
            ) + (todayCategoryMap.get(name)?.revenue || 0),
          sameTime7WkValues,
          todayVal,
          lwVal,
          isLagging,
          pctDiffVsLw,
          sevenWkAvg,
        };
      })
      .filter((category) => category.revenueTotal > 0)
      .sort((a, b) => b.revenueTotal - a.revenueTotal);

    return sortedCategories;
  }, [
    categoryDailyData,
    orders,
    categoryMetric,
    analyticsRange.start.getTime(),
    analyticsRange.end.getTime(),
    sevenWeeksSameDayData,
    nowMsIntoDay,
  ]);

  // Auto-activate any category the first time it's seen (including brand-new
  // ones added to the menu later), without clobbering a user's manual
  // on/off toggles for categories already known.
  useEffect(() => {
    const newlySeen = categoryData
      .map((c) => c.name)
      .filter((name) => !knownCategoryNames.current.has(name));

    if (newlySeen.length === 0) return;

    newlySeen.forEach((name) => knownCategoryNames.current.add(name));
    setActiveCategories((current) => {
      const next = new Set(current);
      newlySeen.forEach((name) => next.add(name));
      return next;
    });
  }, [categoryData]);

  const categoryMetricLabel = (metric: CategoryMetric) =>
    metric === "revenue"
      ? "Revenue"
      : metric === "orders"
        ? "Orders"
        : metric === "aov"
          ? "Avg Order Value"
          : "Items Sold";

  const categoryFormatter = (value: number) =>
    categoryMetric === "revenue" || categoryMetric === "aov"
      ? moneyCompact(value)
      : numberCompact(value);

  const selectedTrendEndDate = new Date(
    analyticsRange.end.getTime() - 86400000
  );
  const highlightedTrendWeekday = selectedTrendEndDate.getDay();
  const highlightedTrendLabel = selectedTrendEndDate.toLocaleDateString(
    "en-IN",
    { weekday: "short" }
  );

  const revenue =
    todayMetrics.revenue;
  const aov = todayMetrics.aov;
  const items = orders.reduce(
    (s, o) =>
      s +
      o.items.reduce(
        (x, i) => x + i.qty,
        0
      ),
    0
  );

  const productMap:
    Record<string, number> =
    {};

  orders.forEach(
    (o) =>
      o.items.forEach(
        (i) =>
          (productMap[
            i.name
          ] =
            (productMap[
              i.name
            ] || 0) +
            i.qty)
      )
  );

  const sourceMap:
    Record<string, number> =
    {};

  orders.forEach(
    (o) =>
      (sourceMap[
        o.source
      ] =
        (sourceMap[
          o.source
        ] || 0) + 1)
  );

  const sources =
    Object.entries(
      sourceMap
    ).map(
      ([
        channel,
        count,
      ]) => ({
        channel,
        orders: count,
      })
    );

  const products =
    Object.entries(
      productMap
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
      .slice(0, 5);

  const best =
    products[0];

  const visibleActiveCategoryCount =
    categoryData.filter((category) =>
      activeCategories.has(category.name)
    ).length;

  return (
    <>
      <div className="kpis">

        <Kpi
          title="Revenue today"
          value={money(
            revenue
          )}
          valueFormatter={
            moneyCompact
          }
          compareData={[
            {
              label: "Today",
              value: revenue,
              sameTimeValue: revenue,
            },
            {
              label: "Last wk",
              value:
                lastWeekMetricsFullDay.revenue,
              sameTimeValue:
                lastWeekMetricsSameTime.revenue,
            },
            {
              label: "7-wk avg",
              value:
                revenueWeeklyAvg,
              sameTimeValue:
                revenueWeeklyAvgSameTime,
            },
          ]}
        />

        <Kpi
          title="Total orders"
          value={String(
            orders.length
          )}
          valueFormatter={
            numberCompact
          }
          compareData={[
            {
              label: "Today",
              value: orders.length,
              sameTimeValue:
                orders.length,
            },
            {
              label: "Last wk",
              value:
                lastWeekMetricsFullDay.count,
              sameTimeValue:
                lastWeekMetricsSameTime.count,
            },
            {
              label: "7-wk avg",
              value:
                orderCountWeeklyAvg,
              sameTimeValue:
                orderCountWeeklyAvgSameTime,
            },
          ]}
        />

        <Kpi
          title="Avg order value"
          value={money(aov)}
          valueFormatter={
            moneyCompact
          }
          compareData={[
            {
              label: "Today",
              value: aov,
              sameTimeValue: aov,
            },
            {
              label: "Last wk",
              value:
                lastWeekMetricsFullDay.aov,
              sameTimeValue:
                lastWeekMetricsSameTime.aov,
            },
            {
              label: "7-wk avg",
              value: aovWeeklyAvg,
              sameTimeValue:
                aovWeeklyAvgSameTime,
            },
          ]}
        />

        <Kpi
          title="Items sold"
          value={String(items)}
          valueFormatter={
            numberCompact
          }
          compareData={[
            {
              label: "Today",
              value: items,
              sameTimeValue: items,
            },
            {
              label: "Last wk",
              value:
                lastWeekMetricsFullDay.items,
              sameTimeValue:
                lastWeekMetricsSameTime.items,
            },
            {
              label: "7-wk avg",
              value: itemsWeeklyAvg,
              sameTimeValue:
                itemsWeeklyAvgSameTime,
            },
          ]}
        />

      </div>

      <div className="card date-range-card">

        <div className="section-title">
          <div>
            <h2>
              Analytics Period
            </h2>
            <span>
              {analyticsRangeLabel()}
            </span>
          </div>
        </div>

        <div className="date-range-pills">
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["last7", "Last 7 Days"],
              ["last30", "Last 30 Days"],
              [
                "thisMonth",
                "This Month",
              ],
              [
                "lastMonth",
                "Last Month",
              ],
              ["thisYear", "This Year"],
              ["lastYear", "Last Year"],
              ["custom", "Custom"],
            ] as [
              AnalyticsRangePreset,
              string
            ][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={
                analyticsRangePreset ===
                key
                  ? "active"
                  : ""
              }
              onClick={() =>
                setAnalyticsRangePreset(
                  key
                )
              }
            >
              {label}
            </button>
          ))}
        </div>

        {analyticsRangePreset ===
          "custom" && (
          <div className="custom-range-inputs">
            <label>
              From
              <input
                type="date"
                value={
                  customRangeStart
                }
                max={customRangeEnd}
                onChange={(e) =>
                  setCustomRangeStart(
                    e.target.value
                  )
                }
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={
                  customRangeEnd
                }
                min={customRangeStart}
                max={
                  today
                    .toISOString()
                    .split("T")[0]
                }
                onChange={(e) =>
                  setCustomRangeEnd(
                    e.target.value
                  )
                }
              />
            </label>
          </div>
        )}

      </div>

      <div className="card">

        <div className="section-title">
          <div>
            <h2>
              {trendViewMode === "continuous"
                ? `${dayWiseMetricLabel(dayWiseMetric)} Trend`
                : `Weekday Analysis · Last 7 Weeks (${selectedWeekdayName}s)`}
            </h2>
            <span>
              {dayWiseLoading
                ? "Loading..."
                : trendViewMode === "weekday"
                  ? `Comparing ${selectedWeekdayName}s across the last 7 weeks (Same Time & Full Day)`
                  : `${dayWiseTrendData.length} day(s) · ${dayOfWeek}s highlighted · MTD baseline`}
            </span>
          </div>
        </div>

        <div className="trend-view-controls">
          <div className="trend-mode-toggle">
            <button
              type="button"
              className={trendViewMode === "continuous" ? "active" : ""}
              onClick={() => setTrendViewMode("continuous")}
            >
              <Calendar size={13} />
              <span>Continuous Days</span>
            </button>
            <button
              type="button"
              className={trendViewMode === "weekday" ? "active" : ""}
              onClick={() => setTrendViewMode("weekday")}
            >
              <TrendingUp size={13} />
              <span>By Weekday (Last 7 Weeks)</span>
            </button>
          </div>

          <div className="metric-pills" style={{ margin: 0 }}>
            <button
              className={
                dayWiseMetric ===
                "revenue"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setDayWiseMetric(
                  "revenue"
                )
              }
            >
              Revenue
            </button>
            <button
              className={
                dayWiseMetric ===
                "orderCount"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setDayWiseMetric(
                  "orderCount"
                )
              }
            >
              Orders
            </button>
            <button
              className={
                dayWiseMetric === "aov"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setDayWiseMetric("aov")
              }
            >
              Avg Order Value
            </button>
          </div>
        </div>

        {trendViewMode === "continuous" ? (
          <>
            <div className="trend-chart-legend">
              <span className="legend-item">
                <span className="legend-bar-swatch" />
                Daily Actual ({dayWiseMetricLabel(dayWiseMetric)})
              </span>
              <span className="legend-item">
                <span className="legend-line-swatch" />
                {dayWiseMetric === "orderCount"
                  ? "3-Wk Same Day Avg Orders (MTD)"
                  : "3-Wk Same Day Avg (MTD)"}
              </span>
            </div>

            <div className="chart">
              <ResponsiveContainer
                width="100%"
                height={300}
              >
                <ComposedChart
                  data={displayTrendChartData}
                >
                  <defs>
                    <linearGradient
                      id={
                        REVENUE_HIGHLIGHT_GRADIENT_ID
                      }
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#fb923c"
                      />
                      <stop
                        offset="100%"
                        stopColor="#ea580c"
                      />
                    </linearGradient>
                    <linearGradient
                      id={
                        REVENUE_MUTED_GRADIENT_ID
                      }
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#c7d2fe"
                      />
                      <stop
                        offset="100%"
                        stopColor="#a5b4fc"
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    interval={
                      displayTrendChartData.length > 15
                        ? Math.ceil(
                            displayTrendChartData.length /
                              15
                          )
                        : 0
                    }
                  />
                  <YAxis
                    fontSize={12}
                  />
                  <Tooltip
                    formatter={(
                      v: any,
                      name: any
                    ) => [
                      dayWiseValueFormatter(
                        Number(v)
                      ),
                      name === "mtdBaseline"
                        ? (dayWiseMetric === "orderCount"
                            ? "3-Wk Same Day Avg Orders (MTD)"
                            : "3-Wk Same Day Avg (MTD)")
                        : dayWiseMetricLabel(dayWiseMetric),
                    ]}
                    labelFormatter={(
                      label,
                      payload
                    ) => {
                      const entry = payload?.[0]?.payload;
                      if (entry?.fullLabel) {
                        return entry.fullLabel;
                      }
                      const weekday =
                        entry?.weekday;
                      const dayName =
                        typeof weekday ===
                        "number"
                          ? [
                              "Sun",
                              "Mon",
                              "Tue",
                              "Wed",
                              "Thu",
                              "Fri",
                              "Sat",
                            ][weekday]
                          : "";
                      return `${label} (${dayName})`;
                    }}
                  />
                  <Bar
                    dataKey={dayWiseMetric}
                    radius={[
                      4, 4, 0, 0,
                    ]}
                  >
                    {displayTrendChartData.map(
                      (entry) => {
                        const isSelectedWeekday =
                          entry.weekday ===
                          highlightedTrendWeekday;
                        return (
                          <Cell
                            key={
                              entry.dateKey
                            }
                            fill={
                              isSelectedWeekday
                                ? `url(#${REVENUE_HIGHLIGHT_GRADIENT_ID})`
                                : `url(#${REVENUE_MUTED_GRADIENT_ID})`
                            }
                            stroke={
                              entry.isToday
                                ? REVENUE_TODAY_STROKE
                                : undefined
                            }
                            strokeWidth={
                              entry.isToday
                                ? 2
                                : 0
                            }
                          />
                        );
                      }
                    )}
                    <LabelList
                      dataKey={
                        dayWiseMetric
                      }
                      position="top"
                      formatter={(
                        v: any
                      ) =>
                        dayWiseValueFormatter(
                          Number(v)
                        )
                      }
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        fill: "#4b5563",
                      }}
                    />
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="mtdBaseline"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    dot={{
                      r: 3.5,
                      fill: "#6366f1",
                      strokeWidth: 0,
                    }}
                    activeDot={{ r: 6 }}
                    name={
                      dayWiseMetric === "orderCount"
                        ? "3-Wk Same Day Avg Orders (MTD)"
                        : "3-Wk Same Day Avg (MTD)"
                    }
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="weekday-legend">
              <span className="weekday-legend-item">
                <span
                  className="weekday-legend-swatch"
                  style={{
                    background:
                      "linear-gradient(180deg, #fb923c, #ea580c)",
                  }}
                />
                {highlightedTrendLabel}s (selected end-date weekday)
              </span>
              <span className="weekday-legend-item">
                <span
                  className="weekday-legend-swatch"
                  style={{
                    background:
                      "linear-gradient(180deg, #c7d2fe, #a5b4fc)",
                  }}
                />
                Other days
              </span>
            </div>
          </>
        ) : (
          <div>
            {/* Weekday Selector Bar */}
            <div className="weekday-selector-bar">
              <span className="weekday-selector-title">Select Day to Compare:</span>
              {WEEKDAYS_LIST.map((w) => {
                const isSelected = selectedWeekdayFilter === w.dayIdx;
                const isDayToday = w.dayIdx === currentDayOfWeek;
                return (
                  <button
                    key={w.dayIdx}
                    type="button"
                    className={`weekday-pill-btn ${isSelected ? "active" : ""}`}
                    onClick={() => setSelectedWeekdayFilter(w.dayIdx)}
                  >
                    <span>{w.name}</span>
                    {isDayToday && <span className="today-tag">Today</span>}
                  </button>
                );
              })}
            </div>

            {/* Dual 7-Week Charts: Same Time & Full Day */}
            <div className="weekday-dual-charts-grid">
              {/* Chart 1: Same Day Same Time */}
              <div className="weekday-chart-card">
                <div className="weekday-chart-head">
                  <div>
                    <h3>Last 7 Weeks · Same Time ({selectedWeekdayName})</h3>
                    <p>
                      Apples-to-apples performance up to{" "}
                      {today.toLocaleTimeString("en-IN", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      cutoff
                    </p>
                  </div>
                  {latestWeekItem?.isToday && (
                    <span
                      className={`weekday-status-pill ${
                        latestWeekItem.isLaggingSameTime ? "neg" : "pos"
                      }`}
                    >
                      {latestWeekItem.isLaggingSameTime ? "▼" : "▲"}{" "}
                      {Math.abs(latestWeekItem.pctDiffVsLwSameTime)}% vs Last Wk
                    </span>
                  )}
                </div>

                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={sevenWeeksSameDayData}
                      margin={{ top: 16, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#f1f5f9"
                      />
                      <XAxis dataKey="label" fontSize={10.5} tickLine={false} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(val: any, name: any) => [
                          dayWiseValueFormatter(Number(val)),
                          name === "sameTimeTrend"
                            ? "Trend line"
                            : "Same-Time Actual",
                        ]}
                        labelFormatter={(label, payload) => {
                          const item = payload?.[0]?.payload;
                          return `${item?.relativeLabel || label} (${item?.label || ""})`;
                        }}
                      />
                      <Bar dataKey="sameTimeValue" radius={[4, 4, 0, 0]}>
                        {sevenWeeksSameDayData.map((entry, idx) => {
                          let barColor = "#475569";
                          if (entry.isToday) {
                            barColor = entry.isLaggingSameTime
                              ? "#ef4444"
                              : "#10b981";
                          } else if (idx === 5) {
                            barColor = "#334155";
                          }
                          return <Cell key={entry.dateKey} fill={barColor} />;
                        })}
                        <LabelList
                          dataKey="sameTimeValue"
                          position="top"
                          formatter={(v: any) =>
                            dayWiseValueFormatter(Number(v))
                          }
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            fill: "#475569",
                          }}
                        />
                      </Bar>
                      <Line
                        type="linear"
                        dataKey="sameTimeTrend"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Trend line"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div
                  className="trend-chart-legend"
                  style={{ marginTop: 10, marginBottom: 0 }}
                >
                  <span className="legend-item">
                    <span
                      className="legend-bar-swatch"
                      style={{
                        background: latestWeekItem?.isToday
                          ? latestWeekItem.isLaggingSameTime
                            ? "#ef4444"
                            : "#10b981"
                          : "#475569",
                      }}
                    />
                    {latestWeekItem?.isToday
                      ? "Today (Live Cutoff)"
                      : "Same-Time Actual"}
                  </span>
                  <span className="legend-item">
                    <span
                      className="legend-bar-swatch"
                      style={{ background: "#475569" }}
                    />
                    Prior Weeks
                  </span>
                  <span className="legend-item">
                    <span
                      className="legend-line-swatch"
                      style={{ borderColor: "#f59e0b", borderTop: "2px dashed #f59e0b" }}
                    />
                    Trend line
                  </span>
                </div>
              </div>

              {/* Chart 2: Same Day Full Day */}
              <div className="weekday-chart-card">
                <div className="weekday-chart-head">
                  <div>
                    <h3>Last 7 Weeks · Full Day ({selectedWeekdayName})</h3>
                    <p>Full day closing numbers & Today&apos;s projected finish</p>
                  </div>
                  {latestWeekItem?.isToday && (
                    <span
                      className="weekday-status-pill pos"
                      style={{ background: "#eff6ff", color: "#1d4ed8" }}
                    >
                      Pacing to{" "}
                      {dayWiseValueFormatter(latestWeekItem.projectedTotal)}
                    </span>
                  )}
                </div>

                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={sevenWeeksSameDayData}
                      margin={{ top: 16, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#f1f5f9"
                      />
                      <XAxis dataKey="label" fontSize={10.5} tickLine={false} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(val: any, name: any) => [
                          dayWiseValueFormatter(Number(val)),
                          name === "fullDayValue"
                            ? "Full Day Total (or Actual so far)"
                            : name === "projectedRemaining"
                              ? "Projected Evening Pace"
                              : "Trend line",
                        ]}
                        labelFormatter={(label, payload) => {
                          const item = payload?.[0]?.payload;
                          return `${item?.relativeLabel || label} (${item?.label || ""})`;
                        }}
                      />
                      <Bar
                        dataKey="fullDayValue"
                        stackId="fullDayStack"
                        radius={[4, 4, 0, 0]}
                      >
                        {sevenWeeksSameDayData.map((entry, idx) => {
                          let barColor = "#475569";
                          if (entry.isToday) {
                            barColor = entry.isLaggingSameTime
                              ? "#ef4444"
                              : "#10b981";
                          } else if (idx === 5) {
                            barColor = "#334155";
                          }
                          return <Cell key={entry.dateKey} fill={barColor} />;
                        })}
                        <LabelList
                          dataKey="fullDayValue"
                          position="top"
                          formatter={(v: any) =>
                            dayWiseValueFormatter(Number(v))
                          }
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            fill: "#334155",
                          }}
                        />
                      </Bar>
                      <Bar
                        dataKey="projectedRemaining"
                        stackId="fullDayStack"
                        fill="#cbd5e1"
                        radius={[4, 4, 0, 0]}
                        name="Projected Evening Pace"
                      />
                      <Line
                        type="linear"
                        dataKey="fullDayTrend"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Trend line"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div
                  className="trend-chart-legend"
                  style={{ marginTop: 10, marginBottom: 0 }}
                >
                  <span className="legend-item">
                    <span
                      className="legend-bar-swatch"
                      style={{ background: "#475569" }}
                    />
                    Full Day Actual
                  </span>
                  <span className="legend-item">
                    <span
                      className="legend-bar-swatch"
                      style={{ background: "#cbd5e1" }}
                    />
                    Projected Finish
                  </span>
                  <span className="legend-item">
                    <span
                      className="legend-line-swatch"
                      style={{ borderColor: "#f59e0b", borderTop: "2px dashed #f59e0b" }}
                    />
                    Trend line
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      <div className="card category-performance-card">

        <div className="section-title">
          <div>
            <h2>
              {categoryMetricLabel(categoryMetric)} by Category
            </h2>
            <span>
              {categoryLoading
                ? "Loading category history..."
                : categoryViewMode === "weekday"
                  ? `Same time performance across last 7 ${selectedWeekdayName}s (Cutoff: ${today.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })})`
                  : `${analyticsRangeLabel()} · one trend per menu category`}
            </span>
          </div>
        </div>

        <div className="trend-view-controls" style={{ marginBottom: 12 }}>
          <div className="trend-mode-toggle">
            <button
              type="button"
              className={categoryViewMode === "daily" ? "active" : ""}
              onClick={() => setCategoryViewMode("daily")}
            >
              <Calendar size={13} />
              <span>Daily Timeline</span>
            </button>
            <button
              type="button"
              className={categoryViewMode === "weekday" ? "active" : ""}
              onClick={() => setCategoryViewMode("weekday")}
            >
              <TrendingUp size={13} />
              <span>Same Time (Last 7 {selectedWeekdayName}s)</span>
            </button>
          </div>

          <div className="metric-pills category-metric-pills" style={{ margin: 0 }}>
            {(
              [
                ["revenue", "Revenue"],
                ["orders", "Orders"],
                ["aov", "Avg Order Value"],
                ["items", "Items Sold"],
              ] as [CategoryMetric, string][]
            ).map(([metric, label]) => (
              <button
                key={metric}
                className={categoryMetric === metric ? "active" : ""}
                onClick={() => setCategoryMetric(metric)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Weekday Selector Pills when in Weekday Mode */}
        {categoryViewMode === "weekday" && (
          <div className="weekday-selector-bar" style={{ margin: "4px 0 12px" }}>
            <span className="weekday-selector-title">Compare Last 7:</span>
            {WEEKDAYS_LIST.map((w) => {
              const isSelected = selectedWeekdayFilter === w.dayIdx;
              const isDayToday = w.dayIdx === currentDayOfWeek;
              return (
                <button
                  key={w.dayIdx}
                  type="button"
                  className={`weekday-pill-btn ${isSelected ? "active" : ""}`}
                  onClick={() => setSelectedWeekdayFilter(w.dayIdx)}
                >
                  <span>{w.name}</span>
                  {isDayToday && <span className="today-tag">Today</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend for 7-Week Same Time Bars */}
        {categoryViewMode === "weekday" && (
          <div className="trend-chart-legend" style={{ margin: "2px 0 12px 2px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#10b981",
                  display: "inline-block",
                }}
              />
              Today (Ahead / On Track vs Last Week)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#ef4444",
                  display: "inline-block",
                }}
              />
              Today (Lagging vs Last Week)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#334155",
                  display: "inline-block",
                }}
              />
              Last Week (Same Time)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#64748b",
                  display: "inline-block",
                }}
              />
              Prior Weeks (Same Time)
            </span>
          </div>
        )}

        <div className="category-filter-pills">
          {categoryData.map(({ name }) => (
            <button
              key={name}
              className={activeCategories.has(name) ? "active" : ""}
              onClick={() => {
                if (
                  activeCategories.has(name) &&
                  visibleActiveCategoryCount === 1
                ) {
                  return;
                }

                setActiveCategories((current) => {
                  const next = new Set(current);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                });
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="category-grid">
          {categoryData
            .filter((category) => activeCategories.has(category.name))
            .map((category, index) => {
              const chartData =
                categoryViewMode === "weekday"
                  ? category.sameTime7WkValues
                  : category.values.map((value, idx) => ({
                      value,
                      label: category.labels[idx],
                      isToday: false,
                    }));

              const totalDisplay =
                categoryViewMode === "weekday" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 700, color: "#0f172a" }}>
                      {categoryFormatter(category.todayVal)} Today
                    </span>
                    {category.lwVal > 0 && (
                      <span
                        className={`weekday-status-pill ${
                          category.isLagging ? "neg" : "pos"
                        }`}
                        style={{ fontSize: 10, padding: "2px 6px" }}
                      >
                        {category.isLagging ? "▼" : "▲"}{" "}
                        {Math.abs(category.pctDiffVsLw)}% vs LW
                      </span>
                    )}
                  </div>
                ) : (
                  <span>{categoryFormatter(category.total)} total</span>
                );

              return (
                <div
                  className={
                    categoryData.length === 3 && index === 0
                      ? "category-chart-card category-chart-card-featured"
                      : "category-chart-card"
                  }
                  key={category.name}
                >
                  <div className="category-chart-head">
                    <b>{category.name}</b>
                    {totalDisplay}
                  </div>
                  <div className="category-mini-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 24, right: 0, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id={`categoryGradient-${category.name.replace(/\W/g, "")}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="0%" stopColor="#e2a034" />
                            <stop offset="100%" stopColor="#a8402a" />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#6b5d48" }}
                          axisLine={{ stroke: "#dccfb4" }}
                          tickLine={false}
                        />
                        <YAxis hide />
                        <Tooltip
                          formatter={(value: any, name: any) => [
                            categoryFormatter(Number(value)),
                            name === "trendLine"
                              ? "Trend line"
                              : categoryMetricLabel(categoryMetric),
                          ]}
                          labelFormatter={(label: any, items: any) => {
                            if (categoryViewMode === "weekday" && items?.[0]?.payload?.fullLabel) {
                              return items[0].payload.fullLabel;
                            }
                            return String(label);
                          }}
                        />
                        <Bar
                          dataKey="value"
                          radius={[4, 4, 0, 0]}
                        >
                          {chartData.map((entry: any, i: number) => {
                            let barColor = `url(#categoryGradient-${category.name.replace(/\W/g, "")})`;
                            if (categoryViewMode === "weekday") {
                              if (entry.isToday) {
                                barColor = category.isLagging ? "#ef4444" : "#10b981";
                              } else if (i === 5) {
                                barColor = "#334155"; // Last Week
                              } else {
                                barColor = "#64748b"; // Prior weeks
                              }
                            }
                            return (
                              <Cell
                                key={`cat-cell-${category.name}-${i}`}
                                fill={barColor}
                              />
                            );
                          })}
                          <LabelList
                            dataKey="value"
                            position="top"
                            formatter={(value: any) =>
                              categoryFormatter(Number(value))
                            }
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              fill: "#2b2013",
                            }}
                          />
                        </Bar>
                        {categoryViewMode === "weekday" && (
                          <Line
                            type="linear"
                            dataKey="trendLine"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            strokeDasharray="4 3"
                            dot={false}
                            name="Trend line"
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
        </div>

      </div>

    </>
  );
}

/* =========================================================
   KPI
========================================================= */

type KpiCompareDatum = {
  label: string;
  value: number;
  sameTimeValue: number;
};

const KPI_COMPARE_COLORS = [
  "#5b5ce2",
  "#f59e0b",
  "#14b8a6",
];

function Kpi({
  title,
  value,
  compareData,
  valueFormatter,
  delta,
  good,
}: {
  title: string;
  value: string;
  compareData?: KpiCompareDatum[];
  valueFormatter?: (
    v: number
  ) => string;
  delta?: string;
  good?: boolean;
}) {
  const format = (v: any) =>
    valueFormatter
      ? valueFormatter(Number(v))
      : String(v);

  const safeId = title.replace(
    /[^a-zA-Z0-9]/g,
    ""
  );

  // Compare Today (index 0) with Last Week (index 1)
  const todayVal = compareData?.[0]?.sameTimeValue ?? compareData?.[0]?.value ?? 0;
  const lwVal = compareData?.[1]?.sameTimeValue ?? compareData?.[1]?.value ?? 0;
  const isPerformingPoorly = lwVal > 0 ? todayVal < lwVal : false;
  const pctDiff = lwVal > 0 ? Math.round(((todayVal - lwVal) / lwVal) * 100) : 0;

  // Dynamic & Coherent Colors:
  // Bar 0 (Today): RED if underperforming vs LW, else GREEN
  // Bar 1 (Last Week): Refined Slate Blue
  // Bar 2 (7-Wk Avg): Neutral Cool Slate Gray
  const getKpiBarColor = (index: number) => {
    if (index === 0) {
      return isPerformingPoorly ? "#ef4444" : "#10b981";
    }
    if (index === 1) {
      return "#475569"; // Slate Blue
    }
    return "#94a3b8"; // Cool Gray
  };

  return (
    <div className="card kpi">

      <span className="kpi-title">
        {title}
      </span>

      <strong>
        {value}
      </strong>

      {compareData && compareData.length >= 2 && lwVal > 0 && (
        <div style={{ marginTop: 2, marginBottom: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11.5,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 6,
              background: isPerformingPoorly ? "#fee2e2" : "#dcfce7",
              color: isPerformingPoorly ? "#b91c1c" : "#15803d",
            }}
          >
            {isPerformingPoorly ? "▼" : "▲"}{" "}
            {Math.abs(pctDiff)}% vs Last Wk
          </span>
        </div>
      )}

      {delta && !compareData && (
        <span className={good ? "positive" : "trend-delta neutral"}>
          {delta}
        </span>
      )}

      {compareData && (
        <div className="kpi-compare-chart">

          <div className="kpi-compare-caption">
            <span className="kpi-caption-item">
              <span
                className="kpi-caption-swatch bar"
                style={{
                  backgroundColor: isPerformingPoorly ? "#ef4444" : "#10b981",
                }}
              />
              Today ({isPerformingPoorly ? "Lagging" : "Ahead"})
            </span>
            <span className="kpi-caption-item">
              <span
                className="kpi-caption-swatch bar"
                style={{ backgroundColor: "#475569" }}
              />
              Last wk
            </span>
            <span className="kpi-caption-item">
              <span
                className="kpi-caption-swatch bar"
                style={{ backgroundColor: "#94a3b8" }}
              />
              7-wk avg
            </span>
          </div>

          <ResponsiveContainer
            width="100%"
            height={155}
          >
            <BarChart
              data={compareData}
              margin={{
                top: 22,
                right: 8,
                left: 8,
                bottom: 0,
              }}
            >
              <defs>
                {compareData.map(
                  (d, i) => {
                    const color = getKpiBarColor(i);
                    return (
                      <linearGradient
                        key={`kpi-grad-${d.label}`}
                        id={`kpiBarGradient-${safeId}-${i}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={color}
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          stopColor={color}
                          stopOpacity={0.75}
                        />
                      </linearGradient>
                    );
                  }
                )}
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#f1f5f9"
              />

              <XAxis
                dataKey="label"
                fontSize={11}
                axisLine={false}
                tickLine={false}
              />

              <YAxis hide />

              <Tooltip
                formatter={(v: any) => [format(v), "Performance"]}
                contentStyle={{
                  borderRadius: 8,
                  fontSize: 12,
                  border: "1px solid #e2e8f0",
                }}
              />

              <Bar
                dataKey="value"
                radius={[5, 5, 0, 0]}
                maxBarSize={48}
              >
                {compareData.map(
                  (d, i) => (
                    <Cell
                      key={d.label}
                      fill={`url(#kpiBarGradient-${safeId}-${i})`}
                    />
                  )
                )}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={format}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    fill: "#334155",
                  }}
                />
              </Bar>

            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}

/* =========================================================
   SUPER ADMIN - RESTAURANTS
========================================================= */

function RestaurantsPanel({
  restaurants,
  onCreated,
}: {
  restaurants: RestaurantRow[];
  onCreated: (
    r: RestaurantRow
  ) => void;
}) {
  const [name, setName] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  async function createRestaurant() {
    if (!name.trim()) {
      alert(
        "Enter a restaurant name."
      );
      return;
    }

    setSaving(true);

    try {
      const {
        data,
        error,
      } = await supabase
        .from("restaurants")
        .insert({
          name: name.trim(),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      onCreated({
        id: data.id,
        name: data.name,
      });

      setName("");
    } catch (err: any) {
      console.error(
        "CREATE RESTAURANT ERROR:",
        err
      );

      alert(
        err?.message ||
          "Could not create restaurant."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="kpis">

        <Kpi
          title="Restaurants"
          value={String(
            restaurants.length
          )}
          delta="On the platform"
          good
        />

        <Kpi
          title="Active"
          value={String(
            restaurants.length
          )}
          delta="Live"
          good
        />

      </div>

      <div className="card">

        <div className="section-title">

          <div>
            <h2>
              Create restaurant
            </h2>

            <span>
              Add a new restaurant
              to the platform
            </span>
          </div>

        </div>

        <div className="inline-form">

          <input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
            placeholder="Restaurant name"
            onKeyDown={(e) =>
              e.key ===
                "Enter" &&
              createRestaurant()
            }
          />

          <button
            className="primary-btn"
            onClick={
              createRestaurant
            }
            disabled={saving}
          >
            {saving
              ? "Creating..."
              : "Create restaurant"}
          </button>

        </div>

      </div>

      <div className="card table-card">

        <div className="section-title">

          <div>

            <h2>
              Restaurant management
            </h2>

            <span>
              All restaurants
            </span>

          </div>

        </div>

        <table>

          <thead>

            <tr>
              <th>
                Restaurant
              </th>

              <th>
                Status
              </th>
            </tr>

          </thead>

          <tbody>

            {restaurants.length ===
            0 ? (
              <tr>
                <td colSpan={2}>
                  No restaurants yet.
                </td>
              </tr>
            ) : (
              restaurants.map(
                (r) => (
                  <tr
                    key={r.id}
                  >
                    <td>
                      <b>
                        {r.name}
                      </b>
                    </td>

                    <td>
                      <span className="status">
                        Active
                      </span>
                    </td>
                  </tr>
                )
              )
            )}

          </tbody>

        </table>

      </div>
    </>
  );
}

/* =========================================================
   SUPER ADMIN - USERS
========================================================= */

function UsersPanel({
  restaurants,
}: {
  restaurants: RestaurantRow[];
}) {
  const [name, setName] =
    useState("");

  const [phone, setPhone] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [role, setRole] =
    useState<
      "ADMIN" | "POC"
    >("ADMIN");

  const [restaurantId, setRestaurantId] =
    useState(
      restaurants[0]?.id ||
        ""
    );

  const [users, setUsers] =
    useState<UserRow[]>([]);

  const [saving, setSaving] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [filterSearch, setFilterSearch] =
    useState("");
  const [filterRestaurantId, setFilterRestaurantId] =
    useState<string>("ALL");
  const [filterRole, setFilterRole] =
    useState<"ALL" | "ADMIN" | "POC">("ALL");
  const [filterStatus, setFilterStatus] =
    useState<"ALL" | "ACTIVE" | "DISABLED">(
      "ALL"
    );

  const [togglingUserId, setTogglingUserId] =
    useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (
      !restaurantId &&
      restaurants[0]
    ) {
      setRestaurantId(
        restaurants[0].id
      );
    }
  }, [restaurants]);

  async function loadUsers() {
    setLoading(true);

    const {
      data,
      error,
    } = await supabase
      .from("users")
      .select(`
        id,
        name,
        phone,
        email,
        role,
        restaurant_id,
        is_active,
        auth_user_id,
        restaurants (
          name
        )
      `)
      .neq(
        "role",
        "SUPER_ADMIN"
      )
      .order("name");

    if (error) {
      console.error(
        "LOAD USERS ERROR:",
        error
      );
    }

    setUsers(
      (data || []) as unknown as UserRow[]
    );

    setLoading(false);
  }

  async function createUser() {
    if (
      !name.trim() ||
      !phone.trim() ||
      !email.trim() ||
      !password ||
      !restaurantId
    ) {
      alert(
        "Fill in name, phone number, email, password and restaurant. Email is required since login is email-only."
      );
      return;
    }

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Your session has expired. Please log in again."
        );
      }

      const response = await fetch(
        "/api/admin/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            password,
            role,
            restaurantId,
          }),
        }
      );

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      let result: any = {};
      if (
        contentType.includes(
          "application/json"
        )
      ) {
        result = await response.json();
      } else {
        const rawText =
          await response.text();
        console.error(
          "Non-JSON response from /api/admin/users — status:",
          response.status,
          "body:",
          rawText.slice(0, 300)
        );
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "The user creation endpoint (/api/admin/users) was not found (404). Check that app/api/admin/users/route.ts exists and is deployed."
              : `Server returned an unexpected response (status ${response.status}).`
          );
        }
      }

      if (!response.ok) {
        throw new Error(
          result.error || "Could not create user."
        );
      }

      setName("");
      setPhone("");
      setEmail("");
      setPassword("");

      await loadUsers();

      alert(
        "User created successfully."
      );
    } catch (err: any) {
      console.error(
        "CREATE USER ERROR:",
        err
      );

      alert(
        err?.message ||
          "Could not create user."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleUserActive(
    user: UserRow
  ) {
    const nextActive = !user.is_active;

    const confirmed = window.confirm(
      nextActive
        ? `Re-enable ${user.name}'s login?`
        : `Disable ${user.name}'s login? They won't be able to sign in or view data until re-enabled.`
    );
    if (!confirmed) return;

    setTogglingUserId(user.id);

    setUsers((prev) =>
      prev.map((u) =>
        u.id === user.id
          ? { ...u, is_active: nextActive }
          : u
      )
    );

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Your session has expired. Please log in again."
        );
      }

      const response = await fetch(
        `/api/admin/users/${user.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            isActive: nextActive,
          }),
        }
      );

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !contentType.includes(
          "application/json"
        )
      ) {
        const rawText =
          await response.text();
        console.error(
          "Non-JSON response from /api/admin/users/:id — status:",
          response.status,
          "body:",
          rawText.slice(0, 300)
        );
        throw new Error(
          response.status === 404
            ? "The enable/disable endpoint isn't set up on the server yet (404). Check that app/api/admin/users/[id]/route.ts exists."
            : `Server returned an unexpected response (status ${response.status}).`
        );
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Could not update this user."
        );
      }
    } catch (err: any) {
      console.error(
        "TOGGLE USER ACTIVE ERROR:",
        err
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? { ...u, is_active: user.is_active }
            : u
        )
      );

      alert(
        err?.message ||
          "Could not update this user."
      );
    } finally {
      setTogglingUserId(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const search = filterSearch
      .trim()
      .toLowerCase();

    return users.filter((u) => {
      if (
        filterRestaurantId !== "ALL" &&
        u.restaurant_id !==
          filterRestaurantId
      ) {
        return false;
      }

      if (
        filterRole !== "ALL" &&
        u.role !== filterRole
      ) {
        return false;
      }

      if (
        filterStatus === "ACTIVE" &&
        u.is_active === false
      ) {
        return false;
      }

      if (
        filterStatus === "DISABLED" &&
        u.is_active !== false
      ) {
        return false;
      }

      if (search) {
        const haystack = [
          u.name,
          u.phone,
          u.email,
          u.restaurants?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }, [
    users,
    filterSearch,
    filterRestaurantId,
    filterRole,
    filterStatus,
  ]);

  return (
    <>
      <div className="card">

        <div className="section-title">

          <div>

            <h2>
              Create Admin or POC login
            </h2>

            <span>
              Give someone access to
              a restaurant
            </span>

          </div>

        </div>

        <div className="user-form">

          <input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
            placeholder="Full name"
          />

          <input
            value={phone}
            onChange={(e) =>
              setPhone(
                e.target.value
              )
            }
            placeholder="Phone number"
          />

          <input
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            type="email"
            placeholder="Email (required for login)"
          />

          <input
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            type="password"
            placeholder="Temporary password"
          />

          <select
            value={role}
            onChange={(e) =>
              setRole(
                e.target.value as
                  | "ADMIN"
                  | "POC"
              )
            }
          >
            <option value="ADMIN">
              Admin
            </option>

            <option value="POC">
              POC
            </option>
          </select>

          <select
            value={restaurantId}
            onChange={(e) =>
              setRestaurantId(
                e.target.value
              )
            }
          >

            {restaurants.length ===
              0 && (
              <option value="">
                Create a restaurant
                first
              </option>
            )}

            {restaurants.map(
              (r) => (
                <option
                  key={r.id}
                  value={r.id}
                >
                  {r.name}
                </option>
              )
            )}

          </select>

          <button
            className="primary-btn"
            onClick={
              createUser
            }
            disabled={
              saving ||
              !restaurants.length
            }
          >

            <UserPlus
              size={16}
            />

            {saving
              ? "Creating..."
              : "Create login"}

          </button>

        </div>

      </div>

      <div className="card table-card">

        <div className="section-title">

          <div>

            <h2>
              Restaurant users
            </h2>

            <span>
              Admin and POC
              accounts
            </span>

          </div>

        </div>

        <div className="user-filters">

          <div className="user-filters-search">
            <Search size={16} />
            <input
              value={filterSearch}
              onChange={(e) =>
                setFilterSearch(
                  e.target.value
                )
              }
              placeholder="Search name, phone, email, restaurant"
            />
          </div>

          <select
            value={filterRestaurantId}
            onChange={(e) =>
              setFilterRestaurantId(
                e.target.value
              )
            }
          >
            <option value="ALL">
              All restaurants
            </option>
            {restaurants.map((r) => (
              <option
                key={r.id}
                value={r.id}
              >
                {r.name}
              </option>
            ))}
          </select>

          <select
            value={filterRole}
            onChange={(e) =>
              setFilterRole(
                e.target.value as
                  | "ALL"
                  | "ADMIN"
                  | "POC"
              )
            }
          >
            <option value="ALL">
              All roles
            </option>
            <option value="ADMIN">
              Admin
            </option>
            <option value="POC">
              POC
            </option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(
                e.target.value as
                  | "ALL"
                  | "ACTIVE"
                  | "DISABLED"
              )
            }
          >
            <option value="ALL">
              All statuses
            </option>
            <option value="ACTIVE">
              Active
            </option>
            <option value="DISABLED">
              Disabled
            </option>
          </select>

          {(filterSearch ||
            filterRestaurantId !==
              "ALL" ||
            filterRole !== "ALL" ||
            filterStatus !==
              "ALL") && (
            <button
              className="ghost-btn"
              onClick={() => {
                setFilterSearch("");
                setFilterRestaurantId(
                  "ALL"
                );
                setFilterRole("ALL");
                setFilterStatus("ALL");
              }}
            >
              Clear filters
            </button>
          )}

        </div>

        <table>

          <thead>

            <tr>

              <th>
                Name
              </th>

              <th>
                Phone
              </th>

              <th>
                Email
              </th>

              <th>
                Role
              </th>

              <th>
                Restaurant
              </th>

              <th>
                Status
              </th>

              <th>
                Actions
              </th>

            </tr>

          </thead>

          <tbody>

            {loading ? (
              <tr>
                <td colSpan={7}>
                  Loading...
                </td>
              </tr>
            ) : filteredUsers.length ===
              0 ? (
              <tr>
                <td colSpan={7}>
                  {users.length === 0
                    ? "No users created yet."
                    : "No users match these filters."}
                </td>
              </tr>
            ) : (
              filteredUsers.map(
                (u) => (
                  <tr
                    key={u.id}
                  >

                    <td>
                      <b>
                        {u.name}
                      </b>
                    </td>

                    <td>
                      {u.phone ||
                        "—"}
                    </td>

                    <td>
                      {u.email ||
                        "—"}
                    </td>

                    <td>
                      {u.role ===
                      "ADMIN"
                        ? "Admin"
                        : "POC"}
                    </td>

                    <td>
                      {u.restaurants
                        ?.name ||
                        "—"}
                    </td>

                    <td>
                      <span
                        className={
                          u.is_active ===
                          false
                            ? "status disabled"
                            : "status"
                        }
                      >
                        {u.is_active ===
                        false
                          ? "Disabled"
                          : "Active"}
                      </span>
                    </td>

                    <td>
                      <button
                        className={
                          u.is_active ===
                          false
                            ? "icon-action-btn enable"
                            : "icon-action-btn disable"
                        }
                        disabled={
                          togglingUserId ===
                          u.id
                        }
                        onClick={() =>
                          toggleUserActive(
                            u
                          )
                        }
                      >
                        {u.is_active ===
                        false ? (
                          <>
                            <CheckCircle2
                              size={
                                14
                              }
                            />
                            {togglingUserId ===
                            u.id
                              ? "..."
                              : "Enable"}
                          </>
                        ) : (
                          <>
                            <Ban
                              size={
                                14
                              }
                            />
                            {togglingUserId ===
                            u.id
                              ? "..."
                              : "Disable"}
                          </>
                        )}
                      </button>
                    </td>

                  </tr>
                )
              )
            )}

          </tbody>

        </table>

      </div>
    </>
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function HomePage() {

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [mounted, setMounted] = useState(false);

  const [tab, setTab] =
    useState<Tab>("new");

  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(
    () => new Set(["new", "insights"])
  );

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  const [selectedTable, setSelectedTable] =
    useState("");

  const [
    mobileNav,
    setMobileNav,
  ] = useState(false);

  const [
    products,
    setProducts,
  ] = useState<Product[]>(
    []
  );

  const [
    todayOrders,
    setTodayOrders,
  ] = useState<Order[]>(
    []
  );

  const [restaurantTables, setRestaurantTables] =
    useState<RestaurantTable[]>([]);

  const [
    restaurants,
    setRestaurants,
  ] =
    useState<
      RestaurantRow[]
    >([]);

  const [
    refreshKey,
    setRefreshKey,
  ] = useState(0);

  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(() =>
    new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
  );
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  const handleRefreshAll = async () => {
    if (!currentUser?.restaurantId) return;
    setIsRefreshingAll(true);
    try {
      await loadRestaurantData(currentUser.restaurantId);
      setRefreshKey((prev) => prev + 1);
      setLastUpdatedTime(
        new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      );
    } finally {
      setTimeout(() => setIsRefreshingAll(false), 500);
    }
  };

  const [loading, setLoading] =
    useState(false);

  const [
    databaseError,
    setDatabaseError,
  ] =
    useState<
      string | null
    >(null);

  const categoryCounts =
    useMemo(() => {
      const result:
        Record<
          string,
          number
        > = {};

      CATEGORIES.forEach(
        (c) => {
          result[c] =
            products.filter(
              (p) =>
                normalizeCategory(
                  p.category
                ) === c
            ).length;
        }
      );

      return result;
    }, [products]);

  void categoryCounts;

  useEffect(() => {
    setMounted(true);
    let isCurrent = true;

    async function checkExistingSession() {
      try {
        const saved = localStorage.getItem("restaurant_iq_user");
        if (saved && isCurrent) {
          const parsed = JSON.parse(saved);
          setCurrentUser(parsed);
          if (parsed?.id?.startsWith("demo-") || !isSupabaseConfigured) {
            return;
          }
        }
      } catch (e) {}

      if (!isSupabaseConfigured) return;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          if (isCurrent) {
            setCurrentUser(null);
            try {
              localStorage.removeItem("restaurant_iq_user");
            } catch (e) {}
          }
          return;
        }

        const { data, error } = await supabase
          .from("users")
          .select(`
            id,
            name,
            phone,
            email,
            role,
            restaurant_id,
            is_active,
            restaurants (
              name
            )
          `)
          .eq("auth_user_id", session.user.id)
          .maybeSingle();

        if (error || !data || data.is_active === false) {
          if (data?.is_active === false) {
            await supabase.auth.signOut();
          }
          if (isCurrent) {
            setCurrentUser(null);
            try {
              localStorage.removeItem("restaurant_iq_user");
            } catch (e) {}
          }
          return;
        }

        const row = data as unknown as UserRow;
        const restoredUser: CurrentUser = {
          id: row.id,
          name: row.name,
          phone: row.phone || "",
          role: row.role,
          restaurantId: row.restaurant_id,
          restaurantName: row.restaurants?.name || "",
        };

        if (isCurrent) {
          setCurrentUser(restoredUser);
          try {
            localStorage.setItem(
              "restaurant_iq_user",
              JSON.stringify(restoredUser)
            );
          } catch (e) {}
        }
      } catch (err) {
        console.error("SESSION RESTORE ERROR:", err);
      }
    }

    checkExistingSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && isCurrent) {
        try {
          const saved = localStorage.getItem("restaurant_iq_user");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.id?.startsWith("demo-") || !isSupabaseConfigured) {
              return;
            }
          }
        } catch (e) {}

        setCurrentUser(null);
        try {
          localStorage.removeItem("restaurant_iq_user");
        } catch (e) {}
      }
    });

    return () => {
      isCurrent = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    setTab(
      currentUser.role ===
        "SUPER_ADMIN"
        ? "restaurants"
        : currentUser.role === "ADMIN"
          ? "insights"
          : "new"
    );

    if (
      currentUser.role ===
      "SUPER_ADMIN"
    ) {
      loadRestaurants();
    } else {
      loadRestaurantData(
        currentUser.restaurantId
      );
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (
      currentUser?.role === "ADMIN" &&
      tab !== "insights"
    ) {
      setTab("insights");
    }
    if (currentUser?.role === "POC" && tab !== "new") {
      setTab("new");
    }
  }, [currentUser?.role, tab]);

  useEffect(() => {
    if (
      !isSupabaseConfigured ||
      !currentUser ||
      currentUser.role === "SUPER_ADMIN" ||
      !currentUser.restaurantId ||
      currentUser.restaurantId === "demo-restaurant-1"
    ) {
      return;
    }

    const restaurantId =
      currentUser.restaurantId;

    const channel = supabase
      .channel(
        `today-orders-live-${restaurantId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          loadTodayOrders(
            restaurantId
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(
        channel
      );
    };
  }, [currentUser?.restaurantId]);

  async function loadRestaurants() {
    setLoading(true);
    setDatabaseError(null);

    if (!isSupabaseConfigured) {
      setRestaurants(DEMO_RESTAURANTS);
      setLoading(false);
      return;
    }

    try {
      const {
        data,
        error,
      } = await supabase
        .from("restaurants")
        .select(
          "id,name"
        )
        .order("name");

      if (error) {
        throw error;
      }

      setRestaurants(
        data || []
      );
    } catch (err: any) {
      console.error(
        "LOAD RESTAURANTS ERROR:",
        err
      );

      setDatabaseError(
        err?.message ||
          "Could not load restaurants."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRestaurantData(
    restaurantId: string | null
  ) {
    if (!restaurantId) {
      setDatabaseError(
        "This account isn't mapped to a restaurant yet."
      );

      return;
    }

    setLoading(true);
    setDatabaseError(null);

    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
      setProducts(DEMO_PRODUCTS);
      setRestaurantTables(DEMO_TABLES);
      setTodayOrders(DEMO_TODAY_ORDERS);
      setLoading(false);
      return;
    }

    try {

      const {
        data: rawMenu,
        error: menuError,
      } =
        await supabase
          .from(
            "menu_items"
          )
          .select("*")
          .eq(
            "restaurant_id",
            restaurantId
          )
          .order("name");

      if (menuError) {
        throw menuError;
      }

      const formattedMenu: Product[] =
        (rawMenu || [])
          .filter(
            (row: any) =>
              isActiveMenuItem(
                row
              )
          )
          .map(
            (row: any) => ({
              id: String(
                row.id
              ),

              name:
                getMenuName(
                  row
                ),

              price:
                getMenuPrice(
                  row
                ),

              category:
                getMenuCategory(
                  row
                ),
            })
          )
          .filter(
            (item) =>
              item.id &&
              item.name &&
              item.price >=
                0
          );

      const deduplicatedMenu: Product[] = [];
      const seenMenuKeys = new Set<string>();
      for (const item of formattedMenu) {
        const key = `${(item.name || "").trim().toLowerCase()}_${item.category}_${Math.round(Number(item.price) || 0)}`;
        if (!seenMenuKeys.has(key)) {
          seenMenuKeys.add(key);
          deduplicatedMenu.push(item);
        }
      }

      setProducts(deduplicatedMenu);
      cacheMenuItems(restaurantId, deduplicatedMenu);

      const {
        data: rawTables,
        error: tablesError,
      } = await supabase
        .from("restaurant_tables")
        .select("id, table_number, capacity, is_active")
        .eq("restaurant_id", restaurantId)
        .order("table_number");

      if (tablesError) {
        throw tablesError;
      }

      let formattedTables = (rawTables || []).map((table: any) => ({
        id: String(table.id),
        tableNumber: String(table.table_number),
        capacity: Number(table.capacity) || 0,
        isActive: table.is_active !== false,
      }));

      // Auto-persist T1 through T30 into database if fewer than 30 tables exist
      if (!restaurantId.startsWith("demo-") && formattedTables.length < 30) {
        const existingNums = new Set(
          formattedTables.map((t) => t.tableNumber.trim().toUpperCase())
        );
        const missingToInsert: Array<{
          restaurant_id: string;
          table_number: string;
          capacity: number;
        }> = [];

        for (let i = 1; i <= 30; i++) {
          const tNum = `T${i}`;
          if (!existingNums.has(tNum)) {
            const cap =
              i % 5 === 0 ? 8 : i % 3 === 0 ? 6 : i % 2 === 0 ? 2 : 4;
            missingToInsert.push({
              restaurant_id: restaurantId,
              table_number: tNum,
              capacity: cap,
            });
          }
        }

        if (missingToInsert.length > 0) {
          try {
            const { data: inserted, error: insertErr } = await supabase
              .from("restaurant_tables")
              .insert(missingToInsert)
              .select("id, table_number, capacity, is_active");

            if (!insertErr && inserted) {
              const newFormatted = inserted.map((t: any) => ({
                id: String(t.id),
                tableNumber: String(t.table_number),
                capacity: Number(t.capacity) || 0,
                isActive: t.is_active !== false,
              }));
              formattedTables = [...formattedTables, ...newFormatted];
            }
          } catch (e) {
            console.warn("Could not auto-seed missing tables into database:", e);
          }
        }
      }

      setRestaurantTables(formattedTables);
      cacheTables(restaurantId, formattedTables);

      await loadTodayOrders(
        restaurantId
      );
    } catch (err: any) {
      console.error(
        "DATABASE ERROR:",
        err
      );

      // Offline fallback: load cached menu & tables if available, or demo data
      const cachedMenu = getCachedMenuItems(restaurantId);
      if (cachedMenu && cachedMenu.length > 0) {
        setProducts(cachedMenu);
      } else {
        setProducts(DEMO_PRODUCTS);
      }
      const cachedTbls = getCachedTables(restaurantId);
      if (cachedTbls && cachedTbls.length > 0) {
        setRestaurantTables(cachedTbls);
      } else {
        setRestaurantTables(DEMO_TABLES);
      }

      if (todayOrders.length === 0) {
        setTodayOrders(DEMO_TODAY_ORDERS);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadTodayOrders(
    restaurantId: string
  ) {
    if (!isSupabaseConfigured || restaurantId === "demo-restaurant-1") {
      setTodayOrders(DEMO_TODAY_ORDERS);
      return;
    }

    const start =
      new Date();

    start.setHours(
      0,
      0,
      0,
      0
    );

    const {
      data,
      error,
    } =
      await supabase
        .from("orders")
        .select(
          ORDER_SELECT
        )
        .eq(
          "restaurant_id",
          restaurantId
        )
        .gte(
          "created_at",
          start.toISOString()
        )
        .neq(
          "status",
          "CANCELLED"
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        );

    if (error) {
      console.error(
        "TODAY ORDERS ERROR:",
        error
      );

      return;
    }

    setTodayOrders(
      (data || []).map(
        formatOrder
      )
    );
  }

  function handlePlaced(
    order: Order
  ) {
    setTodayOrders((current) => {
      const cleanTable = order.table ? order.table.trim().toUpperCase() : null;
      let matched = false;
      const next = current.map((o) => {
        const oTable = o.table ? o.table.trim().toUpperCase() : null;
        const isSameDb = Boolean(order.databaseId && o.databaseId === order.databaseId);
        const isSameId = Boolean(order.id && o.id === order.id);
        const isSameOpenTable = Boolean(cleanTable && oTable === cleanTable && !o.closedAt);

        if (isSameDb || isSameId || isSameOpenTable) {
          matched = true;
          return {
            ...o,
            ...order,
            status: order.closedAt ? "COMPLETED" : (order.status || o.status),
            closedAt: order.closedAt || o.closedAt,
          };
        }
        return o;
      });

      if (matched) return next;
      return [order, ...next];
    });

    setRefreshKey(
      (k) => k + 1
    );

    setSelectedTable("");
  }

  function handleTableOrder(table?: string) {
    setSelectedTable(table || "");
    setTab("new");
  }

  async function handleCloseTable(
    tableNumber: string
  ) {
    const openOrderIds = todayOrders
      .filter(
        (order) =>
          order.source === "DINE_IN" &&
          order.table === tableNumber &&
          !order.closedAt &&
          order.databaseId
      )
      .map((order) => order.databaseId as string);

    if (openOrderIds.length === 0) return;

    const closedAtIso = new Date().toISOString();

    if (!isSupabaseConfigured || currentUser?.id?.startsWith("demo-")) {
      setTodayOrders((current) =>
        current.map((order) =>
          openOrderIds.includes(order.databaseId as string)
            ? { ...order, closedAt: closedAtIso }
            : order
        )
      );
      return;
    }

    try {
      const { error } = await supabase
        .from("orders")
        .update({ closed_at: closedAtIso })
        .in("id", openOrderIds);

      if (error) throw error;

      setTodayOrders((current) =>
        current.map((order) =>
          openOrderIds.includes(
            order.databaseId as string
          )
            ? { ...order, closedAt: closedAtIso }
            : order
        )
      );
    } catch (err: any) {
      console.error(
        "CLOSE TABLE ERROR:",
        err
      );
      alert(
        err?.message ||
          "Could not close this table's order."
      );
    }
  }

  function handleRestaurantCreated(
    r: RestaurantRow
  ) {
    setRestaurants(
      (current) =>
        [
          ...current,
          r,
        ].sort(
          (a, b) =>
            a.name.localeCompare(
              b.name
            )
        )
    );
  }

  async function handleLogout() {
    try {
      localStorage.removeItem("restaurant_iq_user");
    } catch (e) {}
    await supabase.auth.signOut();
    setCurrentUser(null);
    setProducts([]);
    setTodayOrders([]);
    setRestaurants([]);
    setDatabaseError(null);
    setTab("new");
  }

  if (!mounted) {
    return (
      <div
        style={{
          padding: 50,
          fontFamily: "Arial, sans-serif",
          background: "#f6f1e7",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <h2>RestaurantIQ</h2>
        <p>Connecting...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <ModernLogin
        onLogin={
          setCurrentUser
        }
      />
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "radial-gradient(ellipse at top, #111b2e, #070a12)",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: "360px",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "96px",
              height: "96px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "-8px",
                borderRadius: "26px",
                background: "radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 70%)",
                filter: "blur(12px)",
              }}
            />
            <img
              src="/icon-192.png"
              alt="RestaurantIQ"
              width={96}
              height={96}
              style={{
                position: "relative",
                width: "96px",
                height: "96px",
                borderRadius: "22px",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)",
                objectFit: "cover",
              }}
            />
          </div>

          <h1
            style={{
              margin: "0 0 6px 0",
              fontSize: "26px",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg, #ffffff 40%, #10b981 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            RestaurantIQ
          </h1>

          <p
            style={{
              margin: "0 0 24px 0",
              fontSize: "14px",
              color: "#94a3b8",
              fontWeight: 500,
            }}
          >
            Restaurant POS & Intelligence
          </p>

          <div
            style={{
              width: "160px",
              height: "4px",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: "999px",
              overflow: "hidden",
              position: "relative",
              marginBottom: "14px",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                width: "40%",
                background: "linear-gradient(90deg, #10b981, #34d399)",
                borderRadius: "999px",
                animation: "shimmer 1.5s infinite ease-in-out",
              }}
            />
          </div>

          <span
            style={{
              fontSize: "12px",
              color: "#64748b",
              fontWeight: 500,
            }}
          >
            Connecting to restaurant database...
          </span>
        </div>

        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
      </div>
    );
  }

  const toolbarCopy: Record<
    Tab,
    {
      title: string;
      subtitle: string;
    }
  > = {
    new: {
      title:
        "POS Terminal",
      subtitle:
        "RestaurantIQ rapid 3-click restaurant billing terminal",
    },

    orders: {
      title:
        "Orders",
      subtitle:
        "Search and filter past orders by date",
    },

    insights: {
      title:
        "Daily Analytics & Historic Sales",
      subtitle:
        "Today's KPIs, hourly distribution, item trends & AI recommendations",
    },

    restaurants: {
      title:
        "Restaurants",
      subtitle:
        "Create and manage restaurant accounts",
    },

    users: {
      title:
        "Users",
      subtitle:
        "Create Admin and POC logins",
    },

    tables: {
      title:
        "Table View",
      subtitle:
        "Live table status and dine-in orders",
    },

    reminders: {
      title:
        "Owner Reminders",
      subtitle:
        "Configure 2 daily triggers and manually send reports to restaurant owners",
    },
  };

  return (
    <div className={`shell ${currentUser.role === "POC" ? "poc-shell" : ""}`}>

      {currentUser.role !== "POC" && (
        <Sidebar
          tab={tab}
          setTab={setTab}
          user={currentUser}
          onLogout={
            handleLogout
          }
          mobile={
            mobileNav
          }
          setMobile={
            setMobileNav
          }
        />
      )}

      <main
        className={
          currentUser.role === "POC"
            ? "pos-main"
            : ""
        }
      >

        {currentUser.role !== "POC" && (
          <Header
            user={currentUser}
            onMenu={() => setMobileNav(true)}
            onRefresh={currentUser.role === "ADMIN" ? handleRefreshAll : undefined}
            lastUpdated={lastUpdatedTime}
            isRefreshing={isRefreshingAll}
            tab={tab}
          />
        )}

        {currentUser.role !== "POC" && databaseError && (
          <div
            className="card"
            style={{
              marginBottom: 20,
              border:
                "1px solid #ef4444",
              padding: 16,
            }}
          >

            <b>
              Database connection warning
            </b>

            <p>
              {databaseError}
            </p>

          </div>
        )}

        {currentUser.role !== "POC" && currentUser.role !== "ADMIN" && (
          <div className="toolbar">

            <div>

              <b>
                {
                  toolbarCopy[
                    tab
                  ].title
                }
              </b>

              <span>
                {
                  toolbarCopy[
                    tab
                  ].subtitle
                }
              </span>

            </div>

          </div>
        )}

        {currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "POC" && (
          <OfflineBanner
            restaurantId={currentUser.restaurantId}
            onOrderSynced={(tempId, realOrder) => {
              setTodayOrders((current) =>
                current.map((o) =>
                  o.databaseId === tempId
                    ? {
                        ...o,
                        databaseId: realOrder.id,
                        id: realOrder.order_number,
                      }
                    : o
                )
              );
              setRefreshKey((k) => k + 1);
            }}
          />
        )}

        {currentUser.role ===
          "SUPER_ADMIN" &&
          tab ===
            "restaurants" && (
            <RestaurantsPanel
              restaurants={
                restaurants
              }
              onCreated={
                handleRestaurantCreated
              }
            />
          )}

        {currentUser.role ===
          "SUPER_ADMIN" &&
          tab ===
            "users" && (
            <UsersPanel
              restaurants={
                restaurants
              }
            />
          )}

        {currentUser.role ===
          "SUPER_ADMIN" &&
          tab ===
            "reminders" && (
            <SuperAdminRemindersPanel
              restaurants={
                restaurants
              }
            />
          )}

        {currentUser.role ===
          "POC" &&
          visitedTabs.has("new") && (
            <div style={{ display: tab === "new" ? "block" : "none" }}>
              <RestaurantPOS
                products={
                  products
                }
                restaurantId={
                  currentUser.restaurantId ||
                  ""
                }
                restaurantName={
                  currentUser.restaurantName
                }
                isPoc={true}
                createdByUserId={
                  currentUser.id
                }
                initialTable={
                  selectedTable
                }
                restaurantTables={
                  restaurantTables
                }
                orders={
                  todayOrders
                }
                onPlaced={
                  handlePlaced
                }
                onMenuChanged={() =>
                  loadRestaurantData(
                    currentUser.restaurantId
                  )
                }
                onLogout={handleLogout}
              />
            </div>
          )}

        {currentUser.role ===
          "POC" &&
          visitedTabs.has("tables") && (
            <div style={{ display: tab === "tables" ? "block" : "none" }}>
              <TableView
                tables={restaurantTables}
                orders={todayOrders}
                restaurantId={currentUser.restaurantId || ""}
                restaurantName={currentUser.restaurantName}
                onAddOrder={handleTableOrder}
                onCloseTable={handleCloseTable}
                onTableAdded={() =>
                  loadRestaurantData(currentUser.restaurantId)
                }
              />
            </div>
          )}

        {currentUser.role ===
          "POC" &&
          visitedTabs.has("orders") && (
            <div style={{ display: tab === "orders" ? "block" : "none" }}>
              <Orders
                restaurantId={
                  currentUser.restaurantId ||
                  ""
                }
                restaurantName={
                  currentUser.restaurantName
                }
                refreshKey={
                  refreshKey
                }
                isPoc={true}
              />
            </div>
          )}

        {currentUser.role ===
          "ADMIN" &&
          visitedTabs.has("insights") && (
            <div style={{ display: tab === "insights" ? "block" : "none" }}>
              <Insights
                orders={
                  todayOrders
                }
                restaurantId={
                  currentUser.restaurantId ||
                  ""
                }
                restaurantName={
                  currentUser.restaurantName
                }
                currentUserPhone={
                  currentUser.phone
                }
              />
            </div>
          )}

        {currentUser.role !== "POC" && (
          <footer>
            RestaurantIQ MVP · Supabase
          </footer>
        )}

      </main>

      <style jsx global>{`

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family:
            Arial,
            sans-serif;
          background: #f7f7fb;
          color: #111827;
        }

        button,
        input,
        select {
          font-family: inherit;
        }

        button {
          cursor: pointer;
        }

        .shell {
          min-height: 100vh;
          display: flex;
        }

        /* ===============================
           SIDEBAR
        =============================== */

        .side {
          width: 250px;
          background: #ffffff;
          border-right:
            1px solid #e5e7eb;
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          padding: 20px 12px;
          z-index: 50;
          display: flex;
          flex-direction: column;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 8px 20px;
          font-size: 20px;
          font-weight: 800;
        }

        .brand.big {
          justify-content: center;
          font-size: 24px;
          margin-bottom: 10px;
        }

        .logo {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          background:
            linear-gradient(
              135deg,
              #5b5ce2,
              #8b5cf6
            );
          font-weight: 800;
        }

        nav {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-top: 8px;
        }

        nav a,
        .bottom a {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 10px;
          color: #6b7280;
          font-weight: 600;
          text-decoration: none;
        }

        nav a:hover,
        .bottom a:hover {
          background: #f5f5ff;
          color: #5b5ce2;
        }

        nav a.active {
          background: #eeeeff;
          color: #5b5ce2;
        }

        .bottom {
          margin-top: auto;
        }

        .close {
          display: none;
          margin-left: auto;
          border: none;
          background: transparent;
        }

        /* ===============================
           RESTAURANT BADGE
        =============================== */

        .restaurant-id {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          margin: 4px 0 10px;
          border-radius: 14px;
          background:
            linear-gradient(
              135deg,
              rgba(
                91,
                92,
                226,
                0.08
              ),
              rgba(
                139,
                92,
                246,
                0.05
              )
            );
          border:
            1px solid
            rgba(
              91,
              92,
              226,
              0.18
            );
        }

        .restaurant-id-badge {
          width: 42px;
          height: 42px;
          min-width: 42px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: #fff;
          background:
            linear-gradient(
              135deg,
              #5b5ce2,
              #8b5cf6
            );
        }

        .platform-badge {
          background:
            linear-gradient(
              135deg,
              #1f2937,
              #4b5563
            );
        }

        .restaurant-id b {
          display: block;
          font-size: 15px;
        }

        .restaurant-id small {
          font-size: 12px;
          color: #6b7280;
        }

        /* ===============================
           MAIN
        =============================== */

        main {
          margin-left: 250px;
          width: calc(
            100% - 250px
          );
          padding: 25px;
          min-height: 100vh;
        }

        .shell.poc-shell {
          height: 100vh !important;
          max-height: 100vh !important;
          overflow: hidden !important;
          background: #0f172a !important;
        }

        main.pos-main {
          margin: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          max-width: 100vw !important;
          height: 100vh !important;
          max-height: 100vh !important;
          overflow: hidden !important;
          display: flex !important;
          flex-direction: column !important;
        }

        header {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 25px;
        }

        header h1 {
          margin: 0;
          font-size: 28px;
        }

        header p {
          margin: 5px 0 0;
          color: #6b7280;
        }

        .profile {
          margin-left: auto;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eeeeff;
          color: #5b5ce2;
          font-weight: 800;
        }

        .hamb {
          display: none;
          border: none;
          background: transparent;
        }

        .toolbar {
          background: white;
          border: 1px solid #e5e7eb;
          padding: 15px 18px;
          border-radius: 14px;
          margin-bottom: 20px;
        }

        .toolbar b {
          display: block;
          font-size: 16px;
        }

        .toolbar span {
          color: #6b7280;
          font-size: 13px;
        }

        .card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 20px;
        }

        /* ===============================
           SECTION
        =============================== */

        .section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 18px;
        }

        .section-title h2 {
          margin: 0;
          font-size: 18px;
        }

        .section-title span {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: 13px;
        }

        .trend-delta {
          display: inline-block;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 700;
        }

        .trend-delta.good {
          color: #15803d;
        }

        .trend-delta.bad {
          color: #b91c1c;
        }

        .trend-delta.neutral {
          color: #9ca3af;
          font-weight: 500;
        }

        .empty-state {
          color: #9ca3af;
          font-size: 13px;
          text-align: center;
          padding: 30px 0;
        }

        .top-items-table {
          width: 100%;
          border-collapse: collapse;
        }

        .top-items-table th {
          text-align: left;
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          padding: 8px 10px;
          border-bottom: 1px solid #e5e7eb;
        }

        .top-items-table td {
          padding: 9px 10px;
          font-size: 13px;
          color: #111827;
          border-bottom: 1px solid #f3f4f6;
        }

        .top-items-table tr:last-child td {
          border-bottom: none;
        }

        .mini-chart-title {
          font-size: 13px;
          font-weight: 700;
          color: #374151;
          margin: 0 0 10px;
        }

        /* ===============================
           NEW ORDER
        =============================== */

        .new-layout {
          display: grid;
          grid-template-columns:
            minmax(0, 1.5fr)
            minmax(320px, 0.8fr);
          gap: 20px;
        }

        .cats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }

        .cats button {
          border: 1px solid #e5e7eb;
          background: white;
          padding: 9px 12px;
          border-radius: 10px;
          font-weight: 600;
        }

        .cats button.active {
          background: #5b5ce2;
          color: white;
          border-color: #5b5ce2;
        }

        .cats small {
          margin-left: 6px;
          opacity: 0.7;
        }

        .menu-grid {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fill,
              minmax(
                180px,
                1fr
              )
            );
          gap: 12px;
        }

        .menu-item {
          text-align: left;
          border: 1px solid #e5e7eb;
          background: white;
          border-radius: 12px;
          padding: 15px;
          min-height: 90px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .menu-item:hover {
          border-color: #5b5ce2;
          transform: translateY(-1px);
        }

        .menu-item span {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: #5b5ce2;
          font-weight: 700;
        }

        .menu-item-wrapper {
          position: relative;
        }

        .edit-btn {
          width: 100%;
          padding: 6px 12px;
          margin-top: 6px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: #f3f4f6;
          color: #4b5563;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .edit-btn:hover {
          background: #e5e7eb;
          border-color: #9ca3af;
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }

        .modal {
          background: white;
          border-radius: 16px;
          padding: 25px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15);
        }

        .modal h3 {
          margin: 0 0 10px;
          font-size: 20px;
          color: #111827;
        }

        .modal p {
          margin: 0 0 15px;
          color: #6b7280;
          font-size: 14px;
        }

        .modal label {
          display: block;
          margin-top: 15px;
          margin-bottom: 6px;
          font-weight: 600;
          font-size: 13px;
          color: #374151;
        }

        .modal input,
        .modal select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
        }

        .modal input:focus,
        .modal select:focus {
          outline: none;
          border-color: #5b5ce2;
          box-shadow: 0 0 0 3px rgba(91, 92, 226, 0.1);
        }

        .modal-actions {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }

        .modal-actions button {
          flex: 1;
        }

        .secondary-btn {
          flex: 1;
          padding: 11px 16px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          background: white;
          color: #6b7280;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .secondary-btn:hover {
          background: #f9fafb;
          border-color: #d1d5db;
        }

        .danger-link-btn {
          display: block;
          width: 100%;
          margin-top: 14px;
          padding: 10px;
          border: none;
          background: none;
          color: #b91c1c;
          font-weight: 600;
          font-size: 13px;
          text-align: center;
          cursor: pointer;
        }

        .danger-link-btn:hover {
          text-decoration: underline;
        }

        .danger-link-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .disabled-items-list {
          max-height: 320px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 14px 0;
        }

        .disabled-items-empty {
          color: #9ca3af;
          font-size: 13px;
          text-align: center;
          padding: 20px 0;
        }

        .disabled-item-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
        }

        .disabled-item-row b {
          display: block;
          font-size: 14px;
          color: #111827;
        }

        .disabled-item-row span {
          display: block;
          font-size: 12px;
          color: #9ca3af;
          margin-top: 2px;
        }

        .cart {
          display: flex;
          flex-direction: column;
        }

        .cart-items {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 450px;
          overflow-y: auto;
        }

        .cart-row {
          display: grid;
          grid-template-columns:
            1fr auto auto;
          gap: 12px;
          align-items: center;
          padding-bottom: 12px;
          border-bottom:
            1px solid #f0f0f0;
        }

        .cart-row small {
          display: block;
          margin-top: 4px;
          color: #6b7280;
        }

        .qty {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .qty button {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          background: white;
        }

        .total {
          margin-top: 18px;
          padding-top: 18px;
          border-top:
            1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          font-size: 18px;
        }

        .source-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 14px 0 8px;
        }

        .source-pills button {
          flex: 1;
          min-width: 90px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-weight: 600;
        }

        .source-pills button.active {
          background: #5b5ce2;
          border-color: #5b5ce2;
          color: #fff;
        }

        .payment-pills {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin: 10px 0 0;
        }

        .payment-pills button {
          padding: 9px 10px;
          border: 1px solid #dccfb4;
          border-radius: 6px;
          background: #fffdf8;
          color: #6b5d48;
          font-weight: 700;
        }

        .payment-pills button.active {
          border-color: #3c6e4a;
          background: #3c6e4a;
          color: #fff;
        }

        .metric-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 4px 0 16px;
        }

        .metric-pills button {
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #4b5563;
          font-weight: 600;
          font-size: 12.5px;
        }

        .metric-pills button.active {
          background: #5b5ce2;
          border-color: #5b5ce2;
          color: #fff;
        }

        .date-range-card {
          background: linear-gradient(
            135deg,
            #f5f3ff,
            #eef2ff
          );
        }

        .date-range-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .date-range-pills button {
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid #ddd6fe;
          background: #fff;
          color: #4f46e5;
          font-weight: 600;
          font-size: 12.5px;
        }

        .date-range-pills button.active {
          background: #4f46e5;
          border-color: #4f46e5;
          color: #fff;
        }

        .custom-range-inputs {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          margin-top: 14px;
        }

        .custom-range-inputs label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
        }

        .custom-range-inputs input {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid #ddd6fe;
          font-size: 13px;
        }

        .kpi-compare-chart {
          margin-top: 8px;
        }

        .table-input {
          width: 100%;
          margin: 8px 0;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
        }

        .place,
        .login-btn {
          width: 100%;
          padding: 13px;
          border: none;
          border-radius: 11px;
          background: #5b5ce2;
          color: white;
          font-weight: 800;
          margin-top: 12px;
        }

        .print-bill {
          width: 100%;
          padding: 11px 13px;
          margin-top: 10px;
          border: 1px solid #8c6a3f;
          border-radius: 10px;
          background: #fffdf8;
          color: #8c6a3f;
          font-weight: 800;
        }

        .print-bill:hover:not(:disabled) {
          background: #f3ded6;
        }

        .print-bill:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .place:disabled {
          opacity: 0.5;
          cursor: default;
        }

        /* ===============================
           EMPTY
        =============================== */

        .empty {
          padding: 35px;
          text-align: center;
          color: #6b7280;
        }

        .empty small {
          display: block;
          margin-top: 8px;
        }

        /* ===============================
           ORDERS
        =============================== */

        .search {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 8px 10px;
        }

        .search input {
          border: none;
          outline: none;
        }

        .date-filter {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 0;
          color: #6b7280;
          font-size: 13px;
          flex-wrap: wrap;
        }

        .date-filter input {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }

        .order-wrap {
          border-bottom:
            1px solid #eeeeee;
        }

        .order-row {
          width: 100%;
          display: grid;
          grid-template-columns:
            100px
            90px
            1fr
            130px
            100px
            20px;
          gap: 10px;
          align-items: center;
          padding: 15px 5px;
          border: none;
          background: white;
          text-align: left;
        }

        .order-items {
          color: #4b5563;
        }

        .order-source {
          color: #6b7280;
          font-size: 12px;
        }

        .order-detail {
          padding: 15px 20px;
          background: #fafafa;
        }

        .order-detail > div {
          display: flex;
          justify-content: space-between;
          padding: 7px 0;
        }

        .reprint-bill {
          width: 100%;
          margin-top: 12px;
          padding: 9px 12px;
          border: 1px solid #8c6a3f;
          border-radius: 5px;
          background: #fffdf8;
          color: #8c6a3f;
          font-weight: 700;
        }

        .reprint-bill:hover {
          background: #f3ded6;
        }

        .closing-summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin: 16px 0;
        }

        .closing-summary div {
          padding: 12px;
          border: 1px solid #dccfb4;
          border-radius: 4px;
          background: #ede4d3;
        }

        .closing-summary span,
        .closing-summary strong {
          display: block;
        }

        .closing-summary span {
          color: #6b5d48;
          font-size: 11px;
        }

        .closing-summary strong {
          margin-top: 5px;
          font: 600 16px 'IBM Plex Mono', monospace;
        }

        .closing-report-btn {
          padding: 9px 12px;
          border: 1px solid #8c6a3f;
          border-radius: 5px;
          background: #fffdf8;
          color: #8c6a3f;
          font-weight: 700;
        }

        .closing-report-btn:hover:not(:disabled) {
          background: #f3ded6;
        }

        .closing-report-btn:disabled {
          opacity: 0.5;
        }

        .export-orders-btn {
          padding: 9px 12px;
          border: 1px solid #3c6e4a;
          border-radius: 5px;
          background: #fffdf8;
          color: #3c6e4a;
          font-weight: 700;
        }

        .export-orders-btn:hover:not(:disabled) {
          background: #deeae0;
        }

        .export-orders-btn:disabled {
          opacity: 0.5;
        }

        @media (max-width: 700px) {
          .closing-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        /* ===============================
           KPI
        =============================== */

        .date-header {
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e5e7eb;
        }

        .date-header h2 {
          margin: 0;
          font-size: 22px;
          color: #111827;
          font-weight: 700;
        }

        .as-of-time {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          color: #9ca3af;
        }

        .kpis {
          display: grid;
          grid-template-columns:
            repeat(
              4,
              1fr
            );
          gap: 15px;
          margin-bottom: 20px;
        }

        .kpi span {
          color: #6b7280;
          font-size: 13px;
        }

        .kpi-title {
          display: inline-block;
          color: #4f46e5 !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding-bottom: 6px;
          border-bottom: 3px solid #e0e7ff;
        }

        .kpi-compare-caption {
          display: flex;
          gap: 16px;
          margin-bottom: 4px;
        }

        .kpi-caption-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #6b7280;
          font-weight: 600;
        }

        .kpi-caption-swatch {
          display: inline-block;
          width: 14px;
          height: 0;
        }

        .kpi-caption-swatch.bar {
          height: 8px;
          border-radius: 2px;
          background: linear-gradient(
            180deg,
            #5b5ce2,
            #5b5ce2aa
          );
        }

        .kpi-caption-swatch.line {
          border-top: 2px dashed #1e293b;
        }

        .kpi strong {
          display: block;
          margin: 8px 0;
          font-size: 25px;
        }

        .positive {
          color: #16a34a;
          font-weight: 700;
        }

        .negative {
          color: #dc2626;
          font-weight: 700;
        }

        .kpi-split {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .kpi-main {
          display: flex;
          flex-direction: column;
          flex: 0 0 auto;
        }

        .kpi-insight {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          flex: 1 1 240px;
          padding-left: 22px;
          border-left: 1px solid #f3f4f6;
          color: #4338ca;
          font-size: 13px;
          line-height: 1.55;
        }

        .kpi-insight svg {
          flex-shrink: 0;
          margin-top: 2px;
          color: #5b5ce2;
        }

        .kpi-compare-rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 6px;
          padding-top: 10px;
          border-top: 1px solid #f3f4f6;
        }

        .kpi-compare-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          flex-wrap: wrap;
        }

        .kpi-compare-label {
          color: #9ca3af;
          font-weight: 600;
          min-width: 58px;
        }

        .weekday-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid #f3f4f6;
        }

        .weekday-legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #6b7280;
        }

        .weekday-legend-swatch {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 3px;
        }

        /* ===============================
           INSIGHTS
        =============================== */

        .ai-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #eeeeff;
          color: #4338ca;
          padding: 15px;
          border-radius: 12px;
          margin-bottom: 20px;
        }

        .grid2 {
          display: grid;
          grid-template-columns:
            1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }

        .filter-controls {
          display: flex;
          gap: 20px;
          align-items: flex-end;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .filter-group label {
          font-weight: 600;
          font-size: 13px;
          color: #374151;
        }

        .filter-group select,
        .filter-group input {
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-family: inherit;
          font-size: 14px;
          min-width: 150px;
        }

        .filter-group select:focus,
        .filter-group input:focus {
          outline: none;
          border-color: #5b5ce2;
          box-shadow: 0 0 0 3px
            rgba(91, 92, 226, 0.1);
        }

        .charts-grid {
          display: grid;
          grid-template-columns:
            repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 20px;
        }

        .chart {
          height: 300px;
        }

        .source-breakdown-card {
          grid-column: 1 / -1;
        }

        .source-breakdown {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(200px, 1fr)
            );
          gap: 20px;
        }

        .source-item {
          padding: 15px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fafafa;
        }

        .source-header {
          display: flex;
          justify-content:
            space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .source-name {
          font-weight: 600;
          color: #111827;
          font-size: 14px;
        }

        .source-percentage {
          font-weight: 700;
          color: #5b5ce2;
          font-size: 16px;
        }

        .source-bar {
          width: 100%;
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .source-fill {
          height: 100%;
          background:
            linear-gradient(
              90deg,
              #5b5ce2,
              #8b5cf6
            );
          border-radius: 4px;
          transition: width
            0.3s ease;
        }

        .source-count {
          font-size: 12px;
          color: #6b7280;
          text-align: center;
        }

        .channel-chart {
          height: 280px;
        }

        .ai-title {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 20px;
        }

        .ai-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: #eeeeff;
          color: #5b5ce2;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ai-title h2 {
          margin: 0;
          font-size: 18px;
        }

        .ai-title span {
          font-size: 12px;
          color: #6b7280;
        }

        .alert,
        .recommend {
          padding: 14px;
          border-radius: 12px;
          background: #f8f8fb;
          margin-bottom: 12px;
        }

        .alert p,
        .recommend p {
          margin-bottom: 0;
          color: #6b7280;
          font-size: 13px;
        }

        .product {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 13px 0;
          border-bottom:
            1px solid #f0f0f0;
        }

        .rank {
          width: 30px;
          height: 30px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eeeeff;
          color: #5b5ce2;
          font-weight: 800;
        }

        .pname {
          flex: 1;
        }

        .pname small {
          display: block;
          color: #6b7280;
          margin-top: 3px;
        }

        .quick {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }

        .quick span {
          display: block;
          color: #6b7280;
          font-size: 13px;
          margin-top: 3px;
        }

        /* ===============================
           FORMS
        =============================== */

        .inline-form {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .inline-form input {
          flex: 1;
          min-width: 200px;
          padding: 11px 12px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
        }

        .user-form {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                180px,
                1fr
              )
            );
          gap: 10px;
        }

        .user-form input,
        .user-form select {
          padding: 11px 12px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          font-size: 14px;
        }

        .primary-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 11px 16px;
          border-radius: 10px;
          border: none;
          background: #5b5ce2;
          color: white;
          font-weight: 700;
        }

        .primary-btn:disabled {
          opacity: 0.5;
        }

        /* ===============================
           TABLE
        =============================== */

        .table-card {
          margin-top: 20px;
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th,
        td {
          text-align: left;
          padding: 13px 10px;
          border-bottom:
            1px solid #eeeeee;
          font-size: 14px;
        }

        th {
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
        }

        .status {
          color: #15803d;
          background: #dcfce7;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
        }

        .status.disabled {
          color: #b91c1c;
          background: #fee2e2;
        }

        .table-view-card {
          overflow: visible;
        }

        .table-view-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 20px 0;
        }

        .table-view-summary > div {
          padding: 14px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fafafa;
        }

        .table-view-summary span,
        .table-card-meta,
        .table-label {
          color: #6b7280;
          font-size: 12px;
        }

        .table-view-summary strong {
          display: block;
          margin-top: 5px;
          font-size: 20px;
        }

        .table-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
        }

        .table-view-card .table-card {
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 210px;
          margin-top: 0;
          padding: 18px;
          overflow: visible;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #ffffff;
        }

        .table-card-top,
        .table-card-meta,
        .table-card-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .table-card-top h3 {
          margin: 4px 0 0;
          font-size: 26px;
        }

        .table-label {
          font-weight: 800;
          letter-spacing: 0.08em;
        }

        .table-status {
          padding: 6px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
        }

        .table-status.occupied {
          color: #b91c1c;
          background: #fee2e2;
        }

        .table-status.available {
          color: #15803d;
          background: #dcfce7;
        }

        .table-total {
          font-size: 20px;
        }

        .table-card-total-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .table-items-toggle {
          display: flex;
          align-items: center;
          gap: 4px;
          border: 1px solid #e5e7eb;
          border-radius: 999px;
          padding: 5px 10px;
          background: #fafafa;
          color: #5b5ce2;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .table-items-toggle .rot {
          transform: rotate(180deg);
        }

        .table-items-detail {
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 4px 12px;
          background: #fafafa;
          overflow-x: auto;
        }

        .table-items-detail table {
          width: 100%;
        }

        .table-items-detail th,
        .table-items-detail td {
          padding: 9px 6px;
          font-size: 13px;
        }

        .table-card-actions {
          margin-top: auto;
          justify-content: flex-start;
          flex-wrap: wrap;
        }

        .table-card-actions button {
          flex: 1 1 auto;
          min-width: 110px;
          white-space: nowrap;
        }

        .close-table-btn {
          border-color: #15803d;
          color: #15803d;
        }

        .close-table-btn:hover {
          background: #f0fdf4;
        }

        .close-table-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .table-view-empty {
          padding: 44px 20px;
        }

        .user-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          padding: 0 20px 16px;
        }

        .user-filters-search {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 8px 12px;
          flex: 1 1 240px;
          min-width: 200px;
          color: #9ca3af;
        }

        .user-filters-search input {
          border: none;
          outline: none;
          flex: 1;
          font-size: 14px;
          color: #111827;
          background: transparent;
        }

        .user-filters select {
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 14px;
          color: #111827;
          background: #fff;
        }

        .ghost-btn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #6b7280;
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .ghost-btn:hover {
          background: #f9fafb;
        }

        .icon-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .icon-action-btn.disable {
          color: #b91c1c;
          background: #fee2e2;
        }

        .icon-action-btn.disable:hover {
          background: #fecaca;
        }

        .icon-action-btn.enable {
          color: #15803d;
          background: #dcfce7;
        }

        .icon-action-btn.enable:hover {
          background: #bbf7d0;
        }

        .icon-action-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        /* ===============================
           LOGIN
        =============================== */

        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(
              135deg,
              #f7f7fb,
              #eeeeff
            );
          padding: 20px;
        }

        .login-card {
          width: 100%;
          max-width: 420px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 35px;
          box-shadow:
            0 20px 50px
            rgba(
              0,
              0,
              0,
              0.08
            );
        }

        .login-card label {
          display: block;
          margin-top: 16px;
          margin-bottom: 7px;
          font-weight: 600;
          font-size: 13px;
        }

        .login-card input {
          width: 100%;
          padding: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          outline: none;
        }

        .login-card input:focus {
          border-color: #5b5ce2;
        }

        .login-sub {
          text-align: center;
          color: #6b7280;
          margin-bottom: 25px;
        }

        .login-card small {
          display: block;
          text-align: center;
          margin-top: 15px;
          color: #9ca3af;
        }

        footer {
          text-align: center;
          color: #9ca3af;
          font-size: 12px;
          margin-top: 30px;
        }

        /* ===============================
           MOBILE
        =============================== */

        .overlay {
          display: none;
        }

        @media (
          max-width: 900px
        ) {

          .side {
            transform:
              translateX(
                -100%
              );
            transition:
              transform
              0.25s ease;
          }

          .side.open {
            transform:
              translateX(
                0
              );
          }

          .close {
            display: block;
          }

          .overlay {
            display: block;
            position: fixed;
            inset: 0;
            background:
              rgba(
                0,
                0,
                0,
                0.35
              );
            z-index: 40;
          }

          main {
            margin-left: 0;
            width: 100%;
            padding: 18px;
          }

          .hamb {
            display: block;
          }

          .new-layout {
            grid-template-columns:
              1fr;
          }

          .kpis {
            grid-template-columns:
              repeat(
                2,
                1fr
              );
          }

          .grid2 {
            grid-template-columns:
              1fr;
          }

          .charts-grid {
            grid-template-columns:
              1fr;
          }

          .source-breakdown {
            grid-template-columns:
              1fr;
          }

          .filter-controls {
            flex-direction: column;
            align-items: stretch;
          }

          .filter-group select,
          .filter-group input {
            min-width: 100%;
          }

          .order-row {
            grid-template-columns:
              80px
              70px
              1fr
              90px
              70px;
          }

          .order-row svg {
            display: none;
          }

          .kpi-split {
            flex-direction: column;
            align-items: stretch;
          }

          .kpi-insight {
            padding-left: 0;
            padding-top: 14px;
            border-left: none;
            border-top: 1px solid #f3f4f6;
          }
        }

        @media (
          max-width: 600px
        ) {

          header h1 {
            font-size: 21px;
          }

          .kpis {
            grid-template-columns:
              1fr;
          }

          .search {
            width: 100%;
          }

          .section-title {
            align-items: flex-start;
            flex-direction: column;
          }

          .order-row {
            grid-template-columns:
              1fr
              auto;
          }

          .order-row
            > span:nth-child(
              2
            ),
          .order-items,
          .order-source {
            display: none;
          }

          .login-card {
            padding: 25px;
          }
        }

        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Zilla+Slab:wght@500;600;700&display=swap');

        body {
          background: #f6f1e7;
          color: #2b2013;
          font-family: 'IBM Plex Sans', sans-serif;
        }

        .shell {
          background: #f6f1e7;
        }

        .side {
          width: 220px;
          background: #3a160f;
          color: #f3ded6;
          border: 0;
          padding: 28px 16px;
        }

        .brand {
          padding: 0 6px 26px;
          font-family: 'Zilla Slab', Georgia, serif;
          color: #fff;
        }

        .logo {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e2a034;
          color: #3a160f;
          font-family: 'Zilla Slab', Georgia, serif;
        }

        .restaurant-id {
          margin: 0 0 16px;
          padding: 10px;
          border: 0;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
        }

        .restaurant-id-badge,
        .platform-badge {
          width: 34px;
          height: 34px;
          min-width: 34px;
          border-radius: 50%;
          background: #e2a034;
          color: #3a160f;
        }

        .restaurant-id small,
        .restaurant-id b {
          color: #f3ded6;
        }

        nav {
          gap: 4px;
        }

        nav a,
        .bottom a {
          padding: 10px;
          border-radius: 6px;
          border-left: 2px solid transparent;
          color: #f3ded6;
          font-size: 13.5px;
          font-weight: 500;
        }

        nav a:hover,
        .bottom a:hover,
        nav a.active {
          border-left-color: #e2a034;
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        main {
          margin-left: 220px;
          width: calc(100% - 220px);
          max-width: 100%;
          padding: 20px 24px 60px;
          box-sizing: border-box;
        }

        header {
          margin-bottom: 16px;
          padding-bottom: 0;
          border-bottom: 0;
        }

        header h1,
        .toolbar b,
        .date-header h2,
        .section-title h2,
        .card h2 {
          font-family: Inter, system-ui, -apple-system, sans-serif;
          color: #0f172a;
        }

        header h1 {
          font-size: 22px;
          font-weight: 700;
        }

        header p,
        .toolbar span,
        .section-title span,
        .as-of-time {
          color: #64748b;
        }

        .profile {
          width: 38px;
          height: 38px;
          background: #e2a034;
          color: #3a160f;
          font-family: Inter, system-ui, -apple-system, sans-serif;
        }

        .toolbar {
          margin: 0 0 16px;
          padding: 0;
          background: transparent;
          border: 0;
        }

        .toolbar b {
          font-size: 16px;
          font-weight: 600;
        }

        .card {
          margin-bottom: 18px;
          padding: 18px 20px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .section-title {
          margin-bottom: 12px;
        }

        .section-title h2 {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }

        .section-title span {
          font-size: 12px;
          color: #64748b;
        }

        .date-header {
          margin-bottom: 14px;
          padding-bottom: 0;
          border-bottom: 0;
        }

        .date-header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
        }

        .as-of-time {
          font-size: 12px;
        }

        .kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
          width: 100%;
        }

        .kpi {
          position: relative;
          padding: 16px 14px 12px;
          min-width: 0;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .kpi::before,
        .kpi::after {
          display: none !important;
        }

        .kpi-title {
          color: #64748b !important;
          font-family: Inter, system-ui, -apple-system, sans-serif !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.04em !important;
          border-bottom: none !important;
          padding-bottom: 0 !important;
          margin-bottom: 4px;
          display: block;
        }

        .kpi strong {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 24px;
          font-weight: 700;
          color: #0f172a;
          margin: 4px 0 6px;
          display: block;
        }

        .kpi-compare-caption,
        .kpi-caption-item {
          color: #64748b;
          font-size: 11px;
        }

        .kpi-caption-swatch.bar {
          background: #6b5d9e;
        }

        .kpi-compare-chart .recharts-cartesian-axis-tick-value {
          fill: #64748b;
          font-size: 11px;
        }

        .date-range-card {
          background: #ffffff;
          border-color: #e2e8f0;
          margin-bottom: 18px;
        }

        .date-range-pills,
        .metric-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .date-range-pills button,
        .metric-pills button {
          padding: 6px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #f8fafc;
          color: #475569;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .date-range-pills button:hover,
        .metric-pills button:hover {
          background: #f1f5f9;
          color: #0f172a;
          border-color: #cbd5e1;
        }

        .date-range-pills button.active,
        .metric-pills button.active {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
        }

        .custom-range-inputs input {
          border-color: #cbd5e1;
          border-radius: 6px;
          background: #ffffff;
          padding: 6px 10px;
        }

        .weekday-legend {
          border-top-color: #dccfb4;
        }

        .weekday-legend-item {
          color: #6b5d48;
        }

        .chart .recharts-cartesian-grid-horizontal line {
          stroke: #ede4d3;
        }

        .chart .recharts-text {
          fill: #6b5d48;
          font-family: 'IBM Plex Sans', sans-serif;
        }

        .category-performance-card {
          overflow: hidden;
        }

        .category-metric-pills {
          margin: 12px 0 16px;
        }

        .category-filter-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
          padding-bottom: 16px;
          border-bottom: 1px dashed #dccfb4;
        }

        .category-filter-pills button {
          padding: 6px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #f8fafc;
          color: #475569;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .category-filter-pills button:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .category-filter-pills button.active {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
          box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
        }

        .category-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .category-chart-card {
          min-width: 0;
          padding: 16px 16px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .category-chart-card-featured {
          grid-column: 1 / -1;
        }

        .category-chart-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 2px;
        }

        .category-chart-head b {
          font-family: Inter, system-ui, -apple-system, sans-serif;
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
        }

        .category-chart-head span {
          color: #64748b;
          font: 12px 'IBM Plex Mono', monospace;
          white-space: nowrap;
        }

        .category-mini-chart {
          min-width: 0;
          width: 100%;
          height: clamp(180px, 18vw, 240px);
        }

        .category-mini-chart .recharts-cartesian-axis-tick-value {
          fill: #64748b;
          font-family: 'IBM Plex Sans', sans-serif;
        }

        .category-mini-chart .recharts-tooltip-wrapper {
          outline: none;
        }

        .recharts-wrapper,
        .recharts-surface {
          overflow: visible;
        }

        .recharts-label-list text {
          paint-order: stroke;
          stroke: #fffdf8;
          stroke-width: 3px;
          stroke-linejoin: round;
        }

        .new-layout {
          grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr);
          align-items: start;
          gap: 20px;
          width: 100%;
          min-width: 0;
        }

        header {
          align-items: flex-start;
          padding: 0;
          margin-bottom: 16px;
        }

        header h1 {
          margin: 0;
          font-size: clamp(20px, 1.8vw, 25px);
          line-height: 1.2;
          letter-spacing: -0.2px;
        }

        h1,
        h2,
        h3,
        .toolbar b,
        .section-title h2,
        .date-header h2,
        .kpi-title,
        .cats button,
        .metric-pills button,
        .date-range-pills button,
        .category-filter-pills button,
        .source-pills button,
        .primary-btn,
        .secondary-btn,
        .place,
        .print-bill,
        .edit-btn,
        nav a,
        .bottom a {
          text-transform: capitalize;
        }

        header p {
          margin: 6px 0 0;
          font-size: 13px;
        }

        .toolbar {
          margin: 0 0 16px;
          padding: 0 0 10px;
          border-bottom: 1px solid #e2e8f0;
        }

        .toolbar b {
          font-size: 18px;
          line-height: 1.2;
        }

        .toolbar span {
          margin-top: 4px;
          font-size: 13px;
          text-transform: capitalize;
        }

        .date-header {
          margin: 0 0 14px;
          padding: 0 0 10px;
          border-bottom: 1px dashed #e2e8f0;
        }

        .date-header h2 {
          font-size: 16px;
          line-height: 1.2;
        }

        .as-of-time {
          margin-top: 4px;
          font-size: 12px;
        }

        .new-layout > .card {
          min-width: 0;
        }

        main {
          min-width: 0;
        }

        .new-layout > .menu-card {
          height: fit-content;
        }

        .new-layout > .cart {
          position: sticky;
          top: 24px;
          min-height: 560px;
          max-height: calc(100vh - 48px);
          overflow: hidden;
        }

        .menu-card .section-title {
          align-items: center;
        }

        .cats {
          padding-bottom: 2px;
          margin-bottom: 20px;
          border-bottom: 1px dashed #dccfb4;
        }

        .cats button {
          border-color: #dccfb4;
          border-radius: 999px;
          background: #fffdf8;
          color: #6b5d48;
          padding: 8px 13px;
          font-size: 12px;
        }

        .cats button.active {
          background: #a8402a;
          border-color: #a8402a;
          color: #fff;
        }

        .menu-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .menu-item-wrapper {
          min-width: 0;
        }

        .menu-item {
          width: 100%;
          min-width: 0;
          min-height: 112px;
          padding: 15px;
          border-color: #dccfb4;
          border-radius: 6px;
          background: #fffdf8;
        }

        .menu-item:hover {
          border-color: #a8402a;
          background: #fff8ee;
          transform: translateY(-2px);
        }

        .menu-item span {
          color: #a8402a;
        }

        .edit-btn {
          width: 100%;
          min-width: 0;
          border-color: #dccfb4;
          border-radius: 5px;
          background: #ede4d3;
          color: #6b5d48;
        }

        .cart .section-title {
          padding-bottom: 14px;
          border-bottom: 1px solid #dccfb4;
        }

        .cart-items {
          flex: 1;
          max-height: none;
          min-height: 120px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .cart-row {
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 10px;
          padding: 12px 0;
          border-bottom-color: #ede4d3;
        }

        .cart-row b {
          font-size: 14px;
        }

        .cart-row strong,
        .cart .total strong {
          font-family: 'IBM Plex Mono', monospace;
        }

        .qty button {
          width: 30px;
          height: 30px;
          border-color: #dccfb4;
          border-radius: 50%;
          color: #a8402a;
        }

        .cart .total {
          margin-top: auto;
          padding: 18px 0 4px;
          border-top-color: #2b2013;
          font-size: 20px;
        }

        @media (max-width: 1100px) {
          .new-layout {
            grid-template-columns: 1fr;
          }

          .menu-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 600px) {
          .new-layout > .cart {
            position: static;
            min-height: 0;
            max-height: none;
          }

          .category-grid {
            grid-template-columns: 1fr;
          }

          .menu-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .category-chart-card-featured {
            grid-column: auto;
          }

          .category-mini-chart {
            height: 190px;
          }
        }

        @media (max-width: 420px) {
          .menu-grid {
            grid-template-columns: 1fr;
          }
        }

        footer {
          color: #8c6a3f;
        }

        @media (max-width: 900px) {
          main {
            margin-left: 0;
            width: 100%;
            padding: 22px 16px 50px;
          }
        }

      `}</style>

    </div>
  );
}