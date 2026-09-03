import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type PresenceState = {
  online: Set<string>;
  typingUsers: Set<string>;
};

/**
 * Realtime presence + typing indicator for a room (e.g. a poker table).
 * Uses Supabase Realtime — no DB writes.
 */
export function usePresence(roomKey: string | null, meId: string | null) {
  const [state, setState] = useState<PresenceState>({
    online: new Set(),
    typingUsers: new Set(),
  });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<Map<string, number>>(new Map());
  const lastBroadcastRef = useRef<number>(0);

  useEffect(() => {
    if (!roomKey || !meId) return;

    const channel = supabase.channel(`presence-${roomKey}`, {
      config: { presence: { key: meId } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const raw = channel.presenceState() as Record<string, unknown[]>;
        setState((prev) => ({ ...prev, online: new Set(Object.keys(raw)) }));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const uid = (payload as { user_id?: string })?.user_id;
        if (!uid || uid === meId) return;
        setState((prev) => {
          const next = new Set(prev.typingUsers);
          next.add(uid);
          return { ...prev, typingUsers: next };
        });
        const timers = typingTimeoutRef.current;
        const existing = timers.get(uid);
        if (existing) window.clearTimeout(existing);
        const handle = window.setTimeout(() => {
          setState((prev) => {
            const next = new Set(prev.typingUsers);
            next.delete(uid);
            return { ...prev, typingUsers: next };
          });
          timers.delete(uid);
        }, 3000);
        timers.set(uid, handle);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: meId, online_at: new Date().toISOString() });
        }
      });

    return () => {
      const timers = typingTimeoutRef.current;
      timers.forEach((h) => window.clearTimeout(h));
      timers.clear();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomKey, meId]);

  function broadcastTyping() {
    if (!channelRef.current || !meId) return;
    const now = Date.now();
    // Throttle to at most one broadcast per 1.5s to avoid spam.
    if (now - lastBroadcastRef.current < 1500) return;
    lastBroadcastRef.current = now;
    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: meId },
    });
  }

  return { ...state, broadcastTyping };
}