import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "~/hooks/useAuth";
import { UserMenu } from "~/components/UserMenu";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, logoutState } = useAuth();

  if (!user) return null;

  const label = user.displayName?.trim() || user.email.split("@")[0];
  const initials = getInitials(user.displayName, user.email);
  const memberSince = formatMemberSince(user.createdAt);

  return (
    <div className="docs-root">
      <header className="docs-header">
        <div className="docs-header-left">
          <button
            type="button"
            className="doc-back-btn"
            onClick={() => navigate({ to: "/" })}
            aria-label="Back to documents"
            title="Back to documents"
          >
            ‹
          </button>
          <h1 className="doc-brand">TP Writer</h1>
        </div>
        <div className="docs-header-right">
          <UserMenu />
        </div>
      </header>

      <main className="profile-main">
        <div className="profile-breadcrumbs">
          <Link to="/" className="profile-breadcrumb-link">
            Documents
          </Link>
          <span className="profile-breadcrumb-sep" aria-hidden>
            /
          </span>
          <span className="profile-breadcrumb-current">Profile</span>
        </div>

        <section className="profile-hero">
          <div className="profile-hero-avatar" aria-hidden>
            {initials}
          </div>
          <div className="profile-hero-body">
            <h2 className="profile-hero-name">{label}</h2>
            <p className="profile-hero-email">{user.email}</p>
            <p className="profile-hero-meta">Member since {memberSince}</p>
          </div>
        </section>

        <section className="profile-card">
          <header className="profile-card-head">
            <h3 className="profile-card-title">Account</h3>
            <p className="profile-card-sub">
              Your account information on TP Writer.
            </p>
          </header>

          <dl className="profile-fields">
            <ProfileField label="Display name" value={user.displayName || "—"} />
            <ProfileField label="Email" value={user.email} />
            <ProfileField label="User ID" value={user.id} mono />
            <ProfileField label="Member since" value={memberSince} />
          </dl>
        </section>

        <section className="profile-card">
          <header className="profile-card-head">
            <h3 className="profile-card-title">Session</h3>
            <p className="profile-card-sub">
              Sign out of this browser. You can log back in anytime.
            </p>
          </header>
          <div className="profile-actions">
            <button
              type="button"
              className="doc-btn profile-signout-btn"
              onClick={() => void logout()}
              disabled={logoutState.isPending}
            >
              {logoutState.isPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProfileField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="profile-field">
      <dt className="profile-field-label">{label}</dt>
      <dd className={`profile-field-value${mono ? " is-mono" : ""}`}>{value}</dd>
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

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
