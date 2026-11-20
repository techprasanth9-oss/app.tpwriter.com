import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "~/lib/api/client";
import { Dialog, DialogButton } from "./ui/Dialog";
import {
  canAtLeast,
  getShares,
  setShareLink,
  shareWith,
  unshare,
  type Role,
  type ShareMember,
  type Shares,
} from "~/lib/api/collab";

type ShareRole = ShareMember["role"];

const ROLE_LABEL: Record<ShareRole, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
};

interface Props {
  open: boolean;
  documentId: string;
  title: string;
  /** The current user's role — only owners can change sharing. */
  role: Role;
  onClose: () => void;
}

export function shareLinkUrl(documentId: string, token: string): string {
  return `${window.location.origin}/documents/${documentId}?share=${encodeURIComponent(token)}`;
}

/** Share with people by email, and the document's share link. */
export function ShareDialog({ open, documentId, title, role, onClose }: Props) {
  const queryClient = useQueryClient();
  const key = ["shares", documentId];
  const isOwner = role === "owner";
  const shares = useQuery({ queryKey: key, queryFn: () => getShares(documentId), enabled: open });
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<ShareRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
  }, [open]);

  const onDone = {
    onSuccess: (next: Shares) => {
      queryClient.setQueryData(key, next);
      setError(null);
    },
    onError: (err: unknown) => setError(describeError(err)),
  };
  const add = useMutation({ mutationFn: () => shareWith(documentId, email.trim(), newRole), ...onDone });
  const change = useMutation({ mutationFn: (m: { email: string; role: ShareRole }) => shareWith(documentId, m.email, m.role), ...onDone });
  const remove = useMutation({ mutationFn: (who: string) => unshare(documentId, who), ...onDone });
  const link = useMutation({ mutationFn: (l: { enabled: boolean; role: ShareRole }) => setShareLink(documentId, l), ...onDone });

  if (!open) return null;
  const data = shares.data;
  const busy = add.isPending || change.isPending || remove.isPending || link.isPending;

  const copyLink = async () => {
    if (!data?.link.token) return;
    try {
      await navigator.clipboard.writeText(shareLinkUrl(documentId, data.link.token));
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  };

  return (
    <Dialog
      open
      size="md"
      title={`Share “${title}”`}
      description="Invite people by email or turn on a link. Everyone needs to sign in."
      onClose={onClose}
      className="tp-share-dialog"
      initialFocus={() => emailRef.current}
      footer={<DialogButton variant="primary" onClick={onClose}>Done</DialogButton>}
    >
          {isOwner && (
            <form
              className="tp-share-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) add.mutate(undefined, { onSuccess: () => setEmail("") });
              }}
            >
              <input
                ref={emailRef}
                className="tp-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Add people by email"
                aria-label="Email address"
                required
              />
              <RoleSelect value={newRole} onChange={setNewRole} label="Role for the new person" />
              <button type="submit" className="tp-btn tp-btn--primary" disabled={busy || !email.trim()}>
                Share
              </button>
            </form>
          )}
          {error && <p className="tp-alert" role="alert">{error}</p>}

          <h3 className="tp-share-heading">People with access</h3>
          {shares.isLoading && <p className="tp-share-muted">Loading…</p>}
          {shares.error && <p className="tp-alert">{describeError(shares.error)}</p>}
          {data && (
            <ul className="tp-share-list">
              <li>
                <Person name={data.owner.displayName} email={data.owner.email} />
                <span className="tp-share-muted">Owner</span>
              </li>
              {data.members.map((m) => (
                <li key={m.id}>
                  <Person name={m.displayName} email={m.email} />
                  {isOwner ? (
                    <MemberControls
                      role={m.role}
                      label={m.displayName ?? m.email}
                      disabled={busy}
                      onRole={(r) => change.mutate({ email: m.email, role: r })}
                      onRemove={() => remove.mutate(m.id)}
                    />
                  ) : (
                    <span className="tp-share-muted">{ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              ))}
              {data.invites.map((inv) => (
                <li key={inv.email}>
                  <Person name={null} email={inv.email} note="Invited — gets access on sign-up" />
                  {isOwner ? (
                    <MemberControls
                      role={inv.role}
                      label={inv.email}
                      disabled={busy}
                      onRole={(r) => change.mutate({ email: inv.email, role: r })}
                      onRemove={() => remove.mutate(inv.email)}
                    />
                  ) : (
                    <span className="tp-share-muted">{ROLE_LABEL[inv.role]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data && (
            <section className="tp-share-link" aria-label="Link sharing">
              <h3 className="tp-share-heading">Share link</h3>
              {isOwner ? (
                <div className="tp-share-link-row">
                  <label className="tp-share-toggle">
                    <input
                      type="checkbox"
                      checked={data.link.enabled}
                      disabled={busy}
                      onChange={(e) => link.mutate({ enabled: e.target.checked, role: data.link.role })}
                    />
                    Anyone signed in with the link
                  </label>
                  <RoleSelect
                    value={data.link.role}
                    disabled={busy || !data.link.enabled}
                    onChange={(r) => link.mutate({ enabled: true, role: r })}
                    label="Role for people with the link"
                  />
                </div>
              ) : (
                <p className="tp-share-muted">
                  {data.link.enabled ? `Anyone signed in with the link — ${ROLE_LABEL[data.link.role].toLowerCase()}` : "Link sharing is off."}
                </p>
              )}
              {data.link.enabled && data.link.token && (
                <div className="tp-share-link-row">
                  <input
                    className="tp-input tp-share-url"
                    readOnly
                    value={shareLinkUrl(documentId, data.link.token)}
                    aria-label="Share link"
                    onFocus={(e) => e.target.select()}
                  />
                  <button type="button" className="tp-btn tp-btn--secondary" onClick={() => void copyLink()}>
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              )}
              {isOwner && data.link.enabled && (
                <p className="tp-share-muted">Turning the link off and on again makes a new link; the old one stops working.</p>
              )}
            </section>
          )}
          {!canAtLeast(role, "owner") && <p className="tp-share-muted">Only the owner can change who has access.</p>}
    </Dialog>
  );
}

function Person({ name, email, note }: { name: string | null; email: string; note?: string }) {
  return (
    <span className="tp-share-person">
      <span className="tp-avatar" aria-hidden>{initials(name ?? email)}</span>
      <span>
        <span className="tp-share-name">{name ?? email}</span>
        {(name || note) && <span className="tp-share-muted">{note ?? email}</span>}
      </span>
    </span>
  );
}

function MemberControls(props: {
  role: ShareRole;
  label: string;
  disabled: boolean;
  onRole: (r: ShareRole) => void;
  onRemove: () => void;
}) {
  return (
    <span className="tp-share-controls">
      <RoleSelect value={props.role} onChange={props.onRole} disabled={props.disabled} label={`Role for ${props.label}`} />
      <button type="button" className="tp-btn tp-btn--secondary" onClick={props.onRemove} disabled={props.disabled} aria-label={`Remove ${props.label}`}>
        Remove
      </button>
    </span>
  );
}

function RoleSelect(props: { value: ShareRole; onChange: (r: ShareRole) => void; disabled?: boolean; label: string }) {
  return (
    <select
      className="tp-input tp-share-role"
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value as ShareRole)}
    >
      {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => (
        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
      ))}
    </select>
  );
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return err.message || "That can't be shared — check the email address.";
    if (err.status === 403 || err.status === 404) return "You don't have permission to change sharing.";
  }
  return err instanceof Error ? err.message : String(err);
}
