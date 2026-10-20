import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ApiError } from "~/lib/api/client";
import { useAuth } from "~/hooks/useAuth";

type Mode = "login" | "signup";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, signup, loginState, signupState } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = loginState.isPending || signupState.isPending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "login") {
        await login({ email, password });
      } else {
        await signup({ email, password, displayName: displayName || undefined });
      }
      navigate({ to: "/" });
    } catch (err) {
      setError(humaniseAuthError(err, mode));
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <h1 className="auth-brand">TP Writer</h1>
        <p className="auth-tagline">
          {mode === "login"
            ? "Sign in to your account."
            : "Create an account to get started."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should we address you?"
              />
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Minimum 8 characters" : "••••••••"}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="auth-submit"
            disabled={busy || !email || !password}
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="auth-toggle">
          {mode === "login" ? "No account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="auth-toggle-btn"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function humaniseAuthError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_credentials") return "Wrong email or password.";
    if (err.code === "email_taken") return "An account with that email already exists.";
  }
  return mode === "login"
    ? "Couldn't sign you in. Please try again."
    : "Couldn't create your account. Please try again.";
}
