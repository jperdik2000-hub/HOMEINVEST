export function formatNightDetailsTime(startsAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startsAt)).replace(",", "");
}

export function getNightIdFromNotificationUrl(url?: string | null) {
  return url?.match(/^\/nights\/([0-9a-f-]{36})(?:[/?#].*)?$/i)?.[1] ?? null;
}