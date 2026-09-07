"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Calendar,
  ChevronDown,
  Clock3,
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

/* =========================================================
   HELPERS
========================================================= */

function money(n: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

function todayISO() {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offsetMs)
    .toISOString()
    .slice(0, 10);
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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] =
    useState(false);

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      alert(
        "Enter your email or phone number and password to continue."
      );
      return;
    }

    setChecking(true);

    try {
      const {
        data: authData,
        error: authError,
      } = await supabase.auth.signInWithPassword(
        identifier.includes("@")
          ? {
              email: identifier.trim().toLowerCase(),
              password,
            }
          : {
              phone: toAuthPhone(identifier),
              password,
            }
      );

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

        <label>Email or phone number</label>

        <input
          value={identifier}
          onChange={(e) =>
            setIdentifier(e.target.value)
          }
          placeholder="admin@restaurant.com or 9876543210"
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
  onPlaced,
}: {
  products: Product[];
  restaurantId: string;
  onPlaced: (o: Order) => void;
}) {
  const [cat, setCat] =
    useState("Starters");

  const [cart, setCart] =
    useState<Item[]>([]);

  const [source, setSource] =
    useState<
      OrderSource | ""
    >("");

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
            "UPI",

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
          "UPI",

        createdAt:
          order.created_at,
      };

      onPlaced(
        newOrder
      );

      setCart([]);
      setSource("");
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
                    {count}
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
                      {money(
                        p.price
                      )}

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
              {source ||
                "Choose order source"}
            </span>

          </div>

          <b>
            {itemCount} items
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
                    {money(
                      i.price
                    )}{" "}
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
                    {i.qty}
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
                  {money(
                    i.price *
                      i.qty
                  )}
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
            {money(total)}
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
                {s}
              </button>
            )
          )}

        </div>

        {source ===
          "DINE_IN" && (
          <input
            className="table-input"
            value={table}
            onChange={(e) =>
              setTable(
                e.target.value
              )
            }
            placeholder="Table number"
          />
        )}

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
            : `PLACE ORDER · ${money(
                total
              )}`}
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

