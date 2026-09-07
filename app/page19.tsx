"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  LogOut,
  Menu as MenuIcon,
  Plus,
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

import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type Role = "SUPER_ADMIN" | "ADMIN" | "POC";

type Tab =
  | "new"
  | "orders"
  | "insights"
  | "restaurants"
  | "users";

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
};

type RestaurantRow = {
  id: string;
  name: string;
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

// Compact Indian-style formatting for chart data labels — under 1,000
// stays as a plain number, 1,000–99,999 rounds to one decimal of "K"
// (10000 -> 10K, 12345 -> 12.3K), and 1,00,000+ rounds to one decimal
// of "L" (150000 -> 1.5L). Whole values drop the trailing ".0".
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

function toAuthPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return value.trim();
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

    items: (o.order_items || []).map(
      (i: any) => ({
        id: i.menu_item_id || i.id,
        name: i.name_snapshot || "Unknown item",
        price:
          Number(i.price_snapshot) || 0,
        category: getMenuCategory(
          Array.isArray(i.menu_items)
            ? i.menu_items[0]
            : i.menu_items
        ),
        qty: Number(i.qty) || 0,
      })
    ),

    total: Number(o.total) || 0,

    payment:
      o.payment_mode || "UPI",

    createdAt:
      o.created_at,
  };
}

