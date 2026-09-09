"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { offlineSyncManager } from "@/lib/offline/offlineSync";

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

  useEffect(() => {
    const unsubscribe = offlineSyncManager.subscribe((state) => {
      setIsOnline(state.isOnline);
      setIsSyncing(state.isSyncing);
      setQueuedCount(state.queuedCount);
    });
    return () => unsubscribe();
  }, []);

  function handleTriggerSync() {
    offlineSyncManager.syncAll(onOrderSynced);
  }

  // If online and no queued orders, do not render anything (zero clutter)
  if (isOnline && queuedCount === 0) {
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
    </div>
  );
}
