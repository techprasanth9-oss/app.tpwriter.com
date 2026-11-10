import { ApiError, apiUrl } from "./client";

export interface UploadedImage {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

/**
 * Upload an image to the API. Returns a URL the browser can load directly:
 * the API answers with a server-relative `/uploads/...` path, which is
 * resolved against the configured API base (VITE_API_URL or the `/api`
 * dev proxy).
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl("/uploads"), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let code = "upload_failed";
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === "string") code = data.error;
    } catch {
      /* body not JSON */
    }
    throw new ApiError(res.status, code);
  }
  const data = (await res.json()) as UploadedImage;
  return { ...data, url: data.url.startsWith("/") ? apiUrl(data.url) : data.url };
}
