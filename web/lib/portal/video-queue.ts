"use client";

import type { EvidencePhase } from "./evidence-sections";

/**
 * The offline queue for worker video evidence, Stage 5.5.
 *
 * A worker filming a stage walkthrough is often on a weak connection in the
 * field, and a video is too large to lose to a dropped bar of signal. This
 * holds a queued video in the browser's IndexedDB, the only browser storage
 * that can hold a video-sized Blob without choking, so it survives a dropped
 * connection, a closed tab, or the phone locking mid-upload. Nothing here
 * talks to the network; that is video-upload.ts. This is just the shelf.
 *
 * Client-side only, on purpose: IndexedDB does not exist during server
 * rendering, and every export here is called from "use client" code.
 */

export type QueueStatus = "queued" | "uploading" | "failed" | "done";

export type QueueItem = {
  id: string;
  jobId: string;
  stage: number;
  kind: "work" | "materials";
  /** Which section of the job this belongs to, as declared on the form, or
      null if nobody said. Optional so items queued before 5 Sep 2026, which
      predate the field, still upload. */
  phase?: EvidencePhase | null;
  label: string;
  mime: string;
  bytes: number;
  file: Blob;
  status: QueueStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
};

const DB_NAME = "yaadly-evidence-queue";
const DB_VERSION = 1;
const STORE = "video_evidence";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("jobId", "jobId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function addQueueItem(item: QueueItem): Promise<void> {
  await withStore("readwrite", (store) => store.add(item));
}

export async function listQueueItems(jobId: string): Promise<QueueItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("jobId");
    const req = idx.getAll(IDBKeyRange.only(jobId));
    req.onsuccess = () => resolve((req.result as QueueItem[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result as QueueItem | undefined;
      if (!current) { resolve(); return; }
      store.put({ ...current, ...patch });
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeQueueItem(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
