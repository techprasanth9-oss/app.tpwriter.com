// @ts-ignore no type declarations shipped
import Delimiter from "@editorjs/delimiter";
// @ts-ignore
import InlineCode from "@editorjs/inline-code";
// @ts-ignore
import Marker from "@editorjs/marker";
import { HeaderTool } from "./tools/HeaderTool";
import { AlignmentTune } from "./tools/AlignmentTune";
import { IndentTune } from "./tools/IndentTune";
import { HorizontalLineTool } from "./tools/HorizontalLineTool";
import {
  BoldTool,
  ItalicTool,
  UnderlineTool,
  StrikeTool,
  SuperscriptTool,
  SubscriptTool,
} from "./tools/FormatTools";
import { TextColorTool } from "./tools/TextStyleTools";
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
    "textColor",
    "marker",
    "inlineCode",
    "variable",
  ];
  const sharedTunes = ["alignment", "indent"];

  return {
    header: {
      class: HeaderTool as unknown as object,
      inlineToolbar,
      config: { levels: [1, 2, 3, 4], defaultLevel: 2 },
      tunes: sharedTunes,
    },
    paragraph: {
      class: ParagraphTool as unknown as object,
      inlineToolbar,
      tunes: sharedTunes,
    },
    list: {
      class: ListTool as unknown as object,
      inlineToolbar,
      config: { defaultStyle: "unordered" },
      tunes: sharedTunes,
    },
    table: {
      class: TableTool as unknown as object,
      inlineToolbar,
      tunes: ["alignment"],
    },
    image: {
      class: ImageTool as unknown as object,
      config: { uploader: opts.imageUploader } satisfies ImageToolConfig,
      tunes: ["alignment"],
    },
    column: {
      class: ColumnTool as unknown as object,
      inlineToolbar: true,
    },
    horizontalLine: {
      class: HorizontalLineTool as unknown as object,
      tunes: ["alignment"],
    },
    delimiter: { class: Delimiter as unknown as object },
    inlineCode: { class: InlineCode as unknown as object },
    marker: { class: Marker as unknown as object },
    bold: { class: BoldTool as unknown as object },
    italic: { class: ItalicTool as unknown as object },
    underline: { class: UnderlineTool as unknown as object },
    strike: { class: StrikeTool as unknown as object },
    superscript: { class: SuperscriptTool as unknown as object },
    subscript: { class: SubscriptTool as unknown as object },
    textColor: { class: TextColorTool as unknown as object },
    variable: {
      class: VariableTool as unknown as object,
      config: { availableVariables: opts.variables ?? [] },
    },
    alignment: { class: AlignmentTune as unknown as object },
    indent: { class: IndentTune as unknown as object },
  };
}
