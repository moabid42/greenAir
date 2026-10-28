"use client";

import { useEffect } from "react";

/**
 * Production: registers /sw.js (fast reopen, survives a weak connection).
 * Development: removes any service worker left over from an earlier production run on the same
 * address, otherwise its cache keeps serving old code and edits seem to do nothing.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* app works fine without it */
      });
      return;
    }
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {
        /* nothing to clean up */
      });
  }, []);
  return null;
}
