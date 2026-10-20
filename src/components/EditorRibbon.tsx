import { useCallback, useRef, type MouseEvent } from "react";
import type EditorJS from "@editorjs/editorjs";

/**
 * Fixed toolbar above the paper canvas. Common commands one click away.
 * Inline actions (bold/italic/underline/strike + alignment) use
 * document.execCommand (EditorJS uses contentEditable and respects it).
 * Block actions (insert, convert) go through the EditorJS block API.
 */

interface Props {
  activeEditorRef: React.MutableRefObject<EditorJS | null>;
}

const HEADING_OPTIONS = [
  { label: "Paragraph", type: "paragraph", data: {} },
  { label: "Heading 1", type: "header", data: { level: 1 } },
  { label: "Heading 2", type: "header", data: { level: 2 } },
  { label: "Heading 3", type: "header", data: { level: 3 } },
  { label: "Heading 4", type: "header", data: { level: 4 } },
] as const;

export function EditorRibbon({ activeEditorRef }: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const exec = useCallback(
    (command: string, value?: string) => (e: MouseEvent) => {
      e.preventDefault();
      try {
        document.execCommand(command, false, value);
      } catch {
        /* execCommand is deprecated but still ships in all browsers */
      }
    },
    [],
  );

  const insertBlock = useCallback(
    async (type: string, data: Record<string, unknown> = {}) => {
      const editor = activeEditorRef.current;
      if (!editor) return;
      await editor.isReady;
      const currentIndex = editor.blocks.getCurrentBlockIndex();
      const targetIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      editor.blocks.insert(type, data, undefined, targetIndex, true);
    },
    [activeEditorRef],
  );

  const convertCurrent = useCallback(
    async (type: string, data: Record<string, unknown> = {}) => {
      const editor = activeEditorRef.current;
      if (!editor) return;
      await editor.isReady;
      const block = editor.blocks.getBlockByIndex(
        editor.blocks.getCurrentBlockIndex(),
      );
      if (!block) return;
      try {
        await editor.blocks.convert(block.id, type, data);
      } catch (err) {
        console.debug("[ribbon] convert failed:", err);
      }
    },
    [activeEditorRef],
  );

  const applyColor = useCallback((color: string) => {
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, color);
    } catch {
      /* no-op */
    }
  }, []);

  return (
    <div className="ribbon" role="toolbar" aria-label="Editor toolbar">
      <select
        className="ribbon-select"
        onMouseDown={(e) => e.preventDefault()}
        onChange={(e) => {
          const opt = HEADING_OPTIONS.find((o) => o.label === e.target.value);
          if (!opt) return;
          convertCurrent(opt.type, opt.data as Record<string, unknown>);
          e.target.value = "";
        }}
        defaultValue=""
        aria-label="Block type"
      >
        <option value="" disabled>Style</option>
        {HEADING_OPTIONS.map((o) => (
          <option key={o.label} value={o.label}>{o.label}</option>
        ))}
      </select>

      <RibbonDivider />

      <RibbonButton onClick={exec("bold")} label="Bold (⌘B)" bold>B</RibbonButton>
      <RibbonButton onClick={exec("italic")} label="Italic (⌘I)" italic>I</RibbonButton>
      <RibbonButton onClick={exec("underline")} label="Underline (⌘U)" underline>U</RibbonButton>
      <RibbonButton onClick={exec("strikeThrough")} label="Strikethrough" strike>S</RibbonButton>

      <input
        ref={colorInputRef}
        type="color"
        className="ribbon-color-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => applyColor(e.target.value)}
      />
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          colorInputRef.current?.click();
        }}
        label="Text color"
      >
        <span className="ribbon-color-swatch" />
        <span>A</span>
      </RibbonButton>
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          try {
            document.execCommand("styleWithCSS", false, "true");
            document.execCommand("hiliteColor", false, "#fef08a");
          } catch {
            /* ignore */
          }
        }}
        label="Highlight"
      >
        <span className="ribbon-mark">H</span>
      </RibbonButton>

      <RibbonDivider />

      <RibbonButton onClick={exec("justifyLeft")} label="Align left">⇤</RibbonButton>
      <RibbonButton onClick={exec("justifyCenter")} label="Align center">⇔</RibbonButton>
      <RibbonButton onClick={exec("justifyRight")} label="Align right">⇥</RibbonButton>
      <RibbonButton onClick={exec("justifyFull")} label="Justify">☰</RibbonButton>

      <RibbonDivider />

      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          convertCurrent("list", { style: "unordered" });
        }}
        label="Bullet list"
      >• ≡</RibbonButton>
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          convertCurrent("list", { style: "ordered" });
        }}
        label="Numbered list"
      >1. ≡</RibbonButton>

      <RibbonDivider />

      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          insertBlock("table");
        }}
        label="Insert table"
      >Table</RibbonButton>
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          insertBlock("image");
        }}
        label="Insert image"
      >Image</RibbonButton>
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          insertBlock("horizontalLine");
        }}
        label="Insert divider"
      >—</RibbonButton>
      <RibbonButton
        onClick={(e) => {
          e.preventDefault();
          insertBlock("delimiter");
        }}
        label="Insert section break"
      >⁂</RibbonButton>
    </div>
  );
}

interface RibbonButtonProps {
  onClick: (e: MouseEvent) => void;
  label: string;
  children: React.ReactNode;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

function RibbonButton({
  onClick,
  label,
  children,
  bold,
  italic,
  underline,
  strike,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className="ribbon-btn"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? "italic" : undefined,
        textDecoration: underline
          ? "underline"
          : strike
            ? "line-through"
            : undefined,
      }}
    >
      {children}
    </button>
  );
}

function RibbonDivider() {
  return <span className="ribbon-divider" aria-hidden />;
}
