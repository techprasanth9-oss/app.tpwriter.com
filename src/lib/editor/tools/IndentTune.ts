
import { API, BlockAPI, BlockTune } from "@editorjs/editorjs";

interface IndentTuneData {
  indentLevel: number;
}

interface ConstructorParams {
  api: API;
  data: IndentTuneData;
  block: BlockAPI;
  config?: {
    maxIndent?: number;
    step?: number;
  };
}

export class IndentTune implements BlockTune {
  static get isTune(): boolean {
    return true;
  }

  private api: API;
  private block: BlockAPI;
  private data: IndentTuneData;
  private maxIndent: number;
  private step: number;

  constructor({ api, data, block, config = {} }: ConstructorParams) {
    this.api = api;
    this.block = block;
    this.maxIndent = config.maxIndent || 5;
    this.step = config.step || 40;
    this.data = {
      indentLevel: data?.indentLevel || 0,
    };

    setTimeout(() => {
      this.applyIndent(this.data.indentLevel);
    }, 100);
  }

  public render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "indent-tune";
    wrapper.style.display = "flex";
    wrapper.style.gap = "4px";
    wrapper.style.padding = "4px";
    wrapper.style.alignItems = "center";

    // Decrease Indent Button
    const decreaseButton = this.createButton({
      icon: "↶",
      title: "Decrease indent",
      disabled: this.data.indentLevel === 0,
      onClick: () => this.changeIndent(-1),
    });

    // Indent Level Display
    const levelDisplay = document.createElement("div");
    levelDisplay.className = "indent-level-display";
    levelDisplay.textContent = `${this.data.indentLevel}`;
    levelDisplay.style.minWidth = "10px";
    levelDisplay.style.textAlign = "center";
    levelDisplay.style.fontSize = "12px";
    levelDisplay.style.fontWeight = "600";
    levelDisplay.style.color = "#388ae5";

    // Increase Indent Button
    const increaseButton = this.createButton({
      icon: "↷",
      title: "Increase indent",
      disabled: this.data.indentLevel >= this.maxIndent,
      onClick: () => this.changeIndent(1),
    });

    wrapper.appendChild(decreaseButton);
    wrapper.appendChild(levelDisplay);
    wrapper.appendChild(increaseButton);

    return wrapper;
  }

  private createButton({
    icon,
    title,
    disabled,
    onClick,
  }: {
    icon: string;
    title: string;
    disabled: boolean;
    onClick: () => void;
  }): HTMLButtonElement {
    const button = document.createElement("button");
    button.innerHTML = icon;
    button.title = title;
    button.classList.add("indent-button");

    // Base styles
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.width = "28px";
    button.style.height = "28px";
    button.style.border = "1px solid #e6e9eb";
    button.style.borderRadius = "4px";
    button.style.background = "white";
    button.style.cursor = disabled ? "not-allowed" : "pointer";
    button.style.fontSize = "14px";
    button.style.fontWeight = "bold";
    button.style.transition = "all 0.2s ease";
    button.style.opacity = disabled ? "0.5" : "1";

    if (disabled) {
      button.style.background = "#f8f9fa";
      button.style.color = "#6c757d";
    } else {
      button.style.color = "#388ae5";

      button.addEventListener("mouseenter", () => {
        button.style.background = "#388ae5";
        button.style.color = "white";
        button.style.borderColor = "#388ae5";
        button.style.transform = "scale(1.05)";
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = "white";
        button.style.color = "#388ae5";
        button.style.borderColor = "#e6e9eb";
        button.style.transform = "scale(1)";
      });
    }

    if (!disabled) {
      button.addEventListener("click", onClick);
    }

    return button;
  }

  private changeIndent(direction: number): void {
    const newLevel = this.data.indentLevel + direction;

    if (newLevel >= 0 && newLevel <= this.maxIndent) {
      this.data.indentLevel = newLevel;
      this.applyIndent(newLevel);
      // EditorJS doesn't expose a public tunes.update() — just signal the
      // block changed so persistence picks it up on the next save.
      this.block.dispatchChange();
    }
  }

  public save(): IndentTuneData {
    return {
      indentLevel: this.data.indentLevel,
    };
  }

  private applyIndent(level: number): void {
    const blockElement = this.block.holder as HTMLElement;
    if (!blockElement) return;

    const contentElement = blockElement.querySelector(
      ".ce-block__content"
    ) as HTMLElement;
    if (contentElement) {
      contentElement.style.marginLeft = `${level * this.step}px`;
      contentElement.style.transition = "margin-left 0.2s ease";
    }

    blockElement.setAttribute("data-indent-level", level.toString());
  }

  public wrap(blockContent: HTMLElement): HTMLElement {
    setTimeout(() => {
      this.applyIndent(this.data.indentLevel);
    }, 50);

    return blockContent;
  }
}
