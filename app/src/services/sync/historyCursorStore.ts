const STORAGE_KEY = 'water_history_ack_cursors';

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage can be unavailable in private or restricted environments.
  }
  return null;
}

function readCursors(target: Storage): Record<string, string> {
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export class HistoryCursorStore {
  public get(deviceId: string): string {
    if (!deviceId) return '';

    const target = getStorage();
    if (!target) return '';

    const cursor = readCursors(target)[deviceId];
    return typeof cursor === 'string' ? cursor : '';
  }

  public set(deviceId: string, eventId: string): void {
    if (!deviceId || !eventId) return;

    const target = getStorage();
    if (!target) return;

    const cursors = readCursors(target);
    cursors[deviceId] = eventId;
    target.setItem(STORAGE_KEY, JSON.stringify(cursors));
  }
}

export const historyCursorStore = new HistoryCursorStore();
