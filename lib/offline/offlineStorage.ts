import {
  dbDeleteOrder,
  dbGetAllOrders,
  dbGetCache,
  dbGetOrdersByRestaurant,
  dbPutCache,
  dbPutOrder,
} from "./offlineDB";

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
  permanentlyFailed?: boolean;
  /**
   * "OPEN"    -> came from KOT print / Save (running tab). Sync should
   *              create-or-merge into the table's order WITHOUT closing it,
   *              so later rounds for the same table keep consolidating.
   * "SETTLED" -> came from Settle & Pay. Sync should create-or-merge and
   *              then close the order (closed_at set).
   * Missing/undefined is treated as "SETTLED" for backward compatibility
   * with orders queued before this field existed.
   */
  orderPhase?: "OPEN" | "SETTLED";
};

export const MAX_SYNC_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Order queue — now backed by IndexedDB (see ./offlineDB) instead of a single
// localStorage JSON blob. Same function names/signatures as before EXCEPT:
//   - these all now return Promises (IndexedDB is inherently async), and
//   - enqueueOfflineOrder is kept "fire and forget" (its call site in
//     RestaurantPOS.tsx doesn't await it today) — it still returns void and
//     resolves the write in the background, so no call-site changes needed
//     there. Every other queue function is genuinely async and any caller
//     needs `await` — none of the currently-uploaded files call them
//     directly today (only offlineSync.ts does, updated to match), but if
//     you build a "review failed orders" screen later, await these.
// ---------------------------------------------------------------------------

export async function getOfflineOrdersQueue(restaurantId?: string): Promise<QueuedOfflineOrder[]> {
  try {
    return restaurantId
      ? await dbGetOrdersByRestaurant<QueuedOfflineOrder>(restaurantId)
      : await dbGetAllOrders<QueuedOfflineOrder>();
  } catch (err) {
    console.error("Failed to read offline orders queue:", err);
    return [];
  }
}

/** Orders that have exhausted MAX_SYNC_ATTEMPTS and need manual attention. */
export async function getFailedOfflineOrders(restaurantId?: string): Promise<QueuedOfflineOrder[]> {
  const all = await getOfflineOrdersQueue(restaurantId);
  return all.filter((o) => o.permanentlyFailed);
}

/** Orders still eligible for an automatic sync attempt. */
export async function getPendingOfflineOrders(restaurantId?: string): Promise<QueuedOfflineOrder[]> {
  const all = await getOfflineOrdersQueue(restaurantId);
  return all.filter((o) => !o.permanentlyFailed);
}

/** Reset a permanently-failed order so it will be retried again (e.g. after a manual fix). */
export async function retryOfflineOrder(tempId: string): Promise<void> {
  await updateOfflineOrder(tempId, {
    permanentlyFailed: false,
    syncAttempts: 0,
    lastError: undefined,
  });
}

/**
 * Fire-and-forget by design, matching how RestaurantPOS.tsx calls this
 * today (inside a sync try/catch, never awaited). The actual IndexedDB
 * write happens in the background; failures are logged, not thrown, so the
 * settle flow's UI never blocks or breaks on this.
 */
export function enqueueOfflineOrder(order: QueuedOfflineOrder): void {
  dbPutOrder(order).catch((err) => {
    console.error("Failed to enqueue offline order:", err);
  });
}

export async function removeOfflineOrder(tempId: string): Promise<void> {
  try {
    await dbDeleteOrder(tempId);
  } catch (err) {
    console.error("Failed to remove offline order:", err);
  }
}

export async function updateOfflineOrder(
  tempId: string,
  patch: Partial<QueuedOfflineOrder>
): Promise<void> {
  try {
    const all = await dbGetAllOrders<QueuedOfflineOrder>();
    const existing = all.find((o) => o.tempId === tempId);
    if (!existing) return;
    await dbPutOrder({ ...existing, ...patch });
  } catch (err) {
    console.error("Failed to update offline order:", err);
  }
}

// ---------------------------------------------------------------------------
// Menu / tables cache — also moved to IndexedDB. Both call sites in
// page.tsx's loadRestaurantData are already inside an async function, so
// this only requires adding `await` in front of the two READ calls
// (getCachedMenuItems / getCachedTables) in the catch block; the two WRITE
// calls (cacheMenuItems / cacheTables) are kept fire-and-forget the same
// way enqueueOfflineOrder is, so those two call sites need no changes.
// ---------------------------------------------------------------------------

export function cacheMenuItems(restaurantId: string, items: any[]): void {
  if (!restaurantId) return;
  dbPutCache("menu", restaurantId, { cachedAt: new Date().toISOString(), items }).catch(
    (err) => console.error("Failed to cache menu items:", err)
  );
}

export async function getCachedMenuItems(restaurantId: string): Promise<any[] | null> {
  if (!restaurantId) return null;
  try {
    const cached = await dbGetCache<{ items: any[] }>("menu", restaurantId);
    return cached?.items || null;
  } catch (err) {
    console.error("Failed to get cached menu items:", err);
    return null;
  }
}

export function cacheTables(restaurantId: string, tables: any[]): void {
  if (!restaurantId) return;
  dbPutCache("tables", restaurantId, { cachedAt: new Date().toISOString(), tables }).catch(
    (err) => console.error("Failed to cache tables:", err)
  );
}

export async function getCachedTables(restaurantId: string): Promise<any[] | null> {
  if (!restaurantId) return null;
  try {
    const cached = await dbGetCache<{ tables: any[] }>("tables", restaurantId);
    return cached?.tables || null;
  } catch (err) {
    console.error("Failed to get cached tables:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local device settings — unchanged, still localStorage on purpose.
// getLocalSettings() is called synchronously inside a useState initializer
// and directly inside JSX (`value={getLocalSettings().paperWidth}`) in
// RestaurantPOS.tsx — IndexedDB can't support that without restructuring
// those call sites to state + useEffect, and there's no real benefit to
// moving two tiny scalar fields off localStorage.
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "restaurant_iq_local_settings_v1";

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
