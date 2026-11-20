import { promptDialog } from "./ui/dialogs";
import { useEffect, useState, type ReactNode } from "react";
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  CalendarDays,
  Copy,
  Scissors,
  CaseSensitive,
  ChartColumn,
  Columns2,
  Files,
  FileText,
  Frame,
  Hash,
  Heading,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PaintBucket,
  Paintbrush,
  PanelBottom,
  PanelTop,
  Redo2,
  RectangleVertical,
  RemoveFormatting,
  Replace,
  Scan,
  Search,
  Settings2,
  Sigma,
  SquareDashed,
  SquareSplitVertical,
  Stamp,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableOfContents,
  TextCursorInput,
  Underline,
  Undo2,
  UnfoldVertical,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import type { PageLayout, PaperSize } from "~/lib/api/documents";
import type { BlockState, EditorCommands, InlineState, ListCounter } from "~/lib/editor/commands";
import { FONT_OPTIONS, FONT_SIZES_PT } from "~/lib/editor/format/inlineStyle";
import type { Alignment } from "~/lib/editor/format/paragraphFormat";
import type { StyleId, StyleSheet } from "~/lib/editor/styles/namedStyles";
import { StyleGallery } from "./ribbon/StyleGallery";
import type { FieldKind, PageSetup } from "~/lib/editor/pageSetup";
import type { HeaderFooterTarget } from "./PageChrome";
import {
  ColorMenu,
  Dropdown,
  ICON_SM,
  MenuItem,
  RibbonButton,
  RibbonGroup,
  RibbonPanel,
  RibbonStack,
  SplitGroup,
} from "./ribbon/controls";
import "./ribbon/ribbon.css";

/**
 * Word-style tabbed ribbon. Every control goes through EditorCommands so
 * changes land in block data / tunes / saved HTML and persist.
 */

type Tab = "home" | "insert" | "layout" | "references" | "view" | "headerFooter";

interface Props {
  commands: EditorCommands | null;
  /** Resolved named styles (live previews in the styles gallery). */
  styles: StyleSheet;
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
  /** Layout of the caret's section when it isn't the first one. */
  sectionLayout: PageLayout | null;
  pageSetup: PageSetup;
  onPageSetupChange: (patch: Partial<PageSetup>) => void;
  editingHeaderFooter: HeaderFooterTarget | null;
  onEditHeaderFooter: (area: "header" | "footer") => void;
  onCloseHeaderFooter: () => void;
  onInsertField: (kind: FieldKind) => void;
  onInsertFootnote: () => void;
  /** Rendered at the start of the tab row, before "Home" (e.g. a File menu button; style it with `.rb-file`). */
  leading?: ReactNode;
}

const WATERMARKS = ["CONFIDENTIAL", "DRAFT", "DO NOT COPY", "SAMPLE", "URGENT"];

const BORDERS: Array<{ label: string; value: PageSetup["pageBorder"] }> = [
  { label: "None", value: null },
  { label: "Box — thin", value: { style: "solid", width: 1, color: "#0f172a" } },
  { label: "Box — thick", value: { style: "solid", width: 3, color: "#0f172a" } },
  { label: "Double", value: { style: "double", width: 4, color: "#0f172a" } },
  { label: "Dashed", value: { style: "dashed", width: 1, color: "#475569" } },
];