function uniqueOrders(
  liveOrders: Order[],
  historicalOrders: Order[]
) {
  const ordersById = new Map<string, Order>();

  // Historical data includes today, so prefer the live version
  // instead of counting the same order twice.
  [...historicalOrders, ...liveOrders].forEach(
    (order) =>
      ordersById.set(
        order.databaseId || order.id,
        order
      )
  );

  return Array.from(ordersById.values());
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

// Lightweight select for trend/aggregate charts — no order_items join.
// Pulling the full item breakdown for months of history is what caused
// the historical fetch to hit Postgres's statement timeout.
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

      // Block disabled accounts even though Supabase Auth itself
      // accepted the password — this is enforced again server-side by
      // the users.is_active flag, but sign the session back out here
      // too so a disabled user's browser doesn't hold onto a live
      // Supabase Auth session.
      if (row.is_active === false) {
        await supabase.auth.signOut();
        alert(
          "This account has been disabled. Contact your administrator for access."
        );
        return;
      }

      onLogin({
        id: row.id,
        name: row.name,
        phone: row.phone || "",
        role: row.role,
        restaurantId:
          row.restaurant_id,
        restaurantName:
          row.restaurants?.name || "",
      });
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
          AI-powered business intelligence
          for restaurants
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
          placeholder="Enter your password"
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
          Access is managed by your
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
              New order
            </a>

            <a
              className={
                tab === "orders"
                  ? "active"
                  : ""
              }
              onClick={() =>
                go("orders")
              }
            >
              <ShoppingBag size={18} />
              Orders
            </a>

            {user.role ===
              "ADMIN" && (
              <a
                className={
                  tab ===
                  "insights"
                    ? "active"
                    : ""
                }
                onClick={() =>
                  go("insights")
                }
              >
                <Brain size={18} />
                Analytics
              </a>
            )}

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
}: {
  user: CurrentUser;
  onMenu: () => void;
}) {
  return (
    <header>

      <button
        className="hamb"
        onClick={onMenu}
      >
        <MenuIcon />
      </button>

      <div>

        <h1>
          Good{" "}
          {timeGreeting()},{" "}
          {firstName(user.name)} 👋
        </h1>

        <p>
          {user.role ===
          "SUPER_ADMIN"
            ? "Platform overview"
            : `${user.restaurantName} · Live database`}
        </p>

      </div>

      <div className="profile">
        {initials(user.name)}
      </div>

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
  onPlaced,
  onMenuChanged,
}: {
  products: Product[];
  restaurantId: string;
  restaurantName: string;
  isPoc: boolean;
  createdByUserId: string;
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

  const [saving, setSaving] =
    useState(false);

  // Edit item price
  const [editingItem, setEditingItem] =
    useState<Product | null>(null);
  const [editPrice, setEditPrice] =
    useState("");

  // Add new item
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

  // Disabled items list — items with active:false don't come through
  // in the `products` prop at all (they're filtered out before it
  // reaches this component), so viewing them requires a separate,
  // on-demand fetch rather than just re-using `products`.
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

      // Refresh the parent's active product list so the re-enabled
      // item reappears on the ordering screen immediately.
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

      // Refresh the parent's product list so the disabled item
      // disappears from the ordering screen immediately, instead of
      // staying visible until the next full reload.
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

    const displayNumber = (value: string | number) =>
      isPoc ? "•••" : String(value);

  async function placeOrder() {
    if (!cart.length) {
      alert(
        "Please select at least one item."
      );
      return;
    }

    if (!source) {
      alert(
        "Choose an order source."
      );
      return;
    }

    if (
      source === "DINE_IN" &&
      !table.trim()
    ) {
      alert(
        "Enter a table number."
      );
      return;
    }

    if (!restaurantId) {
      alert(
        "Restaurant is not mapped."
      );
      return;
    }

    setSaving(true);

    try {
      const orderNumber =
        `S${Date.now()
          .toString()
          .slice(-6)}`;

      const orderType =
        source ===
        "DINE_IN"
          ? "DINE_IN"
          : source ===
            "TAKEAWAY"
          ? "TAKEAWAY"
          : "DELIVERY";

      const {
        data: order,
        error: orderError,
      } = await supabase
        .from("orders")
        .insert({
          restaurant_id:
            restaurantId,

          created_by:
            createdByUserId ||
            null,

          order_number:
            orderNumber,

          order_type:
            orderType,

          table_number:
            source ===
            "DINE_IN"
              ? table.trim()
              : null,

          channel:
            source,

          payment_mode:
            paymentMode,

          subtotal:
            total,

          discount: 0,

          tax: 0,

          total,

          status:
            "COMPLETED",
        })
        .select()
        .single();

      if (orderError) {
        throw orderError;
      }

      const orderItems =
        cart.map(
          (item) => ({
            order_id:
              order.id,

            menu_item_id:
              item.id,

            name_snapshot:
              item.name,

            price_snapshot:
              item.price,

            qty:
              item.qty,
          })
        );

      const {
        error: itemError,
      } = await supabase
        .from("order_items")
        .insert(
          orderItems
        );

      if (itemError) {
        throw itemError;
      }

      const newOrder: Order = {
        id:
          order.order_number,
        databaseId: order.id,

        time:
          new Date(
            order.created_at
          ).toLocaleTimeString(
            "en-IN",
            {
              hour: "numeric",
              minute: "2-digit",
            }
          ),

        source,

        table:
          source ===
          "DINE_IN"
            ? table.trim()
            : undefined,

        items: cart,

        total,

        payment:
          paymentMode,

        createdAt:
          order.created_at,
      };

      onPlaced(
        newOrder
      );

      setCart([]);
      setSource("");
      setPaymentMode("UPI");
      setTable("");

      alert(
        `Order ${orderNumber} saved successfully.`
      );
    } catch (error: any) {
      console.error(
        "ORDER ERROR:",
        error
      );

      alert(
        error?.message ||
          "Could not save order."
      );
    } finally {
      setSaving(false);
    }
  }

  function printBill() {
    if (!cart.length) {
      alert("Please select at least one item before printing.");
      return;
    }

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const billWindow = window.open(
      "",
      "restaurant-bill",
      "width=420,height=720"
    );

    if (!billWindow) {
      alert("Allow pop-ups to print the bill.");
      return;
    }

    const itemRows = cart
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.name)}<small>${item.qty} × ${money(item.price)}</small></td>
            <td>${money(item.price * item.qty)}</td>
          </tr>
        `
      )
      .join("");

    billWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Restaurant bill</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 24px; color: #2b2013; font: 14px Arial, sans-serif; }
            .receipt { max-width: 360px; margin: 0 auto; }
            header { text-align: center; border-bottom: 1px dashed #8c6a3f; padding-bottom: 16px; }
            h1 { margin: 0 0 4px; font: 700 25px Georgia, serif; }
            header p, .meta { margin: 4px 0; color: #6b5d48; font-size: 12px; }
            .meta { display: flex; justify-content: space-between; gap: 12px; margin: 16px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 9px 0; border-bottom: 1px solid #ede4d3; vertical-align: top; }
            td:last-child { text-align: right; white-space: nowrap; }
            small { display: block; color: #6b5d48; margin-top: 3px; }
            .total { display: flex; justify-content: space-between; padding-top: 14px; margin-top: 6px; border-top: 2px solid #2b2013; font-size: 19px; font-weight: 700; }
            footer { text-align: center; margin-top: 22px; color: #8c6a3f; font-size: 11px; }
            @media print { body { padding: 8px; } }
          </style>
        </head>
        <body>
          <main class="receipt">
            <header>
              <h1>${escapeHtml(restaurantName || "Restaurant")}</h1>
              <p>Restaurant bill</p>
              <p>Draft bill · ${new Date().toLocaleString("en-IN")}</p>
            </header>
            <div class="meta">
              <span>${escapeHtml(source || "Order source pending")}</span>
              <span>${escapeHtml(paymentMode)}${source === "DINE_IN" && table.trim() ? ` · Table ${escapeHtml(table.trim())}` : ""}</span>
            </div>
            <table><tbody>${itemRows}</tbody></table>
            <div class="total"><span>Total</span><span>${money(total)}</span></div>
            <footer>Thank you for dining with us</footer>
          </main>
        </body>
      </html>
    `);
    billWindow.document.close();
    billWindow.focus();
    billWindow.onafterprint = () => billWindow.close();
    window.setTimeout(() => billWindow.print(), 250);
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
          "DINE_IN" && (
          <input
            className="table-input"
            type={isPoc ? "password" : "text"}
            value={table}
            onChange={(e) =>
              setTable(
                e.target.value
              )
            }
            placeholder="Table number"
          />
        )}

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
          className="print-bill"
          disabled={!cart.length}
          onClick={printBill}
        >
          PRINT BILL
        </button>

        <button
          className="place"
          disabled={
            !cart.length ||
            saving
          }
          onClick={
            placeOrder
          }
        >
          {saving
            ? "SAVING ORDER..."
            : `PLACE ORDER · ${displayNumber(money(total))}`}
        </button>

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
   ORDERS
========================================================= */

