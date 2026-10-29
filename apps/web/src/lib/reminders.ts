import type { Activity } from "./api/types";
import type { Reminder } from "./prefs";

export type NotifyState = "granted" | "denied" | "default" | "unsupported";

export function notifyState(): NotifyState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Asks for permission (must be called from a tap). */
export async function askNotifications(): Promise<NotifyState> {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

/**
 * Shows a notification now. Phones mirror notifications to a paired watch, which is how the
 * "buzz" reaches the wrist without a native watch app.
 */
export async function notifyNow(title: string, body: string): Promise<boolean> {
  if (notifyState() !== "granted") return false;
  const options: NotificationOptions = { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "sweetspot" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Fires a reminder while the app is open or alive in the background (no push server yet). */
export function scheduleReminder(r: Reminder): void {
  const wait = new Date(r.at).getTime() - Date.now();
  clearTimeout(timers.get(r.id));
  if (wait <= 0 || wait > 24 * 3600 * 1000) return;
  timers.set(
    r.id,
    setTimeout(() => {
      void notifyNow(r.title, r.body);
      timers.delete(r.id);
    }, wait),
  );
}

export function cancelReminder(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** Directions in the phone's own maps app (opens Google/Apple Maps). */
export function directionsUrl([lng, lat]: [number, number], activity: Activity): string {
  const mode = activity === "ride" ? "bicycling" : "walking";
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`;
}
