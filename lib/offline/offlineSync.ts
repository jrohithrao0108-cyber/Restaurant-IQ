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
      this.queuedCountCache = all.filter((o) => !o.permanentlyFailed).length;
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
   * Attempts to sync an offline dine-in order. Mirrors the online
   * "3-hop waterfall" in RestaurantPOS.tsx: if the table already has an
   * open order, merge into it instead of creating a duplicate order row.
   */
  private async syncOneOrder(item: QueuedOfflineOrder): Promise<any> {
    const safeCreatedBy = toValidUuidOrNull(item.createdByUserId);

    // Backward compatible: anything queued before orderPhase existed behaves
    // exactly as it did before (settle-and-close).
    const isSettle = item.orderPhase !== "OPEN";

    let orderRecord: any = null;

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
        const newTotal = (Number(existingOpenOrder.total) || 0) + item.total;
        const { data: updatedOrder, error: updateError } = await supabase
          .from("orders")
          .update({
            total: newTotal,
            payment_mode: item.paymentMode,
            // OPEN rounds (KOT/Save) keep the tab running as "PENDING";
            // only a SETTLED round marks it COMPLETED.
            status: isSettle ? item.status || "COMPLETED" : "PENDING",
            // Only close the tab when this round is an actual settle.
            // An OPEN round must leave closed_at untouched (null) so the
            // *next* round for this table keeps finding and merging into
            // the same order instead of spawning a new one.
            closed_at: isSettle ? new Date().toISOString() : null,
          })
          .eq("id", existingOpenOrder.id)
          .select()
          .maybeSingle();

        if (updateError) throw updateError;
        orderRecord = updatedOrder;
      }
    }

    // No existing open order to merge into (or not a table order) -> insert new
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
          status: isSettle ? item.status || "COMPLETED" : "PENDING",
          created_at: item.createdAt,
          // Mirrors the online pair (executeSaveTableOrder / handleSaveOrder):
          // a SETTLED round closes immediately on creation just like the
          // online 3-hop waterfall does; an OPEN round (KOT/Save) is created
          // as a running tab (closed_at: null) so later rounds for the same
          // table merge into it instead of each spawning its own order.
          closed_at: isSettle ? new Date().toISOString() : null,
        })
        .select()
        .maybeSingle();

      if (orderError) throw orderError;
      if (!newOrder) throw new Error("Failed to create order record");
      orderRecord = newOrder;
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
    if (this.isSyncing || !this.isOnline) {
      return { synced: 0, failed: 0, permanentlyFailed: 0 };
    }

    const queue = await getPendingOfflineOrders(restaurantId ?? this.activeRestaurantId ?? undefined);
    if (queue.length === 0) {
      return { synced: 0, failed: 0, permanentlyFailed: 0 };
    }

    this.isSyncing = true;
    this.notifyListeners();

    let synced = 0;
    let failed = 0;
    let permanentlyFailed = 0;

    // Sequential on purpose: a DINE_IN merge reads-then-writes the same
    // table's order, so two queued rounds for the same table must sync in
    // order, not race each other in parallel.
    for (const item of queue) {
      try {
        const orderRecord = await this.syncOneOrder(item);

        await removeOfflineOrder(item.tempId);
        synced++;

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
          lastError: err?.message || "Sync failed",
          permanentlyFailed: givingUp,
        });
      }
    }

    this.isSyncing = false;
    await this.refreshCounts();

    return { synced, failed, permanentlyFailed };
  }
}

// Singleton instance
export const offlineSyncManager = new OfflineSyncManager();
