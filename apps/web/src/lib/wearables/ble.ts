/** Standard Bluetooth heart-rate sensors through Web Bluetooth. Only heart rate and battery are read; nothing is uploaded. */

export interface HeartRateSample {
  schema_version: string;
  sample_id: string;
  timestamp_utc: string;
  metric: "heart_rate";
  value: number;
  unit: "bpm";
  source_type: "ble_gatt";
  opaque_device_id: string;
  session_id: string;
  quality: "observed";
}

export function parseHeartRate(data: DataView): number {
  if (data.byteLength < 2) throw new Error("Incomplete heart rate measurement");
  const wide = (data.getUint8(0) & 1) !== 0;
  if (wide && data.byteLength < 3) throw new Error("Incomplete 16-bit heart rate measurement");
  return wide ? data.getUint16(1, true) : data.getUint8(1);
}

/** Recent samples recorded on purpose, kept in this browser: at most 3,000 samples or seven days. */
export class LocalSampleStore {
  private readonly key = "ecomab-samples-v3";
  private readonly max = 3000;
  private readonly days = 7;

  read(): HeartRateSample[] {
    try {
      const a = JSON.parse(localStorage.getItem(this.key) || "[]");
      return Array.isArray(a) ? (a as HeartRateSample[]).filter((x) => Date.parse(x.timestamp_utc) > Date.now() - this.days * 86400000).slice(-this.max) : [];
    } catch {
      return [];
    }
  }

  save(x: HeartRateSample) {
    const a = this.read();
    a.push(x);
    localStorage.setItem(this.key, JSON.stringify(a.slice(-this.max)));
  }

  clear() {
    localStorage.removeItem(this.key);
  }
}

// The small slice of the Web Bluetooth API we use (it is not part of TypeScript's DOM types).
interface BleCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  readValue(): Promise<DataView>;
}
interface BleService {
  getCharacteristic(name: string): Promise<BleCharacteristic>;
}
interface BleServer {
  connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(name: string): Promise<BleService>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: BleServer;
}
type BluetoothNav = { bluetooth?: { requestDevice(o: unknown): Promise<BleDevice> } };

export class WebBluetoothAdapter {
  device: BleDevice | null = null;
  recording = false;
  battery: number | null = null;
  last: HeartRateSample | null = null;
  private characteristic: BleCharacteristic | null = null;
  private handler: ((e: Event) => void) | null = null;
  private opaqueId: string | null = null;
  private sessionId: string | null = null;
  error = "";

  constructor(
    private onSample: (s: HeartRateSample) => void,
    private onChange: () => void,
  ) {}

  get supported(): boolean {
    return typeof window !== "undefined" && window.isSecureContext && !!(navigator as unknown as BluetoothNav).bluetooth?.requestDevice && typeof globalThis.crypto?.randomUUID === "function";
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected;
  }

  async connect(): Promise<void> {
    if (!this.supported) throw new Error("Web Bluetooth requires a supported browser and a secure context. Standard iOS Safari and Firefox do not support it.");
    this.opaqueId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    const device = await (navigator as unknown as BluetoothNav).bluetooth!.requestDevice({ filters: [{ services: ["heart_rate"] }], optionalServices: ["battery_service"] });
    this.device = device;
    device.addEventListener("gattserverdisconnected", () => {
      this.characteristic = null;
      this.onChange();
    });
    const server = await device.gatt!.connect();
    const hr = await server.getPrimaryService("heart_rate");
    this.characteristic = await hr.getCharacteristic("heart_rate_measurement");
    this.handler = (e) => {
      try {
        const value = parseHeartRate((e.target as BleCharacteristic).value!);
        this.last = {
          schema_version: "1.0",
          sample_id: crypto.randomUUID(),
          timestamp_utc: new Date().toISOString(),
          metric: "heart_rate",
          value,
          unit: "bpm",
          source_type: "ble_gatt",
          opaque_device_id: this.opaqueId!,
          session_id: this.sessionId!,
          quality: "observed",
        };
        if (this.recording) this.onSample(this.last);
        this.onChange();
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Unreadable heart-rate message";
        this.onChange();
      }
    };
    this.characteristic.addEventListener("characteristicvaluechanged", this.handler);
    await this.characteristic.startNotifications();
    try {
      const battery = await (await server.getPrimaryService("battery_service")).getCharacteristic("battery_level");
      this.battery = (await battery.readValue()).getUint8(0);
    } catch {
      this.battery = null;
    }
    this.onChange();
  }

  async disconnect(): Promise<void> {
    try {
      if (this.characteristic && this.handler) {
        this.characteristic.removeEventListener("characteristicvaluechanged", this.handler);
        await this.characteristic.stopNotifications();
      }
    } catch {
      /* the device may already be gone */
    }
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.characteristic = null;
    this.recording = false;
    this.onChange();
  }
}
