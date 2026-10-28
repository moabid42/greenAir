import type { Activity } from "./api/types";
import type { GeoPlace } from "./api/geocode";

export interface SavedPlace {
  id: string;
  name: string;
  lngLat: [number, number];
}

export interface Reminder {
  id: string;
  /** ISO time the notification should fire */
  at: string;
  title: string;
  body: string;
}

export type WatchSource = "apple" | "healthconnect" | "garmin" | "strava";

/** What the user has chosen to let the AI Coach remember. Never contains environmental readings. */
export interface CoachMemory {
  parks: boolean;
  avoidBusy: boolean;
  flat: boolean;
  distanceKm: number | null;
  hours: "morning" | "midday" | "evening" | null;
}

export const EMPTY_MEMORY: CoachMemory = { parks: false, avoidBusy: false, flat: false, distanceKm: null, hours: null };

/** Everything the user decides. Lives on the phone only (localStorage). */
export interface Prefs {
  onboarded: boolean;
  name: string;
  activity: Activity;
  home: GeoPlace | null;
  radiusKm: number | null;
  airSensitive: boolean;
  heatSensitive: boolean;
  watchSource: WatchSource | null;
  watchNudge: boolean;
  watchAirBuzz: boolean;
  watchFace: boolean;
  saved: SavedPlace[];
  reminders: Reminder[];
  memory: CoachMemory;
  /** Keep the Coach conversation on this phone between visits (off by default). */
  saveChat: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  onboarded: false,
  name: "",
  activity: "run",
  home: null,
  radiusKm: 3,
  airSensitive: false,
  heatSensitive: false,
  watchSource: null,
  watchNudge: true,
  watchAirBuzz: true,
  watchFace: true,
  saved: [],
  reminders: [],
  memory: EMPTY_MEMORY,
  saveChat: false,
};

const KEY = "sweetspot:prefs:v1";
const LEGACY_HOME_KEY = "sweetspot:home";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const stored: Partial<Prefs> = raw ? JSON.parse(raw) : {};
    const prefs: Prefs = { ...DEFAULT_PREFS, ...stored };
    // Carry over the location chosen in the first version of the app.
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_HOME_KEY);
      if (legacy) prefs.home = JSON.parse(legacy);
    }
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode): preferences just won't be remembered */
  }
}

export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_HOME_KEY);
  } catch {
    /* nothing to clear */
  }
}
