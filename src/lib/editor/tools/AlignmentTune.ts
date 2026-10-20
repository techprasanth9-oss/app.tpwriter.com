import type { API, BlockAPI, BlockTune } from "@editorjs/editorjs";

type AlignmentOption = "left" | "center" | "right" | "justify";

interface AlignmentTuneData {
  alignment: AlignmentOption;
}

interface ConstructorParams {
  api: API;
  data: AlignmentTuneData;
  block: BlockAPI;
}

export class AlignmentTune implements BlockTune {
  static get isTune(): boolean {
    return true;
  }

  private api: API;
  private block: BlockAPI;
  private data: AlignmentTuneData;

  private settings = [
    { name: "left" as AlignmentOption, icon: "⬅", label: "Align left" },
    { name: "center" as AlignmentOption, icon: "⫯", label: "Align center" },
    { name: "right" as AlignmentOption, icon: "➡", label: "Align right" },
    { name: "justify" as AlignmentOption, icon: "☰", label: "Justify" },
  ];

  constructor({ api, data, block }: ConstructorParams) {
    this.api = api;
    this.block = block;
    const isHeaderBlock = block.name === "header" || block.name === "delimiter";
    this.data = {
      alignment: data?.alignment || (isHeaderBlock ? "center" : "left"),
    };

    setTimeout(() => {
      this.applyAlignment(this.data.alignment);
    }, 100);
  }

  public render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "alignment-tune";
    wrapper.style.display = "flex";
    wrapper.style.gap = "4px";
    wrapper.style.padding = "4px";

    this.settings.forEach((setting) => {
      const button = document.createElement("button");
      button.innerHTML = setting.icon;
      button.title = setting.label;
      button.classList.add("alignment-button");
      button.style.display = "flex";
      button.style.alignItems = "center";
      button.style.justifyContent = "center";
      button.style.width = "32px";
      button.style.height = "32px";
      button.style.border = "1px solid #e6e9eb";
      button.style.borderRadius = "4px";
      button.style.background = "white";
      button.style.cursor = "pointer";
      button.style.fontSize = "14px";
      button.style.transition = "all 0.2s ease";

      if (this.data.alignment === setting.name) {
        button.style.background = "#388ae5";
        button.style.color = "white";
        button.style.borderColor = "#388ae5";
      }

      button.addEventListener("click", () => {
        this.data.alignment = setting.name;
        this.applyAlignment(setting.name);
        this.highlightSelected(wrapper, setting.name);
        this.block.dispatchChange();
      });

      wrapper.appendChild(button);
    });

    return wrapper;
  }

  public save(): AlignmentTuneData {
    return { alignment: this.data.alignment };
  }

  private applyAlignment(alignment: AlignmentOption): void {
    const blockElement = this.block.holder as HTMLElement | undefined;
    if (!blockElement) return;

    const selectors = [
      ".ce-block__content",
      ".ce-header",
      ".cdx-paragraph",
      ".ce-list",
      ".ce-list__item",
      ".ce-quote",
      ".professional-horizontal-line",
    ];

    let el: HTMLElement | null = null;
    for (const sel of selectors) {
      el = blockElement.querySelector(sel);
      if (el) break;
    }
    (el ?? blockElement).style.textAlign = alignment;

    const children = blockElement.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, div[class*="ce"]',
    );
    children.forEach((c) => {
      const e = c as HTMLElement;
      if (e.style.textAlign !== alignment) e.style.textAlign = alignment;
    });
  }

  private highlightSelected(
    wrapper: HTMLElement,
    selected: AlignmentOption,
  ): void {
    Array.from(wrapper.children).forEach((buttonElement) => {
      const button = buttonElement as HTMLButtonElement;
      const buttonAlignment = this.settings.find((setting) =>
        button.title.toLowerCase().includes(setting.name.toLowerCase()),
      )?.name;
      if (buttonAlignment === selected) {
        button.style.background = "#388ae5";
        button.style.color = "white";
        button.style.borderColor = "#388ae5";
      } else {
        button.style.background = "white";
        button.style.color = "inherit";
        button.style.borderColor = "#e6e9eb";
      }
    });
  }
}
