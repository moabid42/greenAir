"use client";

import { AppProvider } from "@/state/app";
import MobileShell from "./shell/MobileShell";

export default function App() {
  return (
    <AppProvider>
      <MobileShell />
    </AppProvider>
  );
}
