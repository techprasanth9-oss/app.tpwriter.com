/**
 * Imported DOCX images arrive as embedded `data:` URLs. Before they land in
 * the document, upload each distinct one and swap in the server URL — so
 * the document stays small and images load like any other upload.
 * Failures keep the embedded image (it still renders) and are reported.
 */

export type Uploader = (file: File) => Promise<{ url: string }>;

const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,/i;

/** Deep-replace every `data:image/…` string in `value`. */
export async function uploadEmbeddedImages<T>(
  value: T,
  upload: Uploader,
  options: { concurrency?: number } = {},
): Promise<{ value: T; uploaded: number; failed: number }> {
  const found = new Set<string>();
  collect(value, found);
  if (found.size === 0) return { value, uploaded: 0, failed: 0 };

  const replacements = new Map<string, string>();
  let failed = 0;
  const queue = [...found];
  const workers = Array.from({ length: Math.min(options.concurrency ?? 3, queue.length) }, async () => {
    for (let dataUrl = queue.shift(); dataUrl; dataUrl = queue.shift()) {
      try {
        const { url } = await upload(dataUrlToFile(dataUrl, replacements.size));
        replacements.set(dataUrl, url);
      } catch {
        failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return { value: replace(value, replacements) as T, uploaded: replacements.size, failed };
}

function collect(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (DATA_IMAGE.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collect(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collect(v, out));
  }
}

function replace(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replace(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v, map)]));
  }
  return value;
}

export function dataUrlToFile(dataUrl: string, index: number): File {
  const mime = DATA_IMAGE.exec(dataUrl)?.[1]?.toLowerCase() ?? "application/octet-stream";
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
  return new File([bytes], `imported-${index + 1}.${ext}`, { type: mime });
}
