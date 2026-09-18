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
  // Set whenever a sync attempt fails, so syncAll() can back off before the
  // next try instead of hammering the same request every 3.5s. Without
  // this, 5 attempts exhaust in ~17.5s — nowhere near enough time for a
  // real transient blip (flaky WiFi, a captive portal, Supabase briefly
  // rate-limiting right at reconnect) to clear before the order gives up
  // permanently.
  lastAttemptAt?: string;
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

// Spread out over backoff (see BACKOFF_SCHEDULE_MS in offlineSync.ts), 8
// attempts span roughly 45+ minutes before giving up — long enough to ride
// out real-world flaky connectivity, short enough that a genuinely broken
// record (bad data, RLS issue) still surfaces for manual review same-day.
export const MAX_SYNC_ATTEMPTS = 8;

// Queue writes may arrive from rapid Save/KOT taps. Serialize the small
// read-merge-write operation so two saves for the same running table cannot
// both decide that no pending table record exists.
let enqueueChain: Promise<void> = Promise.resolve();

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
export async function enqueueOfflineOrder(order: QueuedOfflineOrder): Promise<void> {
  const write = enqueueChain.catch(() => {}).then(async () => {
    // A running dine-in table is one local order, even when the waiter saves
    // several rounds. Merge unsynced OPEN rounds into the existing record;
    // settled/takeaway/delivery orders always remain distinct records.
    //
    // INVARIANT this relies on: `order.items` / `order.total` always
    // represent the FULL current state of the table's cart at the moment
    // Save/KOT was pressed — never just "items added since the last save".
    // (RestaurantPOS.tsx keeps the cart populated with the table's running
    // total after Save/KOT instead of clearing it, specifically so this
    // holds even when the waiter navigates away and back to the table.)
    //
    // Because of that, a second save for the same still-open table must
    // REPLACE the locally queued record wholesale, not add quantities on
    // top of it. Summing used to double-count items that were already
    // included in both saves, and could never reflect an item the waiter
    // removed from the cart (removal would just add "0 more", never take
    // anything away) — replacing fixes both.
    // A dine-in table has at most one local record at a time. This must
    // match regardless of whether the INCOMING save is another OPEN
    // KOT/Save or the final SETTLED Settle & Pay — either way it has to
    // replace whatever's already queued for this table, not leave it
    // behind. (Matching only when the incoming order was OPEN meant a
    // Settle call, which is never OPEN, skipped this block entirely and
    // left the prior OPEN record as an orphan — one that offlineSync.ts
    // would eventually try to sync as its own open order, potentially
    // AFTER the table had already been closed out by the settle.)
    if (order.orderType === "DINE_IN" && order.tableNumber) {
      const queue = await getOfflineOrdersQueue(order.restaurantId);
      const existing = queue.find(
        (queued) =>
          !queued.permanentlyFailed &&
          queued.orderType === "DINE_IN" &&
          queued.tableNumber === order.tableNumber &&
          // Don't touch a record that's already been handed off to sync —
          // a brand-new sitting starting right after a settle gets its own
          // fresh record instead of clobbering the settle still in flight.
          queued.orderPhase !== "SETTLED"
      );

      if (existing) {
        // Keep the original queue identity (tempId) so this stays one local
        // record per open table — everything else (items, total, syncAttempts,
        // etc.) is taken fresh from the incoming full-state order.
        await dbPutOrder({
          ...order,
          tempId: existing.tempId,
        });
        return;
      }
    }

    await dbPutOrder(order);
  });

  enqueueChain = write;
  try {
    await write;
  } catch (err) {
    console.error("Failed to enqueue offline order:", err);
    throw err;
  }
}

