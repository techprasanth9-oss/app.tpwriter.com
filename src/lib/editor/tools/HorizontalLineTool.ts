import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";

interface HorizontalLineData {
  style: string;
  thickness: number;
  color: string;
  alignment: "left" | "center" | "right";
  length: "full" | "large" | "medium" | "small";
  indentLevel?: number;
}

interface HorizontalLineConfig {
  defaultStyle?: string;
  defaultThickness?: number;
  defaultColor?: string;
  defaultAlignment?: "left" | "center" | "right";
  defaultLength?: "full" | "large" | "medium" | "small";
  preserveBlank?: boolean;
}

export class HorizontalLineTool implements BlockTool {
  private _data: HorizontalLineData;
  private _element: HTMLDivElement;
  private api: API;
  private readOnly: boolean;
  private config: HorizontalLineConfig;
  private _settings: HTMLElement | null;

  static get isInline() {
    return false;
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get toolbox() {
    return {
      // Lucide "SeparatorHorizontal" — centre line + two dashes to
      // signal "divides sections". Clearer than a bare dash alone.
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 8 12 4 16 8"/><polyline points="16 16 12 20 8 16"/></svg>',
      title: "Divider",
    };
  }

  static get sanitize() {
    return {
      style: true,
      thickness: true,
      color: true,
      alignment: true,
      length: true,
      indentLevel: true,
    };
  }

  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = {
      defaultStyle: "solid",
      defaultThickness: 2,
      defaultColor: "#e0e0e0",
      defaultAlignment: "center",
      defaultLength: "full",
      ...config,
    };

    this._data = {
      style: data?.style || this.config.defaultStyle,
      thickness: data?.thickness || this.config.defaultThickness,
      color: data?.color || this.config.defaultColor,
      alignment: data?.alignment || this.config.defaultAlignment,
      length: data?.length || this.config.defaultLength,
      indentLevel: data?.tunes?.indentTune?.indentLevel || 0,
    };

    this._element = this._createLineElement();
    this._settings = null;
  }

  private _createLineElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.classList.add("professional-horizontal-line");
    return element;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("professional-line-settings");

    this._injectSettingsStyles();

    const settingsGrid = document.createElement("div");
    settingsGrid.classList.add("settings-grid");

    const styleSection = this._createCompactSection("Style");
    const styleButtons = document.createElement("div");
    styleButtons.classList.add("compact-button-group");

    const styles = [
      { value: "solid", label: "Solid", icon: "―" },
      { value: "dashed", label: "Dashed", icon: "---" },
      { value: "dotted", label: "Dotted", icon: "•••" },
      { value: "double", label: "Double", icon: "═" },
    ];

    styles.forEach((style) => {
      const button = document.createElement("button");
      button.classList.add("compact-style-button");
      button.type = "button";
      button.dataset.value = style.value;
      button.title = style.label;

      button.innerHTML = `
      <div class="compact-preview ${style.value}" 
           style="border-color: ${this._data.color}; 
                  border-width: ${Math.max(1, this._data.thickness - 1)}px">
      </div>
    `;

      button.classList.toggle("active", this._data.style === style.value);

      button.addEventListener("click", () => {
        this._data.style = style.value;
        this._applyStyles();
        this._updateActiveButton(styleButtons, style.value);
      });

      styleButtons.appendChild(button);
    });

    styleSection.appendChild(styleButtons);
    settingsGrid.appendChild(styleSection);

    const thicknessSection = this._createCompactSection("Thickness");
    const thicknessWrapper = document.createElement("div");
    thicknessWrapper.classList.add("compact-slider-wrapper");

    const thicknessInput = document.createElement("input");
    thicknessInput.type = "range";
    thicknessInput.min = "1";
    thicknessInput.max = "8";
    thicknessInput.value = this._data.thickness.toString();
    thicknessInput.classList.add("compact-slider");
    thicknessInput.title = `${this._data.thickness}px`;

    const thicknessDisplay = document.createElement("div");
    thicknessDisplay.classList.add("compact-value");
    thicknessDisplay.textContent = `${this._data.thickness}px`;

    thicknessInput.addEventListener("input", (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this._data.thickness = value;
      thicknessDisplay.textContent = `${value}px`;
      thicknessInput.title = `${value}px`;
      this._applyStyles();
    });

    thicknessWrapper.appendChild(thicknessInput);
    thicknessWrapper.appendChild(thicknessDisplay);
    thicknessSection.appendChild(thicknessWrapper);
    settingsGrid.appendChild(thicknessSection);

    const colorSection = this._createCompactSection("Color");
    const colorWrapper = document.createElement("div");
    colorWrapper.classList.add("compact-color-wrapper");

    const presetColors = [
      "#e0e0e0",
      "#9e9e9e",
      "#424242",
      "#000000",
      "#f44336",
      "#2196f3",
      "#4caf50",
      "#ff9800",
    ];

