import type { Category, Endpoint, Redirect, RedirectMode, Settings } from "./types";

export type Errors<K extends string = string> = Partial<Record<K, string>>;

const SECRET_KEYS = /^(api[-_]?key|key|token|access[-_]?token|auth|authorization|secret|password|passwd|pwd|signature|sig)$/i;
export const CATEGORIES: Category[] = ["backend", "environment", "weather", "air", "wearable", "geo", "map", "bike", "other"];

/** Replace the {base} and {today} placeholders so the rest of the URL can be parsed. */
function sample(url: string) {
  return url.replaceAll("{base}", "https://backend.example").replaceAll("{today}", "2026-01-01");
}

/** Problems with a URL, or null when it is fine. Secrets in a URL would be stored unencrypted in this browser, so they are refused. */
export function urlProblem(raw: string, { allowTemplate = true, requireHttps = false }: { allowTemplate?: boolean; requireHttps?: boolean } = {}): string | null {
  const v = raw.trim();
  if (!v) return "Enter a URL.";
  if (!allowTemplate && /[{}]/.test(v)) return "Use a full URL without placeholders.";
  let u: URL;
  try {
    u = new URL(allowTemplate ? sample(v) : v);
  } catch {
    return "Enter a full URL such as https://example.org/api.";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Only http:// and https:// URLs are supported.";
  if (requireHttps && u.protocol !== "https:") return "Use https:// so the connection is encrypted.";
  if (u.username || u.password) return "Remove the username and password from the URL.";
  for (const k of u.searchParams.keys()) if (SECRET_KEYS.test(k)) return `Remove "${k}" from the URL. Secrets are not stored securely by this admin.`;
  if (/[{}]/.test(u.href.replace(/%7B|%7D/gi, ""))) return "Only {base} and {today} placeholders are supported.";
  return null;
}

export interface EndpointForm {
  name: string;
  path: string;
  url: string;
  category: Category;
  note: string;
}

export function validateEndpoint(form: EndpointForm, existing: Endpoint[], editingId: string | null = null): Errors<keyof EndpointForm> {
  const e: Errors<keyof EndpointForm> = {};
  const name = form.name.trim();
  if (name.length < 2) e.name = "Give it a name of at least 2 characters.";
  else if (name.length > 40) e.name = "Keep the name under 40 characters.";
  else if (existing.some((x) => x.id !== editingId && x.name.toLowerCase() === name.toLowerCase())) e.name = "Another endpoint already has this name.";

  const p = form.path.trim();
  if (p && !p.startsWith("/")) e.path = "A path starts with /, for example /api/v1/day.";
  else if (p.length > 80) e.path = "Keep the path under 80 characters.";

  const up = urlProblem(form.url);
  if (up) e.url = up;
  else if (existing.some((x) => x.id !== editingId && x.url.trim() === form.url.trim())) e.url = "Another endpoint already uses this URL.";

  if (!CATEGORIES.includes(form.category)) e.category = "Choose a category.";
  if (form.note.length > 200) e.note = "Keep the note under 200 characters.";
  return e;
}

/** Derive the short path label from a URL when the user leaves it empty. */
export function pathFromUrl(url: string): string {
  try {
    const u = new URL(sample(url.trim()));
    return u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function validateRedirect(r: Redirect, endpointUrl: string): Errors<"target"> {
  const e: Errors<"target"> = {};
  if (r.mode === "off") return e;
  const p = urlProblem(r.target, { allowTemplate: false });
  if (p) e.target = p;
  else if (r.target.trim() === endpointUrl.trim()) e.target = "The redirect target must differ from the endpoint itself.";
  return e;
}

export const REDIRECT_MODES: RedirectMode[] = ["off", "on-failure", "always"];

export function validateSettings(s: Settings): Errors<keyof Settings> {
  const e: Errors<keyof Settings> = {};
  if (s.backendUrl) {
    const p = urlProblem(s.backendUrl, { allowTemplate: false });
    if (p) e.backendUrl = p;
    else if (/[?#]/.test(s.backendUrl)) e.backendUrl = "Use the base address only, without ? or #.";
  }
  if (!(s.timeoutMs >= 1000 && s.timeoutMs <= 30000)) e.timeoutMs = "Between 1 and 30 seconds.";
  if (!(s.degradedMs >= 100 && s.degradedMs <= 20000)) e.degradedMs = "Between 0.1 and 20 seconds.";
  else if (s.degradedMs >= s.timeoutMs) e.degradedMs = "Must be lower than the timeout.";
  return e;
}

export const hasErrors = (e: object) => Object.keys(e).length > 0;

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "endpoint";
