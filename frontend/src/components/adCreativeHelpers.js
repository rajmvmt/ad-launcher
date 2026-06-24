// Pure helpers for AdCreativeStep. Kept side-effect-free so they can be unit-tested
// in isolation without mounting the React component.

/**
 * Expand a list of existing post IDs into the `creatives` array shape consumed
 * by the batch publish endpoint.
 *
 * @param {string[]} ids        - post IDs in user-pasted order (already deduped/trimmed by caller if desired)
 * @param {number}   copies     - copies per ID, integer 1..25 (clamped here defensively)
 * @param {object}   opts
 * @param {number}   opts.ts            - timestamp seed for unique React keys
 * @param {object}   opts.previewById   - { [postId]: { thumbnail, message, ... } }
 * @param {string}   opts.creativeName  - the user-entered creative name (used as ad name base)
 * @param {string}   opts.fallbackThumbnail - prev.existingPostThumbnail
 * @returns {Array<object>} creatives ready to stash in creativeData.creatives
 */
export function expandExistingPostCreatives(ids, copies, opts) {
    const { ts, previewById, creativeName, fallbackThumbnail } = opts;
    const safeCopies = Math.max(1, Math.min(25, parseInt(copies, 10) || 1));
    const multi = ids.length > 1;

    return ids.flatMap((postId, idx) => {
        const preview = previewById[postId] || {};
        return Array.from({ length: safeCopies }, (_, copyIdx) => {
            const baseName = multi ? `${creativeName} #${idx + 1}` : creativeName;
            const name = safeCopies > 1
                ? `${baseName} (copy ${copyIdx + 1}/${safeCopies})`
                : baseName;
            return {
                id: `existing-post-${ts}-${idx}-c${copyIdx}`,
                name,
                mediaType: 'existing',
                existing_post_id: postId,
                previewUrl: preview.thumbnail || fallbackThumbnail || null,
                imageUrl: preview.thumbnail || fallbackThumbnail || null,
                headlines: [],
                bodies: [],
                description: '',
                cta: '',
            };
        });
    });
}
