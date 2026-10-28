"use client";

import { useEffect } from "react";
import MapStage from "@/components/map/MapStage";
import CoachScreen from "@/components/screens/CoachScreen";
import ExploreScreen from "@/components/screens/ExploreScreen";
import MeScreen from "@/components/screens/MeScreen";
import Onboarding from "@/components/screens/Onboarding";
import PlaceScreen from "@/components/screens/PlaceScreen";
import TodayScreen from "@/components/screens/TodayScreen";
import AnalyticsScreen from "@/components/screens/AnalyticsScreen";
import DevicesScreen from "@/components/screens/DevicesScreen";
import MapTools from "@/components/map/MapTools";
import AISheet from "@/components/sheets/AISheet";
import LayersSheet from "@/components/sheets/LayersSheet";
import SegmentSheet from "@/components/sheets/SegmentSheet";
import SensorSheet from "@/components/sheets/SensorSheet";
import LocationSheet from "@/components/sheets/LocationSheet";
import WeekSheet from "@/components/sheets/WeekSheet";
import { Wordmark } from "@/components/ui/Logo";
import { useApp } from "@/state/app";
import TabBar from "./TabBar";

/**
 * The phone frame. On a phone it fills the screen; on a big screen it shows as a phone-sized column.
 * One map sits underneath; each screen floats on top of it.
 */
export default function MobileShell() {
  const { ready, prefs, tab, placeId, toast, day, date, showToast } = useApp();
  const onMap = tab === "today" || tab === "explore";

  // Mock data can be intentional; it does not imply an upstream failure.
  useEffect(() => {
    if (day?.source === "mock") showToast("Demo mode: this day uses simulated conditions.");
  }, [day?.source, date, showToast]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[430px] items-stretch justify-center md:py-3">
      <div className="relative w-full overflow-hidden bg-ground text-ink md:rounded-[36px] md:shadow-[0_30px_80px_rgb(22_44_41/0.35)]">
        {!ready ? (
          <Splash />
        ) : (
          <>
            <MapStage />
            {onMap && !placeId && tab === "today" && <TodayScreen />}
            {onMap && !placeId && tab === "explore" && <ExploreScreen />}
            {onMap && !placeId && <MapTools />}
            {onMap && placeId && <PlaceScreen />}
            {/* Stays mounted so the conversation survives switching tabs. */}
            <CoachScreen active={tab === "coach"} />
            {tab === "analytics" && <AnalyticsScreen />}
            {tab === "devices" && <DevicesScreen />}
            {tab === "me" && <MeScreen />}
            <TabBar />
            <LocationSheet />
            <WeekSheet />
            <AISheet />
            <LayersSheet />
            <SensorSheet />
            <SegmentSheet />
            {toast && (
              <div role="status" className="above-nav pointer-events-none absolute inset-x-0 z-[80] mb-14 flex justify-center px-6">
                <span className="rounded-2xl bg-ink px-4 py-2.5 text-center text-xs font-bold text-white shadow-xl">{toast}</span>
              </div>
            )}
            {!prefs.onboarded && <Onboarding />}
          </>
        )}
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <span className="flex flex-col items-center gap-3">
        <Wordmark size={56} />
        <span className="text-sm font-semibold text-mute">Find your better time outside · Heilbronn</span>
      </span>
    </div>
  );
}
