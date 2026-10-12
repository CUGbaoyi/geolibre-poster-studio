import { validateDraft, type Draft } from "./model";
const DATABASE = "geolibre-poster-studio";
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readDraft(): Promise<Draft | undefined> {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly"),
        request = transaction.objectStore("drafts").get("current");
      request.onerror = () => reject(request.error);
      request.onsuccess = () =>
        resolve(validateDraft(request.result) ? request.result : undefined);
    });
  } finally {
    database.close();
  }
}
export async function writeDraft(draft: Draft): Promise<void> {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(draft, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("草稿保存被中止。"));
    });
  } finally {
    database.close();
  }
}
