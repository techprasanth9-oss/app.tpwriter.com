import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "~/hooks/useAuth";

export function UserMenu() {
  const { user, logout, logoutState } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!user) return null;

  const initials = getInitials(user.displayName, user.email);
  const label = user.displayName?.trim() || user.email.split("@")[0];

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className={`user-menu-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        title={label}
      >
        <span className="user-avatar">{initials}</span>
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-identity">
            <span className="user-avatar user-avatar-lg">{initials}</span>
            <div className="user-menu-identity-text">
              <span className="user-menu-name">{label}</span>
              <span className="user-menu-email">{user.email}</span>
            </div>
          </div>

          <div className="user-menu-divider" aria-hidden />

          <Link
            to="/profile"
            className="user-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <IconUser />
            <span>View profile</span>
          </Link>

          <div className="user-menu-divider" aria-hidden />

          <button
            type="button"
            className="user-menu-item user-menu-item-danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            disabled={logoutState.isPending}
          >
            <IconSignOut />
            <span>{logoutState.isPending ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function getInitials(displayName: string | null, email: string): string {
  const name = displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    const out = (first + last).toUpperCase();
    if (out) return out;
  }
  return email[0]?.toUpperCase() ?? "?";
}

function IconUser() {
  return (
    <svg
      className="user-menu-item-icon"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 16.5c1-3 3.6-4.5 6.5-4.5s5.5 1.5 6.5 4.5" />
    </svg>
  );
}

function IconSignOut() {
  return (
    <svg
      className="user-menu-item-icon"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v9A1.5 1.5 0 0 0 4.5 16H8" />
      <path d="M12 13l3-3-3-3" />
      <path d="M15 10H7.5" />
    </svg>
  );
}
