import { useEffect, useState } from "react";
import type { PageLayout, PaperSize } from "~/lib/api/documents";
import type { BlockState, EditorCommands, InlineState, ListCounter } from "~/lib/editor/commands";
import { FONT_OPTIONS, FONT_SIZES_PT } from "~/lib/editor/format/inlineStyle";
import type { Alignment } from "~/lib/editor/format/paragraphFormat";
import { DEFAULT_STYLES, type StyleId } from "~/lib/editor/styles/namedStyles";
import { ColorMenu, Dropdown, MenuItem, RibbonButton, RibbonGroup } from "./ribbon/controls";
import "./ribbon/ribbon.css";

/**
 * Word-style tabbed ribbon. Every control goes through EditorCommands so
 * changes land in block data / tunes / saved HTML and persist.
 */

type Tab = "home" | "insert" | "layout" | "view";

interface Props {
  commands: EditorCommands | null;
  layout: PageLayout;
  onLayoutChange: (patch: Partial<PageLayout>) => void;
  onOpenPageSetup: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onOpenFind: (mode: "find" | "replace") => void;
  onOpenLink: () => void;
  onOpenStyles: () => void;
  painterArmed: boolean;
  onTogglePainter: () => void;
  showStatusBar: boolean;
  onToggleStatusBar: () => void;
}

const STYLE_OPTIONS: StyleId[] = ["normal", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "quote"];

const ALIGN: Array<{ value: Alignment; label: string; glyph: string; key: string }> = [
  { value: "left", label: "Align left", glyph: "⇤", key: "L" },
  { value: "center", label: "Center", glyph: "⇔", key: "E" },
  { value: "right", label: "Align right", glyph: "⇥", key: "R" },
  { value: "justify", label: "Justify", glyph: "☰", key: "J" },
];

const LINE_SPACING = [1, 1.15, 1.5, 2, 2.5, 3];

const NUMBERING: Array<{ value: ListCounter; label: string }> = [
  { value: "numeric", label: "1. 2. 3." },
  { value: "lower-alpha", label: "a. b. c." },
  { value: "upper-alpha", label: "A. B. C." },
  { value: "lower-roman", label: "i. ii. iii." },
  { value: "upper-roman", label: "I. II. III." },
];

const PAPER: Array<{ value: PaperSize; label: string }> = [
  { value: "A4", label: "A4" },
  { value: "LETTER", label: "Letter" },
  { value: "LEGAL", label: "Legal" },
  { value: "A3", label: "A3" },
  { value: "A5", label: "A5" },
];

const MARGINS = [
  { label: "Normal", px: 96 },
  { label: "Narrow", px: 48 },
  { label: "Moderate", px: 72 },
  { label: "Wide", px: 144 },
];

const ZOOM_STOPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

