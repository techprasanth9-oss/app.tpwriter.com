import { useMemo } from "react";
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import { DEFAULT_LAYOUT, pageSize } from "~/lib/editor/pagination/paper";
import { renderBlocksHtml } from "~/lib/editor/render/staticHtml";
import { resolveStyles, stylesToCss } from "~/lib/editor/styles/namedStyles";
import type { BlockDiff, WordOp } from "~/lib/editor/history/diffVersions";

export const PAPER_SCOPE = ".tp-history-paper";

export interface PaperProps {
  layout?: PageLayout | null;
  styles?: Record<string, unknown> | null;
  label: string;
  children: React.ReactNode;
}

/** A paper-like column sized to the document's page width and margins. */
export function HistoryPaper({ layout, styles, label, children }: PaperProps) {
  const l = layout ?? DEFAULT_LAYOUT;
  const { width } = pageSize(l);
  const css = useMemo(() => stylesToCss(resolveStyles(styles ?? {}), PAPER_SCOPE), [styles]);
  return (
    <>
      <style>{css}</style>
      <article
        className="tp-history-paper"
        aria-label={label}
        style={{
          width,
          paddingTop: Math.min(l.marginTop, 96),
          paddingBottom: Math.min(l.marginBottom, 96),
          paddingLeft: l.marginLeft,
          paddingRight: l.marginRight,
        }}
      >
        {children}
      </article>
    </>
  );
}

/** Read-only rendering of a version's blocks. */
export function VersionBlocks({ blocks }: { blocks: readonly EditorBlock[] }) {
  const html = useMemo(() => renderBlocksHtml(blocks), [blocks]);
  if (!blocks.length) return <p className="tp-history-blank">This version is empty.</p>;
  // renderBlocksHtml sanitizes every stored string (see staticHtml.ts).
  return <div className="tp-history-blocks" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Html({ block, className }: { block: EditorBlock; className?: string }) {
  const html = useMemo(() => renderBlocksHtml([block]), [block]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />;
}

function Words({ ops }: { ops: WordOp[] }) {
  return (
    <>
      {ops.map((o, i) =>
        o.op === "equal" ? (
          <span key={i}>{o.text}</span>
        ) : o.op === "insert" ? (
          <ins key={i} className="tp-diff-ins">
            {o.text}
          </ins>
        ) : (
          <del key={i} className="tp-diff-del">
            {o.text}
          </del>
        ),
      )}
    </>
  );
}

function ChangedText({ after, ops }: { after: EditorBlock; ops: WordOp[] }) {
  if (after.type === "header") {
    const n = Number((after.data as { level?: unknown }).level);
    const level = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 2;
    const Tag = `h${level}` as "h2";
    return (
      <Tag className="ce-header" data-level={level}>
        <Words ops={ops} />
      </Tag>
    );
  }
  return (
    <div className="ce-paragraph tp-diff-text">
      <Words ops={ops} />
    </div>
  );
}

export interface VersionDiffProps {
  diff: readonly BlockDiff[];
  /** Hide unchanged blocks. */
  changesOnly?: boolean;
}

/** Block diff: added green, removed red struck through, changed with an
 *  inline word diff. */
export function VersionDiff({ diff, changesOnly }: VersionDiffProps) {
  const items = changesOnly ? diff.filter((d) => d.kind !== "same") : diff;
  if (!items.length) {
    return <p className="tp-history-blank">{changesOnly ? "No differences." : "Both versions are empty."}</p>;
  }
  return (
    <div className="tp-diff">
      {items.map((d, i) => {
        switch (d.kind) {
          case "same":
            return <Html key={`s${i}`} block={d.block} className="tp-diff-block" />;
          case "added":
            return (
              <div key={`a${i}`} className="tp-diff-block tp-diff-added">
                <span className="tp-sr-only">Added: </span>
                <Html block={d.block} />
              </div>
            );
          case "removed":
            return (
              <div key={`r${i}`} className="tp-diff-block tp-diff-removed">
                <span className="tp-sr-only">Removed: </span>
                <Html block={d.block} />
              </div>
            );
          case "changed":
            if (d.formatOnly) {
              return (
                <div key={`c${i}`} className="tp-diff-block tp-diff-changed tp-diff-format">
                  <span className="tp-diff-tag">Formatting changed</span>
                  <Html block={d.after} />
                </div>
              );
            }
            if (d.words) {
              return (
                <div key={`c${i}`} className="tp-diff-block tp-diff-changed">
                  <span className="tp-sr-only">Changed: </span>
                  <ChangedText after={d.after} ops={d.words} />
                </div>
              );
            }
            return (
              <div key={`c${i}`} className="tp-diff-block tp-diff-changed">
                <div className="tp-diff-removed">
                  <span className="tp-sr-only">Before: </span>
                  <Html block={d.before} />
                </div>
                <div className="tp-diff-added">
                  <span className="tp-sr-only">After: </span>
                  <Html block={d.after} />
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}
