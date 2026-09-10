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

export type RestaurantRow = {
  id: string;
  name: string;
};

export const DEMO_PRODUCTS: Product[] = [
  // Starters
  { id: "demo-p1", name: "Paneer Tikka", price: 260, category: "Starters" },
  { id: "demo-p2", name: "Chicken Malai Tikka", price: 320, category: "Starters" },
  { id: "demo-p3", name: "Veg Crispy Salt & Pepper", price: 210, category: "Starters" },
  { id: "demo-p4", name: "Chicken Seekh Kebab", price: 310, category: "Starters" },
  { id: "demo-p5", name: "Hara Bhara Kebab", price: 190, category: "Starters" },

  // Mains
  { id: "demo-p6", name: "Paneer Butter Masala", price: 280, category: "Mains" },
  { id: "demo-p7", name: "Butter Chicken", price: 340, category: "Mains" },
  { id: "demo-p8", name: "Dal Makhani", price: 240, category: "Mains" },
  { id: "demo-p9", name: "Kadhai Paneer", price: 270, category: "Mains" },
  { id: "demo-p10", name: "Mutton Rogan Josh", price: 420, category: "Mains" },

  // Breads
  { id: "demo-p11", name: "Butter Naan", price: 55, category: "Breads" },
  { id: "demo-p12", name: "Garlic Naan", price: 70, category: "Breads" },
  { id: "demo-p13", name: "Tandoori Roti", price: 35, category: "Breads" },
  { id: "demo-p14", name: "Laccha Paratha", price: 65, category: "Breads" },

  // Rice & Biryani
  { id: "demo-p15", name: "Hyderabadi Chicken Biryani", price: 320, category: "Rice & Biryani" },
  { id: "demo-p16", name: "Veg Dum Biryani", price: 240, category: "Rice & Biryani" },
  { id: "demo-p17", name: "Steamed Jeera Rice", price: 160, category: "Rice & Biryani" },

  // Desserts
  { id: "demo-p18", name: "Gulab Jamun (2 pcs)", price: 90, category: "Desserts" },
  { id: "demo-p19", name: "Rasmalai (2 pcs)", price: 120, category: "Desserts" },

  // Beverages
  { id: "demo-p20", name: "Sweet Fresh Lime Soda", price: 80, category: "Beverages" },
  { id: "demo-p21", name: "Mango Lassi", price: 110, category: "Beverages" },
  { id: "demo-p22", name: "Masala Chai", price: 40, category: "Beverages" },
];

export const DEMO_TABLES: RestaurantTable[] = Array.from({ length: 30 }, (_, idx) => {
  const num = idx + 1;
  const capacity = num % 5 === 0 ? 8 : num % 3 === 0 ? 6 : num % 2 === 0 ? 2 : 4;
  return {
    id: `demo-t${num}`,
    tableNumber: `T${num}`,
    capacity,
    isActive: true,
  };
});

export const DEMO_RESTAURANTS: RestaurantRow[] = [
  { id: "demo-restaurant-1", name: "Shubham" },
  { id: "demo-restaurant-2", name: "Bawarchi Express" },
];

export const DEMO_TODAY_ORDERS: Order[] = [
  {
    id: "DEMO-1001",
    databaseId: "demo-db-1001",
    time: "12:45 PM",
    source: "DINE_IN",
    table: "T2",
    items: [
      { id: "demo-p6", name: "Paneer Butter Masala", price: 280, category: "Mains", qty: 1 },
      { id: "demo-p11", name: "Butter Naan", price: 55, category: "Breads", qty: 2 },
      { id: "demo-p20", name: "Sweet Fresh Lime Soda", price: 80, category: "Beverages", qty: 2 },
    ],
    total: 550,
    payment: "UPI",
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    closedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    serverName: "Ramesh",
  },
  {
    id: "DEMO-1002",
    databaseId: "demo-db-1002",
    time: "01:20 PM",
    source: "SWIGGY",
    items: [
      { id: "demo-p15", name: "Hyderabadi Chicken Biryani", price: 320, category: "Rice & Biryani", qty: 2 },
      { id: "demo-p21", name: "Mango Lassi", price: 110, category: "Beverages", qty: 2 },
    ],
    total: 860,
    payment: "UPI",
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    closedAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
  },
  {
    id: "DEMO-1003",
    databaseId: "demo-db-1003",
    time: "02:10 PM",
    source: "TAKEAWAY",
    customerPhone: "9876543210",
    customerName: "Vikas Sharma",
    items: [
      { id: "demo-p7", name: "Butter Chicken", price: 340, category: "Mains", qty: 1 },
      { id: "demo-p12", name: "Garlic Naan", price: 70, category: "Breads", qty: 3 },
      { id: "demo-p18", name: "Gulab Jamun (2 pcs)", price: 90, category: "Desserts", qty: 1 },
    ],
    total: 640,
    payment: "CASH",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    closedAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "DEMO-1004",
    databaseId: "demo-db-1004",
    time: "02:40 PM",
    source: "DINE_IN",
    table: "T1",
    serverName: "Suresh",
    items: [
      { id: "demo-p1", name: "Paneer Tikka", price: 260, category: "Starters", qty: 1 },
      { id: "demo-p8", name: "Dal Makhani", price: 240, category: "Mains", qty: 1 },
      { id: "demo-p13", name: "Tandoori Roti", price: 35, category: "Breads", qty: 4 },
    ],
    total: 640,
    payment: "CARD",
    createdAt: new Date(Date.now() - 900000).toISOString(),
    closedAt: null, // Occupied table
  },
];

