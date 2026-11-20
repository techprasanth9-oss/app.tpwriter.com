#!/usr/bin/env python3
"""
Build the DOCX fidelity corpus → fixtures/docx/*.docx

Deterministic: fixed core properties, fixed zip timestamps, seeded filler
text, PNGs generated with zlib/struct. Uses python-docx where it has an API
and raw OOXML (lxml via python-docx's parse_xml) where it doesn't
(numbering, floating images, crops, footnotes, fields, TOC, text boxes,
OMML, page colour/border, watermark).

Every fixture's content is mirrored by declarative assertions in
fixtures/docx/expectations.ts — if you change a fixture, update that file.

Usage:  python3 scripts/fixtures/build_docx_fixtures.py [OUT_DIR]
"""
from __future__ import annotations

import copy
import datetime as dt
import io
import random
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_COLOR_INDEX
from docx.opc.constants import CONTENT_TYPE as CT
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Emu, Inches, Pt, RGBColor, Twips

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fixtures" / "docx"

FIXED_DATE = dt.datetime(2026, 1, 1, 0, 0, 0)
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
EMU_PER_PX = 9525

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "v": "urn:schemas-microsoft-com:vml",
    "o": "urn:schemas-microsoft-com:office:office",
    "w10": "urn:schemas-microsoft-com:office:word",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
}


def xmlns(*prefixes: str) -> str:
    return " ".join(f'xmlns:{p}="{NS[p]}"' for p in prefixes)


def X(fragment: str, *prefixes: str):
    """Parse an XML fragment whose root declares the given namespaces."""
    prefixes = prefixes or ("w",)
    m = re.match(r"<[\w:]+", fragment)
    i = m.end()
    return parse_xml(fragment[:i] + " " + xmlns(*prefixes) + fragment[i:])


# ── Small PNGs (stdlib only) ─────────────────────────────────────────────