function Orders({
  restaurantId,
  refreshKey,
}: {
  restaurantId: string;
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

  // Chart filtering — moved up here (from further below) so the data
  // fetch below can size its lookback window to whatever the user has
  // selected, instead of always fetching a fixed 60 days.
  const [periodType, setPeriodType] =
    useState<
      "day" | "week" | "month" | "year"
    >("week");
  const [numPeriods, setNumPeriods] =
    useState(4);

  useEffect(() => {
    if (!restaurantId) {
      console.log(
        "No restaurantId, skipping historical load"
      );
      return;
    }
    loadHistoricalData();
    // Re-fetch whenever the selected period changes, not just on mount —
    // otherwise picking "Year x 3" still only ever queries the old fixed window.
  }, [restaurantId, periodType, numPeriods]);

  async function loadHistoricalData() {
    setLoading(true);

    // Declared outside try{} so the catch block can still persist
    // whatever pages were successfully fetched before a later page fails
    // (e.g. a transient statement timeout deep into pagination).
    const allRows: any[] = [];

    try {
      // Look back far enough to cover whatever period/count is selected
      // in the UI (Period Type x Number of Periods), with a 60-day floor
      // so short ranges still show a reasonable amount of context.
      const daysPerPeriod =
        periodType === "day"
          ? 1
          : periodType === "week"
          ? 7
          : periodType === "month"
          ? 31
          : 366;
      const lookbackDays = Math.max(
        60,
        numPeriods * daysPerPeriod + 7
      );

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
        `(lookback: ${lookbackDays} days for ${numPeriods} ${periodType}(s))`
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
      
      setHistoricalOrders(formatted);
    } catch (err: any) {
      console.error(
        "HISTORICAL DATA ERROR:",
        err.message || err
      );

      // A later page can still fail (e.g. a transient timeout) after
      // earlier pages succeeded — keep whatever was already fetched
      // instead of throwing away the whole window, so the chart shows
      // partial history rather than nothing at all.
      if (allRows.length > 0) {
        console.warn(
          `Falling back to ${allRows.length} partially-loaded rows after error.`
        );
        setHistoricalOrders(allRows.map(formatOrder));
      }
    } finally {
      setLoading(false);
    }
  }

  function getOrdersByDate(
    date: Date,
    ordersList: Order[]
  ) {
    const dateStr = date
      .toISOString()
      .split("T")[0];

    return ordersList.filter((o) => {
      const oDate = new Date(
        o.createdAt
      )
        .toISOString()
        .split("T")[0];
      return oDate === dateStr;
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

    return { revenue: rev, count: cnt, aov: av };
  }

  // Today's metrics
  const todayMetrics =
    calculateMetrics(orders);

  // Last week same day
  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(
    lastWeekDate.getDate() - 7
  );
  const lastWeekOrders =
    getOrdersByDate(
      lastWeekDate,
      historicalOrders
    );
  const lastWeekMetrics =
    calculateMetrics(lastWeekOrders);

  // Last 7 weeks same weekday average
  const last7WeeksSameDay: Order[] = [];
  for (let w = 1; w <= 7; w++) {
    const checkDate = new Date(today);
    checkDate.setDate(
      checkDate.getDate() - 7 * w
    );

    // Only add if it's the same weekday
    if (
      checkDate.getDay() ===
      currentDayOfWeek
    ) {
      const dayOrders = getOrdersByDate(
        checkDate,
        historicalOrders
      );
      last7WeeksSameDay.push(
        ...dayOrders
      );
    }
  }
  const last7WeeksMetrics =
    calculateMetrics(
      last7WeeksSameDay
    );

  // Calculate comparison percentages
  function calcPercent(
    current: number,
    previous: number
  ): {
    percent: number;
    isGood: boolean;
  } {
    if (previous === 0) {
      return {
        percent:
          current > 0 ? 100 : 0,
        isGood: current > 0,
      };
    }

    const pct =
      ((current - previous) /
        previous) *
      100;
    return {
      percent: pct,
      isGood: pct >= 0,
    };
  }

  const revenueLWComp = calcPercent(
    todayMetrics.revenue,
    lastWeekMetrics.revenue
  );
  const orderCountLWComp =
    calcPercent(
      todayMetrics.count,
      lastWeekMetrics.count
    );
  const aovLWComp = calcPercent(
    todayMetrics.aov,
    lastWeekMetrics.aov
  );

  const revenue7WComp = calcPercent(
    todayMetrics.revenue,
    last7WeeksMetrics.revenue
  );
  const orderCount7WComp =
    calcPercent(
      todayMetrics.count,
      last7WeeksMetrics.count
    );
  const aov7WComp = calcPercent(
    todayMetrics.aov,
    last7WeeksMetrics.aov
  );

  // (periodType / numPeriods now declared near the top of this
  // component, above loadHistoricalData — see comment there.)

  // Source breakdown filtering
  const [sourcePeriodType, setSourcePeriodType] =
    useState<
      "day" | "week" | "month" | "year"
    >("day");
  const [sourceNumPeriods, setSourceNumPeriods] =
    useState(1);

  // Generate chart data based on filters
  function generateChartData() {
    const chartData: Array<{
      label: string;
      revenue: number;
      orders: number;
      aov: number;
    }> = [];

    // Combine today's orders with historical orders
    const allOrders = uniqueOrders(
      orders,
      historicalOrders
    );

    console.log(
      "generateChartData - Total orders:",
      allOrders.length,
      "Today:",
      orders.length,
      "Historical:",
      historicalOrders.length
    );

    // Reset today to start of day for proper calculations
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const msPerPeriod =
      periodType === "day"
        ? 86400000
        : periodType === "week"
        ? 604800000
        : periodType === "month"
        ? 2592000000
        : 31536000000;

    for (
      let i = numPeriods - 1;
      i >= 0;
      i--
    ) {
      let startMs: number;
      let endMs: number;

      if (periodType === "day") {
        // For days, align to day boundaries
        const daysBack = new Date(todayStart);
        daysBack.setDate(
          daysBack.getDate() - (i + 1)
        );
        const daysBackEnd = new Date(daysBack);
        daysBackEnd.setDate(
          daysBackEnd.getDate() + 1
        );
        startMs = daysBack.getTime();
        endMs = daysBackEnd.getTime();
      } else {
        // For weeks/months/years, use millisecond calculation
        startMs =
          todayEnd.getTime() -
          msPerPeriod * (i + 1);
        endMs =
          todayEnd.getTime() -
          msPerPeriod * i;
      }

      const startDate =
        new Date(startMs);

      const periodOrders =
        allOrders.filter((o) => {
          const oTime = new Date(
            o.createdAt
          ).getTime();
          return (
            oTime >= startMs &&
            oTime < endMs
          );
        });

      const rev =
        periodOrders.reduce(
          (s, o) => s + o.total,
          0
        ) || 0;
      const cnt =
        periodOrders.length || 0;
      const av = cnt ? rev / cnt : 0;

      // Debug logging for weeks
      if (periodType === "week") {
        console.log(
          `Week ${i}: ${new Date(
            startMs
          ).toISOString()} to ${new Date(
            endMs
          ).toISOString()} = ${cnt} orders, ₹${rev}`
        );
      }

      let label = "";
      if (periodType === "day") {
        label = startDate.toLocaleDateString(
          "en-IN",
          {
            month: "short",
            day: "numeric",
          }
        );
      } else if (
        periodType === "week"
      ) {
        // Label by the bucket's actual start date rather than
        // recalculating "week of the month" — the old approach reset
        // back to W1 whenever a bucket crossed into a new month,
        // producing a non-sequential, wrapping axis (e.g. W4, W1, W2...).
        label = startDate.toLocaleDateString(
          "en-IN",
          { month: "short", day: "numeric" }
        );
      } else if (
        periodType === "month"
      ) {
        label = startDate.toLocaleDateString(
          "en-IN",
          { month: "short", year: "2-digit" }
        );
      } else {
        label = String(
          startDate.getFullYear()
        );
      }

      chartData.push({
        label,
        revenue: rev,
        orders: cnt,
        aov: av,
      });
    }

    return chartData;
  }

  const chartData = useMemo(
    () => {
      const data = generateChartData();
      console.log(
        "Chart Data Generated:",
        data,
        "Historical Orders:",
        historicalOrders.length,
        "Today Orders:",
        orders.length
      );
      return data;
    },
    [
      orders,
      historicalOrders,
      periodType,
      numPeriods,
    ]
  );

  // Calculate source breakdown for selected period
  function calculateSourceBreakdown() {
    const allOrders = uniqueOrders(
      orders,
      historicalOrders
    );

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const msPerPeriod =
      sourcePeriodType === "day"
        ? 86400000
        : sourcePeriodType === "week"
        ? 604800000
        : sourcePeriodType === "month"
        ? 2592000000
        : 31536000000;

    let startMs: number;
    let endMs: number;

    if (sourcePeriodType === "day") {
      const daysBack = new Date(todayStart);
      daysBack.setDate(
        daysBack.getDate() -
          (sourceNumPeriods - 1)
      );
      const daysBackEnd = new Date(todayEnd);
      startMs = daysBack.getTime();
      endMs = daysBackEnd.getTime();
    } else {
      startMs =
        todayEnd.getTime() -
        msPerPeriod *
          sourceNumPeriods;
      endMs = todayEnd.getTime();
    }

    const periodOrders = allOrders.filter(
      (o) => {
        const oTime = new Date(
          o.createdAt
        ).getTime();
        return (
          oTime >= startMs &&
          oTime < endMs
        );
      }
    );

    const sourceMap: Record<
      string,
      number
    > = {};

    periodOrders.forEach((o) => {
      sourceMap[o.source] =
        (sourceMap[o.source] || 0) + 1;
    });

    const total = periodOrders.length;
    const breakdown = ORDER_SOURCES.map(
      (source) => {
        const count = sourceMap[source] || 0;

        return {
          source,
          count,
          percentage: total
            ? ((count / total) * 100).toFixed(1)
            : "0.0",
        };
      }
    );

    return breakdown;
  }

  const sourceBreakdown = useMemo(
    () => calculateSourceBreakdown(),
    [
      orders,
      historicalOrders,
      sourcePeriodType,
      sourceNumPeriods,
    ]
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

  return (
    <>
      <div className="date-header">
        <h2>{dateDisplay}</h2>
      </div>

      <div className="kpis">

        <Kpi
          title="Revenue today"
          value={money(
            revenue
          )}
          delta={`LW: ${revenueLWComp.percent > 0 ? "+" : ""}${revenueLWComp.percent.toFixed(1)}% | 7W Avg: ${revenue7WComp.percent > 0 ? "+" : ""}${revenue7WComp.percent.toFixed(1)}%`}
          good={
            revenueLWComp.isGood
          }
        />

        <Kpi
          title="Total orders"
          value={String(
            orders.length
          )}
          delta={`LW: ${orderCountLWComp.percent > 0 ? "+" : ""}${orderCountLWComp.percent.toFixed(1)}% | 7W Avg: ${orderCount7WComp.percent > 0 ? "+" : ""}${orderCount7WComp.percent.toFixed(1)}%`}
          good={
            orderCountLWComp.isGood
          }
        />

        <Kpi
          title="Avg order value"
          value={money(aov)}
          delta={`LW: ${aovLWComp.percent > 0 ? "+" : ""}${aovLWComp.percent.toFixed(1)}% | 7W Avg: ${aov7WComp.percent > 0 ? "+" : ""}${aov7WComp.percent.toFixed(1)}%`}
          good={aovLWComp.isGood}
        />

        <Kpi
          title="Items sold"
          value={String(items)}
          delta="Live from order items"
          good
        />

      </div>

      <div className="ai-banner">

        <Brain size={19} />

        <span>

          <b>
            AI insight:
          </b>{" "}

          {orders.length ===
          0
            ? "No orders recorded today."
            : `You have ${orders.length} orders with an average order value of ${money(
                aov
              )}.`}

        </span>

      </div>

      {/* Filter Controls */}
      <div className="card filter-controls">

        <div className="filter-group">

          <label>
            Period Type
          </label>

          <select
            value={periodType}
            onChange={(e) =>
              setPeriodType(
                e.target.value as
                  | "day"
                  | "week"
                  | "month"
                  | "year"
              )
            }
          >
            <option value="day">
              Days
            </option>
            <option value="week">
              Weeks
            </option>
            <option value="month">
              Months
            </option>
            <option value="year">
              Years
            </option>
          </select>

        </div>

        <div className="filter-group">

          <label>
            Number of Periods
          </label>

          <input
            type="number"
            min="1"
            max="52"
            value={numPeriods}
            onChange={(e) =>
              setNumPeriods(
                Math.max(
                  1,
                  parseInt(
                    e.target.value
                  ) || 1
                )
              )
            }
          />

        </div>

      </div>

      {/* Charts */}
      <div className="charts-grid">

        {/* Revenue Line Chart */}
        <div className="card chart-card">

          <div className="section-title">

            <div>
              <h2>
                Revenue Trend
              </h2>

              <span>
                {periodType ===
                  "day"
                  ? "Daily revenue"
                  : periodType ===
                    "week"
                  ? "Weekly revenue"
                  : periodType ===
                    "month"
                  ? "Monthly revenue"
                  : "Yearly revenue"}
              </span>
            </div>

          </div>

          <div className="chart">

            <ResponsiveContainer
              width="100%"
              height={300}
            >

              <LineChart data={chartData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="label"
                  fontSize={12}
                />

                <YAxis
                  fontSize={12}
                />

                <Tooltip
                  formatter={(
                    v: any
                  ) =>
                    money(
                      Number(v)
                    )
                  }
                  labelFormatter={(
                    label
                  ) =>
                    `Period: ${label}`
                  }
                />

                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#5b5ce2"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />

              </LineChart>

            </ResponsiveContainer>

          </div>

        </div>

        {/* Orders Bar Chart */}
        <div className="card chart-card">

          <div className="section-title">

            <div>
              <h2>
                Orders Count
              </h2>

              <span>
                {periodType ===
                  "day"
                  ? "Daily order count"
                  : periodType ===
                    "week"
                  ? "Weekly order count"
                  : periodType ===
                    "month"
                  ? "Monthly order count"
                  : "Yearly order count"}
              </span>
            </div>

          </div>

          <div className="chart">

            <ResponsiveContainer
              width="100%"
              height={300}
            >

              <BarChart data={chartData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="label"
                  fontSize={12}
                />

                <YAxis
                  fontSize={12}
                />

                <Tooltip
                  labelFormatter={(
                    label
                  ) =>
                    `Period: ${label}`
                  }
                />

                <Bar
                  dataKey="orders"
                  fill="#8b5cf6"
                  radius={[6, 6, 0, 0]}
                />

              </BarChart>

            </ResponsiveContainer>

          </div>

        </div>

        {/* AOV Column Chart */}
        <div className="card chart-card">

          <div className="section-title">

            <div>
              <h2>
                Avg Order Value
              </h2>

              <span>
                {periodType ===
                  "day"
                  ? "Daily AOV"
                  : periodType ===
                    "week"
                  ? "Weekly AOV"
                  : periodType ===
                    "month"
                  ? "Monthly AOV"
                  : "Yearly AOV"}
              </span>
            </div>

          </div>

          <div className="chart">

            <ResponsiveContainer
              width="100%"
              height={300}
            >

              <BarChart data={chartData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="label"
                  fontSize={12}
                />

                <YAxis
                  fontSize={12}
                />

                <Tooltip
                  formatter={(
                    v: any
                  ) =>
                    money(
                      Number(v)
                    )
                  }
                  labelFormatter={(
                    label
                  ) =>
                    `Period: ${label}`
                  }
                />

                <Bar
                  dataKey="aov"
                  fill="#ec4899"
                  radius={[6, 6, 0, 0]}
                />

              </BarChart>

            </ResponsiveContainer>

          </div>

        </div>

      </div>

      {/* Order Source Breakdown */}
      <div className="card source-breakdown-card">

        <div className="section-title">

          <div>
            <h2>
              Order Type Split
            </h2>

            <span>
              {sourcePeriodType ===
                "day"
                ? `Last ${sourceNumPeriods} day(s)`
                : sourcePeriodType ===
                  "week"
                ? `Last ${sourceNumPeriods} week(s)`
                : sourcePeriodType ===
                  "month"
                ? `Last ${sourceNumPeriods} month(s)`
                : `Last ${sourceNumPeriods} year(s)`}
            </span>
          </div>

        </div>

        <div className="filter-controls">

          <div className="filter-group">

            <label>
              Period Type
            </label>

            <select
              value={sourcePeriodType}
              onChange={(e) =>
                setSourcePeriodType(
                  e.target.value as
                    | "day"
                    | "week"
                    | "month"
                    | "year"
                )
              }
            >
              <option value="day">
                Days
              </option>
              <option value="week">
                Weeks
              </option>
              <option value="month">
                Months
              </option>
              <option value="year">
                Years
              </option>
            </select>

          </div>

          <div className="filter-group">

            <label>
              Number of Periods
            </label>

            <input
              type="number"
              min="1"
              max="52"
              value={sourceNumPeriods}
              onChange={(e) =>
                setSourceNumPeriods(
                  Math.max(
                    1,
                    parseInt(
                      e.target.value
                    ) || 1
                  )
                )
              }
            />

          </div>

        </div>

        <div className="source-breakdown">

          {sourceBreakdown.map(
            (item) => (
              <div
                key={item.source}
                className="source-item"
              >

                <div className="source-header">

                  <span className="source-name">
                    {item.source === "DINE_IN"
                      ? "Dine-in"
                      : item.source === "TAKEAWAY"
                      ? "Takeaway"
                      : item.source === "ZOMATO"
                      ? "Zomato"
                      : "Swiggy"}
                  </span>

                  <span className="source-percentage">
                    {item.percentage}%
                  </span>

                </div>

                <div className="source-bar">

                  <div
                    className="source-fill"
                    style={{
                      width: `${item.percentage}%`,
                    }}
                  />

                </div>

                <div className="source-count">
                  {item.count} of {sourceBreakdown.reduce(
                    (total, source) =>
                      total + source.count,
                    0
                  )}{" "}
                  order
                  {item.count !==
                  1
                    ? "s"
                    : ""}
                </div>

              </div>
            )
          )}

        </div>

      </div>
    </>
  );
}

/* =========================================================
   KPI
========================================================= */

function Kpi({
  title,
  value,
  delta,
  good,
}: {
  title: string;
  value: string;
  delta: string;
  good: boolean;
}) {
  return (
    <div className="card kpi">

      <span>
        {title}
      </span>

      <strong>
        {value}
      </strong>

      <small
        className={
          good
            ? "positive"
            : "negative"
        }
      >
        <TrendingUp
          size={14}
        />

        {delta}

      </small>

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
      !password ||
      !restaurantId
    ) {
      alert(
        "Fill in name, phone number, password and restaurant."
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
            placeholder="Email (optional)"
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

            </tr>

          </thead>

          <tbody>

            {loading ? (
              <tr>
                <td colSpan={5}>
                  Loading...
                </td>
              </tr>
            ) : users.length ===
              0 ? (
              <tr>
                <td colSpan={5}>
                  No users created yet.
                </td>
              </tr>
            ) : (
              users.map(
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
              onPlaced={
                handlePlaced
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

        .kpi strong {
          display: block;
          margin: 8px 0;
          font-size: 25px;
        }

        .positive {
          color: #16a34a;
          display: flex;
          gap: 5px;
          align-items: flex-start;
          font-size: 11px;
          line-height: 1.4;
          flex-wrap: wrap;
        }

        .negative {
          color: #dc2626;
          display: flex;
          gap: 5px;
          align-items: flex-start;
          font-size: 11px;
          line-height: 1.4;
          flex-wrap: wrap;
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

      `}</style>

    </div>
  );
}
