// @ts-ignore no type declarations shipped
import InlineCode from "@editorjs/inline-code";
import { HeaderTool } from "./tools/HeaderTool";
import { AlignmentTune } from "./tools/AlignmentTune";
import { ParagraphFormatTune } from "./tools/ParagraphFormatTune";
import { PageBreakTool } from "./tools/PageBreakTool";
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

  return {
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
}
