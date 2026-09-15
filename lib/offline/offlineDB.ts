// IndexedDB backend for everything that benefits from being durable, fast,
// and not capped at localStorage's ~5MB: the offline order queue, and the
// menu/tables cache used as an offline fallback when a fetch fails.
//
// getLocalSettings/saveLocalSettings stay on localStorage on purpose (see
// offlineStorage.ts) — they're read synchronously inside render/useState,
// which IndexedDB's async API can't support without a bigger refactor, and
// they're tiny scalars where localStorage's sync read is actually the
// faster, simpler tool for the job.

const DB_NAME = "restaurant_iq_offline";
const DB_VERSION = 1;

const STORE_QUEUE = "queued_orders";
const STORE_MENU_CACHE = "menu_cache";
const STORE_TABLES_CACHE = "tables_cache";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (dbPromise) return dbPromise;

  // Ask the browser not to auto-evict this data under storage pressure.
  // Relevant specifically for budget Android tablets that fill up with
  // WhatsApp media etc. — without this, "best effort" storage can be
  // cleared by the OS to free space, silently dropping queued orders.
  // Best-effort itself (not all browsers grant it, some need a user
  // gesture first) — never blocks DB open on the result.
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: "tempId" });
        store.createIndex("by_restaurant", "restaurantId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MENU_CACHE)) {
        db.createObjectStore(STORE_MENU_CACHE); // keyed by restaurantId directly
      }
      if (!db.objectStoreNames.contains(STORE_TABLES_CACHE)) {
        db.createObjectStore(STORE_TABLES_CACHE); // keyed by restaurantId directly
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || req.error);
  });
}

// ---- Order queue (keyPath: tempId) ----------------------------------------

export async function dbGetAllOrders<T>(): Promise<T[]> {
  return run<T[]>(STORE_QUEUE, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

export async function dbGetOrdersByRestaurant<T>(restaurantId: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const idx = tx.objectStore(STORE_QUEUE).index("by_restaurant");
    const req = idx.getAll(restaurantId);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutOrder<T>(order: T): Promise<void> {
  await run(STORE_QUEUE, "readwrite", (s) => s.put(order as any));
}

export async function dbDeleteOrder(tempId: string): Promise<void> {
  await run(STORE_QUEUE, "readwrite", (s) => s.delete(tempId));
}

// ---- Simple keyed cache (menu / tables, keyed by restaurantId) ------------

export async function dbGetCache<T>(store: "menu" | "tables", restaurantId: string): Promise<T | undefined> {
  const storeName = store === "menu" ? STORE_MENU_CACHE : STORE_TABLES_CACHE;
  return run<T>(storeName, "readonly", (s) => s.get(restaurantId) as IDBRequest<T>);
}

export async function dbPutCache<T>(store: "menu" | "tables", restaurantId: string, value: T): Promise<void> {
  const storeName = store === "menu" ? STORE_MENU_CACHE : STORE_TABLES_CACHE;
  await run(storeName, "readwrite", (s) => s.put(value as any, restaurantId));
}
