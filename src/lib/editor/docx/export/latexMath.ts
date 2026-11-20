/**
 * LaTeX → Office Math (OMML via the `docx` package's Math components), for
 * the subset people actually type in documents: fractions, super/subscripts,
 * roots, sums / products / integrals with limits, \left…\right brackets,
 * \text{}, Greek letters and common operators. Anything outside the subset
 * is kept as literal math text, so nothing is ever lost — Word just shows
 * that part linearly.
 */
import {
  MathCurlyBrackets,
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  type MathComponent,
} from "docx";

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  varpi: "ϖ", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠",
  ne: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞", partial: "∂", nabla: "∇",
  to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", cup: "∪", cap: "∩", forall: "∀",
  exists: "∃", ldots: "…", cdots: "⋯", dots: "…", degree: "°", circ: "∘", lt: "<", gt: ">",
  ",": " ", ";": " ", ":": " ", quad: " ", qquad: "  ", "{": "{", "}": "}", "%": "%", "$": "$", "&": "&",
  "#": "#", "_": "_", "|": "‖",
};

const FUNCTIONS = new Set(["sin", "cos", "tan", "log", "ln", "exp", "lim", "max", "min", "det", "sec", "csc", "cot"]);

type Token = { kind: "cmd"; name: string } | { kind: "char"; ch: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < src.length; ) {
    const ch = src[i]!;
    if (ch === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) break;
      out.push({ kind: "cmd", name: m[1]! });
      i += m[0].length;
    } else {
      out.push({ kind: "char", ch });
      i += 1;
    }
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isChar(ch: string): boolean {
    const t = this.peek();
    return t?.kind === "char" && t.ch === ch;
  }

  /** A sequence until `}` / `\right` / end. */
  sequence(): MathComponent[] {
    const out: MathComponent[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push(new MathRun(text));
      text = "";
    };
    while (this.pos < this.tokens.length) {
      const t = this.peek()!;
      if (t.kind === "char" && t.ch === "}") break;
      if (t.kind === "cmd" && t.name === "right") break;
      if (t.kind === "char" && (t.ch === "^" || t.ch === "_")) {
        // Script on the previous atom (or on the last character of a run).
        flush();
        const base = out.pop() ?? new MathRun("");
        out.push(this.scripts([base]));
        continue;
      }
      if (t.kind === "char" && t.ch === " ") {
        this.pos++;
        continue;
      }
      const atom = this.atom();
      if (atom === null) continue;
      if (typeof atom === "string") {
        text += atom;
        // Keep a single character separate when a script may follow it.
        const next = this.peek();
        if (next?.kind === "char" && (next.ch === "^" || next.ch === "_")) {
          const last = text.slice(-1);
          text = text.slice(0, -1);
          flush();
          text = last;
          flush();
        }
      } else {
        flush();
        out.push(...atom);
      }
    }
    flush();
    return out;
  }

  private group(): MathComponent[] {
    if (this.isChar("{")) {
      this.pos++;
      const inner = this.sequence();
      if (this.isChar("}")) this.pos++;
      return inner;
    }
    const atom = this.atom();
    if (atom === null) return [];
    return typeof atom === "string" ? [new MathRun(atom)] : atom;
  }

  /** `^…` / `_…` after a base, in either order. */
  private scripts(base: MathComponent[]): MathComponent {
    let sub: MathComponent[] | undefined;
    let sup: MathComponent[] | undefined;
    while (this.isChar("^") || this.isChar("_")) {
      const which = (this.peek() as { ch: string }).ch;
      this.pos++;
      if (which === "^") sup = this.group();
      else sub = this.group();
    }
    if (sub && sup) return new MathSubSuperScript({ children: base, subScript: sub, superScript: sup });
    if (sup) return new MathSuperScript({ children: base, superScript: sup });
    return new MathSubScript({ children: base, subScript: sub ?? [] });
  }

  /** A string (plain text to merge into a run), components, or null. */
  private atom(): string | MathComponent[] | null {
    const t = this.tokens[this.pos++];
    if (!t) return null;
    if (t.kind === "char") {
      if (t.ch === "{") {
        const inner = this.sequence();
        if (this.isChar("}")) this.pos++;
        return inner;
      }
      return t.ch;
    }
    const name = t.name;
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
        return [new MathFraction({ numerator: this.group(), denominator: this.group() })];
      case "sqrt": {
        let degree: MathComponent[] | undefined;
        if (this.isChar("[")) {
          this.pos++;
          const start = this.pos;
          while (this.pos < this.tokens.length && !this.isChar("]")) this.pos++;
          degree = new Parser(this.tokens.slice(start, this.pos)).sequence();
          this.pos++;
        }
        return [new MathRadical({ children: this.group(), ...(degree ? { degree } : {}) })];
      }
      case "sum":
      case "prod":
      case "int":
      case "iint":
      case "oint": {
        let sub: MathComponent[] | undefined;
        let sup: MathComponent[] | undefined;
        while (this.isChar("_") || this.isChar("^")) {
          const which = (this.peek() as { ch: string }).ch;
          this.pos++;
          if (which === "_") sub = this.group();
          else sup = this.group();
        }
        const body = this.group();
        const limits = { ...(sub ? { subScript: sub } : {}), ...(sup ? { superScript: sup } : {}) };
        if (name === "sum") return [new MathSum({ children: body, ...limits })];
        if (name === "int") return [new MathIntegral({ children: body, ...limits })];
        // ∏, ∬, ∮ have no dedicated component: symbol + scripts.
        const symbol = name === "prod" ? "∏" : name === "iint" ? "∬" : "∮";
        const base = [new MathRun(symbol)];
        const op =
          sub && sup
            ? new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })
            : sub
              ? new MathSubScript({ children: base, subScript: sub })
              : sup
                ? new MathSuperScript({ children: base, superScript: sup })
                : base[0]!;
        return [op, ...body];
      }
      case "left": {
        const open = this.tokens[this.pos++];
        const inner = this.sequence();
        if (this.peek()?.kind === "cmd") this.pos++; // \right
        this.pos++; // its delimiter
        const o = open?.kind === "char" ? open.ch : open?.kind === "cmd" ? open.name : "(";
        if (o === "[") return [new MathSquareBrackets({ children: inner })];
        if (o === "{") return [new MathCurlyBrackets({ children: inner })];
        if (o === "(") return [new MathRoundBrackets({ children: inner })];
        return [new MathRun(o === "." ? "" : o), ...inner];
      }
      case "text":
      case "mathrm":
      case "textrm":
      case "operatorname":
      case "mathbf":
      case "mathit": {
        const inner = this.rawGroup();
        return [new MathRun(inner)];
      }
      default:
        if (FUNCTIONS.has(name)) return name;
        if (name in SYMBOLS) return SYMBOLS[name]!;
        // Unknown command: keep it literally so nothing is lost.
        return `\\${name}`;
    }
  }

  /** The literal text of a `{…}` group (for \text). */
  private rawGroup(): string {
    if (!this.isChar("{")) return "";
    this.pos++;
    let depth = 1;
    let text = "";
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos++]!;
      if (t.kind === "char" && t.ch === "{") depth++;
      if (t.kind === "char" && t.ch === "}" && --depth === 0) break;
      text += t.kind === "char" ? t.ch : SYMBOLS[t.name] ?? `\\${t.name}`;
    }
    return text;
  }
}

/** Convert LaTeX to Office Math components. Never throws. */
export function latexToMath(latex: string): MathComponent[] {
  const source = latex.trim();
  if (!source) return [];
  try {
    const parsed = new Parser(tokenize(source)).sequence();
    return parsed.length > 0 ? parsed : [new MathRun(source)];
  } catch {
    return [new MathRun(source)];
  }
}
