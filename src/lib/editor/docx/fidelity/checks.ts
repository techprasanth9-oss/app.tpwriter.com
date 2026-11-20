/** Evaluate declarative fidelity checks against an imported document. */
import type { EditorBlock } from "~/lib/api/documents";
import type { ImportedDocument } from "../import/types";
import {
  blockText,
  fieldKinds,
  flattenItems,
  fmtNum,
  footnoteHtmls,
  footnoteRefIds,
  formatOf,
  formatSignature,
  formattedChars,
  headerFooterBlocks,
  htmlText,
  imageAlt,
  imageSize,
  imageWrap,
  inRange,
  listDepth,
  listItems,
  listMeta,
  matches,
  normColor,
  scopeHtmls,
  scopeRaw,
  scopeTexts,
  sectionLayouts,
  showPattern,
  tableInfo,
  type CharFormat,
} from "./inspect";
import type { Check, CheckResult, FormatExpect, Num, Scope, TextPattern } from "./types";

type Verdict = { ok: boolean; detail?: string };
const pass: Verdict = { ok: true };
const fail = (detail: string): Verdict => ({ ok: false, detail });

const short = (s: string, n = 60) => {
  const one = s.replace(/\n/g, "⏎");
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Human label for a check (report rows). */
export function labelOf(c: Check): string {
  switch (c.kind) {
    case "blockCount":
      return `${c.type} blocks = ${fmtNum(c.count)}`;
    case "sequence":
      return `sequence ${c.steps.map((s) => s.type + (s.text ? `(${showPattern(s.text)})` : "")).join(" → ")}`;
    case "text":
      return `text ${showPattern(c.text)}${c.count !== undefined ? ` ×${fmtNum(c.count)}` : ""}${c.scope ? ` in ${c.scope}` : ""}`;
    case "absent":
      return `absent ${showPattern(c.pattern)}${c.scope ? ` in ${c.scope}` : ""}`;
    case "format": {
      const { kind, text, prefix, scope, soft, note, ...f } = c;
      void kind, void prefix, void scope, void soft, void note;
      return `format "${text}" ${JSON.stringify(f, (_, v) => (v instanceof RegExp ? String(v) : v))}`;
    }
    case "heading":
      return `heading ${showPattern(c.text)} level ${fmtNum(c.level)}`;
    case "paragraph": {
      const { kind, text, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `paragraph ${showPattern(text)} ${JSON.stringify(f)}`;
    }
    case "blockBefore":
      return `${c.type} before ${showPattern(c.text)}`;
    case "emptyParagraphs":
      return `empty paragraphs = ${fmtNum(c.count)}`;
    case "list": {
      const { kind, firstItem, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `list ${showPattern(firstItem)} ${JSON.stringify(f)}`;
    }
    case "table": {
      const { kind, contains, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `table ${showPattern(contains)} ${JSON.stringify(f)}`;
    }
    case "image": {
      const { kind, alt, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `image ${showPattern(alt)} ${JSON.stringify(f)}`;
    }
    case "sectionCount":
      return `sections = ${fmtNum(c.count)}`;
    case "layout": {
      const { kind, section, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `section ${section} layout ${JSON.stringify(f)}`;
    }
    case "headerFooter":
      return `${c.part}.${c.variant}${c.contains ? ` ∋ ${showPattern(c.contains)}` : ""}${c.fields ? ` fields ${c.fields.join("+")}` : ""}${c.hasImage ? " +image" : ""}`;
    case "pageSetup": {
      const { kind, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `pageSetup ${JSON.stringify(f, (_, v) => (v instanceof RegExp ? String(v) : v))}`;
    }
    case "footnotes":
      return `footnotes${c.count !== undefined ? ` = ${fmtNum(c.count)}` : ""}${c.refs !== undefined ? `, refs = ${fmtNum(c.refs)}` : ""}${c.contains ? ` ∋ ${c.contains.map(showPattern).join(", ")}` : ""}`;
    case "toc":
      return `toc${c.count !== undefined ? ` ×${fmtNum(c.count)}` : ""}${c.maxLevel !== undefined ? ` maxLevel ${c.maxLevel}` : ""}`;
    case "equation":
      return `equation${c.display !== undefined ? (c.display ? " (display)" : " (inline)") : ""} ∋ ${c.latexContains.join(" ")}`;
    case "textBox":
      return `textBox ∋ ${showPattern(c.contains)}`;
    case "style": {
      const { kind, id, soft, note, ...f } = c;
      void kind, void soft, void note;
      return `style ${id} ${JSON.stringify(f, (_, v) => (v instanceof RegExp ? String(v) : v))}`;
    }
    case "title":
      return `title ${showPattern(c.text)}`;
    case "warning":
      return `warning ${String(c.pattern)}`;
  }
}

const findBlock = (doc: ImportedDocument, text: TextPattern, type?: string) =>
  doc.blocks.find((b) => (!type || b.type === type) && matches(blockText(b), text));

function formatMismatch(f: CharFormat, e: FormatExpect): string | null {
  const bad: string[] = [];
  const flag = (k: "bold" | "italic" | "underline" | "strike" | "sup" | "sub") => {
    if (e[k] !== undefined && f[k] !== e[k]) bad.push(`${k}=${f[k]}`);
  };
  (["bold", "italic", "underline", "strike", "sup", "sub"] as const).forEach(flag);
  if (e.color !== undefined && f.color !== normColor(e.color)) bad.push(`color=${f.color ?? "none"}`);
  if (e.background !== undefined && f.background !== normColor(e.background)) bad.push(`background=${f.background ?? "none"}`);
  if (e.fontFamily !== undefined && !(f.fontFamily && matches(f.fontFamily, e.fontFamily))) bad.push(`font=${f.fontFamily ?? "none"}`);
  if (e.fontSizePx !== undefined && !inRange(f.fontSizePx, e.fontSizePx, 0.5)) bad.push(`size=${f.fontSizePx?.toFixed(2) ?? "none"}px`);
  if (e.href !== undefined) {
    if (e.href === null) {
      if (f.href !== undefined && f.href !== "") bad.push(`href=${f.href}`);
    } else if (!(f.href && matches(f.href, e.href))) bad.push(`href=${f.href ?? "none"}`);
  }
  return bad.length ? bad.join(" ") : null;
}

function checkFormat(doc: ImportedDocument, c: Extract<Check, { kind: "format" }>): Verdict {
  const needle = (c.prefix ?? "") + c.text;
  let firstProblem: string | null = null;
  for (const html of scopeHtmls(doc, c.scope ?? "all")) {
    const { text, formats } = formattedChars(html);
    let at = text.indexOf(needle);
    while (at >= 0) {
      const start = at + (c.prefix?.length ?? 0);
      let problem: string | null = null;
      for (let i = start; i < start + c.text.length; i++) {
        if (/\s/.test(text[i]!)) continue;
        problem = formatMismatch(formats[i]!, c);
        if (problem) {
          problem = `"${text.slice(start, start + c.text.length)}" has ${problem} [${formatSignature(formats[i]!) || "plain"}]`;
          break;
        }
      }
      if (!problem) return pass;
      firstProblem ??= problem;
      at = text.indexOf(needle, at + 1);
    }
  }
  return fail(firstProblem ?? `text "${needle}" not found`);
}

function count(n: number, expected: Num, what: string): Verdict {
  return inRange(n, expected, 0) ? pass : fail(`${what}: got ${n}, expected ${fmtNum(expected)}`);
}

function evaluate(doc: ImportedDocument, c: Check): Verdict {
  switch (c.kind) {
    case "blockCount":
      return count(doc.blocks.filter((b) => b.type === c.type).length, c.count, c.type);

    case "sequence": {
      const blocks = doc.blocks;
      const stepOk = (b: EditorBlock, s: { type: string; text?: string | RegExp }) =>
        b.type === s.type && (s.text === undefined || matches(blockText(b), s.text));
      for (let start = 0; start < blocks.length; start++) {
        if (!stepOk(blocks[start]!, c.steps[0]!)) continue;
        let i = start + 1;
        let k = 1;
        for (; k < c.steps.length && i < blocks.length; i++) {
          if (stepOk(blocks[i]!, c.steps[k]!)) k++;
          else if (c.adjacent) break;
        }
        if (k === c.steps.length) return pass;
      }
      const types = blocks.map((b) => b.type).join(",");
      return fail(`not found; block types: ${short(types, 160)}`);
    }

    case "text": {
      const units = scopeTexts(doc, c.scope ?? "all");
      const n = units.filter((t) => matches(t, c.text)).length;
      return c.count === undefined ? (n > 0 ? pass : fail("not found")) : count(n, c.count, "occurrences");
    }

    case "absent": {
      const hay = c.raw ? scopeRaw(doc, c.scope ?? "all") : scopeTexts(doc, c.scope ?? "all").join("\n");
      return matches(hay, c.pattern) ? fail("present") : pass;
    }

    case "format":
      return checkFormat(doc, c);

    case "heading": {
      const hs = doc.blocks.filter((b) => b.type === "header" && matches(blockText(b), c.text));
      if (hs.length === 0) {
        const other = doc.blocks.find((b) => matches(blockText(b), c.text));
        return fail(other ? `found as ${other.type} ${JSON.stringify(formatOf(other))}` : "not found");
      }
      const levels = hs.map((b) => Number(b.data?.level));
      return levels.some((l) => inRange(l, c.level, 0)) ? pass : fail(`level ${levels.join("/")}`);
    }

    case "paragraph": {
      const b = findBlock(doc, c.text, c.type);
      if (!b) return fail("block not found");
      const f = formatOf(b);
      const bad: string[] = [];
      if (c.alignment !== undefined && (f.alignment ?? "left") !== c.alignment) bad.push(`alignment=${String(f.alignment)}`);
      if (c.styleId !== undefined && f.styleId !== c.styleId) bad.push(`styleId=${String(f.styleId)}`);
      const num = (k: "indent" | "lineHeight" | "spaceBefore" | "spaceAfter", eps: number) => {
        const exp = c[k];
        if (exp !== undefined && !inRange(f[k] as number, exp, eps)) bad.push(`${k}=${String(f[k])}`);
      };
      num("indent", 0);
      num("lineHeight", 0.05);
      num("spaceBefore", 1);
      num("spaceAfter", 1);
      return bad.length ? fail(`${b.type}: ${bad.join(" ")}`) : pass;
    }

    case "blockBefore": {
      const idx = doc.blocks.findIndex((b) => matches(blockText(b), c.text));
      if (idx < 0) return fail("block not found");
      let j = idx - 1;
      while (c.skipEmpty && j >= 0 && doc.blocks[j]!.type === "paragraph" && !blockText(doc.blocks[j]!)) j--;
      const prev = doc.blocks[j];
      return prev?.type === c.type ? pass : fail(`previous block is ${prev?.type ?? "none"}`);
    }

    case "emptyParagraphs":
      return count(doc.blocks.filter((b) => b.type === "paragraph" && !blockText(b)).length, c.count, "empty paragraphs");

    case "list": {
      const lists = doc.blocks.filter((b) => b.type === "list");
      const b = lists.find((l) => {
        const first = flattenItems(listItems(l))[0];
        return first && matches(htmlText(first.html), c.firstItem);
      });
      if (!b) {
        const where = doc.blocks.find((x) => matches(blockText(x), c.firstItem));
        return fail(where ? `not the first item of a list (found in ${where.type})` : "not found");
      }
      const meta = listMeta(b);
      const bad: string[] = [];
      if (c.style && meta.style !== c.style) bad.push(`style=${meta.style}`);
      if (c.counterType && (meta.counterType ?? "numeric") !== c.counterType) bad.push(`counterType=${meta.counterType}`);
      if (c.start !== undefined && (meta.start ?? 1) !== c.start) bad.push(`start=${meta.start}`);
      const items = listItems(b);
      if (c.depth !== undefined && !inRange(listDepth(items), c.depth, 0)) bad.push(`depth=${listDepth(items)}`);
      const total = flattenItems(items).length;
      if (c.items !== undefined && !inRange(total, c.items, 0)) bad.push(`items=${total}`);
      return bad.length ? fail(bad.join(" ")) : pass;
    }

    case "table": {
      const tables = doc.blocks.filter((b) => b.type === "table");
      const b = tables.find((t) => tableInfo(t).content.flat().some((h) => matches(htmlText(h), c.contains)));
      if (!b) return fail("table not found");
      const t = tableInfo(b);
      const bad: string[] = [];
      if (c.rows !== undefined && !inRange(t.rows, c.rows, 0)) bad.push(`rows=${t.rows}`);
      if (c.cols !== undefined && !inRange(t.cols, c.cols, 0)) bad.push(`cols=${t.cols}`);
      if (c.colSpan && !t.cells.some((x) => x.colSpan === c.colSpan)) bad.push(`no colSpan ${c.colSpan}`);
      if (c.rowSpan && !t.cells.some((x) => x.rowSpan === c.rowSpan)) bad.push(`no rowSpan ${c.rowSpan}`);
      if (c.headerRows && JSON.stringify(t.headerRows) !== JSON.stringify(c.headerRows)) bad.push(`headerRows=${JSON.stringify(t.headerRows)}`);
      if (c.repeatHeader !== undefined && (t.repeatHeader ?? true) !== c.repeatHeader) bad.push(`repeatHeader=${t.repeatHeader}`);
      if (c.columnWidthRatios) {
        const total = t.widths.reduce((a, w) => a + (Number.isFinite(w) ? w : 0), 0);
        const want = c.columnWidthRatios.reduce((a, w) => a + w, 0);
        const ok =
          t.widths.length === c.columnWidthRatios.length &&
          total > 0 &&
          t.widths.every((w, i) => Math.abs(w / total - c.columnWidthRatios![i]! / want) <= 0.03);
        if (!ok) bad.push(`columnWidths=${JSON.stringify(t.widths)}`);
      }
      if (c.cellBackground && !t.backgrounds.has(normColor(c.cellBackground)!)) bad.push(`backgrounds=${[...t.backgrounds].join("/") || "none"}`);
      if (c.verticalAlign && !t.cells.some((x) => String(x.style.verticalAlign ?? "") === c.verticalAlign))
        bad.push(`no cell with verticalAlign ${c.verticalAlign}`);
      if (c.containsText) {
        const all = t.content.flat().map(htmlText).join("\n");
        const missing = c.containsText.filter((s) => !all.includes(s));
        if (missing.length) bad.push(`missing ${missing.join(", ")}`);
      }
      return bad.length ? fail(bad.join("; ")) : pass;
    }

    case "image": {
      const pool =
        c.scope === "headers"
          ? headerFooterBlocks(doc, "headers")
          : c.scope === "footers"
            ? headerFooterBlocks(doc, "footers")
            : c.scope === "all"
              ? [...doc.blocks, ...headerFooterBlocks(doc, "headers"), ...headerFooterBlocks(doc, "footers")]
              : doc.blocks;
      const images = pool.filter((b) => b.type === "image");
      const b = images.find((i) => matches(imageAlt(i), c.alt));
      if (!b) return fail(`no image with that alt (alts: ${images.map(imageAlt).map((a) => JSON.stringify(a)).join(", ") || "none"})`);
      const bad: string[] = [];
      const wrap = imageWrap(b);
      if (c.wrap && !c.wrap.includes(wrap)) bad.push(`wrap=${wrap}`);
      const size = imageSize(b);
      if (c.widthPx !== undefined && !inRange(size.width, c.widthPx, 2)) bad.push(`width=${size.width}`);
      if (c.heightPx !== undefined && !inRange(size.height, c.heightPx, 2)) bad.push(`height=${size.height}`);
      if (c.crop) {
        const crop = (b.data?.crop ?? {}) as Record<string, number>;
        for (const [side, exp] of Object.entries(c.crop)) {
          if (!inRange(crop[side], exp!, 1)) bad.push(`crop.${side}=${crop[side]}`);
        }
      }
      return bad.length ? fail(bad.join(" ")) : pass;
    }

    case "sectionCount":
      return count(sectionLayouts(doc).length, c.count, "sections");

    case "layout": {
      const l = sectionLayouts(doc)[c.section];
      if (!l) return fail(`no section ${c.section}`);
      const bad: string[] = [];
      if (c.paperSize && l.paperSize !== c.paperSize) bad.push(`paper=${l.paperSize}`);
      if (c.orientation && l.orientation !== c.orientation) bad.push(`orientation=${l.orientation}`);
      for (const [side, exp] of Object.entries(c.margins ?? {})) {
        const key = `margin${side[0]!.toUpperCase()}${side.slice(1)}` as keyof typeof l;
        if (!inRange(l[key] as number, exp!, 2)) bad.push(`${side}=${String(l[key])}`);
      }
      return bad.length ? fail(bad.join(" ")) : pass;
    }

    case "headerFooter": {
      const blocks = headerFooterBlocks(doc, c.part, c.variant);
      if (blocks.length === 0) return fail("empty");
      const bad: string[] = [];
      const text = blocks.map(blockText).join("\n");
      if (c.contains && !matches(text, c.contains)) bad.push(`text=${JSON.stringify(short(text))}`);
      if (c.fields) {
        const kinds = fieldKinds(blocks);
        const missing = c.fields.filter((f) => !kinds.includes(f));
        if (missing.length) bad.push(`missing fields ${missing.join(",")} (have ${kinds.join(",") || "none"})`);
      }
      if (c.hasImage && !blocks.some((b) => b.type === "image" || JSON.stringify(b.data).includes("<img"))) bad.push("no image");
      return bad.length ? fail(bad.join("; ")) : pass;
    }

    case "pageSetup": {
      const ps = doc.pageSetup;
      const bad: string[] = [];
      if (c.differentFirstPage !== undefined && ps.differentFirstPage !== c.differentFirstPage) bad.push(`differentFirstPage=${ps.differentFirstPage}`);
      if (c.differentOddEven !== undefined && ps.differentOddEven !== c.differentOddEven) bad.push(`differentOddEven=${ps.differentOddEven}`);
      if (c.headerDistance !== undefined && !inRange(ps.headerDistance, c.headerDistance, 2)) bad.push(`headerDistance=${ps.headerDistance}`);
      if (c.footerDistance !== undefined && !inRange(ps.footerDistance, c.footerDistance, 2)) bad.push(`footerDistance=${ps.footerDistance}`);
      if (c.pageColor !== undefined && normColor(ps.pageColor) !== normColor(c.pageColor)) bad.push(`pageColor=${ps.pageColor}`);
      if (c.pageBorder) {
        const pb = ps.pageBorder;
        if (!pb) bad.push("pageBorder=null");
        else {
          if (c.pageBorder.style && pb.style !== c.pageBorder.style) bad.push(`border.style=${pb.style}`);
          if (c.pageBorder.color && normColor(pb.color) !== normColor(c.pageBorder.color)) bad.push(`border.color=${pb.color}`);
          if (c.pageBorder.width !== undefined && !inRange(pb.width, c.pageBorder.width, 0.5)) bad.push(`border.width=${pb.width}`);
        }
      }
      if (c.watermarkText !== undefined && !(ps.watermark && matches(ps.watermark.text, c.watermarkText))) bad.push(`watermark=${JSON.stringify(ps.watermark?.text ?? null)}`);
      return bad.length ? fail(bad.join(" ")) : pass;
    }

    case "footnotes": {
      const notes = footnoteHtmls(doc);
      const bad: string[] = [];
      if (c.count !== undefined && !inRange(notes.length, c.count, 0)) bad.push(`count=${notes.length}`);
      const refs = footnoteRefIds(doc.blocks);
      if (c.refs !== undefined && !inRange(refs.length, c.refs, 0)) bad.push(`refs=${refs.length}`);
      const dangling = refs.filter((id) => !notes.some(([k]) => k === id));
      if (dangling.length) bad.push(`refs without text: ${dangling.join(",")}`);
      for (const p of c.contains ?? []) {
        if (!notes.some(([, h]) => matches(htmlText(h), p))) bad.push(`missing ${showPattern(p)}`);
      }
      return bad.length ? fail(bad.join("; ")) : pass;
    }

    case "toc": {
      const tocs = doc.blocks.filter((b) => b.type === "toc");
      if (c.count !== undefined && !inRange(tocs.length, c.count, 0)) return fail(`count=${tocs.length}`);
      if (tocs.length === 0) return fail("no toc block");
      if (c.maxLevel !== undefined && !tocs.some((t) => Number(t.data?.maxLevel) === c.maxLevel))
        return fail(`maxLevel=${tocs.map((t) => String(t.data?.maxLevel)).join("/")}`);
      return pass;
    }

    case "equation": {
      const eqs = doc.blocks.filter((b) => b.type === "equation");
      const ok = eqs.some(
        (e) =>
          (c.display === undefined || Boolean(e.data?.display ?? true) === c.display) &&
          c.latexContains.every((frag) => String(e.data?.latex ?? "").includes(frag)),
      );
      return ok ? pass : fail(`equations: ${eqs.map((e) => JSON.stringify(short(String(e.data?.latex ?? ""), 80))).join(", ") || "none"}`);
    }

    case "textBox": {
      const boxes = doc.blocks.filter((b) => b.type === "textBox");
      return boxes.some((b) => matches(blockText(b), c.contains)) ? pass : fail(`${boxes.length} text box(es)`);
    }

    case "style": {
      const s = (doc.styles?.[c.id] ?? {}) as Record<string, unknown>;
      const bad: string[] = [];
      if (c.fontFamily !== undefined && !(typeof s.fontFamily === "string" && matches(s.fontFamily, c.fontFamily))) bad.push(`fontFamily=${String(s.fontFamily)}`);
      if (c.fontSizePx !== undefined && !inRange(s.fontSize as number, c.fontSizePx, 0.5)) bad.push(`fontSize=${String(s.fontSize)}`);
      if (c.color !== undefined && normColor(s.color as string) !== normColor(c.color)) bad.push(`color=${String(s.color)}`);
      if (c.italic !== undefined && Boolean(s.italic) !== c.italic) bad.push(`italic=${String(s.italic)}`);
      if (c.bold !== undefined && (Number(s.fontWeight ?? 400) >= 600) !== c.bold) bad.push(`fontWeight=${String(s.fontWeight)}`);
      return bad.length ? fail(bad.join(" ")) : pass;
    }

    case "title":
      return doc.title && matches(doc.title, c.text) ? pass : fail(`title=${JSON.stringify(doc.title)}`);

    case "warning":
      return doc.warnings.some((w) => c.pattern.test(w)) ? pass : fail(`warnings: ${JSON.stringify(doc.warnings)}`);
  }
}

export function runChecks(doc: ImportedDocument, checks: Check[]): CheckResult[] {
  return checks.map((check) => {
    let v: Verdict;
    try {
      v = evaluate(doc, check);
    } catch (e) {
      v = fail(`threw: ${(e as Error).message}`);
    }
    return { check, label: labelOf(check), ok: v.ok, soft: check.soft === true, detail: v.detail };
  });
}

export type { Scope };