export function getDemoHistoricalOrders(): Order[] {
  const orders: Order[] = [...DEMO_TODAY_ORDERS];
  const now = Date.now();

  const channels: OrderSource[] = ["DINE_IN", "TAKEAWAY", "SWIGGY", "ZOMATO"];
  const paymentModes = ["UPI", "CASH", "CARD"];
  const tables = ["T1", "T2", "T3", "T4", "T5", "T6"];

  let counter = 1005;

  for (let dayOffset = 1; dayOffset <= 45; dayOffset++) {
    const dayDate = new Date(now - dayOffset * 86400000);
    // 4 to 9 orders per day
    const ordersToday = 4 + ((dayOffset * 3) % 6);

    for (let o = 0; o < ordersToday; o++) {
      const ch = channels[(dayOffset + o) % channels.length];
      const hour = 12 + (o % 2 === 0 ? 0 + (o % 3) : 6 + (o % 4)); // 12-3pm or 6-10pm
      const minute = (o * 17) % 60;
      const orderDate = new Date(dayDate);
      orderDate.setHours(hour, minute, 0, 0);

      const item1 = DEMO_PRODUCTS[(dayOffset + o) % DEMO_PRODUCTS.length];
      const item2 = DEMO_PRODUCTS[(dayOffset + o + 3) % DEMO_PRODUCTS.length];
      const items = [
        { ...item1, qty: 1 + (o % 2) },
        { ...item2, qty: 1 },
      ];
      const total = items.reduce((s, i) => s + i.price * i.qty, 0);

      orders.push({
        id: `DEMO-${counter++}`,
        databaseId: `demo-db-${counter}`,
        time: orderDate.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
        source: ch,
        table: ch === "DINE_IN" ? tables[o % tables.length] : undefined,
        items,
        total,
        payment: paymentModes[o % paymentModes.length],
        createdAt: orderDate.toISOString(),
        closedAt: new Date(orderDate.getTime() + 2700000).toISOString(),
        serverName: ch === "DINE_IN" ? "Ramesh" : undefined,
      });
    }
  }

  return orders;
}

export function getDemoDayWiseTrend(startDate: Date, endDate: Date) {
  const result: Array<{
    dateKey: string;
    label: string;
    weekday: number;
    revenue: number;
    orderCount: number;
    aov: number;
    isToday: boolean;
  }> = [];

  const todayStr = new Date().toISOString().split("T")[0];
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  let seed = 12;
  while (cur <= end) {
    seed = (seed * 9301 + 49297) % 233280;
    const rnd = seed / 233280;
    const dateKey = cur.toISOString().split("T")[0];
    const isToday = dateKey === todayStr;
    const weekday = cur.getDay();
    const isWeekend = weekday === 0 || weekday === 6;

    const baseRev = isWeekend ? 14000 : 8500;
    const revenue = Math.round(baseRev + rnd * 6000);
    const orderCount = Math.max(8, Math.round(revenue / (480 + rnd * 120)));
    const aov = Math.round(revenue / orderCount);

    result.push({
      dateKey,
      label: cur.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      weekday,
      revenue,
      orderCount,
      aov,
      isToday,
    });

    cur.setDate(cur.getDate() + 1);
  }

  return result;
}

export function getDemoHourlyBuckets() {
  const buckets = [
    { bucket: 10, label: "10AM-12PM", revenue: 2400, orderCount: 5, aov: 480, items: 12 },
    { bucket: 12, label: "12PM-2PM", revenue: 14800, orderCount: 26, aov: 569, items: 68 },
    { bucket: 14, label: "2PM-4PM", revenue: 6200, orderCount: 12, aov: 516, items: 28 },
    { bucket: 16, label: "4PM-6PM", revenue: 3800, orderCount: 9, aov: 422, items: 20 },
    { bucket: 18, label: "6PM-8PM", revenue: 11500, orderCount: 21, aov: 547, items: 55 },
    { bucket: 20, label: "8PM-10PM", revenue: 19400, orderCount: 32, aov: 606, items: 84 },
    { bucket: 22, label: "10PM-12AM", revenue: 4600, orderCount: 8, aov: 575, items: 19 },
  ];
  return buckets;
}

export function getDemoCategoryDailyBreakdown(startDate: Date, endDate: Date) {
  const categories = ["Starters", "Mains", "Breads", "Rice & Biryani", "Desserts", "Beverages"];
  const byDate: Array<{
    dateKey: string;
    label: string;
    categories: Record<string, { revenue: number; orders: number; items: number }>;
  }> = [];

  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  let seed = 7;
  while (cur <= end) {
    seed = (seed * 9301 + 49297) % 233280;
    const rnd = seed / 233280;
    const dateKey = cur.toISOString().split("T")[0];
    const catRecord: Record<string, { revenue: number; orders: number; items: number }> = {};

    categories.forEach((cat, idx) => {
      const multiplier = (idx + 1) * 350;
      const rev = Math.round(multiplier + rnd * 400);
      const orders = Math.max(3, Math.round(rev / 120));
      const items = Math.max(orders, Math.round(orders * 1.5));
      catRecord[cat] = { revenue: rev, orders, items };
    });

    byDate.push({
      dateKey,
      label: cur.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      categories: catRecord,
    });

    cur.setDate(cur.getDate() + 1);
  }

  return byDate;
}