def png(width: int, height: int, color: tuple[int, int, int], stripe: tuple[int, int, int] | None = None) -> bytes:
    """RGB PNG, optionally with a diagonal stripe so crops are visible."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            c = stripe if stripe and abs((x * height // max(width, 1)) - y) < max(2, height // 10) else color
            row += bytes(c)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# ── Common helpers ───────────────────────────────────────────────────────

_rng = random.Random(42)
WORDS = (
    "the quarterly review shows steady growth across every region while costs remain under "
    "control and teams continue to deliver projects on schedule customers report higher "
    "satisfaction with support response times and the new product line exceeded early "
    "forecasts by a comfortable margin investment in infrastructure will continue next year"
).split()


def filler(n_words: int, seed: int) -> str:
    rng = random.Random(seed)
    words = [rng.choice(WORDS) for _ in range(n_words)]
    words[0] = words[0].capitalize()
    return " ".join(words) + "."


def new_doc(title: str, a4: bool = True) -> Document:
    doc = Document()
    cp = doc.core_properties
    cp.title = title
    cp.author = "TP Writer fixtures"
    cp.last_modified_by = "TP Writer fixtures"
    cp.created = FIXED_DATE
    cp.modified = FIXED_DATE
    cp.last_printed = FIXED_DATE
    cp.revision = 1
    if a4:
        set_layout(doc.sections[0], "A4", "portrait", 1, 1, 1, 1)
    return doc


PAPER = {"A4": (11906, 16838), "LETTER": (12240, 15840)}


def set_layout(section, paper: str, orientation: str, top: float, right: float, bottom: float, left: float):
    w, h = PAPER[paper]
    if orientation == "landscape":
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = Twips(h), Twips(w)
    else:
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width, section.page_height = Twips(w), Twips(h)
    section.top_margin = Inches(top)
    section.right_margin = Inches(right)
    section.bottom_margin = Inches(bottom)
    section.left_margin = Inches(left)
    section.header_distance = Inches(0.5)
    section.footer_distance = Inches(0.5)


def save(doc: Document, name: str, rewrite: dict | None = None) -> Path:
    """Save with fixed zip timestamps; `rewrite` maps part name → fn(str)->str."""
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.docx"
    with zipfile.ZipFile(buf) as src, zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if rewrite and info.filename in rewrite:
                data = rewrite[info.filename](data.decode("utf-8")).encode("utf-8")
            zi = zipfile.ZipInfo(info.filename, ZIP_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            dst.writestr(zi, data)
    print(f"  {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}  ({path.stat().st_size} bytes)")
    return path


def add_hyperlink(paragraph, url: str, text: str):
    r_id = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = X(
        f'<w:hyperlink r:id="{r_id}" w:history="1"><w:r><w:rPr><w:color w:val="0563C1"/>'
        f'<w:u w:val="single"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:hyperlink>',
        "w",
        "r",
    )
    paragraph._p.append(link)
    return link


def shade_run(run, fill: str):
    rpr = run._r.get_or_add_rPr()
    rpr.append(X(f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>'))


def shade_cell(cell, fill: str):
    cell._tc.get_or_add_tcPr().append(X(f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>'))


def table_borders(table, sz: int = 8, color: str = "444444", style: str = "single"):
    tblPr = table._tbl.tblPr
    sides = "".join(
        f'<w:{s} w:val="{style}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        for s in ("top", "left", "bottom", "right", "insideH", "insideV")
    )
    borders = X(f"<w:tblBorders>{sides}</w:tblBorders>")
    later = [c for c in tblPr if c.tag in (qn("w:shd"), qn("w:tblLayout"), qn("w:tblCellMar"), qn("w:tblLook"))]
    if later:
        later[0].addprevious(borders)
    else:
        tblPr.append(borders)


def set_col_widths(table, widths_twips: list[int]):
    table.autofit = False
    grid = table._tbl.tblGrid
    for gc, w in zip(grid.findall(qn("w:gridCol")), widths_twips):
        gc.set(qn("w:w"), str(w))
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            if idx < len(widths_twips):
                cell.width = Twips(widths_twips[idx])


def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    trPr.append(X('<w:tblHeader/>'))


def cell_text(cell, text: str, bold: bool = False, color: str | None = None):
    p = cell.paragraphs[0]
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    run = p.add_run(text)
    run.bold = bold or None
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return run


def page_break_paragraph(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def field_runs(paragraph, instr: str, cached: str):
    """Complex field: begin / instrText / separate / cached / end."""
    for xml in (
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
        f'<w:r><w:instrText xml:space="preserve"> {instr} </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
        f'<w:r><w:t>{cached}</w:t></w:r>',
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ):
        paragraph._p.append(X(xml))


def simple_field(paragraph, instr: str, cached: str):
    paragraph._p.append(X(f'<w:fldSimple w:instr=" {instr} "><w:r><w:t>{cached}</w:t></w:r></w:fldSimple>'))


# ── Images ───────────────────────────────────────────────────────────────


def add_inline_image(paragraph, data: bytes, w_px: int, h_px: int, alt: str):
    run = paragraph.add_run()
    run.add_picture(io.BytesIO(data), width=Emu(w_px * EMU_PER_PX), height=Emu(h_px * EMU_PER_PX))
    inline = run._r.find(".//" + qn("wp:inline"))
    inline.find(qn("wp:docPr")).set("descr", alt)
    return run, inline


_anchor_seq = [251659264]


def float_image(paragraph, data: bytes, w_px: int, h_px: int, alt: str, side: str):
    """Inline picture → wp:anchor with square wrapping, aligned left/right."""
    run, inline = add_inline_image(paragraph, data, w_px, h_px, alt)
    _anchor_seq[0] += 1
    extent = copy.deepcopy(inline.find(qn("wp:extent")))
    docPr = copy.deepcopy(inline.find(qn("wp:docPr")))
    graphic = copy.deepcopy(inline.find(qn("a:graphic")))
    anchor = X(
        f'<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" '
        f'relativeHeight="{_anchor_seq[0]}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        f'<wp:positionH relativeFrom="column"><wp:align>{side}</wp:align></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
        "</wp:anchor>",
        "wp",
    )
    anchor.append(extent)
    anchor.append(X('<wp:effectExtent l="0" t="0" r="0" b="0"/>', "wp"))
    anchor.append(X('<wp:wrapSquare wrapText="bothSides"/>', "wp"))
    anchor.append(docPr)
    anchor.append(X("<wp:cNvGraphicFramePr/>", "wp"))
    anchor.append(graphic)
    inline.getparent().replace(inline, anchor)
    return run


def crop_image(run, l=0, t=0, r=0, b=0):
    """srcRect in 1/1000 of a percent."""
    blipFill = run._r.find(".//" + qn("pic:blipFill"))
    blip = blipFill.find(qn("a:blip"))
    src = X(f'<a:srcRect l="{l}" t="{t}" r="{r}" b="{b}"/>', "a")
    blip.addnext(src)


# ── Numbering ────────────────────────────────────────────────────────────


def lvl_xml(ilvl: int, fmt: str, text: str, start: int = 1) -> str:
    left = 720 * (ilvl + 1)
    return (
        f'<w:lvl w:ilvl="{ilvl}"><w:start w:val="{start}"/><w:numFmt w:val="{fmt}"/>'
        f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
        f'<w:pPr><w:ind w:left="{left}" w:hanging="360"/></w:pPr></w:lvl>'
    )


def add_abstract(doc, abs_id: int, levels: list[tuple[str, str]]):
    numbering = doc.part.numbering_part.element
    body = "".join(lvl_xml(i, fmt, text) for i, (fmt, text) in enumerate(levels))
    absn = X(
        f'<w:abstractNum w:abstractNumId="{abs_id}"><w:multiLevelType w:val="hybridMultilevel"/>{body}</w:abstractNum>'
    )
    first_num = numbering.find(qn("w:num"))
    if first_num is not None:
        first_num.addprevious(absn)
    else:
        numbering.append(absn)


def add_num(doc, num_id: int, abs_id: int, start_override: int | None = None):
    numbering = doc.part.numbering_part.element
    override = (
        f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="{start_override}"/></w:lvlOverride>'
        if start_override
        else ""
    )
    numbering.append(X(f'<w:num w:numId="{num_id}"><w:abstractNumId w:val="{abs_id}"/>{override}</w:num>'))


def list_par(doc, text: str, num_id: int, ilvl: int = 0):
    p = doc.add_paragraph(text, style="List Paragraph")
    p._p.get_or_add_pPr().append(
        X(f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr>')
    )
    return p


BULLET_LEVELS = [("bullet", "•"), ("bullet", "o"), ("bullet", "▪")] * 3
DECIMAL_LEVELS = [("decimal", "%1."), ("lowerLetter", "%2."), ("lowerRoman", "%3.")] * 3


def setup_standard_lists(doc):
    add_abstract(doc, 100, BULLET_LEVELS)
    add_abstract(doc, 101, DECIMAL_LEVELS)
    add_num(doc, 100, 100)
    add_num(doc, 101, 101)


# ── Footnotes part ───────────────────────────────────────────────────────

FOOTNOTES_HEAD = (
    f'<w:footnotes {xmlns("w", "r")}>'
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    "<w:r><w:separator/></w:r></w:p></w:footnote>"
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    "<w:r><w:continuationSeparator/></w:r></w:p></w:footnote>"
)


def add_footnotes_part(doc, notes: dict[int, str]):
    """notes: id → inner run XML (after the footnoteRef)."""
    body = "".join(
        f'<w:footnote w:id="{fid}"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
        f'<w:r><w:t xml:space="preserve"> </w:t></w:r>{runs}</w:p></w:footnote>'
        for fid, runs in notes.items()
    )
    blob = (FOOTNOTES_HEAD + body + "</w:footnotes>").encode("utf-8")
    part = Part(PackURI("/word/footnotes.xml"), CT.WML_FOOTNOTES, blob, doc.part.package)
    doc.part.relate_to(part, RT.FOOTNOTES)


def footnote_ref(paragraph, fid: int):
    paragraph._p.append(
        X(f'<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="{fid}"/></w:r>')
    )


def run_xml(text: str, bold=False, italic=False) -> str:
    rpr = ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "")
    return f'<w:r>{"<w:rPr>" + rpr + "</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{text}</w:t></w:r>'


# ── OMML ─────────────────────────────────────────────────────────────────


def m_r(t: str) -> str:
    return f"<m:r><m:t>{t}</m:t></m:r>"


OMML_FRAC = f"<m:f><m:num>{m_r('a')}</m:num><m:den>{m_r('b')}</m:den></m:f>"
OMML_SUM = (
    '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>'
    f"<m:sub>{m_r('i=1')}</m:sub><m:sup>{m_r('n')}</m:sup><m:e>{m_r('i')}</m:e></m:nary>"
)
OMML_SQRT = f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{m_r("x")}</m:e></m:rad>'
OMML_SSUP = f"<m:sSup><m:e>{m_r('r')}</m:e><m:sup>{m_r('2')}</m:sup></m:sSup>"


def display_equation(doc, inner: str):
    p = doc.add_paragraph()
    p._p.append(X(f"<m:oMathPara><m:oMath>{inner}</m:oMath></m:oMathPara>", "m"))
    return p


def inline_equation(paragraph, inner: str):
    paragraph._p.append(X(f"<m:oMath>{inner}</m:oMath>", "m"))


# ── Text box (DrawingML wps with VML fallback, as Word writes it) ────────


def text_box(paragraph, bold_lead: str, text: str, w_in: float = 4, h_in: float = 1):
    cx, cy = int(w_in * 914400), int(h_in * 914400)
    content = (
        f'<w:txbxContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{bold_lead}</w:t></w:r>'
        f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p></w:txbxContent>'
    )
    xml = (
        '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>'
        '<wp:anchor distT="45720" distB="45720" distL="114300" distR="114300" simplePos="0" relativeHeight="251700000" '
        'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
        '<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/>'
        '<wp:docPr id="900" name="Text Box 900"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>'
        f'<a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        '<a:solidFill><a:srgbClr val="DEEAF6"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="2E74B5"/></a:solidFill></a:ln>'
        f"</wps:spPr><wps:txbx>{content}</wps:txbx>"
        '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"><a:noAutofit/></wps:bodyPr>'
        "</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>"
        '<mc:Fallback><w:pict><v:shape id="TextBox900" o:spid="_x0000_s1900" type="#_x0000_t202" '
        f'style="position:absolute;margin-left:0;margin-top:0;width:{w_in * 72:.0f}pt;height:{h_in * 72:.0f}pt;z-index:251700000;'
        'mso-position-horizontal:center;mso-position-horizontal-relative:text" fillcolor="#deeaf6" strokecolor="#2e74b5" strokeweight="1pt">'
        f'<v:textbox>{content}</v:textbox><w10:wrap type="topAndBottom"/></v:shape></w:pict></mc:Fallback>'
        "</mc:AlternateContent></w:r>"
    )
    paragraph._p.append(X(xml, "w", "mc", "wp", "a", "wps", "v", "o", "w10"))


# ═════════════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════════════


def f01_basic_formatting():
    doc = new_doc("Basic formatting")
    p = doc.add_paragraph()
    p.add_run("Bold text").bold = True
    p.add_run(", ")
    p.add_run("italic text").italic = True
    p.add_run(", ")
    p.add_run("underlined text").underline = True
    p.add_run(" and ")
    r = p.add_run("struck text")
    r.font.strike = True
    p.add_run(".")

    p = doc.add_paragraph()
    r = p.add_run("Red words")
    r.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
    p.add_run(" then ")
    r = p.add_run("blue words")
    r.font.color.rgb = RGBColor(0x1F, 0x4E, 0x79)
    p.add_run(" and ")
    r = p.add_run("highlighted words")
    r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    p.add_run(" and ")
    r = p.add_run("shaded words")
    shade_run(r, "D9E2F3")
    p.add_run(".")

    p = doc.add_paragraph()
    r = p.add_run("Georgia font")
    r.font.name = "Georgia"
    p.add_run(", ")
    r = p.add_run("Courier New font")
    r.font.name = "Courier New"
    p.add_run(", ")
    r = p.add_run("eighteen point")
    r.font.size = Pt(18)
    p.add_run(", ")
    r = p.add_run("eight point")
    r.font.size = Pt(8)
    p.add_run(".")

    p = doc.add_paragraph()
    p.add_run("Water is H")
    p.add_run("2").font.subscript = True
    p.add_run("O and energy is E=mc")
    p.add_run("2").font.superscript = True
    p.add_run(".")

    p = doc.add_paragraph()
    r = p.add_run("Line one")
    r.add_break()
    r = p.add_run("Line two")
    r.add_break()
    p.add_run("Line three")

    p = doc.add_paragraph("Links: ")
    add_hyperlink(p, "https://example.com/docs", "Example docs")
    p.add_run(", ")
    add_hyperlink(p, "mailto:team@example.com", "Email the team")
    p.add_run(" and ")
    add_hyperlink(p, "javascript:alert(1)", "Unsafe link")
    p.add_run(".")

    p = doc.add_paragraph()
    r = p.add_run("Bold italic red")
    r.bold = True
    r.italic = True
    r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
    p.add_run(" combined.")
    save(doc, "01-basic-formatting")


def f02_styles():
    doc = new_doc("Styles")
    normal = doc.styles["Normal"]
    normal.font.name = "Cambria"
    normal.font.size = Pt(11)
    h1 = doc.styles["Heading 1"]
    h1.font.color.rgb = RGBColor(0x2E, 0x74, 0xB5)
    h1.font.size = Pt(20)

    doc.add_paragraph("Document Title", style="Title")
    doc.add_paragraph("A subtitle for the document", style="Subtitle")
    doc.add_paragraph("Heading One Text", style="Heading 1")
    doc.add_paragraph(filler(30, 1))
    doc.add_paragraph("Heading Two Text", style="Heading 2")
    doc.add_paragraph(filler(30, 2))
    doc.add_paragraph("Heading Three Text", style="Heading 3")
    doc.add_paragraph("Heading Four Text", style="Heading 4")
    doc.add_paragraph("Heading Five Text", style="Heading 5")
    doc.add_paragraph(filler(20, 3))
    doc.add_paragraph("To be or not to be, that is the question.", style="Quote")
    doc.add_paragraph("Plain normal paragraph at the end.")
    save(doc, "02-styles")


def f02b_styles_localized():
    """German-Word style IDs: styleId 'berschrift1' with name 'heading 1'."""
    doc = new_doc("Lokalisierte Formatvorlagen")
    doc.add_paragraph("Lokaler Titel", style="Title")
    doc.add_paragraph("Erste Ebene", style="Heading 1")
    doc.add_paragraph(filler(20, 4))
    doc.add_paragraph("Zweite Ebene", style="Heading 2")
    doc.add_paragraph(filler(20, 5))
    doc.add_paragraph("Dritte Ebene", style="Heading 3")
    doc.add_paragraph("Ein Zitat steht hier.", style="Quote")

    ids = {
        "Heading1": "berschrift1",
        "Heading2": "berschrift2",
        "Heading3": "berschrift3",
        "Title": "Titel",
        "Quote": "Zitat",
    }

    def localize(xml: str) -> str:
        for a, b in ids.items():
            xml = xml.replace(f'w:styleId="{a}"', f'w:styleId="{b}"')
            xml = xml.replace(f'w:val="{a}"', f'w:val="{b}"')
            # Character styles linked to these ("Heading1Char", "TitleChar").
            xml = xml.replace(f'w:val="{a}Char"', f'w:val="{b}Zchn"')
            xml = xml.replace(f'w:styleId="{a}Char"', f'w:styleId="{b}Zchn"')
        return xml

    save(doc, "02b-styles-localized", {"word/styles.xml": localize, "word/document.xml": localize})


def f03_paragraphs():
    doc = new_doc("Paragraphs")
    for align, label in (
        (WD_ALIGN_PARAGRAPH.LEFT, "Left aligned paragraph."),
        (WD_ALIGN_PARAGRAPH.CENTER, "Centered paragraph."),
        (WD_ALIGN_PARAGRAPH.RIGHT, "Right aligned paragraph."),
        (WD_ALIGN_PARAGRAPH.JUSTIFY, "Justified paragraph. " + filler(60, 6)),
    ):
        doc.add_paragraph(label).alignment = align

    p = doc.add_paragraph("Indented half an inch. " + filler(20, 7))
    p.paragraph_format.left_indent = Inches(0.5)
    p = doc.add_paragraph("Indented one inch. " + filler(20, 8))
    p.paragraph_format.left_indent = Inches(1)
    p = doc.add_paragraph("First line indent. " + filler(30, 9))
    p.paragraph_format.first_line_indent = Inches(0.5)

    p = doc.add_paragraph("Spaced paragraph: 12pt before, 18pt after.")
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(18)

    p = doc.add_paragraph("One and a half line spacing. " + filler(40, 10))
    p.paragraph_format.line_spacing = 1.5
    p = doc.add_paragraph("Double line spacing. " + filler(40, 11))
    p.paragraph_format.line_spacing = 2.0

    doc.add_paragraph("Two empty paragraphs follow.")
    doc.add_paragraph()
    doc.add_paragraph()
    doc.add_paragraph("After the empty paragraphs.")

    p = doc.add_paragraph("Starts on a new page via pageBreakBefore.")
    p.paragraph_format.page_break_before = True
    doc.add_paragraph(filler(30, 12))
    save(doc, "03-paragraphs")


def f04_lists():
    doc = new_doc("Lists")
    add_abstract(doc, 100, BULLET_LEVELS)
    add_abstract(doc, 101, DECIMAL_LEVELS)
    add_abstract(doc, 102, [("lowerLetter", "%1)")] * 9)
    add_abstract(doc, 103, [("upperLetter", "%1.")] * 9)
    add_abstract(doc, 104, [("lowerRoman", "%1.")] * 9)
    add_abstract(doc, 105, [("upperRoman", "%1.")] * 9)
    add_abstract(doc, 106, DECIMAL_LEVELS)
    add_num(doc, 100, 100)  # bullets
    add_num(doc, 101, 101)  # decimal
    add_num(doc, 102, 102)
    add_num(doc, 103, 103)
    add_num(doc, 104, 104)
    add_num(doc, 105, 105)
    add_num(doc, 106, 101, start_override=5)  # restart at 5
    add_num(doc, 107, 106)  # list A
    add_num(doc, 108, 106, start_override=1)  # list B (separate instance)

    doc.add_paragraph("Bulleted list:")
    list_par(doc, "Apple", 100, 0)
    list_par(doc, "Banana", 100, 0)
    list_par(doc, "Cavendish", 100, 1)
    list_par(doc, "Dwarf Cavendish", 100, 2)
    list_par(doc, "Cherry", 100, 0)

    doc.add_paragraph("Decimal list:")
    list_par(doc, "First step", 101, 0)
    list_par(doc, "Second step", 101, 0)
    list_par(doc, "Sub-step one", 101, 1)
    list_par(doc, "Third step", 101, 0)

    doc.add_paragraph("Lower letter list:")
    list_par(doc, "alpha item", 102)
    list_par(doc, "beta item", 102)
    doc.add_paragraph("Upper letter list:")
    list_par(doc, "Upper A item", 103)
    list_par(doc, "Upper B item", 103)
    doc.add_paragraph("Lower roman list:")
    list_par(doc, "roman i item", 104)
    list_par(doc, "roman ii item", 104)
    doc.add_paragraph("Upper roman list:")
    list_par(doc, "Roman I item", 105)
    list_par(doc, "Roman II item", 105)

    doc.add_paragraph("Restarted list starting at five:")
    list_par(doc, "Starts at five", 106)
    list_par(doc, "Then six", 106)

    doc.add_paragraph("Two separate numbered lists:")
    list_par(doc, "List A one", 107)
    list_par(doc, "List A two", 107)
    doc.add_paragraph("Interlude paragraph between lists.")
    list_par(doc, "List B one", 108)
    list_par(doc, "List B two", 108)
    save(doc, "04-lists")


def f05_tables():
    doc = new_doc("Tables")
    doc.add_paragraph("Quarterly table with merges:")
    t = doc.add_table(rows=5, cols=4)
    table_borders(t)
    set_col_widths(t, [2000, 3000, 2000, 2000])
    for j, h in enumerate(("Region", "Q1", "Q2", "Notes")):
        c = t.cell(0, j)
        cell_text(c, h, bold=True, color="FFFFFF")
        shade_cell(c, "1F4E79")
    repeat_header(t.rows[0])
    for j, v in enumerate(("North", "120", "135", "Stable")):
        cell_text(t.cell(1, j), v)
    south = t.cell(2, 0).merge(t.cell(3, 0))
    cell_text(south, "South merged")
    cell_text(t.cell(2, 1), "98")
    cell_text(t.cell(2, 2), "110")
    c = t.cell(2, 3)
    cell_text(c, "Centered")
    c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    span = t.cell(3, 1).merge(t.cell(3, 2))
    cell_text(span, "Spans two columns")
    c = t.cell(3, 3)
    cell_text(c, "Bottom")
    c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.BOTTOM
    for j, v in enumerate(("Total", "218", "245")):
        cell_text(t.cell(4, j), v, bold=j == 0)
    c = t.cell(4, 3)
    cell_text(c, "Shaded cell")
    shade_cell(c, "FFF2CC")

    doc.add_paragraph("Nested table:")
    t2 = doc.add_table(rows=2, cols=2)
    table_borders(t2, color="000000")
    cell_text(t2.cell(0, 0), "Outer A")
    host = t2.cell(0, 1)
    cell_text(host, "Outer B")
    inner = host.add_table(rows=2, cols=2)
    table_borders(inner, sz=4, color="808080")
    for i, txt in enumerate(("Inner 1", "Inner 2", "Inner 3", "Inner 4")):
        cell_text(inner.cell(i // 2, i % 2), txt)
    host.add_paragraph("")
    cell_text(t2.cell(1, 0), "Outer C")
    cell_text(t2.cell(1, 1), "Outer D")

    doc.add_paragraph("Long table with a repeating header:")
    t3 = doc.add_table(rows=61, cols=3)
    table_borders(t3, sz=4, color="999999")
    set_col_widths(t3, [1800, 5400, 1800])
    for j, h in enumerate(("Item", "Description", "Amount")):
        cell_text(t3.cell(0, j), h, bold=True)
        shade_cell(t3.cell(0, j), "D9E2F3")
    repeat_header(t3.rows[0])
    for i in range(1, 61):
        cell_text(t3.cell(i, 0), f"Item {i}")
        cell_text(t3.cell(i, 1), f"Line item description number {i}")
        cell_text(t3.cell(i, 2), f"{i * 10}.00")
    doc.add_paragraph("End of tables.")
    save(doc, "05-tables")


def f06_images():
    doc = new_doc("Images")
    blue = png(64, 32, (31, 78, 121), (255, 255, 255))
    red = png(32, 32, (192, 0, 0))
    green = png(32, 48, (84, 130, 53))
    stripes = png(64, 32, (255, 192, 0), (0, 0, 0))

    doc.add_paragraph("An inline image on its own line:")
    add_inline_image(doc.add_paragraph(), blue, 192, 96, "Inline blue banner")

    p = doc.add_paragraph()
    float_image(p, red, 96, 96, "Left floating square", "left")
    p.add_run("Text wraps to the right of the left-floating square. " + filler(80, 13))

    p = doc.add_paragraph()
    float_image(p, green, 96, 144, "Right floating rectangle", "right")
    p.add_run("Text wraps to the left of the right-floating rectangle. " + filler(80, 14))

    doc.add_paragraph("A cropped image (25% off each side):")
    run, _ = add_inline_image(doc.add_paragraph(), stripes, 96, 96, "Cropped stripes")
    crop_image(run, l=25000, r=25000)
    doc.add_paragraph("End of images.")
    save(doc, "06-images")


def f07_sections():
    doc = new_doc("Sections")
    doc.add_paragraph("Section one: A4 portrait with one inch margins.")
    doc.add_paragraph(filler(40, 15))
    s = doc.add_section(WD_SECTION.NEW_PAGE)
    set_layout(s, "A4", "landscape", 0.5, 0.5, 0.5, 0.5)
    doc.add_paragraph("Section two: A4 landscape with half inch margins.")
    doc.add_paragraph(filler(40, 16))
    s = doc.add_section(WD_SECTION.NEW_PAGE)
    set_layout(s, "A4", "portrait", 1.25, 1.25, 1.25, 1.25)
    doc.add_paragraph("Section three: A4 portrait with 1.25 inch margins.")
    doc.add_paragraph(filler(40, 17))
    s = doc.add_section(WD_SECTION.NEW_PAGE)
    set_layout(s, "LETTER", "portrait", 0.75, 0.75, 0.75, 0.75)
    doc.add_paragraph("Section four: US Letter portrait with 0.75 inch margins.")
    doc.add_paragraph(filler(40, 18))
    save(doc, "07-sections")


WATERMARK = (
    '<w:r><w:pict>'
    '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">'
    '<v:path textpathok="t" o:connecttype="custom"/><v:textpath on="t" fitshape="t"/>'
    '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>'
    '<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" '
    'style="position:absolute;margin-left:0;margin-top:0;width:412.4pt;height:137.45pt;rotation:315;z-index:-251657216;'
    'mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;'
    'mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="silver" stroked="f">'
    '<v:fill opacity=".5"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="DRAFT"/>'
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>'
)


def f08_headers_footers():
    doc = new_doc("Headers and footers")
    doc.settings.odd_and_even_pages_header_footer = True
    s = doc.sections[0]
    s.different_first_page_header_footer = True

    hp = s.header.paragraphs[0]
    add_inline_image(hp, png(16, 16, (31, 78, 121)), 24, 24, "Header logo")
    hp.add_run(" Fidelity Corp — Confidential")
    hp._p.append(X(WATERMARK, "w", "v", "o", "w10"))

    s.first_page_header.paragraphs[0].text = "First Page Header"
    s.even_page_header.paragraphs[0].text = "Even Page Header"

    fp = s.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.add_run("Page ")
    field_runs(fp, "PAGE", "1")
    fp.add_run(" of ")
    simple_field(fp, "NUMPAGES", "4")

    s.first_page_footer.paragraphs[0].text = "First page footer"
    ep = s.even_page_footer.paragraphs[0]
    ep.add_run("Even footer page ")
    field_runs(ep, "PAGE", "2")

    for i in range(4):
        doc.add_paragraph(f"Body page {i + 1}.")
        doc.add_paragraph(filler(60, 20 + i))
        if i < 3:
            page_break_paragraph(doc)
    save(doc, "08-headers-footers")


def f09_footnotes():
    doc = new_doc("Footnotes")
    p = doc.add_paragraph("Revenue grew twelve percent")
    footnote_ref(p, 1)
    p.add_run(" while margins widened")
    footnote_ref(p, 2)
    p.add_run(".")
    doc.add_paragraph(filler(40, 30))
    p = doc.add_paragraph("The outlook remains positive")
    footnote_ref(p, 3)
    p.add_run(".")
    add_footnotes_part(
        doc,
        {
            1: run_xml("Source: annual survey 2025."),
            2: run_xml("Important:", bold=True) + run_xml(" ") + run_xml("see appendix B", italic=True) + run_xml("."),
            3: run_xml("Third note in plain text."),
        },
    )
    save(doc, "09-footnotes")


def f10_toc():
    doc = new_doc("Table of contents")
    body = doc.element.body
    entries = [("Introduction", 1, "2"), ("Background", 2, "2"), ("Details", 3, "2"), ("Conclusion", 1, "3")]
    paras = ['<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Contents</w:t></w:r></w:p>']
    for i, (text, lvl, page) in enumerate(entries):
        begin = (
            '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            if i == 0
            else ""
        )
        paras.append(
            f'<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9016"/></w:tabs>'
            f'<w:ind w:left="{(lvl - 1) * 220}"/></w:pPr>{begin}'
            f'<w:r><w:t>{text}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>{page}</w:t></w:r></w:p>'
        )
    paras.append('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')
    sdt = X(
        '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/>'
        f'</w:docPartObj></w:sdtPr><w:sdtContent>{"".join(paras)}</w:sdtContent></w:sdt>'
    )
    body.insert(0, sdt)
    page_break_paragraph(doc)
    doc.add_paragraph("Introduction", style="Heading 1")
    doc.add_paragraph(filler(40, 40))
    doc.add_paragraph("Background", style="Heading 2")
    doc.add_paragraph(filler(40, 41))
    doc.add_paragraph("Details", style="Heading 3")
    doc.add_paragraph(filler(40, 42))
    doc.add_paragraph("Deep detail not in TOC", style="Heading 4")
    doc.add_paragraph(filler(40, 43))
    page_break_paragraph(doc)
    doc.add_paragraph("Conclusion", style="Heading 1")
    doc.add_paragraph(filler(40, 44))
    save(doc, "10-toc")


def f11_breaks():
    doc = new_doc("Breaks")
    p = doc.add_paragraph()
    r = p.add_run("Alpha before the break.")
    r.add_break(WD_BREAK.PAGE)
    p.add_run("Omega after the break.")
    doc.add_paragraph("A standalone page break follows.")
    page_break_paragraph(doc)
    doc.add_paragraph("After the standalone break.")
    p = doc.add_paragraph()
    p._p.append(X("<w:r><w:lastRenderedPageBreak/><w:t>Rendered break markers are ignored.</w:t></w:r>"))
    doc.add_paragraph("Last paragraph of section one.")
    s = doc.add_section(WD_SECTION.CONTINUOUS)
    set_layout(s, "A4", "portrait", 1, 1, 1, 1)
    doc.add_paragraph("Continuous section content.")
    doc.add_paragraph(filler(30, 50))
    save(doc, "11-breaks")


def f12_textbox_math():
    doc = new_doc("Text box and math")
    doc.add_paragraph("A text box follows.")
    text_box(doc.add_paragraph(), "Important:", " text box content stays together.")
    doc.add_paragraph("A display equation follows.")
    display_equation(doc, OMML_FRAC + m_r("+") + OMML_SUM + m_r("+") + OMML_SQRT)
    p = doc.add_paragraph("The area is ")
    inline_equation(p, m_r("π") + OMML_SSUP)
    p.add_run(" for a circle.")
    doc.add_paragraph("End of math.")
    save(doc, "12-textbox-math")


def f13_page_design():
    doc = new_doc("Page design")
    doc.element.insert(0, X('<w:background w:color="FFF2CC"/>'))
    settings = doc.settings.element
    zoom = settings.find(qn("w:zoom"))
    if zoom is not None:
        zoom.addnext(X("<w:displayBackgroundShape/>"))
    else:
        settings.insert(0, X("<w:displayBackgroundShape/>"))
    sectPr = doc.sections[0]._sectPr
    pgMar = sectPr.find(qn("w:pgMar"))
    sides = "".join(
        f'<w:{s} w:val="single" w:sz="12" w:space="24" w:color="1F4E79"/>' for s in ("top", "left", "bottom", "right")
    )
    pgMar.addnext(X(f'<w:pgBorders w:offsetFrom="page">{sides}</w:pgBorders>'))
    doc.add_paragraph("This page has a light yellow page colour and a dark blue single page border.")
    doc.add_paragraph(filler(60, 60))
    save(doc, "13-page-design")


def f14_report():
    doc = new_doc("Annual Fidelity Report 2026")
    setup_standard_lists(doc)
    add_abstract(doc, 110, DECIMAL_LEVELS)
    add_num(doc, 110, 110)
    s = doc.sections[0]
    hp = s.header.paragraphs[0]
    hp.text = "Annual Fidelity Report 2026"
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    fp = s.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.add_run("Page ")
    field_runs(fp, "PAGE", "1")
    fp.add_run(" of ")
    field_runs(fp, "NUMPAGES", "10")

    doc.add_paragraph("Annual Fidelity Report 2026", style="Title")
    doc.add_paragraph("Prepared for the board of directors", style="Subtitle")
    p = doc.add_paragraph()
    field_runs(p, 'TOC \\o "1-2" \\h \\z \\u', "Update the table of contents.")
    page_break_paragraph(doc)

    notes: dict[int, str] = {}
    fn = [0]

    def para(seed: int, words: int = 90, note: str | None = None):
        p = doc.add_paragraph(filler(words, seed))
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        if note:
            fn[0] += 1
            footnote_ref(p, fn[0])
            notes[fn[0]] = run_xml(note)
        return p

    doc.add_paragraph("Executive Summary", style="Heading 1")
    p = doc.add_paragraph()
    p.add_run("This report summarises ")
    p.add_run("key results").bold = True
    p.add_run(" for the year and highlights ")
    p.add_run("risks and opportunities").italic = True
    p.add_run(".")
    para(101, note="Figures are unaudited.")
    para(102)
    for t in ("Revenue up twelve percent", "Costs held flat", "Customer satisfaction at a record high"):
        list_par(doc, t, 100)
    para(103)

    doc.add_paragraph("Market Overview", style="Heading 1")
    doc.add_paragraph("Regional Performance", style="Heading 2")
    para(104)
    t = doc.add_table(rows=4, cols=4)
    table_borders(t)
    for j, h in enumerate(("Region", "Revenue", "Growth", "Comment")):
        cell_text(t.cell(0, j), h, bold=True, color="FFFFFF")
        shade_cell(t.cell(0, j), "1F4E79")
    repeat_header(t.rows[0])
    rows = [("North", "4.2m", "8%", "Steady"), ("South", "3.1m", "15%", "Fastest growth"), ("East", "2.7m", "5%", "")]
    for i, row in enumerate(rows, start=1):
        for j, v in enumerate(row):
            cell_text(t.cell(i, j), v)
    m = t.cell(2, 3).merge(t.cell(3, 3))
    cell_text(m, "South and East merged comment")
    para(105, note="Growth measured year over year.")
    doc.add_paragraph("Competitive Landscape", style="Heading 2")
    p = doc.add_paragraph()
    float_image(p, png(32, 32, (192, 0, 0)), 120, 120, "Market share chart placeholder", "right")
    p.add_run(filler(120, 106))
    para(107)
    para(108)

    doc.add_paragraph("Financial Results", style="Heading 1")
    para(109)
    doc.add_paragraph("Key steps in the close process:")
    for t in ("Reconcile accounts", "Review accruals", "Approve statements"):
        list_par(doc, t, 110)
    list_par(doc, "Board sign-off", 110, 1)
    doc.add_paragraph("Detailed Figures", style="Heading 2")
    t = doc.add_table(rows=26, cols=3)
    table_borders(t, sz=4, color="999999")
    for j, h in enumerate(("Account", "2025", "2026")):
        cell_text(t.cell(0, j), h, bold=True)
    repeat_header(t.rows[0])
    for i in range(1, 26):
        cell_text(t.cell(i, 0), f"Account {i:02d}")
        cell_text(t.cell(i, 1), f"{1000 + i * 37:,}")
        cell_text(t.cell(i, 2), f"{1100 + i * 41:,}")
    doc.add_paragraph("The margin is computed as:")
    display_equation(doc, f"<m:f><m:num>{m_r('profit')}</m:num><m:den>{m_r('revenue')}</m:den></m:f>")
    para(110, note="Margin excludes one-off items.")

    s2 = doc.add_section(WD_SECTION.NEW_PAGE)
    set_layout(s2, "A4", "landscape", 0.75, 0.75, 0.75, 0.75)
    doc.add_paragraph("Appendix A: Wide Data", style="Heading 1")
    t = doc.add_table(rows=8, cols=8)
    table_borders(t, sz=4)
    for j in range(8):
        cell_text(t.cell(0, j), f"Col {j + 1}", bold=True)
    for i in range(1, 8):
        for j in range(8):
            cell_text(t.cell(i, j), f"{i * j}")
    para(111, 60)

    s3 = doc.add_section(WD_SECTION.NEW_PAGE)
    set_layout(s3, "A4", "portrait", 1, 1, 1, 1)
    doc.add_paragraph("Outlook", style="Heading 1")
    para(112)
    doc.add_paragraph("Success is not final, failure is not fatal.", style="Quote")
    para(113)
    para(114)
    para(115)
    doc.add_paragraph("Risks", style="Heading 2")
    for t in ("Supply chain delays", "Currency movements", "Regulatory change"):
        list_par(doc, t, 100)
    para(116)
    para(117)
    para(118)
    doc.add_paragraph("Opportunities", style="Heading 2")
    for seed in range(121, 127):
        para(seed)
    doc.add_paragraph("Conclusion", style="Heading 1")
    para(119)
    para(120)
    add_footnotes_part(doc, notes)
    save(doc, "14-report")


FIXTURES = [
    f01_basic_formatting,
    f02_styles,
    f02b_styles_localized,
    f03_paragraphs,
    f04_lists,
    f05_tables,
    f06_images,
    f07_sections,
    f08_headers_footers,
    f09_footnotes,
    f10_toc,
    f11_breaks,
    f12_textbox_math,
    f13_page_design,
    f14_report,
]


def main():
    print(f"Writing fixtures to {OUT}")
    for build in FIXTURES:
        build()


if __name__ == "__main__":
    main()
