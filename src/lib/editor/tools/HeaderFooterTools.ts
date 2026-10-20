import { configureBaseTools } from "../tools";

/**
 * Configure the EditorJS tools map used by the header and footer sub-editors.
 *
 * Same base-tools set as the body editor, but with image upload disabled:
 * header/footer regions in a DOCX render inside tiny frames and we don't want
 * users dropping full-page images in there. Forwarding `imageUploader: undefined`
 * to `configureBaseTools` makes the Image tool skip registration.
 */
export function configureHeaderFooterTools(
  params: Parameters<typeof configureBaseTools>[0],
) {
  return configureBaseTools({
    ...params,
    imageUploader: undefined,
  });
}