const ALIGN: Array<{ value: Alignment; label: string; icon: LucideIcon; key: string }> = [
  { value: "left", label: "Align left", icon: AlignLeft, key: "L" },
  { value: "center", label: "Center", icon: AlignCenter, key: "E" },
  { value: "right", label: "Align right", icon: AlignRight, key: "R" },
  { value: "justify", label: "Justify", icon: AlignJustify, key: "J" },
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
  // Layout controls show (and change) the caret's section.
  const layout = props.sectionLayout ?? props.layout;
  const editingHF = props.editingHeaderFooter !== null;

  // The contextual Header & Footer tab appears while one is being edited.
  useEffect(() => {
    if (editingHF) setTab("headerFooter");
    else setTab((t) => (t === "headerFooter" ? "home" : t));
  }, [editingHF]);
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
        {props.leading}
        {([
          ["home", "Home"],
          ["insert", "Insert"],
          ["layout", "Layout"],
          ["references", "References"],
          ["view", "View"],
          ...(editingHF ? [["headerFooter", "Header & Footer"]] : []),
        ] as Array<[Tab, string]>).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`rb-tab${tab === t ? " is-active" : ""}${t === "headerFooter" ? " is-contextual" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      <RibbonPanel label={`${tab} tab`}>
        {tab === "home" && (
          <>
            <RibbonGroup label="History">
              <RibbonStack>
                <RibbonButton label={`Undo (${MOD}Z)`} icon={Undo2} onClick={run((c) => c.undo())} disabled={off} />
                <RibbonButton label={`Redo (${MOD}Shift+Z)`} icon={Redo2} onClick={run((c) => c.redo())} disabled={off} />
              </RibbonStack>
            </RibbonGroup>

            <RibbonGroup label="Clipboard">
              <RibbonButton
                label={`Format painter (${MOD}Shift+C / ${MOD}Shift+V)`}
                icon={Paintbrush}
                text="Format painter"
                large
                active={props.painterArmed}
                onClick={props.onTogglePainter}
                disabled={off}
              />
              <RibbonStack>
                <RibbonButton label={`Cut (${MOD}X)`} icon={Scissors} text="Cut" onClick={() => document.execCommand("cut")} disabled={off} />
                <RibbonButton label={`Copy (${MOD}C)`} icon={Copy} text="Copy" onClick={() => document.execCommand("copy")} disabled={off} />
              </RibbonStack>
            </RibbonGroup>

            <RibbonGroup label="Font">
              <RibbonStack>
                <div className="rb-row">
                  <select
                    className="rb-select rb-select-font"
                    aria-label="Font"
                    title="Font"
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
                  <RibbonButton label={`Grow font (${MOD}Shift+>)`} icon={AArrowUp} onClick={run((c) => c.stepFontSize(1))} disabled={off} />
                  <RibbonButton label={`Shrink font (${MOD}Shift+<)`} icon={AArrowDown} onClick={run((c) => c.stepFontSize(-1))} disabled={off} />
                  <Dropdown label="Change case" icon={CaseSensitive} disabled={off}>
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
                  <RibbonButton label={`Clear formatting (${MOD}Space)`} icon={RemoveFormatting} onClick={run((c) => c.clearFormatting())} disabled={off} />
                </div>
                <div className="rb-row">
                  <RibbonButton label={`Bold (${MOD}B)`} icon={Bold} active={inline.bold} onClick={run((c) => c.inline("bold"))} disabled={off} />
                  <RibbonButton label={`Italic (${MOD}I)`} icon={Italic} active={inline.italic} onClick={run((c) => c.inline("italic"))} disabled={off} />
                  <RibbonButton label={`Underline (${MOD}U)`} icon={Underline} active={inline.underline} onClick={run((c) => c.inline("underline"))} disabled={off} />
                  <RibbonButton label={`Strikethrough (${MOD}Shift+X)`} icon={Strikethrough} active={inline.strike} onClick={run((c) => c.inline("strikeThrough"))} disabled={off} />
                  <RibbonButton label={`Subscript (${MOD}=)`} icon={Subscript} active={inline.subscript} onClick={run((c) => c.inline("subscript"))} disabled={off} />
                  <RibbonButton label={`Superscript (${MOD}Shift+=)`} icon={Superscript} active={inline.superscript} onClick={run((c) => c.inline("superscript"))} disabled={off} />
                  <span className="rb-sep" aria-hidden />
                  <ColorMenu label="Text colour" noneLabel="Automatic" glyph={<span className="rb-letter-a">A</span>} initial="#c2410c" disabled={off} onPick={(color) => void run((c) => c.setTextColor(color))()} />
                  <ColorMenu label="Highlight" noneLabel="No highlight" icon={Highlighter} initial="#fef08a" disabled={off} onPick={(color) => void run((c) => c.setHighlight(color))()} />
                </div>
              </RibbonStack>
            </RibbonGroup>

            <RibbonGroup label="Paragraph">
              <RibbonStack>
                <div className="rb-row">
                  <RibbonButton label={`Bulleted list (${MOD}Shift+L)`} icon={List} active={block.type === "list"} onClick={run((c) => c.toggleList("unordered"))} disabled={off} />
                  <SplitGroup>
                    <RibbonButton label="Numbered list" icon={ListOrdered} onClick={run((c) => c.toggleList("ordered"))} disabled={off} />
                    <Dropdown label="Numbering format" caretOnly disabled={off}>
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
                              void promptDialog({
                                title: "Set numbering value",
                                label: "Start numbering at",
                                defaultValue: "1",
                                inputType: "number",
                                confirmLabel: "Set value",
                                validate: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? null : "Enter a whole number, 1 or more."),
                              }).then((raw) => {
                                if (raw !== null) void run((c) => c.setListStart(Number(raw)))();
                              });
                            }}
                          >
                            Set numbering value…
                          </MenuItem>
                        </>
                      )}
                    </Dropdown>
                  </SplitGroup>
                  <RibbonButton label="Checklist" icon={ListChecks} onClick={run((c) => c.toggleList("checklist"))} disabled={off} />
                  <span className="rb-sep" aria-hidden />
                  <RibbonButton label="Decrease indent" icon={IndentDecrease} onClick={run((c) => c.changeIndent(-1))} disabled={off || block.indent === 0} />
                  <RibbonButton label="Increase indent" icon={IndentIncrease} onClick={run((c) => c.changeIndent(1))} disabled={off} />
                </div>
                <div className="rb-row">
                  {ALIGN.map((a) => (
                    <RibbonButton key={a.value} label={`${a.label} (${MOD}${a.key})`} icon={a.icon} active={block.alignment === a.value} onClick={run((c) => c.setAlignment(a.value))} disabled={off} />
                  ))}
                  <span className="rb-sep" aria-hidden />
                  <Dropdown label="Line and paragraph spacing" icon={UnfoldVertical} disabled={off}>
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
              </RibbonStack>
            </RibbonGroup>

            <RibbonGroup
              label="Styles"
              launcher={{ label: "Modify styles…", onClick: props.onOpenStyles, disabled: off }}
            >
              <StyleGallery
                styles={props.styles}
                value={block.styleId as StyleId}
                disabled={off}
                onApply={(id) => void run((c) => c.applyStyle(id))()}
                onModify={props.onOpenStyles}
              />
            </RibbonGroup>

            <RibbonGroup label="Editing">
              <RibbonStack>
                <RibbonButton label={`Find (${MOD}F)`} icon={Search} text="Find" onClick={() => props.onOpenFind("find")} disabled={off} />
                <RibbonButton label={`Replace (${MOD}H)`} icon={Replace} text="Replace" onClick={() => props.onOpenFind("replace")} disabled={off} />
              </RibbonStack>
            </RibbonGroup>
          </>
        )}

        {tab === "insert" && (
          <>
            <RibbonGroup label="Tables & media">
              <RibbonButton label="Table" icon={Table} text="Table" large onClick={run((c) => c.insertBlock("table"))} disabled={off} />
              <RibbonButton label="Image" icon={ImageIcon} text="Image" large onClick={run((c) => c.insertBlock("image"))} disabled={off} />
              <RibbonButton label="Chart" icon={ChartColumn} text="Chart" large onClick={run((c) => c.insertBlock("chart"))} disabled={off} />
            </RibbonGroup>
            <RibbonGroup label="Text & symbols">
              <RibbonButton label="Text box" icon={TextCursorInput} text="Text box" large onClick={run((c) => c.insertBlock("textBox"))} disabled={off} />
              <RibbonButton label="Equation" icon={Sigma} text="Equation" large onClick={run((c) => c.insertBlock("equation"))} disabled={off} />
              <RibbonButton label="Columns" icon={Columns2} text="Columns" large onClick={run((c) => c.insertBlock("column"))} disabled={off} />
            </RibbonGroup>
            <RibbonGroup label="Links">
              <RibbonButton label={`Link (${MOD}K)`} icon={LinkIcon} text="Link" large active={inline.link !== null} onClick={props.onOpenLink} disabled={off} />
            </RibbonGroup>
            <RibbonGroup label="Pages">
              <RibbonButton label={`Page break (${MOD}Enter)`} icon={SquareSplitVertical} text="Page break" large onClick={run((c) => c.insertPageBreak())} disabled={off} />
              <RibbonButton label="Horizontal line" icon={Minus} text="Horizontal line" large onClick={run((c) => c.insertBlock("horizontalLine"))} disabled={off} />
            </RibbonGroup>
            <RibbonGroup label="Header & footer">
              <RibbonButton label="Header" icon={PanelTop} text="Header" large onClick={() => props.onEditHeaderFooter("header")} disabled={off} />
              <RibbonButton label="Footer" icon={PanelBottom} text="Footer" large onClick={() => props.onEditHeaderFooter("footer")} disabled={off} />
              <RibbonButton
                label="Page number"
                icon={Hash}
                text="Page number"
                large
                onClick={() => {
                  props.onEditHeaderFooter("footer");
                  window.setTimeout(() => props.onInsertField("page"), 250);
                }}
                disabled={off}
              />
            </RibbonGroup>
          </>
        )}

        {tab === "references" && (
          <>
            <RibbonGroup label="Table of contents">
              <Dropdown label="Table of contents" icon={TableOfContents} text="Table of contents" large disabled={off}>
                {(close) => (
                  <>
                    {[1, 2, 3, 4].map((n) => (
                      <MenuItem key={n} onSelect={() => { close(); void run((c) => c.insertTableOfContents(n))(); }}>
                        Headings 1–{n}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Dropdown>
            </RibbonGroup>
            <RibbonGroup label="Footnotes">
              <RibbonButton label="Insert footnote" icon={Superscript} text="Insert footnote" large onClick={props.onInsertFootnote} disabled={off} />
            </RibbonGroup>
          </>
        )}

        {tab === "headerFooter" && (
          <>
            <RibbonGroup label="Options">
              <RibbonStack>
                <label className="tp-check rb-check">
                  <input
                    type="checkbox"
                    checked={props.pageSetup.differentFirstPage}
                    onChange={(e) => props.onPageSetupChange({ differentFirstPage: e.target.checked })}
                  />
                  Different first page
                </label>
                <label className="tp-check rb-check">
                  <input
                    type="checkbox"
                    checked={props.pageSetup.differentOddEven}
                    onChange={(e) => props.onPageSetupChange({ differentOddEven: e.target.checked })}
                  />
                  Different odd & even pages
                </label>
              </RibbonStack>
            </RibbonGroup>
            <RibbonGroup label="Insert">
              <RibbonButton label="Page number" icon={Hash} text="Page number" large onClick={() => props.onInsertField("page")} />
              <RibbonButton label="Page count" icon={Files} text="Page count" large onClick={() => props.onInsertField("pages")} />
              <RibbonButton label="Date" icon={CalendarDays} text="Date" large onClick={() => props.onInsertField("date")} />
              <RibbonButton label="Document title" icon={Heading} text="Document title" large onClick={() => props.onInsertField("title")} />
            </RibbonGroup>
            <RibbonGroup label="Position">
              <RibbonStack>
                <label className="rb-field">
                  <ArrowUpToLine size={ICON_SM} strokeWidth={1.75} aria-hidden className="rb-icon" />
                  <span className="rb-field-label">Header from top (in)</span>
                  <input
                    className="rb-select rb-select-narrow"
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    value={+(props.pageSetup.headerDistance / 96).toFixed(2)}
                    onChange={(e) => props.onPageSetupChange({ headerDistance: Math.round(Number(e.target.value) * 96) })}
                  />
                </label>
                <label className="rb-field">
                  <ArrowDownToLine size={ICON_SM} strokeWidth={1.75} aria-hidden className="rb-icon" />
                  <span className="rb-field-label">Footer from bottom (in)</span>
                  <input
                    className="rb-select rb-select-narrow"
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    value={+(props.pageSetup.footerDistance / 96).toFixed(2)}
                    onChange={(e) => props.onPageSetupChange({ footerDistance: Math.round(Number(e.target.value) * 96) })}
                  />
                </label>
              </RibbonStack>
            </RibbonGroup>
            <RibbonGroup label="Close">
              <RibbonButton label="Close header and footer (Esc)" icon={X} text="Close" large onClick={props.onCloseHeaderFooter} />
            </RibbonGroup>
          </>
        )}

        {tab === "layout" && (
          <>
            <RibbonGroup label={props.sectionLayout ? "Page setup · this section" : "Page setup"}>
              <RibbonStack>
                <label className="rb-field" title="Paper size">
                  <FileText size={ICON_SM} strokeWidth={1.75} aria-hidden className="rb-icon" />
                  <span className="rb-field-label">Size</span>
                  <select className="rb-select rb-select-layout" value={layout.paperSize} onChange={(e) => props.onLayoutChange({ paperSize: e.target.value as PaperSize })}>
                    {PAPER.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="rb-field" title="Orientation">
                  <RectangleVertical size={ICON_SM} strokeWidth={1.75} aria-hidden className="rb-icon" style={layout.orientation === "landscape" ? { transform: "rotate(90deg)" } : undefined} />
                  <span className="rb-field-label">Orientation</span>
                  <select
                    className="rb-select rb-select-layout"
                    value={layout.orientation}
                    onChange={(e) => props.onLayoutChange({ orientation: e.target.value as PageLayout["orientation"] })}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </RibbonStack>
              <RibbonStack>
                <label className="rb-field" title="Margins">
                  <Frame size={ICON_SM} strokeWidth={1.75} aria-hidden className="rb-icon" />
                  <span className="rb-field-label">Margins</span>
                  <select
                    className="rb-select rb-select-margins"
                    value={MARGINS.find((m) => [layout.marginTop, layout.marginRight, layout.marginBottom, layout.marginLeft].every((v) => v === m.px))?.label ?? "Custom"}
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
                <RibbonButton label="More page setup…" icon={Settings2} text="More page setup…" onClick={props.onOpenPageSetup} />
              </RibbonStack>
            </RibbonGroup>
            <RibbonGroup label={props.sectionLayout ? "Breaks · this section" : "Breaks"}>
              <Dropdown label="Breaks" icon={SquareSplitVertical} text="Breaks" large disabled={off}>
                {(close) => (
                  <>
                    <MenuItem onSelect={() => { close(); void run((c) => c.insertPageBreak())(); }}>Page break</MenuItem>
                    <div className="rb-menu-sep" />
                    <MenuItem onSelect={() => { close(); void run((c) => c.insertSectionBreak({ ...layout }))(); }}>Section break (next page)</MenuItem>
                    <MenuItem
                      onSelect={() => {
                        close();
                        void run((c) => c.insertSectionBreak({ ...layout, orientation: layout.orientation === "landscape" ? "portrait" : "landscape" }))();
                      }}
                    >
                      Section break → {layout.orientation === "landscape" ? "portrait" : "landscape"} pages
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </RibbonGroup>
            <RibbonGroup label="Page background">
              <Dropdown label="Watermark" icon={Stamp} text="Watermark" large disabled={off}>
                {(close) => (
                  <>
                    <MenuItem checked={!props.pageSetup.watermark} onSelect={() => { close(); props.onPageSetupChange({ watermark: null }); }}>None</MenuItem>
                    {WATERMARKS.map((w) => (
                      <MenuItem
                        key={w}
                        checked={props.pageSetup.watermark?.text === w}
                        onSelect={() => { close(); props.onPageSetupChange({ watermark: { text: w, color: "#94a3b8", opacity: 0.3 } }); }}
                      >
                        {w}
                      </MenuItem>
                    ))}
                    <MenuItem
                      onSelect={() => {
                        close();
                        void promptDialog({
                          title: "Custom watermark",
                          message: "Shown faintly behind the text on every page.",
                          label: "Watermark text",
                          defaultValue: props.pageSetup.watermark?.text ?? "",
                          placeholder: "e.g. INTERNAL",
                          confirmLabel: "Add watermark",
                          validate: (v) => (!v.trim() ? "Enter some text." : v.trim().length > 60 ? "Keep it under 60 characters." : null),
                        }).then((text) => {
                          if (text?.trim()) props.onPageSetupChange({ watermark: { text: text.trim(), color: "#94a3b8", opacity: 0.3 } });
                        });
                      }}
                    >
                      Custom…
                    </MenuItem>
                  </>
                )}
              </Dropdown>
              <ColorMenu
                label="Page colour"
                text="Page colour"
                large
                noneLabel="No colour"
                icon={PaintBucket}
                initial={props.pageSetup.pageColor ?? "#fdf6e3"}
                disabled={off}
                onPick={(color) => props.onPageSetupChange({ pageColor: color })}
              />
              <Dropdown label="Page borders" icon={SquareDashed} text="Page borders" large disabled={off}>
                {(close) => (
                  <>
                    {BORDERS.map((b) => (
                      <MenuItem
                        key={b.label}
                        checked={JSON.stringify(props.pageSetup.pageBorder) === JSON.stringify(b.value)}
                        onSelect={() => { close(); props.onPageSetupChange({ pageBorder: b.value }); }}
                      >
                        {b.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Dropdown>
            </RibbonGroup>
          </>
        )}

        {tab === "view" && (
          <>
            <RibbonGroup label="Zoom">
              <RibbonStack>
                <div className="rb-row">
                  <RibbonButton label="Zoom out" icon={ZoomOut} onClick={() => props.onZoomChange(prevStop(props.zoom, -1))} />
                  <select className="rb-select rb-select-narrow" aria-label="Zoom" title="Zoom" value={props.zoom} onChange={(e) => props.onZoomChange(Number(e.target.value))}>
                    {ZOOM_STOPS.map((z) => (
                      <option key={z} value={z}>{Math.round(z * 100)}%</option>
                    ))}
                  </select>
                  <RibbonButton label="Zoom in" icon={ZoomIn} onClick={() => props.onZoomChange(prevStop(props.zoom, 1))} />
                </div>
              </RibbonStack>
              <RibbonButton label="100%" icon={Scan} text="100%" large onClick={() => props.onZoomChange(1)} />
            </RibbonGroup>
            <RibbonGroup label="Show">
              <RibbonButton label="Status bar (word count)" icon={PanelBottom} text="Status bar" large active={props.showStatusBar} onClick={props.onToggleStatusBar} />
            </RibbonGroup>
          </>
        )}
      </RibbonPanel>
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
        title="Font size"
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
