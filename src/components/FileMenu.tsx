import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileDown,
  FileText,
  FileUp,
  History,
  Printer,
  Save,
  Settings2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export interface FileMenuProps {
  /** Editors only. */
  onSave?: () => void;
  onImport?: () => void;
  onExportDocx: () => void;
  onPrint: () => void;
  onDownloadPdf?: () => void;
  /** false when the server can't render PDFs — the item is hidden. */
  pdfAvailable?: boolean | null;
  pdfBusy?: boolean;
  onPageSetup?: () => void;
  onVersionHistory?: () => void;
  onShare?: () => void;
  busy?: boolean;
}

interface Item {
  key: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * Word-style "File" menu: everything about the document as a file —
 * saving, importing, downloading, printing, page setup and history —
 * kept out of the header so it stays calm.
 */
export function FileMenu(props: FileMenuProps) {
  const [open, setOpen] = useState(false);
  /** Fixed-position anchor: the ribbon's tab row clips overflow. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections: Item[][] = [
    [
      ...(props.onSave ? [{ key: "save", label: "Save now", icon: Save, shortcut: `${MOD}S`, run: props.onSave }] : []),
      ...(props.onShare ? [{ key: "share", label: "Share…", icon: UserPlus, run: props.onShare }] : []),
    ],
    [
      ...(props.onImport
        ? [{ key: "import", label: "Import Word document…", icon: FileUp, hint: ".docx", disabled: props.busy, run: props.onImport }]
        : []),
      { key: "docx", label: "Download as Word", icon: FileText, hint: ".docx", disabled: props.busy, run: props.onExportDocx },
      ...(props.onDownloadPdf && props.pdfAvailable !== false
        ? [
            {
              key: "pdf",
              label: props.pdfBusy ? "Creating PDF…" : "Download as PDF",
              icon: FileDown,
              hint: ".pdf",
              disabled: props.pdfBusy,
              run: props.onDownloadPdf,
            },
          ]
        : []),
      { key: "print", label: "Print…", icon: Printer, shortcut: `${MOD}P`, run: props.onPrint },
    ],
    [
      ...(props.onPageSetup ? [{ key: "setup", label: "Page setup…", icon: Settings2, run: props.onPageSetup }] : []),
      ...(props.onVersionHistory
        ? [{ key: "history", label: "Version history", icon: History, run: props.onVersionHistory }]
        : []),
    ],
  ].filter((s) => s.length > 0);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.left) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focus(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focus(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focus(0); }
    else if (e.key === "End") { e.preventDefault(); focus(items.length - 1); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <div className="fm" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`rb-file${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
        }}
      >
        File
      </button>
      {open && (
        <div
          className="fm-list"
          role="menu"
          aria-label="File"
          ref={listRef}
          onKeyDown={onKeyDown}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
        >
          {sections.map((section, i) => (
            <MenuSection key={i} first={i === 0}>
              {section.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="fm-item"
                  disabled={item.disabled}
                  onClick={() => {
                    close(false);
                    item.run();
                  }}
                >
                  <item.icon size={16} strokeWidth={1.75} aria-hidden className="fm-icon" />
                  <span className="fm-label">{item.label}</span>
                  {item.shortcut && <kbd className="fm-kbd">{item.shortcut}</kbd>}
                  {item.hint && !item.shortcut && <span className="fm-hint">{item.hint}</span>}
                </button>
              ))}
            </MenuSection>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuSection({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {!first && <div className="fm-sep" role="separator" />}
      {children}
    </>
  );
}
