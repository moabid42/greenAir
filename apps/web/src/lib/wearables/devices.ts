/**
 * Simulated wearables (WHOOP, Apple Watch). They replay a fixed, synthetic session from public/fixtures
 * so the Analytics and Devices pages can be shown without hardware. History stays in this browser and is never uploaded.
 */
export interface DemoSample {
  timestamp: string;
  heartRateBpm: number;
  sessionStrainDemoIndex?: number;
  cumulativeSteps?: number;
  cumulativeDistanceKm?: number;
  cadenceStepsPerMin?: number;
}

export interface DemoSummary {
  recoveryScoreDemo?: number;
}

export interface DemoDevice {
  id: string;
  name: string;
  connected: boolean;
  samples: DemoSample[];
  summary?: DemoSummary | null;
}

const DEFINITIONS: Record<string, { name: string; file: string }> = {
  "whoop-demo-01": { name: "WHOOP", file: "whoop_demo_2026-10-29.json" },
  "applewatch-demo-01": { name: "Apple Watch", file: "apple_watch_demo_2026-10-29.json" },
};

type Stored = Record<string, { connected: boolean; samples: DemoSample[]; summary?: DemoSummary | null }>;

export class DemoDevices {
  private readonly key = "ecomab-demo-devices-v4";
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private generation = new Map<string, number>();

  constructor(private onChange: () => void = () => undefined) {
    // Playback cannot stay connected across a page reload.
    const data = this.read();
    for (const record of Object.values(data)) record.connected = false;
    if (Object.keys(data).length) this.write(data);
  }

  private read(): Stored {
    try {
      const x = JSON.parse(localStorage.getItem(this.key) || "{}");
      return x && typeof x === "object" ? (x as Stored) : {};
    } catch {
      return {};
    }
  }

  private write(data: Stored) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }

  list(): DemoDevice[] {
    const data = this.read();
    return Object.entries(DEFINITIONS).map(([id, info]) => {
      const saved = data[id];
      return { id, name: info.name, connected: saved?.connected ?? false, samples: saved?.samples ?? [], summary: saved?.summary };
    });
  }

  async connect(id: string): Promise<void> {
    const def = DEFINITIONS[id];
    if (!def) throw new Error("Unknown sample device");
    this.disconnect(id);
    const generation = this.generation.get(id);
    const response = await fetch(`/fixtures/${def.file}`);
    if (!response.ok) throw new Error("Sample session unavailable");
    const fixture = (await response.json()) as { deviceId: string; samples: DemoSample[]; summary?: DemoSummary | null };
    if (fixture.deviceId !== id || !Array.isArray(fixture.samples)) throw new Error("Invalid sample session");
    if (this.generation.get(id) !== generation) return;
    const data = this.read();
    data[id] = { connected: true, samples: data[id]?.samples ?? [] };
    this.write(data);

    let index = 0;
    const step = () => {
      const current = this.read();
      if (!current[id]?.connected || this.generation.get(id) !== generation) return;
      const sample = fixture.samples[index++];
      if (sample && !current[id].samples.some((x) => x.timestamp === sample.timestamp)) current[id].samples.push(sample);
      this.write(current);
      this.onChange();
      if (index >= fixture.samples.length) {
        current[id].summary = fixture.summary ?? null;
        this.write(current);
        this.onChange();
        clearInterval(this.timers.get(id));
        this.timers.delete(id);
      }
    };
    step();
    if (index < fixture.samples.length) this.timers.set(id, setInterval(step, 3000));
  }

  disconnect(id: string) {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    const t = this.timers.get(id);
    if (t) {
      clearInterval(t);
      this.timers.delete(id);
    }
    const data = this.read();
    if (data[id]) {
      data[id].connected = false;
      this.write(data);
    }
  }

  forget(id: string) {
    this.disconnect(id);
    const data = this.read();
    delete data[id];
    this.write(data);
  }
}