function printExistingBill(order: Order, restaurantName: string) {
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const billWindow = window.open(
    "",
    "restaurant-reprint-bill",
    "width=420,height=720"
  );

  if (!billWindow) {
    alert("Allow pop-ups to reprint the bill.");
    return;
  }

  const itemRows = order.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}<small>${item.qty} × ${money(item.price)}</small></td>
          <td>${money(item.price * item.qty)}</td>
        </tr>
      `
    )
    .join("");

  billWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Reprint bill ${escapeHtml(order.id)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 24px; color: #2b2013; font: 14px Arial, sans-serif; }
          .receipt { max-width: 360px; margin: 0 auto; }
          header { text-align: center; border-bottom: 1px dashed #8c6a3f; padding-bottom: 16px; }
          h1 { margin: 0 0 4px; font: 700 25px Georgia, serif; }
          header p, .meta { margin: 4px 0; color: #6b5d48; font-size: 12px; }
          .meta { display: flex; justify-content: space-between; gap: 12px; margin: 16px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { padding: 9px 0; border-bottom: 1px solid #ede4d3; vertical-align: top; }
          td:last-child { text-align: right; white-space: nowrap; }
          small { display: block; color: #6b5d48; margin-top: 3px; }
          .total { display: flex; justify-content: space-between; padding-top: 14px; margin-top: 6px; border-top: 2px solid #2b2013; font-size: 19px; font-weight: 700; }
          footer { text-align: center; margin-top: 22px; color: #8c6a3f; font-size: 11px; }
          @media print { body { padding: 8px; } }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header>
            <h1>${escapeHtml(restaurantName || "Restaurant")}</h1>
            <p>Reprinted bill · ${escapeHtml(order.id)}</p>
            <p>${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString("en-IN") : "")}</p>
          </header>
          <div class="meta">
            <span>${escapeHtml(order.source.replace(/_/g, " "))}</span>
            <span>${order.table ? `Table ${escapeHtml(order.table)}` : ""}</span>
          </div>
          <table><tbody>${itemRows}</tbody></table>
          <div class="total"><span>Total</span><span>${money(order.total)}</span></div>
          <footer>Thank you for dining with us</footer>
        </main>
      </body>
    </html>
  `);
  billWindow.document.close();
  billWindow.focus();
  billWindow.onafterprint = () => billWindow.close();
  window.setTimeout(() => billWindow.print(), 250);
}