const EMPTY_BLOCK: BlockState = { type: null, styleId: "normal", alignment: "left", indent: 0 };
const EMPTY_INLINE: InlineState = {
  font: "Inter",
  sizePt: 12,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  link: null,
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

export function EditorRibbon(props: Props) {
  const { commands } = props;
  const [tab, setTab] = useState<Tab>("home");
  const [block, setBlock] = useState<BlockState>(EMPTY_BLOCK);
  const [inline, setInline] = useState<InlineState>(EMPTY_INLINE);

  // Track the caret so the ribbon shows what's active there.
  useEffect(() => {
    if (!commands) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Skip re-rendering the ribbon when nothing it shows changed.
        const nextBlock = commands.blockState();
        const nextInline = commands.inlineState();
        setBlock((prev) => (sameState(prev, nextBlock) ? prev : nextBlock));
        setInline((prev) => (sameState(prev, nextInline) ? prev : nextInline));
      });
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
  const run = (fn: (c: EditorCommands) => unknown) => async () => {
    if (!commands) return;
    await fn(commands);
    setBlock(commands.blockState());
    setInline(commands.inlineState());
  };

  const off = !commands;

  return (
    <div className="rb" aria-label="Ribbon">
      <div className="rb-tabs" role="tablist" aria-label="Ribbon tabs">
        {(["home", "insert", "layout", "view"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`rb-tab${tab === t ? " is-active" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="rb-panel" role="tabpanel" aria-label={`${tab} tab`}>
        {tab === "home" && (
          <>
            <RibbonGroup label="History">
              <RibbonButton label={`Undo (${MOD}Z)`} onClick={run((c) => c.undo())} disabled={off}>↶</RibbonButton>
              <RibbonButton label={`Redo (${MOD}Shift+Z)`} onClick={run((c) => c.redo())} disabled={off}>↷</RibbonButton>
            </RibbonGroup>

            <RibbonGroup label="Font">
              <div className="rb-row">
                <select
                  className="rb-select rb-select-font"
                  aria-label="Font"
                  disabled={off}
                  value={inline.font ?? ""}
                  onChange={(e) => {
                    const font = FONT_OPTIONS.find((f) => f.label === e.target.value);
                    void run((c) => c.setFontFamily(font?.css ?? null))();
                  }}
                >
                  {inline.font === null && <option value="">(mixed)</option>}
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.label} value={f.label} style={{ fontFamily: f.css }}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <FontSizeBox
                  value={inline.sizePt}
                  disabled={off}
                  onCommit={(pt) => void run((c) => c.setFontSize(pt))()}
                />
                <RibbonButton label={`Grow font (${MOD}Shift+>)`} onClick={run((c) => c.stepFontSize(1))} disabled={off}>A<sup>+</sup></RibbonButton>
                <RibbonButton label={`Shrink font (${MOD}Shift+<)`} onClick={run((c) => c.stepFontSize(-1))} disabled={off}>A<sup>−</sup></RibbonButton>
              </div>
              <div className="rb-row">
                <RibbonButton label={`Bold (${MOD}B)`} active={inline.bold} onClick={run((c) => c.inline("bold"))} disabled={off} style={{ fontWeight: 700 }}>B</RibbonButton>
                <RibbonButton label={`Italic (${MOD}I)`} active={inline.italic} onClick={run((c) => c.inline("italic"))} disabled={off} style={{ fontStyle: "italic" }}>I</RibbonButton>
                <RibbonButton label={`Underline (${MOD}U)`} active={inline.underline} onClick={run((c) => c.inline("underline"))} disabled={off} style={{ textDecoration: "underline" }}>U</RibbonButton>
                <RibbonButton label={`Strikethrough (${MOD}Shift+X)`} active={inline.strike} onClick={run((c) => c.inline("strikeThrough"))} disabled={off} style={{ textDecoration: "line-through" }}>S</RibbonButton>
                <RibbonButton label={`Subscript (${MOD}=)`} active={inline.subscript} onClick={run((c) => c.inline("subscript"))} disabled={off}>x<sub>2</sub></RibbonButton>
                <RibbonButton label={`Superscript (${MOD}Shift+=)`} active={inline.superscript} onClick={run((c) => c.inline("superscript"))} disabled={off}>x<sup>2</sup></RibbonButton>
                <ColorMenu label="Text colour" noneLabel="Automatic" glyph="A" initial="#c2410c" disabled={off} onPick={(color) => void run((c) => c.setTextColor(color))()} />
                <ColorMenu label="Highlight" noneLabel="No highlight" glyph="✎" initial="#fef08a" disabled={off} onPick={(color) => void run((c) => c.setHighlight(color))()} />
                <Dropdown label="Change case" trigger="Aa" disabled={off}>
                  {(close) => (
                    <>
                      {([
                        ["sentence", "Sentence case."],
                        ["lower", "lowercase"],
                        ["upper", "UPPERCASE"],
                        ["title", "Capitalize Each Word"],
                        ["toggle", "tOGGLE cASE"],
                      ] as const).map(([mode, text]) => (
                        <MenuItem key={mode} onSelect={() => { close(); void run((c) => c.changeCase(mode))(); }}>{text}</MenuItem>
                      ))}
                    </>
                  )}
                </Dropdown>
                <RibbonButton label={`Clear formatting (${MOD}Space)`} onClick={run((c) => c.clearFormatting())} disabled={off}>T̸</RibbonButton>
              </div>
            </RibbonGroup>

            <RibbonGroup label="Paragraph">
              <div className="rb-row">
                <RibbonButton label={`Bulleted list (${MOD}Shift+L)`} active={block.type === "list"} onClick={run((c) => c.toggleList("unordered"))} disabled={off}>•≡</RibbonButton>
                <RibbonButton label="Numbered list" onClick={run((c) => c.toggleList("ordered"))} disabled={off}>1≡</RibbonButton>
                <RibbonButton label="Checklist" onClick={run((c) => c.toggleList("checklist"))} disabled={off}>☑</RibbonButton>
                <Dropdown label="Numbering format" trigger="1.a" disabled={off}>
                  {(close) => (
                    <>
                      {NUMBERING.map((n) => (
                        <MenuItem key={n.value} onSelect={() => { close(); void run((c) => c.setListNumbering(n.value))(); }}>{n.label}</MenuItem>
                      ))}
                      <div className="rb-menu-sep" />
                      <MenuItem onSelect={() => { close(); void run((c) => c.setListStart(1))(); }}>Restart numbering at 1</MenuItem>
                      <MenuItem
                        onSelect={() => {
                          close();
                          const raw = prompt("Start numbering at:", "1");
                          const n = raw ? Number(raw) : NaN;
                          if (Number.isFinite(n) && n >= 1) void run((c) => c.setListStart(n))();
                        }}
                      >
                        Set numbering value…
                      </MenuItem>
                    </>
                  )}
                </Dropdown>
                <RibbonButton label="Decrease indent" onClick={run((c) => c.changeIndent(-1))} disabled={off || block.indent === 0}>⇠</RibbonButton>
                <RibbonButton label="Increase indent" onClick={run((c) => c.changeIndent(1))} disabled={off}>⇢</RibbonButton>
              </div>
              <div className="rb-row">
                {ALIGN.map((a) => (
                  <RibbonButton key={a.value} label={`${a.label} (${MOD}${a.key})`} active={block.alignment === a.value} onClick={run((c) => c.setAlignment(a.value))} disabled={off}>{a.glyph}</RibbonButton>
                ))}
                <Dropdown label="Line and paragraph spacing" trigger="↕" disabled={off}>
                  {(close) => (
                    <>
                      {LINE_SPACING.map((v) => (
                        <MenuItem key={v} onSelect={() => { close(); void run((c) => c.setLineHeight(v))(); }}>{v.toFixed(v % 1 ? 2 : 1).replace(/0$/, "")}</MenuItem>
                      ))}
                      <MenuItem onSelect={() => { close(); void run((c) => c.setLineHeight(undefined))(); }}>Style default</MenuItem>
                      <div className="rb-menu-sep" />
                      <MenuItem onSelect={() => { close(); void run((c) => c.setParagraphSpacing({ spaceBefore: 12 }))(); }}>Add space before paragraph</MenuItem>
                      <MenuItem onSelect={() => { close(); void run((c) => c.setParagraphSpacing({ spaceAfter: 12 }))(); }}>Add space after paragraph</MenuItem>
                      <MenuItem onSelect={() => { close(); void run((c) => c.setParagraphSpacing({ spaceBefore: 0, spaceAfter: 0 }))(); }}>Remove paragraph spacing</MenuItem>
                      <MenuItem onSelect={() => { close(); void run((c) => c.setParagraphSpacing({ spaceBefore: null, spaceAfter: null }))(); }}>Style default spacing</MenuItem>
                    </>
                  )}
                </Dropdown>
              </div>
            </RibbonGroup>

            <RibbonGroup label="Styles">
              <div className="rb-row">
                <select
                  className="rb-select rb-select-style"
                  aria-label="Paragraph style"
                  disabled={off}
                  value={block.styleId}
                  onChange={(e) => void run((c) => c.applyStyle(e.target.value as StyleId))()}
                >
                  {STYLE_OPTIONS.map((id) => (
                    <option key={id} value={id}>{DEFAULT_STYLES[id].label}</option>
                  ))}
                </select>
              </div>
              <div className="rb-row">
                <RibbonButton label="Modify styles…" wide onClick={props.onOpenStyles} disabled={off}>¶</RibbonButton>
              </div>
            </RibbonGroup>

            <RibbonGroup label="Editing">
              <div className="rb-row">
                <RibbonButton label={`Find (${MOD}F)`} wide onClick={() => props.onOpenFind("find")} disabled={off}>⌕</RibbonButton>
              </div>
              <div className="rb-row">
                <RibbonButton label={`Replace (${MOD}H)`} wide onClick={() => props.onOpenFind("replace")} disabled={off}>⇄</RibbonButton>
                <RibbonButton label={`Format painter (${MOD}Shift+C / ${MOD}Shift+V)`} active={props.painterArmed} onClick={props.onTogglePainter} disabled={off}>🖌</RibbonButton>
              </div>
            </RibbonGroup>
          </>
        )}

        {tab === "insert" && (
          <>
            <RibbonGroup label="Tables & media">
              <RibbonButton label="Table" wide onClick={run((c) => c.insertBlock("table"))} disabled={off}>▦</RibbonButton>
              <RibbonButton label="Image" wide onClick={run((c) => c.insertBlock("image"))} disabled={off}>🖼</RibbonButton>
            </RibbonGroup>
            <RibbonGroup label="Links">
              <RibbonButton label={`Link (${MOD}K)`} wide active={inline.link !== null} onClick={props.onOpenLink} disabled={off}>🔗</RibbonButton>
            </RibbonGroup>
            <RibbonGroup label="Pages">
              <RibbonButton label={`Page break (${MOD}Enter)`} wide onClick={run((c) => c.insertPageBreak())} disabled={off}>⤓</RibbonButton>
              <RibbonButton label="Horizontal line" wide onClick={run((c) => c.insertBlock("horizontalLine"))} disabled={off}>—</RibbonButton>
            </RibbonGroup>
          </>
        )}

        {tab === "layout" && (
          <>
            <RibbonGroup label="Page setup">
              <label className="rb-field">
                <span>Size</span>
                <select className="rb-select" value={props.layout.paperSize} onChange={(e) => props.onLayoutChange({ paperSize: e.target.value as PaperSize })}>
                  {PAPER.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="rb-field">
                <span>Orientation</span>
                <select
                  className="rb-select"
                  value={props.layout.orientation}
                  onChange={(e) => props.onLayoutChange({ orientation: e.target.value as PageLayout["orientation"] })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label className="rb-field">
                <span>Margins</span>
                <select
                  className="rb-select"
                  value={MARGINS.find((m) => [props.layout.marginTop, props.layout.marginRight, props.layout.marginBottom, props.layout.marginLeft].every((v) => v === m.px))?.label ?? "Custom"}
                  onChange={(e) => {
                    const m = MARGINS.find((x) => x.label === e.target.value);
                    if (m) props.onLayoutChange({ marginTop: m.px, marginRight: m.px, marginBottom: m.px, marginLeft: m.px });
                  }}
                >
                  {MARGINS.map((m) => (
                    <option key={m.label} value={m.label}>{m.label} ({m.px / 96} in)</option>
                  ))}
                  <option value="Custom" disabled>Custom</option>
                </select>
              </label>
              <RibbonButton label="More page setup…" wide onClick={props.onOpenPageSetup}>⚙</RibbonButton>
            </RibbonGroup>
          </>
        )}

        {tab === "view" && (
          <>
            <RibbonGroup label="Zoom">
              <RibbonButton label="Zoom out" onClick={() => props.onZoomChange(prevStop(props.zoom, -1))}>−</RibbonButton>
              <select className="rb-select rb-select-narrow" aria-label="Zoom" value={props.zoom} onChange={(e) => props.onZoomChange(Number(e.target.value))}>
                {ZOOM_STOPS.map((z) => (
                  <option key={z} value={z}>{Math.round(z * 100)}%</option>
                ))}
              </select>
              <RibbonButton label="Zoom in" onClick={() => props.onZoomChange(prevStop(props.zoom, 1))}>+</RibbonButton>
              <RibbonButton label="100%" wide onClick={() => props.onZoomChange(1)}>⊙</RibbonButton>
            </RibbonGroup>
            <RibbonGroup label="Show">
              <RibbonButton label="Status bar (word count)" wide active={props.showStatusBar} onClick={props.onToggleStatusBar}>▭</RibbonButton>
            </RibbonGroup>
          </>
        )}
      </div>
    </div>
  );
}

function prevStop(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STOPS.find((z) => z > current + 0.001) ?? ZOOM_STOPS[ZOOM_STOPS.length - 1]!;
  return [...ZOOM_STOPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STOPS[0]!;
}

/** Editable font-size box with the Word size list as suggestions. */
function FontSizeBox({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (pt: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const pt = Number(text);
    // Blur fires when the user clicks back into the document; only apply
    // when the value was actually changed here.
    if (pt === value) return;
    if (Number.isFinite(pt) && pt >= 1 && pt <= 400) onCommit(Math.round(pt * 2) / 2);
    else setText(String(value));
  };
  return (
    <>
      <input
        className="rb-select rb-size"
        aria-label="Font size"
        list="tp-font-sizes"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <datalist id="tp-font-sizes">
        {FONT_SIZES_PT.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

function sameState<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
