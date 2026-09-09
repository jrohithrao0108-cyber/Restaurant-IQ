import { supabase } from "@/lib/supabase";
import {
  getOfflineOrdersQueue,
  removeOfflineOrder,
  updateOfflineOrder,
  QueuedOfflineOrder,
} from "./offlineStorage";

type SyncListener = (state: {
  isOnline: boolean;
  isSyncing: boolean;
  queuedCount: number;
}) => void;

class OfflineSyncManager {
  private listeners: Set<SyncListener> = new Set();
  private isSyncing = false;
  private isOnline = true;
  private checkInterval: any = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.isOnline = navigator.onLine;

      window.addEventListener("online", () => {
        this.isOnline = true;
        this.notifyListeners();
        this.syncAll();
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
        this.notifyListeners();
      });

      // Background periodic check every 30 seconds
      this.checkInterval = setInterval(() => {
        if (navigator.onLine && getOfflineOrdersQueue().length > 0) {
          this.syncAll();
        }
      }, 30000);
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener({
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      queuedCount: getOfflineOrdersQueue().length,
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notifyListeners(): void {
    const state = {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      queuedCount: getOfflineOrdersQueue().length,
    };
    this.listeners.forEach((l) => {
      try {
        l(state);
      } catch (err) {
        console.error("Sync listener error:", err);
      }
    });
  }

  public async syncAll(
    onOrderSynced?: (tempId: string, realOrder: any) => void
  ): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing || !this.isOnline) {
      return { synced: 0, failed: 0 };
    }

    const queue = getOfflineOrdersQueue();
    if (queue.length === 0) {
      return { synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    this.notifyListeners();

    let synced = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        // 1. Insert order
        const { data: orderRecord, error: orderError } = await supabase
          .from("orders")
          .insert({
            restaurant_id: item.restaurantId,
            created_by: item.createdByUserId || null,
            order_number: item.orderNumber,
            order_type: item.orderType,
            table_number: item.tableNumber,
            channel: item.channel,
            payment_mode: item.paymentMode,
            total: item.total,
            status: item.status || "COMPLETED",
            created_at: item.createdAt,
          })
          .select()
          .maybeSingle();

        if (orderError) throw orderError;
        if (!orderRecord) throw new Error("Failed to create order record");

        // 2. Insert order items
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

        // 3. Remove from queue on success
        removeOfflineOrder(item.tempId);
        synced++;

        if (onOrderSynced) {
          onOrderSynced(item.tempId, orderRecord);
        }
      } catch (err: any) {
        console.error(`Failed to sync offline order ${item.tempId}:`, err);
        failed++;
        updateOfflineOrder(item.tempId, {
          syncAttempts: (item.syncAttempts || 0) + 1,
          lastError: err?.message || "Sync failed",
        });
      }
    }

    this.isSyncing = false;
    this.notifyListeners();

    return { synced, failed };
  }
}

// Singleton instance
export const offlineSyncManager = new OfflineSyncManager();
