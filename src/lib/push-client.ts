import { supabase } from "@/integrations/supabase/client";

// VAPID public key — safe to expose to the browser.
export const VAPID_PUBLIC_KEY =
  "BOooOzbsl4v4YHwiGCse7RLu5infRzGnHMW-d2n4a1cRPozMiUPAtg550alllwYMPygixlX3CL9W4_lmsiHKzRQ";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isPreviewOrIframe() {
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true;
  } catch (_) {
    return true;
  }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host.endsWith(".lovableproject-dev.com")) return true;
  return false;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !isPreviewOrIframe()
  );
}

export async function currentPushStatus(): Promise<
  "unsupported" | "preview" | "denied" | "granted" | "default"
> {
  if (typeof window === "undefined") return "unsupported";
  if (isPreviewOrIframe()) return "preview";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return Notification.permission;
}

async function registerSw(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/push-sw.js");
  if (existing) return existing;
  return await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Push not supported in this browser." };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "Permission denied." };
    const reg = await registerSw();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" },
    );
    if (error) return { ok: false, reason: error.message };
    // Ensure a preferences row exists
    await supabase.from("notification_preferences").upsert(
      { user_id: user.id },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "Failed to enable push." };
  }
}

export async function disablePush(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "Failed to disable push." };
  }
}

// Re-upsert the current browser subscription so the DB row stays in sync.
// The browser can rotate/replace subscriptions, and server-side pruning on
// 404/410 can drop rows the browser still considers active. Calling this on
// mount and before sending a test push keeps the two ends aligned.
export async function syncPushSubscription(): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!pushSupported()) return { ok: false, reason: "unsupported" };
    if (Notification.permission !== "granted") return { ok: false, reason: "not-granted" };
    const reg = await registerSw();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "not-signed-in" };
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" },
    );
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "sync failed" };
  }
}