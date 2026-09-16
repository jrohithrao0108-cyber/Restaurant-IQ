import { supabase } from "@/lib/supabase";
import { toValidUuidOrNull } from "@/lib/Utils/validation";
import {
  getOfflineOrdersQueue,
  getPendingOfflineOrders,
  removeOfflineOrder,
  updateOfflineOrder,
  QueuedOfflineOrder,
  MAX_SYNC_ATTEMPTS,
} from "./offlineStorage";

type SyncListener = (state: {
  isOnline: boolean;
  isSyncing: boolean;
  queuedCount: number;
  failedCount: number;
}) => void;

// How often the background drain runs while online. This is what makes sync
// "not just on settle" — every tick, whatever's queued gets a real attempt,
// with zero user action needed.
const AUTO_SYNC_INTERVAL_MS = 3500;

// Wait before retry N (1-indexed: after the 1st failure, before the 2nd
// attempt, etc.). Grows from a few seconds to 10 minutes, so a short blip
// clears on the next tick or two while a longer outage doesn't burn through
// every attempt in the first minute. Index 0 covers the first attempt,
// which always fires immediately (no wait).
const BACKOFF_SCHEDULE_MS = [0, 5_000, 15_000, 60_000, 180_000, 300_000, 600_000, 600_000];

function backoffMsForAttempt(attemptsSoFar: number): number {
  const idx = Math.min(attemptsSoFar, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

class OfflineSyncManager {
  private listeners: Set<SyncListener> = new Set();
  private isSyncing = false;
  private isOnline = true;
  private checkInterval: any = null;
  // When set, subscribe()/notifyListeners()/syncAll() default to this
  // restaurant only, so a shared device never mixes queues across
  // restaurants. Call setActiveRestaurantId() from the POS screen.
  private activeRestaurantId: string | null = null;
  // Cached counts, kept in sync via refreshCounts() so subscribe()/
  // notifyListeners() can report state synchronously without every listener
  // triggering its own IndexedDB read.
  private queuedCountCache = 0;
  private failedCountCache = 0;
  // Set when a syncAll() call arrives while one is already in flight, so
  // its would-be work isn't silently dropped until the next 3.5s tick.
  private rerunRequested = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.isOnline = navigator.onLine;

      window.addEventListener("online", () => {
        this.isOnline = true;
        this.notifyListeners();
        this.syncAll(); // don't wait for the next tick — recover instantly
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
        this.notifyListeners();
      });

      // Continuous background drain (was: only a 30s poll gated on a
      // pending-check). Reliability note: browsers throttle setInterval
      // heavily in backgrounded/inactive tabs (sometimes to once a minute
      // or less), so the interval alone isn't enough for a POS device that
      // might sit on another app for a while. The two listeners below cover
      // that gap — they fire the instant the tab becomes active again,
      // regardless of how long the interval was throttled.
      this.checkInterval = setInterval(() => {
        if (this.isOnline) this.syncAll();
      }, AUTO_SYNC_INTERVAL_MS);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.isOnline) {
          this.syncAll();
        }
      });
      window.addEventListener("focus", () => {
        if (this.isOnline) this.syncAll();
      });

      // Prime counts from whatever's already on disk (e.g. after a reload)
      // and take an immediate first pass in case orders were queued in a
      // previous session and never got a chance to sync before the app closed.
      this.refreshCounts().then(() => {
        if (this.isOnline) this.syncAll();
      });
    }
  }

  public setActiveRestaurantId(restaurantId: string | null): void {
    this.activeRestaurantId = restaurantId;
    this.refreshCounts();
  }

  private async refreshCounts(): Promise<void> {
    try {
      const all = await getOfflineOrdersQueue(this.activeRestaurantId ?? undefined);
      // OPEN records are local-only running tabs, not a sync backlog — a
      // restaurant with several occupied tables would otherwise
      // permanently show "N pending sync," which isn't accurate.
      this.queuedCountCache = all.filter((o) => !o.permanentlyFailed && o.orderPhase !== "OPEN").length;
      this.failedCountCache = all.filter((o) => o.permanentlyFailed).length;
    } catch (err) {
      console.error("Failed to refresh offline queue counts:", err);
    }
    this.notifyListeners();
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener({
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      queuedCount: this.queuedCountCache,
      failedCount: this.failedCountCache,
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notifyListeners(): void {
    const state = {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      queuedCount: this.queuedCountCache,
      failedCount: this.failedCountCache,
    };
    this.listeners.forEach((l) => {
      try {
        l(state);
      } catch (err) {
        console.error("Sync listener error:", err);
      }
    });
  }

  /**
   * Pushes one finished table sitting to Supabase. Since syncAll() now
   * filters out orderPhase "OPEN" items before they ever reach here (see
   * above), everything arriving in this function is the final SETTLED
   * state of a sitting — there's no more "leave it running as PENDING"
   * case to branch on.
   *
   * The existing-open-order lookup below is a safety net, not the normal
   * path: it only matters if a row is somehow still open for this table
   * (e.g. left over from before this architecture). Either way we REPLACE
   * that row's total/items rather than adding to them, since item.total/
   * item.items is always the complete, authoritative state on its own.
   */
  private async syncOneOrder(item: QueuedOfflineOrder): Promise<any> {
    const safeCreatedBy = toValidUuidOrNull(item.createdByUserId);
    const nowIso = new Date().toISOString();

    let orderRecord: any = null;
    // Set when we're updating an already-open remote order rather than
    // inserting a fresh one — signals that order_items must be replaced
    // (deleted + reinserted) below instead of appended to.
    let replacingExistingItems = false;

    if (item.orderType === "DINE_IN" && item.tableNumber) {
      const { data: existingOpenOrder, error: lookupError } = await supabase
        .from("orders")
        .select("id, order_number, total")
        .eq("restaurant_id", item.restaurantId)
        .eq("table_number", item.tableNumber)
        .is("closed_at", null)
        .neq("status", "CANCELLED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (existingOpenOrder) {
        // Full replace, not additive: item.total/item.items already
        // represent the complete, final state of the sitting.
        const { data: updatedOrder, error: updateError } = await supabase
          .from("orders")
          .update({
            total: item.total,
            payment_mode: item.paymentMode,
            status: item.status || "COMPLETED",
            closed_at: nowIso,
          })
          .eq("id", existingOpenOrder.id)
          .select()
          .maybeSingle();

        if (updateError) throw updateError;
        orderRecord = updatedOrder;
        replacingExistingItems = true;
      }
    }

    // No existing open order to fall back into (the normal case) -> insert new
    if (!orderRecord) {
      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert({
          restaurant_id: item.restaurantId,
          created_by: safeCreatedBy,
          order_number: item.orderNumber,
          order_type: item.orderType,
          table_number: item.tableNumber,
          channel: item.channel,
          payment_mode: item.paymentMode,
          total: item.total,
          status: item.status || "COMPLETED",
          created_at: item.createdAt,
          // Always closes immediately: by the time anything reaches
          // syncOneOrder it's already the final settled state.
          closed_at: nowIso,
        })
        .select()
        .maybeSingle();

      if (orderError) throw orderError;
      if (!newOrder) throw new Error("Failed to create order record");
      orderRecord = newOrder;
    }

    if (replacingExistingItems) {
      // item.items is the full current cart for this table, not a delta —
      // clear out whatever rows this order already has before reinserting,
      // otherwise every round would leave the previous round's rows behind
      // as duplicates alongside the fresh full set.
      const { error: deleteItemsError } = await supabase
        .from("order_items")
        .delete()
        .eq("order_id", orderRecord.id);

      if (deleteItemsError) throw deleteItemsError;
    }

    if (item.items && item.items.length > 0) {
      const orderItems = item.items.map((i) => ({
        order_id: orderRecord.id,
        menu_item_id: i.id,
        name_snapshot: i.name,
        price_snapshot: i.price,
        qty: i.qty,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) throw itemsError;
    }

    return orderRecord;
  }

  public async syncAll(
    onOrderSynced?: (tempId: string, realOrder: any) => void,
    restaurantId?: string
  ): Promise<{ synced: number; failed: number; permanentlyFailed: number }> {
    // CRITICAL: the lock must be claimed synchronously, before any `await`.
    // The old version checked `this.isSyncing` and only set it to `true`
    // AFTER awaiting getPendingOfflineOrders() — that gap let two syncAll()
    // calls fired close together (e.g. KOT-save's fire-and-forget call
    // overlapping with Settle & Pay's, seconds apart) both pass the guard
    // and run concurrently. Each one independently checked "does this table
    // have an open order?", both got "no" before either's insert had
    // committed, and both inserted their own row for the same table/round
    // instead of one merging into the other's — producing two DB rows with
    // the same order_number/created_at, one still holding the earlier
    // partial total. Setting the flag here, with no await in between,
    // makes claiming the lock atomic from JS's single-threaded perspective.
    if (this.isSyncing || !this.isOnline) {
      // Something is (or was about to be) queued and this call is being
      // skipped rather than run — remember to sync again right after the
      // in-flight run finishes, so whatever prompted this call isn't lost.
      if (this.isSyncing) this.rerunRequested = true;
      return { synced: 0, failed: 0, permanentlyFailed: 0 };
    }

    this.isSyncing = true;
    this.notifyListeners();

    const rawQueue = await getPendingOfflineOrders(restaurantId ?? this.activeRestaurantId ?? undefined);
    // OPEN items are running tabs that are intentionally local-only (see
    // offlineStorage.ts) — they must never reach Supabase until Settle &
    // Pay flips them to SETTLED. Anything still OPEN here just stays in
    // IndexedDB; only SETTLED (or legacy items queued before this field
    // existed, orderPhase === undefined) are eligible.
    //
    // Items that failed recently also get skipped until their backoff
    // window has passed (see BACKOFF_SCHEDULE_MS below) — otherwise a
    // stretch of flaky connectivity retries every 3.5s and burns through
    // all attempts in well under a minute, giving up on orders that a
    // slightly longer wait would have synced fine.
    const now = Date.now();
    const queue = rawQueue.filter((o) => {
      if (o.orderPhase === "OPEN") return false;
      if (!o.lastAttemptAt || !o.syncAttempts) return true;
      const waitMs = backoffMsForAttempt(o.syncAttempts);
      return now - new Date(o.lastAttemptAt).getTime() >= waitMs;
    });
    if (queue.length === 0) {
      this.isSyncing = false;
      this.notifyListeners();
      return { synced: 0, failed: 0, permanentlyFailed: 0 };
    }

    let synced = 0;
    let failed = 0;
    let permanentlyFailed = 0;

    // Sequential on purpose: a DINE_IN merge reads-then-writes the same
    // table's order, so two queued rounds for the same table must sync in
    // order, not race each other in parallel.
    for (const item of queue) {
      try {
        const orderRecord = await this.syncOneOrder(item);

        // If this delete fails, the record stays in the local queue — and
        // since syncOneOrder just closed it remotely (closed_at set), a
        // plain retry on the next tick would no longer find it as "the
        // existing open order" and would INSERT A DUPLICATE row instead.
        // Better to stop retrying it automatically and flag it for a human
        // to clean up than to risk silently double-billing a table.
        const removed = await removeOfflineOrder(item.tempId);
        synced++;

        if (!removed) {
          console.error(
            `Order ${item.tempId} synced to Supabase (id ${orderRecord?.id}) but could not be removed from the local queue — flagging for manual review instead of risking a duplicate on retry.`
          );
          await updateOfflineOrder(item.tempId, {
            lastError: `Already synced to cloud (order ${orderRecord?.id ?? "unknown"}) but couldn't clear the local copy. Safe to dismiss — do not retry.`,
            permanentlyFailed: true,
          });
        }

        if (onOrderSynced) {
          onOrderSynced(item.tempId, orderRecord);
        }
      } catch (err: any) {
        console.error(`Failed to sync offline order ${item.tempId}:`, err);
        failed++;

        const attempts = (item.syncAttempts || 0) + 1;
        const givingUp = attempts >= MAX_SYNC_ATTEMPTS;
        if (givingUp) permanentlyFailed++;

        await updateOfflineOrder(item.tempId, {
          syncAttempts: attempts,
          lastAttemptAt: new Date().toISOString(),
          lastError: err?.message || "Sync failed",
          permanentlyFailed: givingUp,
        });
      }
    }

    this.isSyncing = false;
    await this.refreshCounts();

    // If another syncAll() call came in while this one was running (e.g. a
    // KOT round got queued mid-sync), it was skipped rather than allowed to
    // race — run once more now so that order doesn't wait for the next
    // 3.5s tick or an online/focus event.
    if (this.rerunRequested) {
      this.rerunRequested = false;
      return this.syncAll(onOrderSynced, restaurantId);
    }

    return { synced, failed, permanentlyFailed };
  }
}

// Singleton instance
export const offlineSyncManager = new OfflineSyncManager();