    presetColors.forEach((color) => {
      const colorButton = document.createElement("button");
      colorButton.classList.add("compact-color-button");
      colorButton.style.backgroundColor = color;
      colorButton.dataset.color = color;
      colorButton.title = color;

      if (color === this._data.color) {
        colorButton.classList.add("active");
        colorButton.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M8 2.5L4 6.5L2 4.5" stroke="white" stroke-width="1.5"/></svg>';
      }

      colorButton.addEventListener("click", () => {
        this._data.color = color;
        this._applyStyles();
        this._updateColorButtons(colorWrapper, color);
      });

      colorWrapper.appendChild(colorButton);
    });

    const customColorButton = document.createElement("button");
    customColorButton.classList.add("compact-color-custom");
    customColorButton.title = "Custom color";
    customColorButton.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M11.5 2.5L7.5 6.5M1 13L3.5 10.5L10 4L12 2L11.5 1.5L10.5 1L9 2.5L7 4.5L3.5 8L1 10.5V13Z" 
            stroke="currentColor" stroke-width="1.2"/>
    </svg>
  `;

    const customColorInput = document.createElement("input");
    customColorInput.type = "color";
    customColorInput.value = this._data.color;
    customColorInput.classList.add("compact-color-input");
    customColorInput.style.display = "none";

    customColorInput.addEventListener("input", (e) => {
      const color = (e.target as HTMLInputElement).value;
      this._data.color = color;
      this._applyStyles();
      this._updateColorButtons(colorWrapper, color);
    });

    customColorButton.addEventListener("click", () => {
      customColorInput.click();
    });

    colorWrapper.appendChild(customColorButton);
    colorWrapper.appendChild(customColorInput);
    colorSection.appendChild(colorWrapper);
    settingsGrid.appendChild(colorSection);

    const lengthSection = this._createCompactSection("Length");
    const lengthButtons = document.createElement("div");
    lengthButtons.classList.add("compact-button-group");

    const lengths = [
      { value: "full", label: "Full", icon: "▬▬▬" },
      { value: "large", label: "Large", icon: "▬▬" },
      { value: "medium", label: "Medium", icon: "▬" },
      { value: "small", label: "Small", icon: "―" },
    ];

    lengths.forEach((length) => {
      const button = document.createElement("button");
      button.classList.add("compact-length-button");
      button.type = "button";
      button.dataset.value = length.value;
      button.title = length.label;
      button.innerHTML = `<span class="length-icon">${length.icon}</span>`;

      button.classList.toggle("active", this._data.length === length.value);

      button.addEventListener("click", () => {
        this._data.length = length.value;
        this._applyStyles();
        this._updateActiveButton(lengthButtons, length.value);
      });

      lengthButtons.appendChild(button);
    });

    lengthSection.appendChild(lengthButtons);
    settingsGrid.appendChild(lengthSection);

    wrapper.appendChild(settingsGrid);
    this._settings = wrapper;
    return wrapper;
  }

  private _createCompactSection(title: string): HTMLElement {
    const section = document.createElement("div");
    section.classList.add("compact-settings-section");

    const titleEl = document.createElement("div");
    titleEl.classList.add("compact-section-title");
    titleEl.textContent = title;
    titleEl.title = title;

    section.appendChild(titleEl);
    return section;
  }

  private _createSection(title: string): HTMLElement {
    const section = document.createElement("div");
    section.classList.add("settings-section");

    const titleEl = document.createElement("div");
    titleEl.classList.add("section-title");
    titleEl.textContent = title;

    section.appendChild(titleEl);
    return section;
  }

  private _updateActiveButton(container: HTMLElement, value: string): void {
    container.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === value);
    });
  }

  private _updateColorButtons(container: HTMLElement, color: string): void {
    container.querySelectorAll(".color-button").forEach((button) => {
      const isActive = button.dataset.color === color;
      button.classList.toggle("active", isActive);

      if (isActive) {
        button.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.5 8.5L2 6" stroke="white" stroke-width="2"/></svg>';
      } else {
        button.innerHTML = "";
      }
    });

    const customColorInput = container.querySelector(
      ".custom-color-input"
    ) as HTMLInputElement;
    if (customColorInput) {
      customColorInput.value = color;
    }
  }

  private _applyStyles(): void {
    if (this._element) {
      this._element.style.cssText = "";

      this._element.style.borderTop = `${this._data.thickness}px ${this._data.style} ${this._data.color}`;
      this._element.style.textAlign = this._data.alignment;
      this._element.style.paddingLeft = `${(this._data.indentLevel ?? 0) * 20}px`;
      this._element.style.margin = "20px 0";
      this._element.style.height = `${Math.max(2, this._data.thickness)}px`;
      this._element.style.boxSizing = "border-box";

      switch (this._data.length) {
        case "full":
          this._element.style.width = "100%";
          this._element.style.marginLeft = "0";
          this._element.style.marginRight = "0";
          break;
        case "large":
          this._element.style.width = "80%";
          this._element.style.marginLeft =
            this._data.alignment === "center" ? "10%" : "0";
          break;
        case "medium":
          this._element.style.width = "60%";
          this._element.style.marginLeft =
            this._data.alignment === "center" ? "20%" : "0";
          break;
        case "small":
          this._element.style.width = "40%";
          this._element.style.marginLeft =
            this._data.alignment === "center" ? "30%" : "0";
          break;
      }

      if (this._data.style === "double") {
        this._element.style.borderTop = `${this._data.thickness}px double ${this._data.color}`;
        this._element.style.height = `${Math.max(6, this._data.thickness * 2)}px`;
        this._element.style.borderBottom = "none";
      }
    }
  }

  render(): HTMLElement {
    this._applyStyles();
    return this._element;
  }

  save(): HorizontalLineData {
    return {
      style: this._data.style,
      thickness: this._data.thickness,
      color: this._data.color,
      alignment: this._data.alignment,
      length: this._data.length,
      indentLevel: this._data.indentLevel,
    };
  }

  static get pasteConfig() {
    return {
      patterns: {
        horizontalLine: /^([-*_=])\1{2,}\s*$/,
      },
    };
  }

  onPaste(event: any) {
    const content = event.detail.data;
    if (content.text.match(/^([-*_=])\1{2,}\s*$/)) {
      const char = content.text.trim()[0];
      const styleMap: { [key: string]: string } = {
        "*": "dotted",
        "-": "dashed",
        _: "solid",
        "=": "double",
      };
      this._data.style = styleMap[char] || "solid";
      this._applyStyles();
    }
  }

  static get conversionConfig() {
    return {
      export: () => "---",
      import: () => ({
        style: "solid",
        thickness: 2,
        color: "#e0e0e0",
        alignment: "center",
        length: "full",
      }),
    };
  }

  private _injectSettingsStyles(): void {
    if (document.getElementById("compact-line-styles")) return;

    const styles = `
    <style id="compact-line-styles">
      .professional-line-settings {
        padding: 12px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border: 1px solid #e1e5e9;
      }

