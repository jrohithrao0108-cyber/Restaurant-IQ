export type QueuedOfflineOrder = {
  tempId: string;
  restaurantId: string;
  createdByUserId?: string | null;
  orderNumber: string;
  orderType: string;
  tableNumber: string | null;
  channel: string;
  paymentMode: string;
  total: number;
  status: string;
  items: Array<{
    id: string;
    name: string;
    price: number;
    qty: number;
    notes?: string;
    category?: string;
  }>;
  createdAt: string;
  syncAttempts: number;
  lastError?: string;
};

const QUEUE_KEY = "restaurant_iq_offline_orders_v1";
const MENU_CACHE_PREFIX = "restaurant_iq_menu_cache_";
const TABLES_CACHE_PREFIX = "restaurant_iq_tables_cache_";
const SETTINGS_KEY = "restaurant_iq_local_settings_v1";

export function getOfflineOrdersQueue(restaurantId?: string): QueuedOfflineOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: QueuedOfflineOrder[] = JSON.parse(raw);
    if (restaurantId) {
      return parsed.filter((o) => o.restaurantId === restaurantId);
    }
    return parsed;
  } catch (err) {
    console.error("Failed to read offline orders queue:", err);
    return [];
  }
}

export function enqueueOfflineOrder(order: QueuedOfflineOrder): void {
  if (typeof window === "undefined") return;
  try {
    const queue = getOfflineOrdersQueue();
    // Avoid duplicates
    const filtered = queue.filter((o) => o.tempId !== order.tempId);
    filtered.push(order);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to enqueue offline order:", err);
  }
}

export function removeOfflineOrder(tempId: string): void {
  if (typeof window === "undefined") return;
  try {
    const queue = getOfflineOrdersQueue();
    const filtered = queue.filter((o) => o.tempId !== tempId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to remove offline order:", err);
  }
}

export function updateOfflineOrder(
  tempId: string,
  patch: Partial<QueuedOfflineOrder>
): void {
  if (typeof window === "undefined") return;
  try {
    const queue = getOfflineOrdersQueue();
    const updated = queue.map((o) =>
      o.tempId === tempId ? { ...o, ...patch } : o
    );
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to update offline order:", err);
  }
}

export function cacheMenuItems(restaurantId: string, items: any[]): void {
  if (typeof window === "undefined" || !restaurantId) return;
  try {
    localStorage.setItem(
      `${MENU_CACHE_PREFIX}${restaurantId}`,
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        items,
      })
    );
  } catch (err) {
    console.error("Failed to cache menu items:", err);
  }
}

export function getCachedMenuItems(restaurantId: string): any[] | null {
  if (typeof window === "undefined" || !restaurantId) return null;
  try {
    const raw = localStorage.getItem(`${MENU_CACHE_PREFIX}${restaurantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.items || null;
  } catch (err) {
    console.error("Failed to get cached menu items:", err);
    return null;
  }
}

export function cacheTables(restaurantId: string, tables: any[]): void {
  if (typeof window === "undefined" || !restaurantId) return;
  try {
    localStorage.setItem(
      `${TABLES_CACHE_PREFIX}${restaurantId}`,
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        tables,
      })
    );
  } catch (err) {
    console.error("Failed to cache tables:", err);
  }
}

export function getCachedTables(restaurantId: string): any[] | null {
  if (typeof window === "undefined" || !restaurantId) return null;
  try {
    const raw = localStorage.getItem(`${TABLES_CACHE_PREFIX}${restaurantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.tables || null;
  } catch (err) {
    console.error("Failed to get cached tables:", err);
    return null;
  }
}

type LocalSettings = {
  paperWidth: "80mm" | "58mm";
  autoPrintKot: boolean;
};

export function getLocalSettings(): LocalSettings {
  const defaults: LocalSettings = {
    paperWidth: "80mm",
    autoPrintKot: true,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function saveLocalSettings(patch: Partial<LocalSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const current = getLocalSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (err) {
    console.error("Failed to save local settings:", err);
  }
}
