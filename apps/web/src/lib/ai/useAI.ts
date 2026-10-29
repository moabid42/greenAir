"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getServerState, getState, initAI, subscribe, type AIState } from "./engine";

/** The on-device AI's current state. The first caller also checks the device. */
export function useAI(): AIState {
  const s = useSyncExternalStore(subscribe, getState, getServerState);
  useEffect(() => {
    void initAI();
  }, []);
  return s;
}
