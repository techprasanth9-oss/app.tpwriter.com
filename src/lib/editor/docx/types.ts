/** Block / document shapes the DOCX exporter accepts (ids optional, unlike
 *  stored API blocks). */
export interface EditorBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

export interface EditorOutput {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}
