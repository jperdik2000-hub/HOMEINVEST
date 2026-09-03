import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Renders a player's name as a tap target that opens their profile.
 * - Registered users → /players/$id
 * - Walk-ins (no user_id) → /players/walkin/$name
 * If name is empty / falsy, renders a muted placeholder.
 */
export function PlayerLink({
  userId,
  name,
  className = "",
  children,
  placeholder = "—",
}: {
  userId?: string | null;
  name?: string | null;
  className?: string;
  children?: ReactNode;
  placeholder?: string;
}) {
  const trimmed = (name ?? "").trim();
  const label = children ?? (trimmed || placeholder);
  const base = "hover:text-gold underline-offset-2 hover:underline transition-colors";
  const cls = `${base} ${className}`.trim();

  if (userId) {
    return (
      <Link to="/players/$id" params={{ id: userId }} className={cls}>
        {label}
      </Link>
    );
  }
  if (trimmed) {
    return (
      <Link
        to="/players/walkin/$name"
        params={{ name: encodeURIComponent(trimmed) }}
        className={cls}
      >
        {label}
      </Link>
    );
  }
  return <span className={className}>{label}</span>;
}