function Orders({
  restaurantId,
  restaurantName,
  refreshKey,
}: {
  restaurantId: string;
  restaurantName: string;
  refreshKey: number;
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

    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {orders.length}{" "}
            orders ·{" "}
            {money(revenue)}
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

      </div>

      <div className="closing-summary">
        <div><span>Revenue</span><strong>{money(revenue)}</strong></div>
        <div><span>Orders</span><strong>{orders.length}</strong></div>
        <div><span>Items Sold</span><strong>{itemsSold}</strong></div>
        <div><span>Avg Order Value</span><strong>{money(averageOrderValue)}</strong></div>
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
                      (i) => (
                        <div
                          key={
                            i.id
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

function Insights({
  orders,
  restaurantId,
}: {
  orders: Order[];
  restaurantId: string;
}) {
  const [historicalOrders, setHistoricalOrders] =
    useState<Order[]>([]);
  const [loading, setLoading] =
    useState(false);

  // Tracks which loadHistoricalData() call is the most recent one.
  // The Number of Periods input fires onChange on every keystroke
  // (typing "14" fires it once for "1" and once for "14"), and each
  // change re-triggers the effect below with no cancellation of the
  // previous in-flight fetch. Two overlapping paginated fetches can
  // then resolve out of order — whichever finishes last wins and
  // silently overwrites the other, even if it's the stale one. This
  // ref lets a fetch check "am I still the latest request?" before
  // committing its result to state.
  const latestRequestId = useRef(0);

  // Get today's date info
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

  useEffect(() => {
    if (!restaurantId) {
      console.log(
        "No restaurantId, skipping historical load"
      );
      return;
    }
    loadHistoricalData();
  }, [restaurantId]);

  async function loadHistoricalData() {
    // Claim this call as the latest request. Any earlier call that
    // resolves after this one started will see a mismatch below and
    // bail out instead of overwriting fresher data with stale results.
    const requestId = ++latestRequestId.current;

    setLoading(true);

    // Declared outside try{} so the catch block can still persist
    // whatever pages were successfully fetched before a later page fails
    // (e.g. a transient statement timeout deep into pagination).
    const allRows: any[] = [];

    try {
      // This fetch feeds the KPI comparisons (Last Week / 7-wk avg)
      // and the Day-wise trend graph. A fixed, modest lookback window
      // keeps it fast regardless of what's selected elsewhere on the
      // page.
      const lookbackDays = 60;

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - lookbackDays);

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);
      endDate.setHours(0, 0, 0, 0);

      console.log(
        "Loading orders from",
        startDate.toISOString(),
        "to",
        endDate.toISOString(),
        `(fixed lookback: ${lookbackDays} days)`
      );

      // Supabase/PostgREST caps a single request at 1000 rows by default,
      // with no guaranteed ordering unless we ask for one, so we still
      // page through everything in the range. But OFFSET-based paging
      // (.range()) forces Postgres to rescan and discard everything
      // before the offset on every page, which got slow enough with
      // months of history plus the order_items join to hit the
      // statement timeout. Two fixes: (1) use a lightweight select with
      // no item join for this trend query, and (2) page by created_at
      // cursor instead of OFFSET so every page is a fast indexed lookup.
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
          console.error(
            "Supabase query error:",
            error
          );
          throw error;
        }

        allRows.push(...(page || []));

        console.log(
          `Fetched page from ${cursor}, got ${
            (page || []).length
          } rows (running total: ${allRows.length})`
        );

        if (!page || page.length < PAGE_SIZE) {
          break;
        }

        // Move the cursor just past the last row's timestamp so the
        // next page picks up an indexed range scan instead of an
        // ever-growing OFFSET scan.
        const lastCreatedAt =
          page[page.length - 1].created_at;
        cursor = new Date(
          new Date(lastCreatedAt).getTime() + 1
        ).toISOString();

        // Safety cap so a runaway loop can't hang the page if something
        // unexpected happens with the data.
        if (allRows.length > 50000) {
          console.warn(
            "Historical orders exceeded 50,000 rows — stopping pagination early."
          );
          break;
        }
      }

      const formatted = allRows.map(
        formatOrder
      );
      console.log(
        "Historical orders loaded:",
        formatted.length,
        "orders"
      );
      
      if (formatted.length > 0) {
        console.log(
          "First order date:",
          formatted[
            formatted.length - 1
          ].createdAt,
          "Last order date:",
          formatted[0].createdAt
        );
      }

      // Only commit if a newer request hasn't started since this one
      // began — otherwise a slow, now-stale fetch (e.g. from an
      // intermediate keystroke like "1" while typing "14") could
      // overwrite the correct, more recent result.
      if (requestId !== latestRequestId.current) {
        console.log(
          `Discarding stale historical data response (request ${requestId}, latest is ${latestRequestId.current})`
        );
        return;
      }

      setHistoricalOrders(formatted);
    } catch (err: any) {
      console.error(
        "HISTORICAL DATA ERROR:",
        err.message || err
      );

      // A later page can still fail (e.g. a transient timeout) after
      // earlier pages succeeded — keep whatever was already fetched
      // instead of throwing away the whole window, so the chart shows
      // partial history rather than nothing at all. Still subject to
      // the same staleness check as the success path.
      if (
        allRows.length > 0 &&
        requestId === latestRequestId.current
      ) {
        console.warn(
          `Falling back to ${allRows.length} partially-loaded rows after error.`
        );
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

      // When a cutoff is given, only count orders up to the same
      // time-of-day as "now" — otherwise a partial current day (e.g.
      // 11 AM so far) gets compared against a full 24-hour historical
      // day, which always makes today look artificially worse than it
      // actually is at this point in the day.
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

  // Calculate metrics for specific date
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

  // Today's metrics
  const todayMetrics =
    calculateMetrics(orders);

  // How far into today we currently are, in milliseconds since
  // midnight — used so "Last week" and "7-wk avg" can each show both
  // their full-day total (the bar) and their value up to this same
  // clock time (the line overlay), which is the fairer comparison
  // since today itself is necessarily still partial.
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

  // True per-week average (not a sum) for each metric, over however
  // many of the last 7 same-weekday occurrences have data — powers the
  // "7-wk avg" bar in each KPI's compact comparison chart below. An
  // optional cutoff computes the same-time-of-day version instead of
  // the full-day version.
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

  // Day-wise trend graph: one bar per day over an admin-selected date
  // range (Today / Last 7 Days / Last 30 Days / This Month / Last
  // Month / This Year / Last Year / Custom). "This Year"/"Last Year"
  // can span far beyond the 60-day window historicalOrders keeps
  // client-side, so this fetches from the get_order_period_trends RPC
  // instead — the same server-side aggregation used earlier for the
  // long-range trend charts, which returns one row per day no matter
  // how large the range is, rather than paging through raw orders.
  const REVENUE_HIGHLIGHT_GRADIENT_ID =
    "revenueHighlightGradient";
  const REVENUE_MUTED_GRADIENT_ID =
    "revenueMutedGradient";
  const REVENUE_TODAY_STROKE = "#c2410c";

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

  // Computes the [start, end) window for whichever preset is picked.
  // `end` is always an exclusive midnight boundary so the RPC's
  // `created_at < p_end` filter behaves consistently across presets.
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

  // Which metric the day-wise chart below is currently showing —
  // toggled with the pill buttons so one chart can stand in for three,
  // instead of stacking Revenue, Orders, and AOV as three separate
  // always-visible charts.
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
    >([]);
  const [dayWiseLoading, setDayWiseLoading] =
    useState(false);
  const latestDayWiseRequestId = useRef(0);

  async function loadDayWiseTrend() {
    if (!restaurantId) return;

    const requestId =
      ++latestDayWiseRequestId.current;
    setDayWiseLoading(true);

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

  // Hourly Breakdown: same date range as above, but summed into 2-hour
  // buckets (12–2am, 2–4am, ... 10pm–12am) instead of one bar per day —
  // shows what time of day drives the numbers within the selected
  // range, metric-switchable the same way as the day-wise chart above.
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
    >([]);
  const [
    hourlyBucketLoading,
    setHourlyBucketLoading,
  ] = useState(false);
  const latestHourlyBucketRequestId =
    useRef(0);

  async function loadHourlyBuckets() {
    if (!restaurantId) return;

    const requestId =
      ++latestHourlyBucketRequestId.current;
    setHourlyBucketLoading(true);

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

  const categoryNames = [
    "Mains",
    "Starters",
    "Beverages",
    "Desserts",
    "Sides & Add-ons",
  ];
  const [categoryMetric, setCategoryMetric] =
    useState<CategoryMetric>("items");
  const [activeCategories, setActiveCategories] =
    useState(() => new Set(categoryNames));

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

  function categoryNameForItem(category: string) {
    const normalized = normalizeCategory(category);

    if (normalized === "Mains") return "Mains";
    if (normalized === "Starters") return "Starters";
    if (normalized === "Beverages") return "Beverages";
    if (normalized === "Desserts") return "Desserts";
    return "Sides & Add-ons";
  }

  useEffect(() => {
    if (!restaurantId) return;

    const requestId = ++latestCategoryRequestId.current;

    async function loadCategoryHistory() {
      setCategoryLoading(true);

      try {
        const rows: any[] = [];
        const pageSize = 500;
        let cursor = analyticsRange.start.toISOString();
        const endIso = analyticsRange.end.toISOString();

        while (true) {
          const { data, error } = await supabase
            .from("orders")
            .select(ORDER_SELECT)
            .eq("restaurant_id", restaurantId)
            .gte("created_at", cursor)
            .lt("created_at", endIso)
            .neq("status", "CANCELLED")
            .order("created_at", { ascending: true })
            .limit(pageSize);

          if (error) throw error;

          rows.push(...(data || []));

          if (!data || data.length < pageSize) break;

          const lastCreatedAt = data[data.length - 1].created_at;
          cursor = new Date(
            new Date(lastCreatedAt).getTime() + 1
          ).toISOString();

          if (rows.length >= 50000) break;
        }

        const byDate = new Map<string, CategoryDay>();

        rows.map(formatOrder).forEach((order) => {
          const dateKey = new Date(order.createdAt)
            .toISOString()
            .split("T")[0];
          const dateValue = new Date(`${dateKey}T00:00:00`);
          const day = byDate.get(dateKey) || {
            dateKey,
            label: dateValue.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            }),
            categories: Object.fromEntries(
              categoryNames.map((name) => [
                name,
                { revenue: 0, orders: 0, items: 0 },
              ])
            ),
          };
          const seen = new Set<string>();

          order.items.forEach((item) => {
            const category = categoryNameForItem(item.category);
            day.categories[category].revenue += item.price * item.qty;
            day.categories[category].items += item.qty;
            seen.add(category);
          });

          seen.forEach((category) => {
            day.categories[category].orders += 1;
          });
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
    const sortedCategories = categoryNames.map((name) => {
      const values = categoryDailyData.map((day) => {
        const total = day.categories[name];
        return categoryMetric === "revenue"
          ? total.revenue
          : categoryMetric === "orders"
            ? total.orders
            : categoryMetric === "aov"
              ? total.orders
                ? total.revenue / total.orders
                : 0
              : total.items;
      });

      return {
        name,
        values,
        labels: categoryDailyData.map((day) => day.label),
        total: values.reduce((sum, value) => sum + value, 0),
        revenueTotal: categoryDailyData.reduce(
          (sum, day) => sum + day.categories[name].revenue,
          0
        ),
      };
    })
      .filter((category) => category.revenueTotal > 0)
      .sort((a, b) => b.revenueTotal - a.revenueTotal);

    return sortedCategories;
  }, [categoryDailyData, categoryMetric]);

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
      <div className="date-header">
        <h2>{dateDisplay}</h2>
        <span className="as-of-time">
          As of{" "}
          {today.toLocaleTimeString(
            "en-IN",
            {
              hour: "numeric",
              minute: "2-digit",
            }
          )}{" "}
          — compared to last week same
          day up to the same time
        </span>
      </div>

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

      {/* Date range selector — controls the Day-wise Trend and Hourly
          Breakdown charts below. Deliberately does NOT affect the KPI
          row above, since those are always anchored to "today" by
          design (Revenue today, Last Week, 7-wk avg). */}
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

      {/* Day-wise trend graph — placed above Orders for the Day so the
          daily pattern is the first thing seen after the KPIs. A pill
          selector switches the chart between Revenue, Orders, and Avg
          Order Value instead of stacking three separate always-visible
          charts. Bars matching today's weekday (e.g. every Monday, if
          today is Monday) are highlighted; every other day is muted,
          so the recurring pattern for today's weekday is easy to pick
          out instead of competing with a different color per weekday. */}
      <div className="card">

        <div className="section-title">
          <div>
            <h2>
              {dayWiseMetricLabel(
                dayWiseMetric
              )}{" "}
              Trend
            </h2>
            <span>
              {dayWiseLoading
                ? "Loading..."
                : `${dayWiseTrendData.length} day(s) · ${dayOfWeek}s highlighted`}
            </span>
          </div>
        </div>

        <div className="metric-pills">
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

        <div className="chart">
          <ResponsiveContainer
            width="100%"
            height={300}
          >
            <BarChart
              data={dayWiseTrendData}
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
                  dayWiseTrendData.length >
                  15
                    ? Math.ceil(
                        dayWiseTrendData.length /
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
                  v: any
                ) =>
                  dayWiseValueFormatter(
                    Number(v)
                  )
                }
                labelFormatter={(
                  label,
                  payload
                ) => {
                  const weekday =
                    payload?.[0]
                      ?.payload
                      ?.weekday;
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
                {dayWiseTrendData.map(
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
            </BarChart>
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

      </div>

      {/* Hourly Breakdown — same date range as the Day-wise Trend
          chart above, but summed into 2-hour buckets instead of one
          bar per day, so you can see what time of day drives the
          numbers within the selected period. */}
      <div className="card">

        <div className="section-title">
          <div>
            <h2>
              {hourlyBucketMetricLabel(
                hourlyBucketMetric
              )}{" "}
              by Time of Day
            </h2>
            <span>
              {hourlyBucketLoading
                ? "Loading..."
                : `2-hour buckets · ${analyticsRangeLabel()}`}
            </span>
          </div>
        </div>

        <div className="metric-pills">
          <button
            className={
              hourlyBucketMetric ===
              "revenue"
                ? "active"
                : ""
            }
            onClick={() =>
              setHourlyBucketMetric(
                "revenue"
              )
            }
          >
            Revenue
          </button>
          <button
            className={
              hourlyBucketMetric ===
              "orderCount"
                ? "active"
                : ""
            }
            onClick={() =>
              setHourlyBucketMetric(
                "orderCount"
              )
            }
          >
            Orders
          </button>
          <button
            className={
              hourlyBucketMetric ===
              "aov"
                ? "active"
                : ""
            }
            onClick={() =>
              setHourlyBucketMetric(
                "aov"
              )
            }
          >
            Avg Order Value
          </button>
          <button
            className={
              hourlyBucketMetric ===
              "items"
                ? "active"
                : ""
            }
            onClick={() =>
              setHourlyBucketMetric(
                "items"
              )
            }
          >
            Items Sold
          </button>
        </div>

        <div className="chart">
          <ResponsiveContainer
            width="100%"
            height={300}
          >
            <BarChart
              data={hourlyBucketData}
            >
              <defs>
                <linearGradient
                  id="hourlyBucketGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="#818cf8"
                  />
                  <stop
                    offset="100%"
                    stopColor="#4f46e5"
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
              />
              <YAxis
                fontSize={12}
              />
              <Tooltip
                formatter={(
                  v: any
                ) =>
                  hourlyBucketValueFormatter(
                    Number(v)
                  )
                }
              />
              <Bar
                dataKey={
                  hourlyBucketMetric
                }
                fill="url(#hourlyBucketGradient)"
                radius={[
                  6, 6, 0, 0,
                ]}
              >
                <LabelList
                  dataKey={
                    hourlyBucketMetric
                  }
                  position="top"
                  formatter={(
                    v: any
                  ) =>
                    hourlyBucketValueFormatter(
                      Number(v)
                    )
                  }
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    fill: "#4b5563",
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

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
                : `${analyticsRangeLabel()} · one trend per menu category`}
            </span>
          </div>
        </div>

        <div className="metric-pills category-metric-pills">
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
            .map((category, index) => (
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
                  <span>
                    {categoryFormatter(category.total)} total
                  </span>
                </div>
                <div className="category-mini-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={category.values.map((value, index) => ({
                        value,
                        label: category.labels[index],
                      }))}
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
                        formatter={(value: any) => categoryFormatter(Number(value))}
                      />
                      <Bar
                        dataKey="value"
                        fill={`url(#categoryGradient-${category.name.replace(/\W/g, "")})`}
                        radius={[4, 4, 0, 0]}
                      >
                        <LabelList
                          dataKey="value"
                          position="top"
                          formatter={(value: any) => categoryFormatter(Number(value))}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            fill: "#2b2013",
                          }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
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

  // SVG gradient ids can't safely contain spaces or punctuation — a
  // raw title like "Revenue today" produces `url(#...Revenue today...)`,
  // which the browser can't resolve as a fragment reference, so the
  // bar silently falls back to a solid black fill instead of erroring
  // visibly. Strip it down to a safe identifier.
  const safeId = title.replace(
    /[^a-zA-Z0-9]/g,
    ""
  );

  return (
    <div className="card kpi">

      <span className="kpi-title">
        {title}
      </span>

      <strong>
        {value}
      </strong>

      {delta && (
        <span className={good ? "positive" : "trend-delta neutral"}>
          {delta}
        </span>
      )}

      {compareData && (
        <div className="kpi-compare-chart">

          <div className="kpi-compare-caption">
            <span className="kpi-caption-item">
              <span className="kpi-caption-swatch bar" />
              Full day
            </span>
            <span className="kpi-caption-item">
              <span className="kpi-caption-swatch line" />
              Same time
            </span>
          </div>

          <ResponsiveContainer
            width="100%"
            height={195}
          >
            <ComposedChart
              data={compareData}
              margin={{
                top: 18,
                right: 10,
                left: 10,
                bottom: 0,
              }}
            >
              <defs>
                {compareData.map(
                  (d, i) => {
                    const color =
                      KPI_COMPARE_COLORS[
                        i %
                          KPI_COMPARE_COLORS.length
                      ];
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
                          stopColor={
                            color
                          }
                          stopOpacity={
                            0.95
                          }
                        />
                        <stop
                          offset="100%"
                          stopColor={
                            color
                          }
                          stopOpacity={
                            0.55
                          }
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
                formatter={(
                  v: any,
                  name: any
                ) => [
                  format(v),
                  name === "value"
                    ? "Full day"
                    : "Same time",
                ]}
                contentStyle={{
                  borderRadius: 10,
                  fontSize: 12,
                  border: "1px solid #e5e7eb",
                }}
              />

              <Bar
                dataKey="value"
                radius={[
                  6, 6, 0, 0,
                ]}
                maxBarSize={54}
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
                    fill: "#374151",
                  }}
                />
              </Bar>

              <Line
                type="monotone"
                dataKey="sameTimeValue"
                stroke="#1e293b"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{
                  r: 4,
                  fill: "#1e293b",
                  strokeWidth: 0,
                }}
                activeDot={{ r: 5 }}
              >
                <LabelList
                  dataKey="sameTimeValue"
                  position="top"
                  formatter={format}
                  offset={8}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    fill: "#2b2013",
                  }}
                />
              </Line>

            </ComposedChart>
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

  // Filters for the users table below
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

  // Tracks which user row currently has an enable/disable request
  // in flight, so its button can show a per-row loading state instead
  // of disabling every row in the table.
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
      const result = await response.json();

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

    // Optimistic update so the row reflects the new state immediately;
    // rolled back below if the request fails.
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

      // A missing/misconfigured API route returns an HTML error page
      // (e.g. Next.js's 404), not JSON — calling .json() on that
      // throws a confusing "Unexpected token '<'" SyntaxError instead
      // of a clear message. Check the content type first so that
      // case surfaces something actionable.
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

      // Roll back the optimistic update.
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

  const [
    currentUser,
    setCurrentUser,
  ] =
    useState<
      CurrentUser | null
    >(null);

  const [tab, setTab] =
    useState<Tab>("new");

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

  /* =======================================================
     LOAD DATA AFTER LOGIN
  ======================================================= */

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

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  /* =======================================================
     LOAD RESTAURANTS
  ======================================================= */

  async function loadRestaurants() {
    setLoading(true);
    setDatabaseError(null);

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

  /* =======================================================
     LOAD RESTAURANT DATA
  ======================================================= */

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

      console.log(
        "RAW MENU FROM SUPABASE:",
        rawMenu
      );

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

      console.log(
        "FORMATTED MENU:",
        formattedMenu
      );

      setProducts(
        formattedMenu
      );

      await loadTodayOrders(
        restaurantId
      );
    } catch (err: any) {
      console.error(
        "DATABASE ERROR:",
        err
      );

      setDatabaseError(
        err?.message ||
          "Unknown database error."
      );
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     LOAD TODAY ORDERS
  ======================================================= */

  async function loadTodayOrders(
    restaurantId: string
  ) {
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

  /* =======================================================
     ORDER PLACED
  ======================================================= */

  function handlePlaced(
    order: Order
  ) {
    setTodayOrders(
      (current) => [
        order,
        ...current,
      ]
    );

    setRefreshKey(
      (k) => k + 1
    );

    setTab("orders");
  }

  /* =======================================================
     RESTAURANT CREATED
  ======================================================= */

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

  /* =======================================================
     LOGOUT
  ======================================================= */

  async function handleLogout() {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setProducts([]);
    setTodayOrders([]);
    setRestaurants([]);
    setDatabaseError(null);
    setTab("new");
  }

  /* =======================================================
     LOGIN SCREEN
  ======================================================= */

  if (!currentUser) {
    return (
      <Login
        onLogin={
          setCurrentUser
        }
      />
    );
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <div
        style={{
          padding: 50,
          fontFamily:
            "Arial, sans-serif",
        }}
      >
        <h2>
          RestaurantIQ
        </h2>

        <p>
          Connecting to your
          database...
        </p>
      </div>
    );
  }

  /* =======================================================
     TOOLBAR
  ======================================================= */

  const toolbarCopy: Record<
    Tab,
    {
      title: string;
      subtitle: string;
    }
  > = {
    new: {
      title:
        "New order",
      subtitle:
        "Create a new restaurant order",
    },

    orders: {
      title:
        "Orders",
      subtitle:
        "Search and filter past orders by date",
    },

    insights: {
      title:
        "Business insights",
      subtitle:
        "KPIs, trends and AI recommendations",
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
  };

  return (
    <div className="shell">

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

      <main>

        <Header
          user={
            currentUser
          }
          onMenu={() =>
            setMobileNav(
              true
            )
          }
        />

        {databaseError && (
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

        {currentUser.role !==
          "SUPER_ADMIN" &&
          tab === "new" && (
            <NewOrder
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
              isPoc={
                currentUser.role === "POC"
              }
              createdByUserId={
                currentUser.id
              }
              onPlaced={
                handlePlaced
              }
              onMenuChanged={() =>
                loadRestaurantData(
                  currentUser.restaurantId
                )
              }
            />
          )}

        {currentUser.role !==
          "SUPER_ADMIN" &&
          tab ===
            "orders" && (
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
            />
          )}

        {currentUser.role ===
          "ADMIN" &&
          tab ===
            "insights" && (
            <Insights
              orders={
                todayOrders
              }
              restaurantId={
                currentUser.restaurantId ||
                ""
              }
            />
          )}

        <footer>
          RestaurantIQ MVP · Supabase
        </footer>

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

        /* Dhaba Ledger analytics theme */
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
          max-width: 1180px;
          padding: 30px 34px 60px;
        }

        header {
          margin-bottom: 22px;
          padding-bottom: 18px;
          border-bottom: 1px solid #dccfb4;
        }

        header h1,
        .toolbar b,
        .date-header h2,
        .section-title h2,
        .card h2 {
          font-family: 'Zilla Slab', Georgia, serif;
          color: #2b2013;
        }

        header h1 {
          font-size: 25px;
          font-weight: 600;
        }

        header p,
        .toolbar span,
        .section-title span,
        .as-of-time {
          color: #6b5d48;
        }

        .profile {
          width: 38px;
          height: 38px;
          background: #e2a034;
          color: #3a160f;
          font-family: 'Zilla Slab', Georgia, serif;
        }

        .toolbar {
          margin: 0 0 24px;
          padding: 0 0 2px;
          background: transparent;
          border: 0;
        }

        .toolbar b {
          font-size: 16px;
          font-weight: 600;
        }

        .card {
          margin-bottom: 24px;
          padding: 20px 20px 16px;
          border: 1px solid #dccfb4;
          border-radius: 4px;
          background: #fffdf8;
          box-shadow: 0 1px 0 rgba(43, 32, 19, 0.06);
        }

        .section-title {
          margin-bottom: 12px;
        }

        .section-title h2 {
          font-size: 16px;
          font-weight: 600;
        }

        .section-title span {
          font-size: 12px;
        }

        .date-header {
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 0;
        }

        .date-header h2 {
          margin: 0;
          font-size: 16px;
        }

        .as-of-time {
          font-size: 12px;
        }

        .kpis {
          gap: 16px;
          margin-bottom: 24px;
        }

        .kpi {
          position: relative;
          padding: 16px 16px 10px;
        }

        .kpi::before,
        .kpi::after {
          content: '';
          position: absolute;
          top: 50%;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #f6f1e7;
          transform: translateY(-50%);
        }

        .kpi::before { left: -7px; }
        .kpi::after { right: -7px; }

        .kpi-title {
          color: #a8402a !important;
          font-family: 'Zilla Slab', Georgia, serif;
          font-size: 15px !important;
          text-transform: none;
          letter-spacing: 0.03em;
          border-bottom: 2px solid #f3ded6;
        }

        .kpi strong {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 23px;
        }

        .kpi-compare-caption,
        .kpi-caption-item {
          color: #6b5d48;
        }

        .kpi-caption-swatch.bar {
          background: #6b5d9e;
        }

        .kpi-compare-chart .recharts-cartesian-axis-tick-value {
          fill: #6b5d48;
        }

        .date-range-card {
          background: #f3ded6;
          border-color: #dccfb4;
        }

        .date-range-pills,
        .metric-pills {
          gap: 8px;
        }

        .date-range-pills button,
        .metric-pills button {
          padding: 6px 13px;
          border: 1px solid #dccfb4;
          border-radius: 999px;
          background: transparent;
          color: #6b5d48;
          font-size: 12px;
        }

        .date-range-pills button {
          background: #fffdf8;
          border-color: #8c6a3f;
          color: #8c6a3f;
        }

        .date-range-pills button.active,
        .metric-pills button.active {
          background: #a8402a;
          border-color: #a8402a;
          color: #fff;
        }

        .metric-pills button.active {
          background: #a8402a;
        }

        .custom-range-inputs input {
          border-color: #8c6a3f;
          border-radius: 4px;
          background: #fffdf8;
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
          padding: 7px 16px;
          border: 1px solid #3c6e4a;
          border-radius: 999px;
          background: #fffdf8;
          color: #3c6e4a;
          font-weight: 700;
          font-size: 12px;
        }

        .category-filter-pills button.active {
          background: #3c6e4a;
          color: #fff;
        }

        .category-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .category-chart-card {
          min-width: 0;
          padding: 14px 14px 6px;
          border: 1px solid #dccfb4;
          border-radius: 4px;
          background: #ede4d3;
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
          font-family: 'Zilla Slab', Georgia, serif;
          font-size: 16px;
          font-weight: 600;
          color: #2b2013;
        }

        .category-chart-head span {
          color: #6b5d48;
          font: 12px 'IBM Plex Mono', monospace;
          white-space: nowrap;
        }

        .category-mini-chart {
          min-width: 0;
          width: 100%;
          height: clamp(180px, 18vw, 240px);
        }

        .category-mini-chart .recharts-cartesian-axis-tick-value {
          fill: #6b5d48;
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

        /* Order entry refinements */
        .new-layout {
          grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr);
          align-items: start;
          gap: 22px;
          width: 100%;
          min-width: 0;
        }

        header {
          align-items: flex-start;
          padding: 4px 0 20px;
          margin-bottom: 24px;
        }

        header h1 {
          margin: 0;
          font-size: clamp(25px, 2.2vw, 32px);
          line-height: 1.1;
          letter-spacing: 0;
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
          margin: 8px 0 0;
          font-size: 14px;
        }

        .toolbar {
          margin: 0 0 28px;
          padding: 0 0 18px;
          border-bottom: 1px solid #dccfb4;
        }

        .toolbar b {
          font-size: 22px;
          line-height: 1.15;
        }

        .toolbar span {
          margin-top: 5px;
          font-size: 14px;
          text-transform: capitalize;
        }

        .date-header {
          margin: 0 0 22px;
          padding: 0 0 16px;
          border-bottom: 1px dashed #dccfb4;
        }

        .date-header h2 {
          font-size: 20px;
          line-height: 1.2;
        }

        .as-of-time {
          margin-top: 6px;
          font-size: 13px;
        }

        .new-layout > .card {
          min-width: 0;
        }

        main {
          min-width: 0;
          overflow-x: hidden;
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
