"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin, Search, Trash2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import { reverseGeocode, searchPlaces, type GeoPlace } from "@/lib/api/geocode";
import { cn } from "@/lib/cn";
import { PLACES } from "@/lib/geo";
import { MAX_OUTSIDE_KM, nearestCell } from "@/lib/rank";
import { useApp } from "@/state/app";

const RADII: { km: number | null; label: string }[] = [
  { km: 1, label: "1 km" },
  { km: 3, label: "3 km" },
  { km: 5, label: "5 km" },
  { km: null, label: "Anywhere" },
];

const NEIGHBOURHOODS: GeoPlace[] = PLACES.map((p) => ({ label: p.name, sub: "Heilbronn", lngLat: p.at }));

/** Where do you start, and how far will you go? Everything in the app adapts to this. */
export function LocationPanel({ onDone }: { onDone?: () => void }) {
  const { prefs, update, grid, showToast } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  // Debounced search: wait until the user pauses typing for 300 ms.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setResults([]);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const typing = query.trim().length >= 3;
  const options = typing ? results : NEIGHBOURHOODS.filter((n) => n.label.toLowerCase().includes(query.trim().toLowerCase()));

  const choose = (p: GeoPlace) => {
    // Only places inside the area we have data for make sense.
    const near = grid ? nearestCell(grid, p.lngLat) : null;
    if (near && near.km > MAX_OUTSIDE_KM) {
      showToast("That's outside the Heilbronn area we cover. Pick a place nearby.");
      return;
    }
    update({ home: p });
    setQuery("");
    onDone?.();
  };

  const useGps = () => {
    if (!("geolocation" in navigator)) return showToast("Your browser can't share your location. Type an address instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const named = await reverseGeocode(at);
        setLocating(false);
        choose({ label: "My location", sub: named ? [named.label, named.sub].filter(Boolean).join(", ") : "GPS", lngLat: at });
      },
      () => {
        setLocating(false);
        showToast("Location is blocked. Allow it in your browser, or type an address.");
      },
      { timeout: 10000 },
    );
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active]);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      {prefs.home && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-great-soft px-3 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white">
            <MapPin className="size-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-[#0a4d38]">{prefs.home.label}</span>
            {prefs.home.sub && <span className="block truncate text-xs text-[#14653e]">{prefs.home.sub}</span>}
          </span>
          <button type="button" onClick={() => update({ home: null })} aria-label="Remove my location" className="grid size-10 place-items-center rounded-full text-[#14653e]">
            <Trash2 className="size-[18px]" aria-hidden />
          </button>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 rounded-2xl border-2 border-line bg-white px-3.5 focus-within:border-ink">
          {searching ? <Loader2 className="size-[18px] shrink-0 animate-spin text-mute" aria-hidden /> : <Search className="size-[18px] shrink-0 text-mute" aria-hidden />}
          <input
            ref={input}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Street, address or neighbourhood"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Street, address or neighbourhood"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-base font-semibold outline-none placeholder:font-medium placeholder:text-mute/70"
          />
        </div>

        <ul id={listId} role="listbox" aria-label={typing ? "Search results" : "Neighbourhoods"} className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-line">
          {!typing && <li role="presentation" className="px-3.5 pb-1 pt-2.5 text-[11px] font-extrabold uppercase tracking-wider text-mute">Neighbourhoods</li>}
          {options.map((p, i) => (
            <li
              key={`${p.label}-${p.lngLat.join()}`}
              role="option"
              aria-selected={i === active}
              onClick={() => choose(p)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2", i === active && "bg-wash")}
            >
              <MapPin className="size-4 shrink-0 text-mute" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{p.label}</span>
                {p.sub && <span className="block truncate text-xs text-mute">{p.sub}</span>}
              </span>
            </li>
          ))}
          {typing && !searching && results.length === 0 && <li role="presentation" className="px-3.5 py-3 text-sm text-mute">Nothing found in Heilbronn for “{query.trim()}”.</li>}
        </ul>
      </div>

      <button
        type="button"
        onClick={useGps}
        disabled={locating}
        className="flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-wash text-sm font-extrabold disabled:opacity-60"
      >
        <LocateFixed className={cn("size-[18px] text-brand", locating && "animate-spin")} aria-hidden />
        {locating ? "Finding you…" : "Use my current location"}
      </button>

      <div>
        <p className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-mute">HOW FAR WILL YOU GO?</p>
        <div role="radiogroup" aria-label="Distance" className="grid grid-cols-4 gap-1 rounded-2xl bg-wash p-1">
          {RADII.map((r) => {
            const on = prefs.radiusKm === r.km;
            return (
              <button
                key={r.label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update({ radiusKm: r.km })}
                className={cn("h-11 rounded-xl text-xs transition-colors", on ? "bg-ink font-display font-bold text-lime" : "font-bold text-mute")}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {onDone && (
        <button type="button" onClick={onDone} className="h-[54px] rounded-2xl bg-lime text-base font-extrabold">
          Show my sweet spots
        </button>
      )}
    </div>
  );
}

export default function LocationSheet() {
  const { sheet, closeSheet } = useApp();
  return (
    <Sheet open={sheet === "location"} onClose={closeSheet} title="Where do you start?">
      <LocationPanel onDone={closeSheet} />
    </Sheet>
  );
}
