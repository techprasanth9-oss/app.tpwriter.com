import EditorJS from "@editorjs/editorjs";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { EditorBlock } from "~/lib/api/documents";
import { configureBaseTools } from "~/lib/editor/tools";
import { normalizeBlocks } from "~/lib/editor/normalize";
import { fieldHtml, type FieldKind } from "~/lib/editor/pageSetup";
import { sanitizeEditorData } from "~/lib/editor/sanitizeData";

export interface HeaderFooterEditorHandle {
  /** Insert a field (page number, page count, date, title) at the caret. */
  insertField: (kind: FieldKind) => void;
}

interface Props {
  blocks: EditorBlock[];
  onChange: (blocks: EditorBlock[]) => void;
  onImageUpload: (file: File) => Promise<{ url: string }>;
  /** Placeholder text shown in an empty header/footer. */
  placeholder: string;
}

/** Tools that make no sense in a header or footer. */
const EXCLUDED_TOOLS = ["pageBreak", "sectionBreak", "toc", "column"];

const FIELD_PLACEHOLDER: Record<FieldKind, string> = {
  page: "#",
  pages: "##",
  date: "date",
  title: "title",
};

/**
 * Editor for one header or footer, opened in place on the page (Word's
 * double-click into the header). A separate small EditorJS instance; its
 * content is saved into the document's page setup, not the body.
 */
export const HeaderFooterEditor = forwardRef<HeaderFooterEditorHandle, Props>(function HeaderFooterEditor(
  { blocks, onChange, onImageUpload, placeholder },
  ref,
) {
  const holderRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorJS | null>(null);
  const propsRef = useRef({ onChange, onImageUpload });
  propsRef.current = { onChange, onImageUpload };
  const initialRef = useRef(blocks);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    const mount = document.createElement("div");
    holder.appendChild(mount);
    const tools = configureBaseTools({
      imageUploader: (file: File) => propsRef.current.onImageUpload(file),
    }) as Record<string, unknown>;
    for (const name of EXCLUDED_TOOLS) delete tools[name];

    const editor = new EditorJS({
      holder: mount,
      minHeight: 0,
      autofocus: true,
      placeholder,
      tools: tools as never,
      data: { time: Date.now(), blocks: sanitizeEditorData(normalizeBlocks(initialRef.current)) },
      onReady: () => {
        if (!cancelled) editorRef.current = editor;
      },
      onChange: async () => {
        if (cancelled) return;
        const out = await editor.save();
        propsRef.current.onChange(out.blocks as EditorBlock[]);
      },
    });
    return () => {
      cancelled = true;
      editorRef.current = null;
      mount.style.display = "none";
      // Closing (Esc / clicking the body) can beat EditorJS's debounced
      // onChange — save the final content before tearing down.
      editor.isReady
        .then(async () => {
          const out = await editor.save();
          propsRef.current.onChange(out.blocks as EditorBlock[]);
          editor.destroy();
        })
        .catch(() => undefined)
        .finally(() => mount.remove());
    };
    // Mount once per open; content changes flow out through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      insertField(kind: FieldKind) {
        const holder = holderRef.current;
        const sel = document.getSelection();
        if (!holder || !sel) return;
        let range: Range;
        if (sel.rangeCount > 0 && holder.contains(sel.anchorNode)) {
          range = sel.getRangeAt(0);
        } else {
          // Caret not in the header: append to its first paragraph.
          const editable = holder.querySelector<HTMLElement>('[contenteditable="true"]');
          if (!editable) return;
          range = document.createRange();
          range.selectNodeContents(editable);
          range.collapse(false);
        }
        const tpl = document.createElement("template");
        tpl.innerHTML = fieldHtml(kind, FIELD_PLACEHOLDER[kind]);
        const field = tpl.content.firstElementChild!;
        range.deleteContents();
        range.insertNode(field);
        // Caret after the field, with a space so typing continues outside it.
        const space = document.createTextNode(" ");
        field.after(space);
        range.setStart(space, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      },
    }),
    [],
  );

  return <div ref={holderRef} className="page-canvas tp-hf-editor" />;
});
