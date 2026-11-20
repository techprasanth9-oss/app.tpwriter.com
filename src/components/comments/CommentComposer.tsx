import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PublicUser } from "~/lib/api/collab";
import {
  activeMentionQuery,
  bodyToDraft,
  draftToBody,
  filterMembers,
  insertMention,
  type PickedMention,
} from "~/lib/editor/comments/mentions";
import { MentionPicker, mentionOptionId } from "./MentionPicker";

export interface CommentComposerProps {
  members: PublicUser[];
  /** Stored body to start from (editing). */
  initialBody?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Accessible name of the text field. */
  label: string;
  autoFocus?: boolean;
  /** Reply boxes stay one line (no buttons) until focused or filled. */
  collapsible?: boolean;
  onSubmit(body: string): void;
  onCancel(): void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const SEND_HINT = isMac ? "⌘+Enter" : "Ctrl+Enter";

/** Plain-text comment box with an @mention picker.
 *  Ctrl/⌘+Enter sends; Esc closes the picker, then cancels. */
export function CommentComposer({
  members,
  initialBody = "",
  placeholder = "Comment or add others with @",
  submitLabel = "Comment",
  label,
  autoFocus,
  collapsible,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const initial = useMemo(() => bodyToDraft(initialBody), [initialBody]);
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<PickedMention[]>(initial.mentions);
  const [caret, setCaret] = useState(initial.text.length);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState<number | null>(null);
  const [focused, setFocused] = useState(!!autoFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const query = activeMentionQuery(text, caret);
  const options = query && pickerDismissed !== query.start ? filterMembers(members, query.query) : [];
  const pickerOpen = options.length > 0;
  const activeIndex = Math.min(pickerIndex, Math.max(0, options.length - 1));

  // Autosize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? text.length);

  const pick = (u: PublicUser) => {
    if (!query) return;
    const r = insertMention(text, query.start, caret, u);
    setText(r.text);
    setMentions((m) => (m.some((x) => x.userId === r.mention.userId && x.name === r.mention.name) ? m : [...m, r.mention]));
    setCaret(r.caret);
    setPickerIndex(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  const body = draftToBody(text, mentions);
  const canSend = text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSubmit(body.trim());
    setText("");
    setMentions([]);
    setCaret(0);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setPickerIndex((activeIndex + d + options.length) % options.length);
        return;
      }
      if ((e.key === "Enter" && !(e.ctrlKey || e.metaKey)) || e.key === "Tab") {
        e.preventDefault();
        pick(options[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPickerDismissed(query!.start);
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (collapsible) {
        setText("");
        setMentions([]);
        ref.current?.blur();
      }
      onCancel();
    }
  };

  const expanded = !collapsible || focused || text.length > 0;

  return (
    <div className={`tp-composer${expanded ? " is-expanded" : ""}`}>
      <div className="tp-composer-field">
        <textarea
          ref={ref}
          className="tp-composer-input"
          value={text}
          rows={expanded ? 2 : 1}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={hintId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? listId : undefined}
          aria-activedescendant={pickerOpen ? mentionOptionId(listId, activeIndex) : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setPickerIndex(0);
          }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {pickerOpen && (
          <MentionPicker id={listId} options={options} activeIndex={activeIndex} onPick={pick} onHover={setPickerIndex} />
        )}
      </div>
      <span id={hintId} className="tp-sr-only">
        Type @ to mention someone. {SEND_HINT} to send, Escape to cancel.
      </span>
      {expanded && (
        <div className="tp-composer-actions">
          <button
            type="button"
            className="tp-cbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText("");
              setMentions([]);
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="tp-cbtn tp-cbtn--primary"
            disabled={!canSend}
            onClick={submit}
            title={`${submitLabel} (${SEND_HINT})`}
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