export async function removeOfflineOrder(tempId: string): Promise<boolean> {
  try {
    await dbDeleteOrder(tempId);
    return true;
  } catch (err) {
    console.error("Failed to remove offline order:", err);
    return false;
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
  // Whether Settle also fires a kitchen ticket automatically. Off by
  // default — Settle just settles; printing is an explicit opt-in via the
  // checkbox next to the Settle button, not a surprise side effect.
  autoPrintKot: boolean;
  // Whether the cart panel's "Settle" button also prints the customer bill.
  // Off by default, same reasoning — Quick Settle (Tables grid) never
  // prints either way; "Bill" is a separate, explicit button there.
  autoPrintBillOnSettle: boolean;
  // Combined GST %, split evenly into CGST/SGST halves for the receipt
  // (e.g. 5 -> 2.5% + 2.5%). Defaults to 0 — GST is off until a restaurant
  // explicitly sets its actual rate, instead of silently assuming 5%.
  gstPercent: number;
  // Whether GST is applied by default on a new order. Defaults to true —
  // was previously only kept in component state, so unchecking "Apply
  // GST" never stuck past a reload/new order like gstPercent does.
  applyGst: boolean;
  // Named printer (as QZ Tray/Windows sees it) that KOT tickets are sent to
  // silently, with no print dialog. Empty string = not configured, so KOT
  // printing falls back to the original popup + browser print-dialog flow
  // (see lib/printing/qzPrinter.ts / kotPrinter.ts). Can be set to the same
  // printer as billPrinterName — one physical printer for both is fine.
  kotPrinterName: string;
  // Same idea as kotPrinterName, for the customer bill/receipt. Independent
  // of kotPrinterName on purpose, so KOT and Bill can go to two different
  // physical printers (kitchen vs counter) — or the same one, either way.
  billPrinterName: string;
  // Printed on the customer bill directly below the restaurant name (see
  // receiptPrinter.ts's .header block). Empty string = omitted, exactly
  // like before this field existed. Kept as a local device setting (not a
  // database column) so it works immediately with no backend/schema change
  // — every terminal for this restaurant should set it the same way once.
  restaurantAddress: string;
};

export function getLocalSettings(): LocalSettings {
  const defaults: LocalSettings = {
    paperWidth: "80mm",
    autoPrintKot: false,
    autoPrintBillOnSettle: false,
    gstPercent: 0,
    applyGst: true,
    kotPrinterName: "",
    billPrinterName: "",
    restaurantAddress: "",
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

// ---------------------------------------------------------------------------
// Daily KOT + Bill counters — local-first, server-checkpointed.
//
// A KOT/bill number must NEVER wait on a network round-trip to print —
// that's the whole reason the previous version was purely local. But
// purely local also meant a cleared cache (or a corrupted localStorage
// value) silently reset the sequence back to 0/1, and a second POS
// terminal for the same restaurant would hand out its own independent,
// colliding sequence.
//
// This keeps the fast local increment (getNextDailyCounter returns
// synchronously, immediately, exactly like before) but ALSO fires a
// fire-and-forget "checkpoint" up to Supabase after every increment — an
// idempotent "raise the server's count to at least this" call (see
// checkpoint_daily_counter in the daily_counters migration), safe to call
// repeatedly without ever double-counting. On startup (or whenever a new
// day rolls over locally), restoreDailyCounterFromServer() tries to pull
// the server's current value first, so a cleared cache or a fresh device
// picks up where the real count actually left off instead of starting
// over at 0.
//
// The "date" sent to the server is always the client's own computed IST
// calendar date string — never left to Postgres's now(), which defaults
// to UTC and would put the day boundary 5.5 hours off from India's actual
// midnight.
// ---------------------------------------------------------------------------

const DAILY_COUNTER_KEY_PREFIX = "restaurant_iq_daily_counter_v2_";

type DailyCounterState = {
  date: string; // YYYY-MM-DD, device-local date (IST, assuming correct device timezone)
  count: number;
};

// Same constant and approach as getFastISTParts/getISTDateStr in
// RestaurantIQDashboard.tsx — kept in sync deliberately, not just
// coincidentally similar. Computing IST this way (fixed +5:30 offset,
// then reading back with UTC getters) gives the correct Indian calendar
// date regardless of what timezone the device's OS/browser actually
// happens to be set to — the previous version used the device's LOCAL
// date getters directly, which only worked if the terminal's OS clock
// was correctly configured to IST. A misconfigured device (set to UTC,
// or any other zone) would reset the counter at the wrong moment,
// exactly the risk being closed here.
const IST_OFFSET_MS = 19800000; // 5 hours 30 minutes

function todayDateKey(): string {
  const istMs = Date.now() + IST_OFFSET_MS;
  const d = new Date(istMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function counterStorageKey(counterType: "kot" | "bill"): string {
  return `${DAILY_COUNTER_KEY_PREFIX}${counterType}`;
}

function readCounterState(counterType: "kot" | "bill"): DailyCounterState {
  const today = todayDateKey();
  try {
    const raw = localStorage.getItem(counterStorageKey(counterType));
    const state: DailyCounterState = raw ? JSON.parse(raw) : { date: today, count: 0 };
    return state.date === today ? state : { date: today, count: 0 };
  } catch {
    return { date: today, count: 0 };
  }
}

function writeCounterState(counterType: "kot" | "bill", state: DailyCounterState): void {
  try {
    localStorage.setItem(counterStorageKey(counterType), JSON.stringify(state));
  } catch {}
}

// Fire-and-forget — never awaited by the caller, never blocks a print.
// Uses a dynamic import so offlineStorage.ts doesn't need a hard,
// always-loaded dependency on the Supabase client for what's fundamentally
// a background best-effort sync.
function checkpointCounterToServer(
  counterType: "kot" | "bill",
  restaurantId: string,
  date: string,
  count: number
): void {
  if (!restaurantId) return;
  import("@/lib/supabase")
    .then(({ supabase }) =>
      supabase.rpc("checkpoint_daily_counter", {
        p_restaurant_id: restaurantId,
        p_counter_type: counterType,
        p_date: date,
        p_count: count,
      })
    )
    .then((result: any) => {
      // supabase.rpc() resolves successfully even when the call itself
      // failed application-side (RLS blocked it, the RPC doesn't exist
      // because a migration wasn't run, etc.) — it reports that via a
      // resolved `error` field, not a rejected promise. Only checking
      // .catch() below would silently miss all of that.
      if (result?.error) {
        console.warn(
          `[${counterType} counter] checkpoint failed:`,
          result.error.message || result.error
        );
      }
    })
    .catch((err) => {
      // Expected and harmless while offline — the local count is already
      // durable in localStorage; this is purely a resilience backup for
      // cache-clear scenarios. No retry queue needed: the NEXT successful
      // print will checkpoint an even higher number anyway.
      console.warn(`[${counterType} counter] checkpoint skipped (likely offline):`, err?.message || err);
    });
}

/**
 * Reserves and returns the next number for today (starts at 1, resets
 * daily) for either counter type. Synchronous and instant — never blocks
 * on network. Also fires a background checkpoint to the server.
 */
function getNextDailyCounter(counterType: "kot" | "bill", restaurantId: string): number {
  if (typeof window === "undefined") return 1;
  try {
    const state = readCounterState(counterType);
    state.count += 1;
    writeCounterState(counterType, state);
    checkpointCounterToServer(counterType, restaurantId, state.date, state.count);
    return state.count;
  } catch (err) {
    console.error(`Failed to get next daily ${counterType} number:`, err);
    // Extremely unlikely fallback path (localStorage unavailable/corrupt) —
    // still produces a usable, mostly-unique number rather than crashing.
    return Number(String(Date.now()).slice(-5));
  }
}

/** Reserves and returns the next KOT number for today. */
export function getNextDailyKotNumber(restaurantId: string): number {
  return getNextDailyCounter("kot", restaurantId);
}

/** Reserves and returns the next Bill number for today — call ONCE per order, at Settle, and store the result on the order (billNo). Reprints must reuse that stored value, never call this again for the same order. */
export function getNextDailyBillNumber(restaurantId: string): number {
  return getNextDailyCounter("bill", restaurantId);
}

/**
 * Call once on app startup (or whenever restaurantId becomes available).
 * If the server's checkpoint for today is higher than what's stored
 * locally — a cleared cache, a fresh device, or this being a second
 * terminal that hasn't caught up yet — raises the local count to match,
 * so the NEXT number handed out continues from the real sequence instead
 * of restarting at 1 and colliding with tickets already printed today.
 */
export async function restoreDailyCountersFromServer(restaurantId: string): Promise<void> {
  if (!restaurantId || typeof window === "undefined") return;
  const today = todayDateKey();
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("daily_counters")
      .select("counter_type, count")
      .eq("restaurant_id", restaurantId)
      .eq("date", today);

    if (error) {
      console.warn("Could not restore daily counters from server:", error.message || error);
      return;
    }
    if (!data) return;

    for (const row of data) {
      const counterType = row.counter_type as "kot" | "bill";
      if (counterType !== "kot" && counterType !== "bill") continue;
      const local = readCounterState(counterType);
      const serverCount = Number(row.count) || 0;
      if (serverCount > local.count) {
        writeCounterState(counterType, { date: today, count: serverCount });
      }
    }
  } catch (err) {
    // Offline at startup, or the migration/RPC isn't deployed yet — fall
    // back silently to whatever's in local storage, exactly like before
    // this feature existed.
    console.warn("Could not restore daily counters from server:", err);
  }
}
