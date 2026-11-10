import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { BlockState, EditorCommands } from "~/lib/editor/commands";
import type { Alignment } from "~/lib/editor/format/paragraphFormat";
import { DEFAULT_STYLES, type StyleId } from "~/lib/editor/styles/namedStyles";

/**
 * Fixed toolbar above the document. Every button goes through
 * EditorCommands so changes land in block data / tunes and persist.
 */

interface Props {
  commands: EditorCommands | null;
}

const STYLE_OPTIONS: StyleId[] = [
  "normal",
  "title",
  "subtitle",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "quote",
];

const ALIGN_BUTTONS: Array<{ value: Alignment; label: string; glyph: string }> = [
  { value: "left", label: "Align left", glyph: "⇤" },
  { value: "center", label: "Align center", glyph: "⇔" },
  { value: "right", label: "Align right", glyph: "⇥" },
  { value: "justify", label: "Justify", glyph: "☰" },
];

const LINE_SPACING = [1, 1.15, 1.5, 2] as const;

const EMPTY_STATE: BlockState = { type: null, styleId: "normal", alignment: "left", indent: 0 };

export function EditorRibbon({ commands }: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<BlockState>(EMPTY_STATE);

  // Track the caret's block so the ribbon shows what's active.
  useEffect(() => {
    if (!commands) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setState(commands.blockState()));
    };
    document.addEventListener("selectionchange", refresh);
    document.addEventListener("keyup", refresh);
    document.addEventListener("mouseup", refresh);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", refresh);
      document.removeEventListener("keyup", refresh);
      document.removeEventListener("mouseup", refresh);
    };
  }, [commands]);

  /** Run a command, then refresh the active state. */
  const run = (fn: (c: EditorCommands) => unknown) => async (e?: MouseEvent) => {
    e?.preventDefault();
    if (!commands) return;
    await fn(commands);
    setState(commands.blockState());
  };

  const disabled = !commands;

  return (
    <div className="ribbon" role="toolbar" aria-label="Editor toolbar">
      <RibbonButton onClick={run((c) => c.undo())} label="Undo (⌘Z)" disabled={disabled}>↶</RibbonButton>
      <RibbonButton onClick={run((c) => c.redo())} label="Redo (⇧⌘Z)" disabled={disabled}>↷</RibbonButton>

      <RibbonDivider />

      <select
        className="ribbon-select"
        value={state.styleId}
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => void run((c) => c.applyStyle(e.target.value as StyleId))()}
        aria-label="Paragraph style"
      >
        {STYLE_OPTIONS.map((id) => (
          <option key={id} value={id}>{DEFAULT_STYLES[id].label}</option>
        ))}
      </select>

      <RibbonDivider />

      <RibbonButton onClick={run((c) => c.inline("bold"))} label="Bold (⌘B)" disabled={disabled} bold>B</RibbonButton>
      <RibbonButton onClick={run((c) => c.inline("italic"))} label="Italic (⌘I)" disabled={disabled} italic>I</RibbonButton>
      <RibbonButton onClick={run((c) => c.inline("underline"))} label="Underline (⌘U)" disabled={disabled} underline>U</RibbonButton>
      <RibbonButton onClick={run((c) => c.inline("strikeThrough"))} label="Strikethrough" disabled={disabled} strike>S</RibbonButton>

      <input
        ref={colorInputRef}
        type="color"
        className="ribbon-color-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => commands?.textColor(e.target.value)}
      />
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          colorInputRef.current?.click();
        }}
        label="Text color"
        disabled={disabled}
      >
        <span className="ribbon-color-swatch" />
        <span>A</span>
      </RibbonButton>
      <RibbonButton onClick={run((c) => c.highlight("#fef08a"))} label="Highlight" disabled={disabled}>
        <span className="ribbon-mark">H</span>
      </RibbonButton>
      <RibbonButton onClick={run((c) => c.inline("removeFormat"))} label="Clear formatting" disabled={disabled}>
        T̸
      </RibbonButton>

      <RibbonDivider />

      {ALIGN_BUTTONS.map((a) => (
        <RibbonButton
          key={a.value}
          onClick={run((c) => c.setAlignment(a.value))}
          label={a.label}
          active={state.alignment === a.value}
          disabled={disabled}
        >
          {a.glyph}
        </RibbonButton>
      ))}

      <select
        className="ribbon-select ribbon-select-narrow"
        value=""
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          void run((c) => c.setLineHeight(v === "default" ? undefined : Number(v)))();
        }}
        aria-label="Line spacing"
        title="Line spacing"
      >
        <option value="" disabled>↕</option>
        <option value="default">Default</option>
        {LINE_SPACING.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>

      <RibbonButton onClick={run((c) => c.changeIndent(-1))} label="Decrease indent" disabled={disabled || state.indent === 0}>⇠</RibbonButton>
      <RibbonButton onClick={run((c) => c.changeIndent(1))} label="Increase indent" disabled={disabled}>⇢</RibbonButton>

      <RibbonDivider />

      <RibbonButton onClick={run((c) => c.toggleList("unordered"))} label="Bullet list" disabled={disabled}>• ≡</RibbonButton>
      <RibbonButton onClick={run((c) => c.toggleList("ordered"))} label="Numbered list" disabled={disabled}>1. ≡</RibbonButton>

      <RibbonDivider />

      <RibbonButton onClick={run((c) => c.insertBlock("table"))} label="Insert table" disabled={disabled}>Table</RibbonButton>
      <RibbonButton onClick={run((c) => c.insertBlock("image"))} label="Insert image" disabled={disabled}>Image</RibbonButton>
      <RibbonButton onClick={run((c) => c.insertBlock("horizontalLine"))} label="Insert horizontal line" disabled={disabled}>—</RibbonButton>
      <RibbonButton onClick={run((c) => c.insertPageBreak())} label="Page break (⌘/Ctrl + Enter)" disabled={disabled}>⤓</RibbonButton>
    </div>
  );
}

interface RibbonButtonProps {
  onClick: (e: MouseEvent) => void;
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

function RibbonButton({
  onClick,
  label,
  children,
  active,
  disabled,
  bold,
  italic,
  underline,
  strike,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className={`ribbon-btn${active ? " ribbon-btn-active" : ""}`}
      // Keep focus (and the caret) in the document.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      style={{
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? "italic" : undefined,
        textDecoration: underline ? "underline" : strike ? "line-through" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function RibbonDivider() {
  return <span className="ribbon-divider" aria-hidden />;
}
