/**
 * DrawingML (w:drawing) and VML (w:pict) objects: pictures → image blocks,
 * text boxes → textBox blocks, header text watermarks → pageSetup.
 *
 * Images are referenced by EXACT relationship target (no fuzzy filename
 * matching); their bytes are attached later from `ctx.imageJobs`.
 */

import type { Alignment } from "../../format/paragraphFormat";
import { isSafeLinkUrl } from "../../safeUrl";
import { TEXT_BOX_WIDTHS } from "../../tools/objectData";
import { block, type ImportContext, type PartScope } from "./context";
import { clamp, emuToPx, hexColor, round } from "./html";
import { NO_FMT, type Piece } from "./pieces";
import { attr, child, intAttr, kids, path, tag } from "./xml";

export interface DrawingEnv {
  alignment?: Alignment;
  inCell: boolean;
  /** Inline HTML of a w:txbxContent (paragraphs joined with <br>). */
  textboxHtml(content: Element): string;
}

const px = (n: number) => `${Math.max(1, Math.round(n))}px`;

function imagePlaceholder(ctx: ImportContext): Piece {
  ctx.warnings.add("Images inside table cells and text boxes were replaced by an [image] placeholder.");
  return { kind: "seg", html: "[image]", fmt: NO_FMT, link: null };
}

interface Placement {
  float: boolean;
  wrapText: string;
  side: "left" | "right" | "inline";
  align?: Alignment;
  margins: { top: number; right: number; bottom: number; left: number };
}

function anchorPlacement(anchor: Element, widthPx: number, ctx: ImportContext): Placement {
  const margins = {
    top: emuToPx(intAttr(anchor, "distT") ?? 0),
    right: emuToPx(intAttr(anchor, "distR") ?? 0),
    bottom: emuToPx(intAttr(anchor, "distB") ?? 0),
    left: emuToPx(intAttr(anchor, "distL") ?? 0),
  };
  let wrap = "";
  for (const c of kids(anchor)) {
    const t = tag(c);
    if (t.startsWith("wp:wrap")) {
      wrap = t.slice(7);
      break;
    }
  }
  const posH = child(anchor, "wp:positionH");
  const alignH = child(posH, "wp:align")?.textContent?.trim() ?? null;
  const offset = child(posH, "wp:posOffset")?.textContent?.trim();
  let side: "left" | "right" | "center" = "left";
  if (alignH === "right" || alignH === "outside") side = "right";
  else if (alignH === "center") side = "center";
  else if (!alignH && offset) {
    let x = emuToPx(Number(offset) || 0);
    const rel = attr(posH, "relativeFrom");
    if (rel === "page" || rel === "leftMargin") x -= 96;
    side = x + widthPx / 2 > ctx.contentWidth / 2 ? "right" : "left";
  }

  if (wrap === "Square" || wrap === "Tight" || wrap === "Through") {
    if (side === "center") {
      return { float: true, wrapText: "top-bottom", side: "inline", align: "center", margins };
    }
    return { float: true, wrapText: wrap.toLowerCase(), side, margins };
  }
  if (wrap === "None") {
    const behind = attr(anchor, "behindDoc");
    ctx.warnings.add(
      behind === "1" || behind === "true"
        ? "Images behind text were placed between paragraphs."
        : "Images in front of text were placed between paragraphs.",
    );
  }
  return {
    float: true,
    wrapText: "top-bottom",
    side: "inline",
    align: side === "center" ? "center" : side === "right" ? "right" : undefined,
    margins,
  };
}

function marginTune(m: Placement["margins"]) {
  const v = (n: number) => `${Math.round(n)}px`;
  return { marginTop: v(m.top), marginRight: v(m.right), marginBottom: v(m.bottom), marginLeft: v(m.left) };
}