      .settings-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .compact-settings-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .compact-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }

      .compact-button-group {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }

      .compact-style-button, .compact-length-button {
        width: 32px;
        height: 32px;
        border: 1.5px solid #e0e0e0;
        background: #fff;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .compact-style-button:hover, .compact-length-button:hover {
        border-color: #2196f3;
        background: #f8fdff;
        transform: translateY(-1px);
      }

      .compact-style-button.active, .compact-length-button.active {
        border-color: #2196f3;
        background: #e3f2fd;
        box-shadow: 0 2px 4px rgba(33, 150, 243, 0.2);
      }

      .compact-preview {
        width: 20px;
        height: 2px;
        border-top: 2px solid;
      }

      .compact-preview.dashed {
        border-top-style: dashed;
      }

      .compact-preview.dotted {
        border-top-style: dotted;
      }

      .compact-preview.double {
        border-top-style: double;
        border-top-width: 3px;
        height: 4px;
      }

      .compact-slider-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .compact-slider {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: #e0e0e0;
        outline: none;
        -webkit-appearance: none;
        margin: 0;
      }

      .compact-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #2196f3;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }

      .compact-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #2196f3;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }

      .compact-value {
        font-size: 11px;
        font-weight: 600;
        color: #333;
        min-width: 24px;
        text-align: center;
      }

      .compact-color-wrapper {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 4px;
      }

      .compact-color-button {
        width: 20px;
        height: 20px;
        border: 2px solid #e0e0e0;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        padding: 0;
      }

      .compact-color-button:hover {
        border-color: #999;
        transform: scale(1.1);
      }

      .compact-color-button.active {
        border-color: #2196f3;
        transform: scale(1.1);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .compact-color-custom {
        width: 20px;
        height: 20px;
        border: 2px solid #e0e0e0;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        color: #666;
        transition: all 0.2s ease;
        padding: 0;
      }

      .compact-color-custom:hover {
        border-color: #2196f3;
        color: #2196f3;
        background: #f8fdff;
      }

      .compact-color-input {
        display: none;
      }

      .length-icon {
        font-size: 12px;
        font-weight: bold;
        color: inherit;
      }

      .professional-horizontal-line {
        transition: all 0.3s ease;
      }

      /* Tooltip styles */
      [title] {
        position: relative;
      }

      [title]:hover::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: #333;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        z-index: 1000;
        margin-bottom: 4px;
      }

      [title]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: #333;
        margin-bottom: -4px;
        z-index: 1000;
      }
    </style>
  `;

    document.head.insertAdjacentHTML("beforeend", styles);
  }
}
