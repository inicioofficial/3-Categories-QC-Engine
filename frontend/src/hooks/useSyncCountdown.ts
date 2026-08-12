import { useEffect, useState } from "react";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useSyncCountdown() {
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    function calculateTimeLeft() {
      const now = Date.now();
      const nextSyncTime = now + SYNC_INTERVAL_MS;
      const diff = nextSyncTime - now;
      
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      
      return { minutes, seconds };
    }

    setTimeLeft(calculateTimeLeft());
    
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return timeLeft;
}

export function formatCountdown(timeLeft: { minutes: number; seconds: number } | null): string {
  if (!timeLeft) return "";
  const { minutes, seconds } = timeLeft;
  return `Next sync in ${minutes}:${seconds.toString().padStart(2, "0")}`;
}