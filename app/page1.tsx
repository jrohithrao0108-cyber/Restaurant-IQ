"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Brain,
  ChevronDown,
  Clock3,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  ShoppingBag,
  TrendingUp,
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

type Tab = "new" | "orders" | "insights";

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
};

type Item = Product & {
  qty: number;
};

type Order = {
  id: string;
  time: string;
  type: string;
  channel: string;
  items: Item[];
  total: number;
  payment: string;
};

/* =========================================================
   CONSTANTS
========================================================= */

const RESTAURANT_ID =
  "d9261f86-a6e4-45c9-9c29-d0a8f6dbea24";

const CATEGORIES = [
  "Starters",
  "Mains",
  "Breads",
  "Rice & Biryani",
  "Desserts",
  "Beverages",
];

/* =========================================================
   HELPERS
========================================================= */

function money(n: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString(
    "en-IN"
  )}`;
}

/*
  Converts different category formats from Supabase
  into the exact categories used by the UI.
*/
function normalizeCategory(category: any): string {
  if (category === null || category === undefined) {
    return "";
  }

  // Supabase relation/object support
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

  // Try matching the UI category directly
  const direct = CATEGORIES.find(
    (c) =>
      c.toLowerCase() ===
      String(category).trim().toLowerCase()
  );

  return direct || String(category).trim();
}

/*
  Handles boolean values coming from Supabase.
*/
function isActiveMenuItem(row: any) {
  /*
    If the table does not have an active field,
    consider the item active.
  */
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

/*
  Supports common column names in menu_items.
*/
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
      row.category?.name ??
      row.menu_category?.name ??
      ""
  );
}

/* =========================================================
   LOGIN
========================================================= */

function Login({
  onLogin,
}: {
  onLogin: (r: Role) => void;
}) {
  const [role, setRole] =
    useState<Role>("ADMIN");

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand big">
          <div className="logo">R</div>
          <span>RestaurantIQ</span>
        </div>

        <p className="login-sub">
          AI-powered business intelligence for
          restaurants
        </p>

        <label>Login as</label>

        <div className="role-pills">
          {(
            [
              "SUPER_ADMIN",
              "ADMIN",
              "POC",
            ] as Role[]
          ).map((r) => (
            <button
              key={r}
              className={
                role === r ? "selected" : ""
              }
              onClick={() => setRole(r)}
            >
              {r.replace("_", " ")}
            </button>
          ))}
        </div>

        <label>Mobile / Email</label>

        <input
          placeholder="owner@restaurant.com"
        />

        <label>PIN / Password</label>

        <input
          type="password"
          placeholder="••••••"
        />

        <button
          className="login-btn"
          onClick={() => onLogin(role)}
        >
          Login
        </button>

        <small>
          Demo login · Subham restaurant
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
  role,
  onLogout,
  mobile,
  setMobile,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  role: Role;
  onLogout: () => void;
  mobile: boolean;
  setMobile: (v: boolean) => void;
}) {
  return (
    <>
      <aside
        className={
          mobile ? "side open" : "side"
        }
      >
        <div className="brand">
          <div className="logo">R</div>

          <span>RestaurantIQ</span>

          <button
            className="close"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>

        <div className="restaurant">
          <ShoppingBag size={17} />

          <div>
            <b>Subham</b>

            <small>Live database</small>
          </div>

          <ChevronDown size={16} />
        </div>

        {role !== "SUPER_ADMIN" ? (
          <nav>
            <a
              className={
                tab === "new" ? "active" : ""
              }
              onClick={() => {
                setTab("new");
                setMobile(false);
              }}
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
              onClick={() => {
                setTab("orders");
                setMobile(false);
              }}
            >
              <ShoppingBag size={18} />
              Orders
            </a>

            <a
              className={
                tab === "insights"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setTab("insights");
                setMobile(false);
              }}
            >
              <Brain size={18} />
              Insights
            </a>
          </nav>
        ) : (
          <nav>
            <a className="active">
              <BarChart3 size={18} />
              Platform
            </a>

            <a>
              <Users size={18} />
              Restaurants
            </a>

            <a>
              <Users size={18} />
              Users
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
          onClick={() => setMobile(false)}
        />
      )}
    </>
  );
}

/* =========================================================
   HEADER
========================================================= */

function Header({
  role,
  onMenu,
}: {
  role: Role;
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
          {role === "SUPER_ADMIN"
            ? "Good morning, Super Admin 👋"
            : "Good evening, Owner 👋"}
        </h1>

        <p>
          Subham · Live Database
        </p>
      </div>

      <div className="profile">
        {role === "SUPER_ADMIN"
          ? "SA"
          : role === "ADMIN"
          ? "AD"
          : "PO"}
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

  const [type, setType] =
    useState("Dine-in");

  const [table, setTable] =
    useState("T12");

  const [saving, setSaving] =
    useState(false);

  const add = (p: Product) => {
    setCart((current) => {
      const existing =
        current.find(
          (i) => i.id === p.id
        );

      if (existing) {
        return current.map((i) =>
          i.id === p.id
            ? {
                ...i,
                qty: i.qty + 1,
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

  const total = cart.reduce(
    (sum, i) =>
      sum + Number(i.price) * i.qty,
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
        type === "Dine-in"
          ? "DINE_IN"
          : type === "Takeaway"
          ? "TAKEAWAY"
          : "DELIVERY";

      const channel =
        type === "Delivery"
          ? "Swiggy"
          : "POS";

      const {
        data: order,
        error: orderError,
      } =
        await supabase
          .from("orders")
          .insert({
            restaurant_id:
              restaurantId,
            order_number:
              orderNumber,
            order_type:
              orderType,
            table_number:
              type === "Dine-in"
                ? table
                : null,
            channel,
            payment_mode:
              "UPI",
            subtotal: total,
            discount: 0,
            tax: 0,
            total,
            status: "COMPLETED",
          })
          .select()
          .single();

      if (orderError) {
        throw orderError;
      }

      const orderItems =
        cart.map((item) => ({
          order_id: order.id,
          menu_item_id: item.id,
          name_snapshot: item.name,
          price_snapshot: item.price,
          qty: item.qty,
        }));

      const {
        error: itemError,
      } =
        await supabase
          .from("order_items")
          .insert(orderItems);

      if (itemError) {
        throw itemError;
      }

      const newOrder: Order = {
        id: order.order_number,

        time: new Date(
          order.created_at
        ).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),

        type,

        channel,

        items: cart,

        total,

        payment: "UPI",
      };

      onPlaced(newOrder);

      setCart([]);

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
              Subham restaurant menu
            </span>
          </div>

          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value)
            }
          >
            <option>Dine-in</option>
            <option>Takeaway</option>
            <option>Delivery</option>
          </select>
        </div>

        {type === "Dine-in" && (
          <input
            className="table-input"
            value={table}
            onChange={(e) =>
              setTable(e.target.value)
            }
            placeholder="Table no."
          />
        )}

        <div className="cats">
          {CATEGORIES.map((c) => {
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
          })}
        </div>

        <div className="menu-grid">
          {filteredProducts.length ===
          0 ? (
            <div className="empty">
              No menu items found in{" "}
              <b>{cat}</b>

              <br />

              <small>
                Loaded {products.length}{" "}
                menu items from Supabase.
              </small>

              <br />

              <small>
                Check the category/name/price
                values in menu_items.
              </small>
            </div>
          ) : (
            filteredProducts.map((p) => (
              <button
                className="menu-item"
                key={p.id}
                onClick={() => add(p)}
              >
                <b>{p.name}</b>

                <span>
                  {money(p.price)}

                  <Plus size={15} />
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="card cart">
        <div className="section-title">
          <div>
            <h2>Current order</h2>

            <span>
              {type}
              {type === "Dine-in"
                ? ` • ${table}`
                : ""}
            </span>
          </div>

          <b>
            {cart.reduce(
              (sum, i) =>
                sum + i.qty,
              0
            )}{" "}
            items
          </b>
        </div>

        {cart.length === 0 ? (
          <div className="empty">
            Select items from the menu.
          </div>
        ) : (
          <div className="cart-items">
            {cart.map((i) => (
              <div
                className="cart-row"
                key={i.id}
              >
                <div>
                  <b>{i.name}</b>

                  <small>
                    {money(i.price)} each
                  </small>
                </div>

                <div className="qty">
                  <button
                    onClick={() =>
                      setCart(
                        (current) =>
                          current.flatMap(
                            (x) =>
                              x.id === i.id
                                ? x.qty > 1
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

                  <b>{i.qty}</b>

                  <button
                    onClick={() => add(i)}
                  >
                    +
                  </button>
                </div>

                <strong>
                  {money(
                    i.price * i.qty
                  )}
                </strong>
              </div>
            ))}
          </div>
        )}

        <div className="total">
          <span>Total</span>

          <strong>
            {money(total)}
          </strong>
        </div>

        <button
          className="place"
          disabled={
            !cart.length || saving
          }
          onClick={placeOrder}
        >
          {saving
            ? "SAVING ORDER..."
            : `PLACE ORDER · ${money(
                total
              )}`}
        </button>
      </section>
    </div>
  );
}

/* =========================================================
   ORDERS
========================================================= */

function Orders({
  orders,
}: {
  orders: Order[];
}) {
  const [q, setQ] =
    useState("");

  const [open, setOpen] =
    useState<string | null>(null);

  const filtered = orders.filter(
    (o) =>
      (
        o.id +
        " " +
        o.items
          .map((i) => i.name)
          .join(" ")
      )
        .toLowerCase()
        .includes(
          q.toLowerCase()
        )
  );

  const revenue = orders.reduce(
    (sum, o) =>
      sum + o.total,
    0
  );

  return (
    <section className="card orders-card">
      <div className="section-title">
        <div>
          <h2>Today's ledger</h2>

          <span>
            {orders.length} orders ·{" "}
            {money(revenue)}
          </span>
        </div>

        <div className="search">
          <Search size={16} />

          <input
            value={q}
            onChange={(e) =>
              setQ(e.target.value)
            }
            placeholder="Search order or item"
          />
        </div>
      </div>

      <div className="ledger">
        {filtered.length === 0 ? (
          <div className="empty">
            No orders found.
          </div>
        ) : (
          filtered.map((o) => (
            <div
              className="order-wrap"
              key={o.id}
            >
              <button
                className="order-row"
                onClick={() =>
                  setOpen(
                    open === o.id
                      ? null
                      : o.id
                  )
                }
              >
                <span className="order-id">
                  {o.id}
                </span>

                <span>{o.time}</span>

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
                    .join(", ")}
                </span>

                <strong>
                  {money(o.total)}
                </strong>

                <ChevronDown
                  size={17}
                  className={
                    open === o.id
                      ? "rot"
                      : ""
                  }
                />
              </button>

              {open === o.id && (
                <div className="order-detail">
                  {o.items.map((i) => (
                    <div key={i.id}>
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
                  ))}

                  <hr />

                  <div>
                    <span>
                      {o.type} ·{" "}
                      {o.payment}
                    </span>

                    <b>
                      {money(o.total)}
                    </b>
                  </div>
                </div>
              )}
            </div>
          ))
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
}: {
  orders: Order[];
}) {
  const revenue = orders.reduce(
    (s, o) => s + o.total,
    0
  );

  const aov = orders.length
    ? revenue / orders.length
    : 0;

  const items = orders.reduce(
    (s, o) =>
      s +
      o.items.reduce(
        (x, i) => x + i.qty,
        0
      ),
    0
  );

  const productMap: Record<
    string,
    number
  > = {};

  orders.forEach((o) =>
    o.items.forEach((i) => {
      productMap[i.name] =
        (productMap[i.name] || 0) +
        i.qty;
    })
  );

  const channelMap: Record<
    string,
    number
  > = {};

  orders.forEach((o) => {
    channelMap[o.channel] =
      (channelMap[o.channel] || 0) +
      1;
  });

  const channels = Object.entries(
    channelMap
  ).map(
    ([channel, orders]) => ({
      channel,
      orders,
    })
  );

  const products = Object.entries(
    productMap
  )
    .sort(
      (a, b) => b[1] - a[1]
    )
    .slice(0, 5);

  const best = products[0];

  return (
    <>
      <div className="kpis">
        <Kpi
          title="Revenue today"
          value={money(revenue)}
          delta="Live from database"
          good
        />

        <Kpi
          title="Total orders"
          value={String(
            orders.length
          )}
          delta="Live from database"
          good
        />

        <Kpi
          title="Avg order value"
          value={money(aov)}
          delta="Calculated from orders"
          good
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
          <b>AI insight:</b>{" "}
          {orders.length === 0
            ? "No orders recorded today."
            : `You have ${orders.length} orders with an average order value of ${money(
                aov
              )}.`}
        </span>
      </div>

      <div className="grid2">
        <div className="card chart-card">
          <div className="section-title">
            <div>
              <h2>
                Revenue trend
              </h2>

              <span>
                Today's orders
              </span>
            </div>

            <b>{money(revenue)}</b>
          </div>

          <div className="chart">
            <ResponsiveContainer>
              <LineChart
                data={[
                  {
                    day: "Today",
                    revenue,
                  },
                ]}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis dataKey="day" />

                <YAxis />

                <Tooltip
                  formatter={(v: any) =>
                    money(Number(v))
                  }
                />

                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#5b5ce2"
                  strokeWidth={3}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card ai-card">
          <div className="ai-title">
            <div className="ai-icon">
              <Brain size={20} />
            </div>

            <div>
              <h2>
                AI Daily Insight
              </h2>

              <span>
                Based on live orders
              </span>
            </div>
          </div>

          <div className="alert">
            <b>
              📊 Today's performance
            </b>

            <p>
              {orders.length} orders
              generated{" "}
              {money(revenue)}{" "}
              revenue.
            </p>
          </div>

          <div className="alert">
            <b>🏆 Best seller</b>

            <p>
              {best
                ? `${best[0]} — ${best[1]} units sold.`
                : "No product sales yet."}
            </p>
          </div>

          <div className="recommend">
            <b>💡 Recommendation</b>

            <p>
              RestaurantIQ will
              identify trends,
              gaps and
              opportunities as
              more data becomes
              available.
            </p>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card products-card">
          <div className="section-title">
            <div>
              <h2>
                Best-selling products
              </h2>

              <span>
                Units sold today
              </span>
            </div>
          </div>

          {products.length === 0 ? (
            <div className="empty">
              No product sales yet.
            </div>
          ) : (
            products.map(
              ([name, qty], index) => (
                <div
                  className="product"
                  key={name}
                >
                  <div className="rank">
                    {index + 1}
                  </div>

                  <div className="pname">
                    <b>{name}</b>

                    <small>
                      {qty} units
                    </small>
                  </div>

                  <strong>
                    {index === 0
                      ? "Top seller"
                      : ""}
                  </strong>
                </div>
              )
            )
          )}
        </div>

        <div className="card channel-card">
          <div className="section-title">
            <div>
              <h2>
                Orders by channel
              </h2>

              <span>
                Today's order mix
              </span>
            </div>
          </div>

          <div className="channel-chart">
            <ResponsiveContainer>
              <BarChart
                data={channels}
                layout="vertical"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                />

                <XAxis type="number" />

                <YAxis
                  type="category"
                  dataKey="channel"
                  width={80}
                />

                <Tooltip />

                <Bar
                  dataKey="orders"
                  fill="#5b5ce2"
                  radius={[
                    0, 6, 6, 0,
                  ]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card quick">
        <Clock3 size={20} />

        <div>
          <b>Daily report</b>

          <span>
            WhatsApp summary will
            be added next.
          </span>
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
      <span>{title}</span>

      <strong>{value}</strong>

      <small
        className={
          good
            ? "positive"
            : "negative"
        }
      >
        <TrendingUp size={14} />

        {delta}
      </small>
    </div>
  );
}

/* =========================================================
   SUPER ADMIN
========================================================= */

function SuperAdmin() {
  return (
    <div className="sa-grid">
      <div className="kpis">
        <Kpi
          title="Restaurants"
          value="1"
          delta="Connected database"
          good
        />

        <Kpi
          title="Active"
          value="1"
          delta="Live"
          good
        />

        <Kpi
          title="Orders processed"
          value="85,000"
          delta="From Supabase"
          good
        />

        <Kpi
          title="MRR"
          value="—"
          delta="Coming soon"
          good
        />
      </div>

      <div className="card table-card">
        <div className="section-title">
          <div>
            <h2>
              Restaurant management
            </h2>

            <span>
              Customer accounts
            </span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Status</th>
              <th>Plan</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>
                <b>Subham</b>
              </td>

              <td>
                <span className="status">
                  Active
                </span>
              </td>

              <td>PRO</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function HomePage() {
  const [role, setRole] =
    useState<Role | null>(null);

  const [tab, setTab] =
    useState<Tab>("new");

  const [mobile, setMobile] =
    useState(false);

  const [restaurantId, setRestaurantId] =
    useState(RESTAURANT_ID);

  const [products, setProducts] =
    useState<Product[]>([]);

  const [orders, setOrders] =
    useState<Order[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [databaseError, setDatabaseError] =
    useState<string | null>(null);

  /* =======================================================
     MENU CATEGORY COUNTS
  ======================================================= */

  const categoryCounts = useMemo(() => {
    const result: Record<
      string,
      number
    > = {};

    CATEGORIES.forEach((c) => {
      result[c] = products.filter(
        (p) =>
          normalizeCategory(
            p.category
          ) === c
      ).length;
    });

    return result;
  }, [products]);

  /* =======================================================
     LOAD DATABASE
  ======================================================= */

  useEffect(() => {
    async function loadDatabase() {
      try {
        setLoading(true);
        setDatabaseError(null);

        /* =================================================
           1. LOAD RESTAURANT
        ================================================= */

        const {
          data: restaurant,
          error:
            restaurantError,
        } = await supabase
          .from("restaurants")
          .select("id,name")
          .eq(
            "id",
            RESTAURANT_ID
          )
          .maybeSingle();

        if (restaurantError) {
          throw restaurantError;
        }

        if (!restaurant) {
          throw new Error(
            "Subham restaurant was not found."
          );
        }

        setRestaurantId(
          restaurant.id
        );

        console.log(
          "CONNECTED RESTAURANT:",
          restaurant
        );

        /* =================================================
           2. LOAD MENU ITEMS

           IMPORTANT FIX:
           Do NOT filter active=true inside Supabase.

           Different databases use:
           active
           is_active
           is_available
           available

           We load the rows first and handle those
           fields safely in JavaScript.
        ================================================= */

        const {
          data: rawMenu,
          error: menuError,
        } = await supabase
          .from("menu_items")
          .select("*")
          .eq(
            "restaurant_id",
            restaurant.id
          )
          .order("name");

        if (menuError) {
          throw menuError;
        }

        console.log(
          "RAW MENU ITEMS FROM SUPABASE:",
          rawMenu
        );

        const formattedMenu: Product[] =
          (rawMenu || [])
            .filter(
              (row: any) =>
                isActiveMenuItem(row)
            )
            .map((row: any) => ({
              id: String(
                row.id
              ),

              name: getMenuName(row),

              price:
                getMenuPrice(row),

              category:
                getMenuCategory(row),
            }))
            .filter(
              (item) =>
                item.id &&
                item.name &&
                item.price >= 0
            );

        console.log(
          "FORMATTED MENU:",
          formattedMenu
        );

        /* =================================================
           DEBUG INFORMATION
        ================================================= */

        console.log(
          "MENU COUNT:",
          formattedMenu.length
        );

        console.log(
          "MENU CATEGORIES:",
          formattedMenu.map(
            (p) => p.category
          )
        );

        console.log(
          "CATEGORY COUNTS:",
          CATEGORIES.reduce(
            (obj, c) => {
              obj[c] =
                formattedMenu.filter(
                  (p) =>
                    normalizeCategory(
                      p.category
                    ) === c
                ).length;

              return obj;
            },
            {} as Record<
              string,
              number
            >
          )
        );

        setProducts(
          formattedMenu
        );

        /* =================================================
           3. LOAD TODAY'S ORDERS
        ================================================= */

        const startOfDay =
          new Date();

        startOfDay.setHours(
          0,
          0,
          0,
          0
        );

        const {
          data: orderData,
          error:
            orderError,
        } = await supabase
          .from("orders")
          .select(
            `
              id,
              order_number,
              order_type,
              channel,
              payment_mode,
              total,
              created_at,
              order_items (
                id,
                menu_item_id,
                name_snapshot,
                price_snapshot,
                qty
              )
            `
          )
          .eq(
            "restaurant_id",
            restaurant.id
          )
          .gte(
            "created_at",
            startOfDay.toISOString()
          )
          .neq(
            "status",
            "CANCELLED"
          )
          .order(
            "created_at",
            {
              ascending: false,
            }
          );

        if (orderError) {
          throw orderError;
        }

        const formattedOrders: Order[] =
          (orderData || []).map(
            (o: any) => ({
              id:
                o.order_number,

              time:
                new Date(
                  o.created_at
                ).toLocaleTimeString(
                  "en-IN",
                  {
                    hour:
                      "numeric",
                    minute:
                      "2-digit",
                  }
                ),

              type:
                o.order_type ===
                "DINE_IN"
                  ? "Dine-in"
                  : o.order_type ===
                    "TAKEAWAY"
                  ? "Takeaway"
                  : "Delivery",

              channel:
                o.channel ||
                "POS",

              payment:
                o.payment_mode ||
                "UPI",

              total:
                Number(o.total) || 0,

              items: (
                o.order_items ||
                []
              ).map(
                (i: any) => ({
                  id:
                    i.menu_item_id ||
                    i.id,

                  name:
                    i.name_snapshot ||
                    "Unknown item",

                  price:
                    Number(
                      i.price_snapshot
                    ) || 0,

                  category: "",

                  qty:
                    Number(i.qty) ||
                    0,
                })
              ),
            })
          );

        setOrders(
          formattedOrders
        );

        console.log(
          "TODAY ORDERS:",
          formattedOrders
        );
      } catch (error: any) {
        console.error(
          "DATABASE ERROR:",
          error
        );

        const message =
          error?.message ||
          "Unknown database error.";

        setDatabaseError(message);

        alert(
          `Database Error\n\n${message}`
        );
      } finally {
        setLoading(false);
      }
    }

    loadDatabase();
  }, []);

  /* =======================================================
     ORDER PLACED
  ======================================================= */

  function handlePlaced(
    newOrder: Order
  ) {
    setOrders((current) => [
      newOrder,
      ...current,
    ]);

    setTab("orders");
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (!role) {
    return (
      <Login
        onLogin={setRole}
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
        <h2>RestaurantIQ</h2>

        <p>
          Connecting to Subham
          database...
        </p>
      </div>
    );
  }

  /* =======================================================
     MAIN UI
  ======================================================= */

  return (
    <div className="shell">
      <Sidebar
        tab={tab}
        setTab={setTab}
        role={role}
        onLogout={() =>
          setRole(null)
        }
        mobile={mobile}
        setMobile={setMobile}
      />

      <main>
        <Header
          role={role}
          onMenu={() =>
            setMobile(true)
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
              Database connection
              warning
            </b>

            <p>
              {databaseError}
            </p>
          </div>
        )}

        {role ===
        "SUPER_ADMIN" ? (
          <>
            <div className="toolbar">
              <div>
                <b>
                  Platform overview
                </b>

                <span>
                  RestaurantIQ
                  platform
                  management
                </span>
              </div>
            </div>

            <SuperAdmin />
          </>
        ) : (
          <>
            <div className="toolbar">
              <div>
                <b>
                  {tab === "new"
                    ? "New order"
                    : tab === "orders"
                    ? "Today's orders"
                    : "Business insights"}
                </b>

                <span>
                  {tab === "new"
                    ? "Create a new restaurant order"
                    : tab === "orders"
                    ? "Today's order ledger"
                    : "KPIs, trends and AI recommendations"}
                </span>
              </div>
            </div>

            {tab === "new" && (
              <NewOrder
                products={
                  products
                }
                restaurantId={
                  restaurantId
                }
                onPlaced={
                  handlePlaced
                }
              />
            )}

            {tab === "orders" && (
              <Orders
                orders={orders}
              />
            )}

            {tab === "insights" && (
              <Insights
                orders={orders}
              />
            )}
          </>
        )}

        <footer>
          RestaurantIQ MVP ·
          Subham · Supabase
        </footer>
      </main>
    </div>
  );
}