function imageBlock(
  ctx: ImportContext,
  scope: PartScope,
  pic: Element,
  size: { w: number; h: number },
  placement: Placement,
  docPr: Element | null,
): Piece | null {
  const blipFill = child(pic, "pic:blipFill");
  const blip = child(blipFill, "a:blip");
  const embed = attr(blip, "r:embed");
  const linked = attr(blip, "r:link");
  const rel = embed ? scope.rels.get(embed) : undefined;
  if (!rel || rel.external) {
    ctx.warnings.add(
      linked || rel?.external ? "Linked (not embedded) images were skipped." : "An image with a missing picture part was skipped.",
    );
    return null;
  }

  // Crop: a:srcRect l/t/r/b in 1/1000 %. The extent is the visible part;
  // the editor's dimensions describe the whole picture.
  const src = child(blipFill, "a:srcRect");
  const pct = (name: string) => clamp((intAttr(src, name) ?? 0) / 1000, 0, 95);
  const crop = { top: pct("t"), right: pct("r"), bottom: pct("b"), left: pct("l") };
  const cropped = crop.top || crop.right || crop.bottom || crop.left;
  const fullW = cropped ? size.w / Math.max(0.05, 1 - (crop.left + crop.right) / 100) : size.w;
  const fullH = cropped ? size.h / Math.max(0.05, 1 - (crop.top + crop.bottom) / 100) : size.h;

  const xfrm = path(pic, "pic:spPr", "a:xfrm");
  const rot = (intAttr(xfrm, "rot") ?? 0) / 60000;
  // Plain text; "<" / ">" would be treated as markup by the load sanitizer.
  const alt = (attr(docPr, "descr") ?? attr(docPr, "title") ?? "").replace(/[<>]/g, "").trim().slice(0, 500);

  const data: Record<string, unknown> = {
    file: { url: "" },
    caption: "",
    showCaption: false,
    dimensions: { width: px(fullW), height: px(fullH) },
    altText: alt,
    tunes: {
      imageTune: {
        float: placement.side,
        wrapText: placement.wrapText,
        position: placement.side === "inline" ? "inline" : "relative",
        ...marginTune(placement.margins),
      },
    },
  };
  if (cropped) data.crop = { top: round(crop.top, 2), right: round(crop.right, 2), bottom: round(crop.bottom, 2), left: round(crop.left, 2) };
  if (rot) data.rotation = round(((rot % 360) + 360) % 360, 1);
  if (attr(xfrm, "flipH") === "1") data.flipX = true;
  if (attr(xfrm, "flipV") === "1") data.flipY = true;

  const linkId = attr(child(docPr, "a:hlinkClick"), "r:id");
  const linkRel = linkId ? scope.rels.get(linkId) : undefined;
  if (linkRel?.external && isSafeLinkUrl(linkRel.target)) data.link = { url: linkRel.target, openInNewTab: true };

  const align = placement.side === "inline" ? placement.align : undefined;
  const b = block(ctx, "image", data, align && align !== "left" ? { alignment: { alignment: align } } : undefined);
  ctx.imageJobs.push({ part: rel.target, block: b });
  return { kind: "block", block: b, float: placement.float, placeholder: "[image]" };
}

function textBoxWidth(widthPx: number, ctx: ImportContext): number {
  const pct = (widthPx / Math.max(1, ctx.contentWidth)) * 100;
  let best: number = TEXT_BOX_WIDTHS[0];
  for (const w of TEXT_BOX_WIDTHS) if (Math.abs(w - pct) < Math.abs(best - pct)) best = w;
  return best;
}

function textBoxBlock(ctx: ImportContext, html: string, widthPx: number, align: Alignment | undefined, float: boolean): Piece {
  const a = align === "right" ? "right" : align === "left" ? "left" : "center";
  const b = block(ctx, "textBox", { text: html, preset: "plain", width: textBoxWidth(widthPx, ctx), align: a });
  return { kind: "block", block: b, float, placeholder: html };
}

