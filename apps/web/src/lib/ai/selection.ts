/** Local routing only: never makes a second model call or queries external services. */
export type DataTopic = "weather" | "air" | "stations" | "devices" | "streets" | "activity";
export interface DataSelection {
  topics: DataTopic[];
  inherited: boolean;
  needsClarification: boolean;
}

function topicsIn(question: string): DataTopic[] {
  const q = question.toLowerCase();
  const topics = new Set<DataTopic>();
  if (/\b(weather|forecast|temperature|humidity|wind|heat|hot|cold|rain|wetter|temperatur|feuchtigkeit)\b/.test(q)) topics.add("weather");
  if (/\b(air|pollution|pollutants?|pm2[._]?5|pm10|no2|o3|ozone|luft|luftqualität)\b/.test(q)) topics.add("air");
  if (/\b(sensors?|stations?|measured|measurements?|messstation|messwerte)\b/.test(q)) topics.add("stations");
  if (/\b(heart|bpm|devices?|watch|whoop|steps?|pace|cadence|workout|recovery|strain|puls|herzfrequenz)\b/.test(q)) topics.add("devices");
  if (/\b(streets?|parks?|places?|where|routes?|surface|traffic|segments?|straße|strecke|verkehr)\b/.test(q)) topics.add("streets");
  if (/\b(best|recommend|recommendation|should i|can i|running|cycling|walking|run|ride|walk|training)\b/.test(q) && !topics.has("devices")) topics.add("activity");
  return [...topics];
}

export function selectData(question: string, history: { role: string; text: string }[] = []): DataSelection {
  const topics = topicsIn(question);
  if (topics.length) return { topics, inherited: false, needsClarification: false };
  // Temporal/pronominal follow-ups inherit one recent user topic, never assistant claims.
  if (/\b(and|tomorrow|today|that|those|more|why|what about|how about|morgen|heute)\b/i.test(question)) {
    for (const turn of [...history].reverse()) {
      if (turn.role !== "user") continue;
      const previous = topicsIn(turn.text);
      if (previous.length) return { topics: previous, inherited: true, needsClarification: false };
    }
  }
  return { topics: [], inherited: false, needsClarification: true };
}

export function includesCategory(selection: DataSelection, category: string): boolean {
  const has = (topic: DataTopic) => selection.topics.includes(topic);
  if (category === "availability_metadata") return true;
  if (/^day_/.test(category)) return has("weather") || has("air") || has("activity");
  if (category === "sensor") return has("stations") || has("air");
  if (/device|ble/.test(category)) return has("devices");
  if (/grid|segment/.test(category)) return has("streets");
  if (category === "activity_metadata") return has("activity");
  return false;
}

/** Empty list means all channels are relevant, not that missing values are zero. */
export function selectedDayFields(selection: DataSelection): string[] {
  if (selection.topics.includes("activity")) return [];
  return [
    ...(selection.topics.includes("weather") ? ["tempC", "humidity", "windKmh", "daylight"] : []),
    ...(selection.topics.includes("air") ? ["pm25", "no2"] : []),
  ];
}
