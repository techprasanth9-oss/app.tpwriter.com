// @ts-ignore no type declarations shipped
import InlineCode from "@editorjs/inline-code";
import { HeaderTool } from "./tools/HeaderTool";
import { AlignmentTune } from "./tools/AlignmentTune";
import { ParagraphFormatTune } from "./tools/ParagraphFormatTune";
import { PageBreakTool } from "./tools/PageBreakTool";
import { SectionBreakTool } from "./tools/SectionBreakTool";
import { TocTool } from "./tools/TocTool";
import { FORMAT_TUNE } from "./format/paragraphFormat";
import { HorizontalLineTool } from "./tools/HorizontalLineTool";
import {
  BoldTool,
  ItalicTool,
  UnderlineTool,
  StrikeTool,
  SuperscriptTool,
  SubscriptTool,
} from "./tools/FormatTools";
import { VariableTool } from "./tools/VariableTool";
import ImageTool, { type ImageToolConfig } from "./tools/ImageTool";
import TableTool from "./tools/TableTool";
import ColumnTool from "./tools/ColumnTool";
import { ParagraphTool } from "./tools/ParagraphTool";
import { ListTool } from "./tools/ListTool";
import { EquationTool } from "./tools/EquationTool";
import { TextBoxTool } from "./tools/TextBoxTool";
import { ChartTool } from "./tools/ChartTool";

export interface BaseToolsOptions {
  imageUploader?: ImageToolConfig["uploader"];
  variables?: Array<{ name: string; label: string }>;
}

export type EditorToolConfig = Record<string, unknown>;

export function configureBaseTools(
  opts: BaseToolsOptions = {},
): EditorToolConfig {
  const inlineToolbar = [
    "bold",
    "italic",
    "underline",
    "strike",
    "inlineCode",
    "variable",
  ];
  // Text blocks share one paragraph-format tune (alignment, indent,
  // spacing, named style). Tables / images / lines keep the old alignment
  // tune — it positions the object, which is a different job.
  const textTunes = [FORMAT_TUNE];
  const objectTunes = ["alignment"];

  const tools: EditorToolConfig = {
    header: {
      class: HeaderTool as unknown as object,
      inlineToolbar,
      config: { levels: [1, 2, 3, 4], defaultLevel: 2, preserveBlank: true },
      tunes: textTunes,
    },
    paragraph: {
      class: ParagraphTool as unknown as object,
      inlineToolbar,
      config: { preserveBlank: true },
      tunes: textTunes,
    },
    list: {
      class: ListTool as unknown as object,
      inlineToolbar,
      config: { defaultStyle: "unordered" },
      tunes: textTunes,
    },
    table: {
      class: TableTool as unknown as object,
      inlineToolbar,
      tunes: objectTunes,
    },
    image: {
      class: ImageTool as unknown as object,
      config: { uploader: opts.imageUploader } satisfies ImageToolConfig,
      tunes: objectTunes,
    },
    column: {
      class: ColumnTool as unknown as object,
      inlineToolbar: true,
    },
    horizontalLine: {
      class: HorizontalLineTool as unknown as object,
      tunes: objectTunes,
    },
    pageBreak: { class: PageBreakTool as unknown as object },
    sectionBreak: { class: SectionBreakTool as unknown as object },
    toc: { class: TocTool as unknown as object },
    equation: { class: EquationTool as unknown as object },
    textBox: {
      class: TextBoxTool as unknown as object,
      inlineToolbar: true,
    },
    chart: { class: ChartTool as unknown as object },
    inlineCode: { class: InlineCode as unknown as object },
    bold: { class: BoldTool as unknown as object },
    italic: { class: ItalicTool as unknown as object },
    underline: { class: UnderlineTool as unknown as object },
    strike: { class: StrikeTool as unknown as object },
    superscript: { class: SuperscriptTool as unknown as object },
    subscript: { class: SubscriptTool as unknown as object },
    variable: {
      class: VariableTool as unknown as object,
      config: { availableVariables: opts.variables ?? [] },
    },
    alignment: { class: AlignmentTune as unknown as object },
    [FORMAT_TUNE]: { class: ParagraphFormatTune as unknown as object },
  };

  // Columns' nested editors get the same tools, minus the ones that only
  // make sense at document level (without this they only had a bare
  // paragraph, and stored headers / lists / tables showed as stubs).
  const nested: EditorToolConfig = { ...tools };
  for (const name of COLUMN_EXCLUDED_TOOLS) delete nested[name];
  tools.column = {
    class: ColumnTool as unknown as object,
    inlineToolbar: true,
    config: { tools: nested },
  };
  return tools;
}

const COLUMN_EXCLUDED_TOOLS = ["column", "pageBreak", "sectionBreak", "toc"];