/** Plain text of a txbxContent (for watermarks / cells). */
function plainText(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function setWatermark(ctx: ImportContext, text: string, color: string | null, opacity: number | null) {
  if (!text) return;
  ctx.watermark = {
    text: text.slice(0, 60),
    color: color ?? "#c0c0c0",
    opacity: clamp(opacity ?? 0.5, 0.05, 1),
  };
}

function shapePieces(
  wsp: Element,
  ctx: ImportContext,
  scope: PartScope,
  env: DrawingEnv,
  size: { w: number; h: number },
  placement: Placement,
  docPr: Element | null,
): Piece[] {
  const content = path(wsp, "wps:txbx", "w:txbxContent");
  const warp = path(wsp, "wps:bodyPr", "a:prstTxWarp");
  const name = attr(docPr, "name") ?? "";
  if ((scope.kind === "header" || scope.kind === "footer") && (warp || /watermark/i.test(name))) {
    const fill = hexColor(attr(path(wsp, "wps:spPr", "a:solidFill", "a:srgbClr"), "val"));
    const alpha = intAttr(path(wsp, "wps:spPr", "a:solidFill", "a:srgbClr", "a:alpha"), "val");
    setWatermark(ctx, plainText(content), fill, alpha !== null ? alpha / 100000 : null);
    return [];
  }
  if (!content) {
    ctx.warnings.add("Drawing shapes (other than pictures and text boxes) were skipped.");
    return [];
  }
  if (env.inCell) {
    const html = env.textboxHtml(content);
    return html ? [{ kind: "seg", html, fmt: NO_FMT, link: null }] : [];
  }
  return [textBoxBlock(ctx, env.textboxHtml(content), size.w, placement.align ?? (placement.side === "right" ? "right" : placement.side === "left" && placement.float ? "left" : env.alignment), placement.float)];
}

function graphicPieces(
  graphicData: Element | null,
  ctx: ImportContext,
  scope: PartScope,
  env: DrawingEnv,
  size: { w: number; h: number },
  placement: Placement,
  docPr: Element | null,
): Piece[] {
  if (!graphicData) return [];
  const out: Piece[] = [];
  for (const c of kids(graphicData)) {
    const t = tag(c);
    if (t === "pic:pic") {
      if (env.inCell) out.push(imagePlaceholder(ctx));
      else {
        const p = imageBlock(ctx, scope, c, size, placement, docPr);
        if (p) out.push(p);
      }
    } else if (t === "wps:wsp") {
      out.push(...shapePieces(c, ctx, scope, env, size, placement, docPr));
    } else if (t === "wpg:wgp" || t === "wpc:wpc") {
      ctx.warnings.add("Grouped drawings were imported as separate objects (layout not kept).");
      out.push(...groupPieces(c, ctx, scope, env, placement, docPr));
    } else if (t === "c:chart") {
      ctx.warnings.add("Charts were not imported.");
    } else if (t.startsWith("dgm:")) {
      ctx.warnings.add("SmartArt diagrams were not imported.");
      break;
    }
  }
  return out;
}

function groupPieces(
  group: Element,
  ctx: ImportContext,
  scope: PartScope,
  env: DrawingEnv,
  placement: Placement,
  docPr: Element | null,
): Piece[] {
  const out: Piece[] = [];
  for (const c of kids(group)) {
    const t = tag(c);
    const ext = path(c, t === "pic:pic" ? "pic:spPr" : t === "wpg:grpSp" ? "wpg:grpSpPr" : "wps:spPr", "a:xfrm", "a:ext");
    const size = { w: emuToPx(intAttr(ext, "cx") ?? 0), h: emuToPx(intAttr(ext, "cy") ?? 0) };
    if (t === "pic:pic") {
      if (env.inCell) out.push(imagePlaceholder(ctx));
      else {
        const p = imageBlock(ctx, scope, c, size, placement, docPr);
        if (p) out.push(p);
      }
    } else if (t === "wps:wsp") out.push(...shapePieces(c, ctx, scope, env, size, placement, docPr));
    else if (t === "wpg:grpSp") out.push(...groupPieces(c, ctx, scope, env, placement, docPr));
  }
  return out;
}

/** w:drawing → pieces. */
export function convertDrawing(drawing: Element, ctx: ImportContext, scope: PartScope, env: DrawingEnv): Piece[] {
  const out: Piece[] = [];
  for (const holder of kids(drawing)) {
    const t = tag(holder);
    if (t !== "wp:inline" && t !== "wp:anchor") continue;
    const ext = child(holder, "wp:extent");
    const size = { w: emuToPx(intAttr(ext, "cx") ?? 0), h: emuToPx(intAttr(ext, "cy") ?? 0) };
    const docPr = child(holder, "wp:docPr");
    const placement: Placement =
      t === "wp:anchor"
        ? anchorPlacement(holder, size.w, ctx)
        : {
            float: false,
            wrapText: "top-bottom",
            side: "inline",
            align: env.alignment,
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
          };
    out.push(...graphicPieces(path(holder, "a:graphic", "a:graphicData"), ctx, scope, env, size, placement, docPr));
  }
  return out;
}

// ── VML ────────────────────────────────────────────────────────────────

const VML_COLORS: Record<string, string> = {
  silver: "#c0c0c0", gray: "#808080", grey: "#808080", black: "#000000", white: "#ffffff",
  red: "#ff0000", blue: "#0000ff", green: "#008000", yellow: "#ffff00", navy: "#000080",
};

function vmlColor(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim().split(/\s/)[0]!.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return VML_COLORS[s] ?? null;
}

function vmlOpacity(v: string | null): number | null {
  if (!v) return null;
  const s = v.trim();
  if (s.endsWith("f")) return Number(s.slice(0, -1)) / 65536;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** CSS-ish VML style "width:100pt;height:50pt" → px. */
function vmlSize(style: string | null): { w: number; h: number } {
  const get = (k: string) => {
    const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|px|in|cm|mm)?`, "i").exec(style ?? "");
    if (!m) return 0;
    const n = Number(m[1]);
    switch ((m[2] ?? "px").toLowerCase()) {
      case "pt":
        return (n * 4) / 3;
      case "in":
        return n * 96;
      case "cm":
        return (n * 96) / 2.54;
      case "mm":
        return (n * 96) / 25.4;
      default:
        return n;
    }
  };
  return { w: get("width"), h: get("height") };
}

/** w:pict / w:object (VML) → pieces. */
export function convertPict(pict: Element, ctx: ImportContext, scope: PartScope, env: DrawingEnv): Piece[] {
  const out: Piece[] = [];
  for (const shape of kids(pict)) {
    const t = tag(shape);
    if (!t.startsWith("v:")) continue;
    if (t === "v:shapetype") continue;
    if (t === "v:group") {
      out.push(...convertPict(shape, ctx, scope, env));
      continue;
    }
    const textpath = child(shape, "v:textpath");
    if (textpath) {
      if (scope.kind === "header" || scope.kind === "footer") {
        const fill = child(shape, "v:fill");
        setWatermark(
          ctx,
          (attr(textpath, "string") ?? "").trim(),
          vmlColor(attr(shape, "fillcolor")),
          vmlOpacity(attr(fill, "opacity")),
        );
      } else {
        ctx.warnings.add("WordArt was imported as plain text.");
        const text = (attr(textpath, "string") ?? "").trim();
        if (text) out.push({ kind: "seg", html: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), fmt: NO_FMT, link: null });
      }
      continue;
    }
    const size = vmlSize(attr(shape, "style"));
    const content = path(shape, "v:textbox", "w:txbxContent");
    if (content) {
      if (env.inCell) {
        const html = env.textboxHtml(content);
        if (html) out.push({ kind: "seg", html, fmt: NO_FMT, link: null });
      } else out.push(textBoxBlock(ctx, env.textboxHtml(content), size.w, env.alignment, false));
      continue;
    }
    const imagedata = child(shape, "v:imagedata");
    const rid = attr(imagedata, "r:id") ?? attr(imagedata, "o:relid");
    if (rid) {
      if (env.inCell) {
        out.push(imagePlaceholder(ctx));
        continue;
      }
      const rel = scope.rels.get(rid);
      if (!rel || rel.external) {
        ctx.warnings.add("Linked (not embedded) images were skipped.");
        continue;
      }
      const b = block(
        ctx,
        "image",
        {
          file: { url: "" },
          caption: "",
          showCaption: false,
          dimensions: { width: px(size.w || 200), height: px(size.h || 150) },
          altText: (attr(shape, "alt") ?? "").replace(/[<>]/g, "").slice(0, 500),
          tunes: {
            imageTune: { float: "inline", wrapText: "top-bottom", position: "inline", marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px" },
          },
        },
        env.alignment && env.alignment !== "left" ? { alignment: { alignment: env.alignment } } : undefined,
      );
      ctx.imageJobs.push({ part: rel.target, block: b });
      out.push({ kind: "block", block: b, float: false, placeholder: "[image]" });
      continue;
    }
    ctx.warnings.add("VML shapes were skipped.");
  }
  return out;
}
