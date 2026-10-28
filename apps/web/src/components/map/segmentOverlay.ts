import type maplibregl from "maplibre-gl";
import type { SegmentSnapshot } from "@/lib/api/consumer";

export const SEGMENT_LAYER = "ecomab-segment-lines";
const SOURCE = "ecomab-segments";

/**
 * Backend street scores drawn on the map. The backend's own vector tiles carry an integer `segment_id`; scores are joined
 * to those features with feature-state. OpenStreetMap ids are never used. Each new `build_id` rebuilds the source.
 */
export class SegmentOverlay {
  private build: string | null = null;
  private ids = new Set<number>();

  constructor(
    private map: maplibregl.Map,
    private tileUrl: (build: string) => string,
  ) {}

  private switchBuild(build: string) {
    if (build === this.build) return;
    this.clear();
    if (this.map.getLayer(SEGMENT_LAYER)) this.map.removeLayer(SEGMENT_LAYER);
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
    this.build = build;
    this.map.addSource(SOURCE, { type: "vector", tiles: [this.tileUrl(build)], promoteId: "segment_id" });
    const before = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    this.map.addLayer(
      {
        id: SEGMENT_LAYER,
        type: "line",
        source: SOURCE,
        "source-layer": "segments",
        paint: {
          "line-color": ["case", ["==", ["get", "coverage"], "none"], "#9aa8a3", ["==", ["coalesce", ["feature-state", "score"], -1], -1], "#9aa8a3", [">", ["%", ["coalesce", ["feature-state", "flags"], 0], 8], 0], "#9f3f45", ["step", ["feature-state", "score"], "#bb5250", 20, "#e47152", 40, "#dbad36", 60, "#74b68c", 80, "#14966f"]],
          "line-width": 3,
          "line-opacity": ["case", ["!=", ["coalesce", ["feature-state", "conf"], -1], -1], ["+", 0.3, ["*", 0.7, ["feature-state", "conf"]]], 0.4],
        },
      },
      before,
    );
  }

  private clear() {
    for (const id of this.ids) this.map.removeFeatureState({ source: SOURCE, sourceLayer: "segments", id });
    this.ids.clear();
  }

  /** Show a snapshot. A snapshot from another build is ignored rather than joined to the wrong tiles. */
  apply(snapshot: SegmentSnapshot, visible: boolean) {
    this.switchBuild(snapshot.build_id);
    this.map.setLayoutProperty(SEGMENT_LAYER, "visibility", visible ? "visible" : "none");
    this.clear();
    for (const [key, [score, conf, flags]] of Object.entries(snapshot.scores)) {
      const id = Number(key);
      this.map.setFeatureState({ source: SOURCE, sourceLayer: "segments", id }, { score, conf, flags });
      this.ids.add(id);
    }
  }

  hide() {
    if (this.map.getLayer(SEGMENT_LAYER)) this.map.setLayoutProperty(SEGMENT_LAYER, "visibility", "none");
  }
}
