import { useEffect, useRef, useState, type ReactNode } from "react";
import { TriangleAlert, Info } from "lucide-react";
import { Dialog, DialogButton } from "./Dialog";

/**
 * In-app replacements for window.alert / confirm / prompt. Callable from
 * anywhere (React or not, e.g. Editor.js tools) and promise-based. Falls
 * back to the native dialogs when no <DialogHost> is mounted (tests,
 * other entry points).
 */

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: red button and warning icon. */
  danger?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: ReactNode;
  /** Problem (warning icon) vs plain information. */
  tone?: "error" | "info";
  okLabel?: string;
}

export interface PromptOptions {
  title: string;
  message?: ReactNode;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputType?: "text" | "number";
  /** Return an error message to keep the dialog open. */
  validate?: (value: string) => string | null;
}

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

let enqueue: ((r: Request) => void) | null = null;

const plain = (m: ReactNode) => (typeof m === "string" ? m : "");

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!enqueue) return Promise.resolve(window.confirm([opts.title, plain(opts.message)].filter(Boolean).join("\n\n")));
  return new Promise((resolve) => enqueue!({ kind: "confirm", opts, resolve }));
}

export function alertDialog(opts: AlertOptions): Promise<void> {
  if (!enqueue) {
    window.alert([opts.title, plain(opts.message)].filter(Boolean).join("\n\n"));
    return Promise.resolve();
  }
  return new Promise((resolve) => enqueue!({ kind: "alert", opts, resolve }));
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  if (!enqueue) return Promise.resolve(window.prompt(opts.title, opts.defaultValue ?? ""));
  return new Promise((resolve) => enqueue!({ kind: "prompt", opts, resolve }));
}

/** Mount once at the app root. Requests queue and show one at a time. */
export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => {
      enqueue = null;
    };
  }, []);
  const current = queue[0];
  const done = () => setQueue((q) => q.slice(1));
  if (!current) return null;
  if (current.kind === "confirm") return <ConfirmView key={queue.length} req={current} done={done} />;
  if (current.kind === "alert") return <AlertView key={queue.length} req={current} done={done} />;
  return <PromptView key={queue.length} req={current} done={done} />;
}

function ConfirmView({ req, done }: { req: Extract<Request, { kind: "confirm" }>; done: () => void }) {
  const { opts } = req;
  const finish = (ok: boolean) => {
    req.resolve(ok);
    done();
  };
  return (
    <Dialog
      open
      size="sm"
      role="alertdialog"
      tone={opts.danger ? "danger" : "default"}
      icon={opts.danger ? <TriangleAlert size={20} strokeWidth={1.75} /> : undefined}
      title={opts.title}
      description={opts.message}
      onClose={() => finish(false)}
      footer={
        <>
          {/* Destructive: focus starts on Cancel, so Enter can't destroy. */}
          <DialogButton onClick={() => finish(false)} data-autofocus={opts.danger ? true : undefined}>
            {opts.cancelLabel ?? "Cancel"}
          </DialogButton>
          <DialogButton variant={opts.danger ? "danger" : "primary"} onClick={() => finish(true)} data-autofocus={opts.danger ? undefined : true}>
            {opts.confirmLabel ?? "OK"}
          </DialogButton>
        </>
      }
    />
  );
}

function AlertView({ req, done }: { req: Extract<Request, { kind: "alert" }>; done: () => void }) {
  const { opts } = req;
  const finish = () => {
    req.resolve();
    done();
  };
  const error = opts.tone !== "info";
  return (
    <Dialog
      open
      size="sm"
      role="alertdialog"
      tone={error ? "danger" : "default"}
      icon={error ? <TriangleAlert size={20} strokeWidth={1.75} /> : <Info size={20} strokeWidth={1.75} />}
      title={opts.title}
      description={opts.message}
      onClose={finish}
      footer={
        <DialogButton variant="primary" onClick={finish} data-autofocus>
          {opts.okLabel ?? "OK"}
        </DialogButton>
      }
    />
  );
}

function PromptView({ req, done }: { req: Extract<Request, { kind: "prompt" }>; done: () => void }) {
  const { opts } = req;
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finish = (result: string | null) => {
    req.resolve(result);
    done();
  };
  const submit = () => {
    const problem = opts.validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    finish(value);
  };
  return (
    <Dialog
      open
      size="sm"
      title={opts.title}
      description={opts.message}
      onClose={() => finish(null)}
      initialFocus={() => inputRef.current}
      footer={
        <>
          <DialogButton onClick={() => finish(null)}>Cancel</DialogButton>
          <DialogButton variant="primary" onClick={submit}>
            {opts.confirmLabel ?? "OK"}
          </DialogButton>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="tp-field-row">
          <span className="tp-field-label">{opts.label}</span>
          <input
            ref={inputRef}
            className="tp-input"
            type={opts.inputType ?? "text"}
            value={value}
            placeholder={opts.placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error && <span className="tp-field-error" role="alert">{error}</span>}
        </label>
      </form>
    </Dialog>
  );
}
