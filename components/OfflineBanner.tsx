"use client";

// This component's content used to live at public/sw.js, which is a
// mistake worth understanding: a filename ending in .js in /public doesn't
// make it a service worker — nothing registers or executes it as one, and
// it couldn't run as one anyway (React JSX, "use client", and `import`
// statements aren't valid inside a service worker's execution context).
// It's just been sitting there unused. Moving it here, under its real
// name, doesn't change its behavior at all — it's still the same
// "N orders waiting to sync" banner — it just stops being confused with
// the actual service worker (the new public/sw.js).

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { offlineSyncManager } from "@/lib/offline/offlineSync";
import { retryOfflineOrder } from "@/lib/offline/offlineStorage";

export function OfflineBanner({
  restaurantId,
  onOrderSynced,
}: {
  restaurantId?: string | null;
  onOrderSynced?: (tempId: string, realOrder: any) => void;
}) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    offlineSyncManager.setActiveRestaurantId(restaurantId || null);
  }, [restaurantId]);

  useEffect(() => {
    const unsubscribe = offlineSyncManager.subscribe((state) => {
      setIsOnline(state.isOnline);
      setIsSyncing(state.isSyncing);
      setQueuedCount(state.queuedCount);
      setFailedCount(state.failedCount);
    });
    return () => unsubscribe();
  }, []);

  function handleTriggerSync() {
    offlineSyncManager.syncAll(onOrderSynced, restaurantId || undefined);
  }

  // Failed orders stop retrying automatically after MAX_SYNC_ATTEMPTS so a
  // genuinely broken record doesn't hammer Supabase forever — but that
  // means someone has to manually kick them back into rotation, or they
  // never sync at all. This is that action.
  async function handleRetryFailed() {
    setRetrying(true);
    try {
      // getOfflineOrdersQueue isn't imported here to keep this component
      // light; offlineSyncManager's own subscribed state already tells us
      // failedCount > 0, and syncAll() re-reads the queue itself, so we
      // only need each failed tempId. Simplest correct source for that
      // without duplicating state: read once via a dynamic import.
      const { getOfflineOrdersQueue } = await import("@/lib/offline/offlineStorage");
      const queue = await getOfflineOrdersQueue(restaurantId || undefined);
      const failed = queue.filter((o) => o.permanentlyFailed);
      await Promise.all(failed.map((o) => retryOfflineOrder(o.tempId)));
      offlineSyncManager.syncAll(onOrderSynced, restaurantId || undefined);
    } catch (err) {
      console.error("Failed to retry failed orders:", err);
    } finally {
      setRetrying(false);
    }
  }

  // If online and nothing queued or failed, do not render anything (zero clutter)
  if (isOnline && queuedCount === 0 && failedCount === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        padding: "8px 14px",
        borderRadius: "8px",
        fontSize: "13px",
        fontWeight: 600,
        marginBottom: "12px",
        background: !isOnline ? "#fff1f2" : "#fffbeb",
        border: !isOnline ? "1px solid #fecdd3" : "1px solid #fde68a",
        color: !isOnline ? "#9f1239" : "#92400e",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {!isOnline ? (
          <>
            <WifiOff size={16} color="#e11d48" />
            <span>
              <strong>Offline Mode:</strong> Internet disconnected. Orders are saved on device and will auto-sync when online.
            </span>
          </>
        ) : (
          <>
            <RefreshCw
              size={16}
              className={isSyncing ? "animate-spin" : ""}
              color="#d97706"
            />
            <span>
              {isSyncing
                ? "Syncing offline orders to cloud..."
                : `${queuedCount} order(s) waiting to sync.`}
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {queuedCount > 0 && isOnline && !isSyncing && (
          <button
            onClick={handleTriggerSync}
            style={{
              padding: "3px 12px",
              fontSize: "12px",
              fontWeight: 700,
              borderRadius: "6px",
              background: "#d97706",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Sync Now
          </button>
        )}

        {failedCount > 0 && (
          <>
            <span style={{ color: "#9f1239", fontWeight: 700 }}>
              {failedCount} order(s) could not be synced after repeated attempts.
            </span>
            <button
              onClick={handleRetryFailed}
              disabled={retrying}
              style={{
                padding: "3px 12px",
                fontSize: "12px",
                fontWeight: 700,
                borderRadius: "6px",
                background: "#dc2626",
                color: "#fff",
                border: "none",
                cursor: retrying ? "not-allowed" : "pointer",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              {retrying ? "Retrying..." : "Retry Failed"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
