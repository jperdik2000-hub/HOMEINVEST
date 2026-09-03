import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

const THRESHOLD = 70;
const MAX_PULL = 120;

export function usePullToRefresh() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || refreshing) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    }
    function onTouchMove(e: TouchEvent) {
      if (!active.current || startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Damped pull
      const damped = Math.min(MAX_PULL, dy * 0.5);
      setPull(damped);
      if (dy > 10 && window.scrollY === 0) e.preventDefault();
    }
    async function onTouchEnd() {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      const shouldRefresh = pullRef.current >= THRESHOLD;
      setPull(0);
      if (shouldRefresh) {
        setRefreshing(true);
        try {
          await Promise.all([
            queryClient.invalidateQueries(),
            router.invalidate(),
          ]);
        } finally {
          setTimeout(() => setRefreshing(false), 300);
        }
      }
    }
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [queryClient, router, refreshing]);

  // Keep a ref of pull so touchend sees latest without re-registering handlers
  const pullRef = useRef(0);
  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  return { pull, refreshing, threshold: THRESHOLD };
}