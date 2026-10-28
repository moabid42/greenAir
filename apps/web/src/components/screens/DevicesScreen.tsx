"use client";

import { type ReactNode, useState } from "react";
import { Bluetooth, BluetoothConnected, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWearables } from "@/lib/wearables/useWearables";
import WatchAlerts from "./WatchAlerts";

const card = "rounded-[20px] bg-white p-4 shadow-sm";
const secondary = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-wash px-3.5 text-[13px] font-bold disabled:opacity-45";
const primary = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-ink px-4 text-[13px] font-extrabold text-lime disabled:opacity-45";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-3 mt-4">
      <h2 className="mb-1.5 px-1 text-[11px] font-extrabold tracking-[0.12em] text-mute">{title}</h2>
      {children}
    </section>
  );
}

/** Devices: simulated wearables, a real Bluetooth heart-rate sensor, privacy, and watch alerts. */
export default function DevicesScreen() {
  const w = useWearables();
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [consentRevoked, setConsentRevoked] = useState(false);
  const { ble, demos, devices, recent, readings } = w;
  const connected = !!ble?.connected;
  const supported = !!ble?.supported;

  const scan = async () => {
    w.setConnectError("");
    try {
      await ble?.connect();
    } catch (e) {
      w.setConnectError(e instanceof Error ? (e.name === "NotFoundError" ? "No device was selected." : e.message) : "Could not connect.");
    }
  };

  const connectDemo = async (id: string) => {
    w.setConnectError("");
    try {
      await demos?.connect(id);
    } catch (e) {
      w.setConnectError(e instanceof Error ? e.message : "Sample session unavailable.");
    }
    w.refresh();
  };

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto overscroll-contain bg-ground pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.5rem)]" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <header className="flex items-center justify-between px-4 pb-1">
        <h1 className="font-display text-[22px] font-extrabold">Devices</h1>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold", connected ? "bg-great-soft text-[#14653e]" : "bg-wash text-mute")}>
          {connected ? <BluetoothConnected className="size-3.5" aria-hidden /> : <Bluetooth className="size-3.5" aria-hidden />}
          {connected ? "Sensor connected" : "Not connected"}
        </span>
      </header>
      <p className="px-4 pb-1 text-xs leading-relaxed text-mute">Simulated devices replay a fixed, synthetic session (29 Oct 2026, 14:00–16:00 Europe/Berlin). They do not connect to real watches or brand services.</p>

      <Section title="SIMULATED DEVICES">
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <div key={d.id} className={card}>
              <h3 className="text-[15px] font-extrabold">{d.name}</h3>
              <p className="mt-0.5 text-xs text-mute">
                Simulated device · {d.connected ? "Connected · simulated playback" : d.samples.length ? "Disconnected, history retained" : "Not connected"} · {d.samples.length} samples
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={secondary} onClick={() => connectDemo(d.id)}>
                  {d.connected ? "Reload scenario" : "Play sample session"}
                </button>
                {d.connected && (
                  <button type="button" className={secondary} onClick={() => { demos?.disconnect(d.id); w.refresh(); }}>
                    Disconnect
                  </button>
                )}
                {d.samples.length > 0 &&
                  (confirmForget === d.id ? (
                    <button type="button" className={cn(secondary, "bg-bad-soft text-[#9a3a12]")} onClick={() => { demos?.forget(d.id); setConfirmForget(null); w.refresh(); }}>
                      <Trash2 className="size-3.5" aria-hidden /> Tap again to erase
                    </button>
                  ) : (
                    <button type="button" className={secondary} onClick={() => setConfirmForget(d.id)}>
                      Forget &amp; erase history
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-[11px] font-semibold text-mute">Browser storage is not the same as encrypted native storage. Sample sessions never upload.</p>
      </Section>

      <Section title="BLUETOOTH HEART-RATE SENSOR">
        <p className="mb-2 px-1 text-xs leading-relaxed text-mute">
          {supported ? "Web Bluetooth is available. Connect a compatible BLE heart-rate device." : "Web Bluetooth is unavailable here. Use a supported browser in a secure context (HTTPS or localhost). Standard iOS Safari and Firefox do not support Web Bluetooth."}
        </p>
        {w.connectError && <div role="alert" className="mb-2 rounded-2xl bg-ok-soft p-3.5 text-[13px] font-semibold text-[#7a5200]">{w.connectError}</div>}
        <div className={card}>
          <h3 className="text-[15px] font-extrabold">{connected ? "Connected" : "Not connected"}</h3>
          <p className="mt-0.5 text-xs text-mute">
            {ble?.device ? `${ble.device.name || "Heart-rate device"} · ${ble.battery == null ? "battery unavailable" : `${ble.battery}% battery`}` : "No sensor connected. Only standard BLE heart-rate measurement and optional battery are supported; smartwatch compatibility varies."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={scan} disabled={!supported}>
              {ble?.device ? "Connect another device" : "Scan for heart-rate device"}
            </button>
            {connected && (
              <button type="button" className={secondary} onClick={() => void ble?.disconnect()}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className={cn(card, "mt-2")}>
          <h3 className="text-[15px] font-extrabold">Live readings</h3>
          {ble?.last ? (
            <>
              <p className="my-1 font-display text-[34px] font-extrabold leading-none text-brand">
                {ble.last.value} <small className="text-sm font-bold text-mute">bpm</small>
              </p>
              <p className="text-xs text-mute">Observed · {new Date(ble.last.timestamp_utc).toLocaleTimeString()}</p>
              <div aria-hidden className="mt-2.5 flex h-16 items-end gap-[3px]">
                {recent.map((x) => (
                  <span key={x.sample_id} className="min-w-[2px] flex-1 rounded-t-[3px] bg-[#58b68f]" style={{ height: `${Math.min(100, x.value / 2)}%` }} />
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-mute">Waiting for a real heart-rate notification.</p>
          )}
          <button type="button" className={cn(secondary, "mt-3")} disabled={!connected} onClick={() => { if (ble) ble.recording = !ble.recording; w.refresh(); }}>
            {ble?.recording ? "Stop recording" : "Start recording"}
          </button>
          <p className="mt-1.5 text-[11px] font-semibold text-mute">Only samples recorded while this is on are saved here, up to 3,000 samples or seven days.</p>
        </div>

        <div className={cn(card, "mt-2")}>
          <h3 className="text-[15px] font-extrabold">Privacy &amp; sync</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">
            Local analytics: {readings.length || ble?.recording ? "enabled while recording" : "off until you record"}. Use in the Coach: off. Cloud sync: off and unavailable.
            {consentRevoked && " Future sync consent revoked."}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-mute">No data is sent to any endpoint. A separate authenticated wearable service, per-metric consent and a deletion policy would be required first.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondary} onClick={() => setConsentRevoked(true)}>
              Revoke future sync consent
            </button>
            <button type="button" className={secondary} onClick={w.clearReadings}>
              Delete local readings
            </button>
          </div>
        </div>

        <div className={cn(card, "mt-2")}>
          <h3 className="text-[15px] font-extrabold">Native integrations · planned</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">Apple HealthKit / Apple Watch, Android Health Connect and native Bluetooth are not part of the web app.</p>
        </div>
      </Section>

      <Section title="WATCH ALERTS &amp; SYNC">
        <div className="-mx-3">
          <WatchAlerts />
        </div>
      </Section>
    </div>
  );
}
