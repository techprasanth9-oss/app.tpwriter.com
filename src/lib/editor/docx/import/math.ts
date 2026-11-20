/**
 * Office Math (OMML) → LaTeX. Covers the structures Word's equation editor
 * produces most: runs, fractions, scripts, radicals, n-ary operators,
 * delimiters, functions, accents / bars, limits, matrices, equation
 * arrays, boxes and group characters. Unknown elements fall back to their
 * text and report a warning.
 */

import { attr, child, childrenNamed, kids, tag } from "./xml";

const SYMBOLS: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\epsilon", ζ: "\\zeta",
  η: "\\eta", θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu",
  ν: "\\nu", ξ: "\\xi", π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", σ: "\\sigma", ς: "\\varsigma",
  τ: "\\tau", υ: "\\upsilon", φ: "\\phi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma",
  Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "∞": "\\infty", "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot",
  "⋅": "\\cdot", "∙": "\\cdot", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx",
  "≡": "\\equiv", "∼": "\\sim", "≅": "\\cong", "∝": "\\propto", "→": "\\to", "←": "\\leftarrow",
  "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow",
  "∂": "\\partial", "∇": "\\nabla", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq",
  "⊃": "\\supset", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall",
  "∃": "\\exists", "¬": "\\neg", "∧": "\\wedge", "∨": "\\vee", "…": "\\ldots", "⋯": "\\cdots",
  "°": "^{\\circ}", "′": "'", "ℏ": "\\hbar", "ℓ": "\\ell", "∠": "\\angle", "⊥": "\\perp",
  "∥": "\\parallel", "−": "-", "∗": "*", "⊕": "\\oplus", "⊗": "\\otimes", "≪": "\\ll", "≫": "\\gg",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint",
  "⋃": "\\bigcup", "⋂": "\\bigcap", "√": "\\surd",
};

const NARY: Record<string, string> = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint",
  "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge",
};

const ACCENTS: Record<string, string> = {
  "̂": "\\hat", "̃": "\\tilde", "̄": "\\bar", "̅": "\\overline", "̇": "\\dot",
  "̈": "\\ddot", "⃗": "\\vec", "́": "\\acute", "̀": "\\grave", "̆": "\\breve",
  "̌": "\\check", "^": "\\hat", "~": "\\tilde", "¯": "\\bar",
};

const DELIMS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|",
  "⟨": "\\langle", "⟩": "\\rangle", "〈": "\\langle", "〉": "\\rangle", "⌊": "\\lfloor",
  "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": ".",
};

const FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "coth", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "gcd", "deg",
  "arg", "ker", "Pr",
]);

const LATEX_SPECIAL: Record<string, string> = {
  "\\": "\\backslash ", "{": "\\{", "}": "\\}", "#": "\\#", "%": "\\%", "&": "\\&", $: "\\$",
  _: "\\_",
};

/** m:t text → LaTeX (symbols mapped, specials escaped). */
function textToLatex(s: string, plain: boolean): string {
  let out = "";
  for (const ch of s) {
    if (LATEX_SPECIAL[ch]) out += LATEX_SPECIAL[ch];
    else if (!plain && SYMBOLS[ch]) out += `${SYMBOLS[ch]} `;
    else out += ch;
  }
  return out.replace(/ +$/, "");
}

/** Wrap in braces unless already a single token. */
function group(s: string): string {
  return s.length === 1 ? s : `{${s}}`;
}

function chrOf(prElement: Element | null, name: string, fallback: string): string {
  const el = child(prElement, name);
  if (!el) return fallback;
  return attr(el, "m:val") ?? "";
}

export class OmmlConverter {
  constructor(private warn: (msg: string) => void = () => {}) {}

  /** Convert an m:oMath (or any OMML container) to LaTeX. */
  convert(el: Element): string {
    return this.seq(el).trim().replace(/\s{2,}/g, " ");
  }

  private seq(el: Element | null): string {
    if (!el) return "";
    let out = "";
    for (const c of kids(el)) {
      const piece = this.node(c);
      // Keep a space between a command and following letters (\alpha x).
      if (piece && /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(piece)) out += " ";
      out += piece;
    }
    return out;
  }

  private arg(el: Element | null, name: string): string {
    return this.seq(child(el, name));
  }

