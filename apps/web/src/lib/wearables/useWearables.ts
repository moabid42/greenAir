"use client";

import { useEffect, useSyncExternalStore } from "react";
import { type DemoDevice, DemoDevices } from "./devices";
import { type HeartRateSample, LocalSampleStore, WebBluetoothAdapter } from "./ble";

/** One set of wearable services for the whole app, so playback and Bluetooth survive switching tabs. */
interface Services {
  demos: DemoDevices;
  store: LocalSampleStore;
  ble: WebBluetoothAdapter;
  recent: HeartRateSample[];
  connectError: string;
}

let services: Services | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

function get(): Services {
  if (services) return services;
  const store = new LocalSampleStore();
  const s: Services = {
    demos: new DemoDevices(notify),
    store,
    recent: [],
    connectError: "",
    ble: new WebBluetoothAdapter(
      (sample) => {
        try {
          store.save(sample);
        } catch {
          s.connectError = "Local storage is full; recording stopped.";
          s.ble.recording = false;
        }
      },
      () => {
        if (s.ble.last) s.recent = [...s.recent, s.ble.last].slice(-20);
        notify();
      },
    ),
  };
  services = s;
  return s;
}

export function useWearables() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => version,
    () => 0,
  );
  const s = typeof window === "undefined" ? null : get();

  useEffect(() => {
    // Leaving the page ends any live Bluetooth link and any playback.
    const stop = () => {
      void services?.ble.disconnect();
      services?.demos.list().forEach((d) => services?.demos.disconnect(d.id));
    };
    window.addEventListener("pagehide", stop);
    return () => window.removeEventListener("pagehide", stop);
  }, []);

  return {
    ready: s != null,
    devices: (process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? s?.demos.list() ?? [] : []) as DemoDevice[],
    demos: s?.demos,
    ble: s?.ble,
    readings: s?.store.read() ?? [],
    recent: s?.recent ?? [],
    connectError: s?.connectError ?? "",
    clearReadings: () => {
      s?.store.clear();
      notify();
    },
    setConnectError: (m: string) => {
      if (s) s.connectError = m;
      notify();
    },
    refresh: notify,
  };
}