  private node(el: Element): string {
    const t = tag(el);
    switch (t) {
      case "m:r": {
        const rPr = child(el, "m:rPr");
        const plain = !!child(rPr, "m:nor");
        const text = childrenNamed(el, "m:t").map((x) => x.textContent ?? "").join("");
        const sty = attr(child(rPr, "m:sty"), "m:val");
        const latex = textToLatex(text, plain);
        if (plain && text) return `\\text{${latex}}`;
        if (sty === "p" && /^[A-Za-z]{2,}$/.test(text)) return FUNCS.has(text) ? `\\${text}` : `\\mathrm{${text}}`;
        if (sty === "b") return `\\mathbf{${latex}}`;
        return latex;
      }
      case "m:oMath":
      case "m:e":
      case "m:num":
      case "m:den":
      case "m:sub":
      case "m:sup":
      case "m:deg":
      case "m:lim":
      case "m:fName":
        return this.seq(el);
      case "m:f": {
        const type = attr(child(child(el, "m:fPr"), "m:type"), "m:val");
        const num = this.arg(el, "m:num");
        const den = this.arg(el, "m:den");
        if (type === "lin") return `${group(num)}/${group(den)}`;
        if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
        if (type === "skw") return `{}^{${num}}/_{${den}}`;
        return `\\frac{${num}}{${den}}`;
      }
      case "m:sSup":
        return `${group(this.arg(el, "m:e"))}^{${this.arg(el, "m:sup")}}`;
      case "m:sSub":
        return `${group(this.arg(el, "m:e"))}_{${this.arg(el, "m:sub")}}`;
      case "m:sSubSup":
        return `${group(this.arg(el, "m:e"))}_{${this.arg(el, "m:sub")}}^{${this.arg(el, "m:sup")}}`;
      case "m:sPre":
        return `{}_{${this.arg(el, "m:sub")}}^{${this.arg(el, "m:sup")}}${group(this.arg(el, "m:e"))}`;
      case "m:rad": {
        const pr = child(el, "m:radPr");
        const hide = attr(child(pr, "m:degHide"), "m:val");
        const deg = this.arg(el, "m:deg");
        const e = this.arg(el, "m:e");
        return deg && hide !== "1" && hide !== "on" ? `\\sqrt[${deg}]{${e}}` : `\\sqrt{${e}}`;
      }
      case "m:nary": {
        const pr = child(el, "m:naryPr");
        const chr = chrOf(pr, "m:chr", "∫");
        const op = NARY[chr] ?? (chr ? textToLatex(chr, false) : "\\int");
        const subHide = attr(child(pr, "m:subHide"), "m:val");
        const supHide = attr(child(pr, "m:supHide"), "m:val");
        const sub = subHide === "1" || subHide === "on" ? "" : this.arg(el, "m:sub");
        const sup = supHide === "1" || supHide === "on" ? "" : this.arg(el, "m:sup");
        const limits = attr(child(pr, "m:limLoc"), "m:val") === "undOvr" && op.includes("int") ? "\\limits" : "";
        return `${op}${limits}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${this.arg(el, "m:e")}`;
      }
      case "m:d": {
        const pr = child(el, "m:dPr");
        const beg = chrOf(pr, "m:begChr", "(");
        const end = chrOf(pr, "m:endChr", ")");
        const sep = chrOf(pr, "m:sepChr", "|");
        const sepTex = sep === "|" ? "\\mid " : textToLatex(sep, false);
        const parts = childrenNamed(el, "m:e").map((e) => this.seq(e));
        const l = DELIMS[beg] ?? textToLatex(beg, false);
        const r = DELIMS[end] ?? textToLatex(end, false);
        return `\\left${l}${parts.join(sepTex)}\\right${r}`;
      }
      case "m:func": {
        const name = this.arg(el, "m:fName").trim();
        const fn = FUNCS.has(name) ? `\\${name}` : /^\\[a-z]+/.test(name) ? name : `\\operatorname{${name}}`;
        return `${fn}{${this.arg(el, "m:e")}}`;
      }
      case "m:acc": {
        const chr = chrOf(child(el, "m:accPr"), "m:chr", "̂");
        const cmd = ACCENTS[chr] ?? "\\hat";
        return `${cmd}{${this.arg(el, "m:e")}}`;
      }
      case "m:bar": {
        const pos = attr(child(child(el, "m:barPr"), "m:pos"), "m:val");
        return `${pos === "bot" ? "\\underline" : "\\overline"}{${this.arg(el, "m:e")}}`;
      }
      case "m:limLow":
        return `${this.limBase(el)}_{${this.arg(el, "m:lim")}}`;
      case "m:limUpp":
        return `${this.limBase(el)}^{${this.arg(el, "m:lim")}}`;
      case "m:groupChr": {
        const pr = child(el, "m:groupChrPr");
        const chr = chrOf(pr, "m:chr", "⏟");
        const top = attr(child(pr, "m:pos"), "m:val") === "top";
        const e = this.arg(el, "m:e");
        if (chr === "⏟" || chr === "⏞") return `${top || chr === "⏞" ? "\\overbrace" : "\\underbrace"}{${e}}`;
        return `\\${top ? "overset" : "underset"}{${textToLatex(chr, false)}}{${e}}`;
      }
      case "m:m": {
        const rows = childrenNamed(el, "m:mr").map((r) =>
          childrenNamed(r, "m:e").map((e) => this.seq(e)).join(" & "),
        );
        return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
      }
      case "m:eqArr": {
        const rows = childrenNamed(el, "m:e").map((e) => this.seq(e));
        return `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`;
      }
      case "m:box":
        return this.arg(el, "m:e");
      case "m:borderBox":
        return `\\boxed{${this.arg(el, "m:e")}}`;
      case "m:phant":
        return `\\phantom{${this.arg(el, "m:e")}}`;
      case "m:oMathParaPr":
      case "m:ctrlPr":
      case "m:rPr":
      case "m:argPr":
      case "w:rPr":
      case "w:bookmarkStart":
      case "w:bookmarkEnd":
      case "w:proofErr":
        return "";
      case "w:r":
        // Plain Word runs inside math.
        return textToLatex(childrenNamed(el, "w:t").map((x) => x.textContent ?? "").join(""), true);
      default:
        if (t.endsWith("Pr")) return "";
        this.warn(`Equation element "${t}" is not supported; its text was kept.`);
        return textToLatex(el.textContent ?? "", false);
    }
  }

  private limBase(el: Element): string {
    const e = this.arg(el, "m:e").trim();
    if (FUNCS.has(e)) return `\\${e}`;
    if (/^\\(lim|max|min|sup|inf)$/.test(e)) return e;
    return group(e);
  }
}

export function ommlToLatex(el: Element, warn?: (msg: string) => void): string {
  return new OmmlConverter(warn).convert(el);
}
