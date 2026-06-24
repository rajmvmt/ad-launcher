// Shared chunked-multipart upload helper used by both the bulk-publish wizard
// and the AI ad copy step. Slices files into 8MB parts and PUTs them straight
// to R2 via presigned URLs. Each part retries independently with exponential
// backoff. Falls back to a single POST /uploads/ when the multipart endpoints
// aren't available on the deployed backend (older versions) or when R2 isn't
// configured server-side.

const PART_SIZE = 8 * 1024 * 1024;        // 8MB
const PART_CONCURRENCY = 4;               // parts in flight per file
const PART_RETRIES = 4;
const PART_TIMEOUT_MS = 5 * 60 * 1000;    // 5 min per part
const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min ceiling for the legacy path

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const noop = () => {};

const putPartWithProgress = (url, blob, onBytes) =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const etag = xhr.getResponseHeader('ETag');
                if (!etag) reject(new Error('R2 did not return ETag (bucket CORS must expose ETag)'));
                else resolve(etag.replace(/"/g, ''));
            } else {
                reject(new Error(`Part upload failed: HTTP ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during part upload'));
        xhr.onabort = () => reject(new Error('Part upload aborted'));
        xhr.timeout = PART_TIMEOUT_MS;
        xhr.ontimeout = () => reject(new Error('Part upload timeout'));
        xhr.send(blob);
    });

const legacyUploadWithProgress = (file, authFetch, onProgress, onStats) =>
    new Promise((resolve, reject) => {
        const token = localStorage.getItem('accessToken');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/uploads/`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                onProgress(Math.round((e.loaded / e.total) * 100));
                onStats({ loaded: e.loaded, total: e.total, ts: Date.now() });
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error('Invalid upload response')); }
            } else {
                reject(new Error(`Upload failed: HTTP ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.timeout = TOTAL_TIMEOUT_MS;
        xhr.ontimeout = () => reject(new Error('Upload timed out after 30 min'));
        const fd = new FormData();
        fd.append('file', file);
        xhr.send(fd);
    });

/**
 * Upload a File to the backend with progress callbacks. Returns { url, media_type? }.
 *
 * @param {File}     file        - the file to upload
 * @param {Function} authFetch   - the AuthContext authFetch (for backend calls)
 * @param {Object}   [callbacks] - { onProgress(pct), onStats({loaded,total,ts}) }
 */
export async function uploadFileWithProgress(file, authFetch, { onProgress = noop, onStats = noop } = {}) {
    const initRes = await authFetch(`${API_URL}/uploads/multipart/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            size: file.size,
        }),
    });

    // 404/405 → backend doesn't have multipart endpoints (older deploy); fall back.
    if (initRes.status === 404 || initRes.status === 405) {
        return await legacyUploadWithProgress(file, authFetch, onProgress, onStats);
    }
    if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}));
        if (typeof err.detail === 'string' && err.detail.includes('R2')) {
            return await legacyUploadWithProgress(file, authFetch, onProgress, onStats);
        }
        throw new Error(err.detail || `Init failed: HTTP ${initRes.status}`);
    }
    const { upload_id, key, public_url, media_type } = await initRes.json();

    const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
    const partLoaded = new Array(totalParts).fill(0);
    const partEtags = new Array(totalParts);
    const reportProgress = () => {
        const loaded = partLoaded.reduce((a, b) => a + b, 0);
        const pct = Math.min(100, Math.round((loaded / file.size) * 100));
        onProgress(pct);
        onStats({ loaded, total: file.size, ts: Date.now() });
    };

    const uploadOnePart = async (partIndex) => {
        const start = partIndex * PART_SIZE;
        const end = Math.min(start + PART_SIZE, file.size);
        const blob = file.slice(start, end);
        const partNumber = partIndex + 1;
        let lastErr;
        for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
            try {
                const signRes = await authFetch(`${API_URL}/uploads/multipart/sign`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key, upload_id, part_number: partNumber }),
                });
                if (!signRes.ok) throw new Error(`Sign failed: HTTP ${signRes.status}`);
                const { url } = await signRes.json();
                const etag = await putPartWithProgress(url, blob, (loaded) => {
                    partLoaded[partIndex] = loaded;
                    reportProgress();
                });
                partLoaded[partIndex] = blob.size;
                partEtags[partIndex] = etag;
                reportProgress();
                return;
            } catch (e) {
                lastErr = e;
                partLoaded[partIndex] = 0;
                reportProgress();
                if (attempt < PART_RETRIES) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
                }
            }
        }
        throw new Error(`Part ${partNumber} failed after ${PART_RETRIES} attempts: ${lastErr?.message || 'unknown'}`);
    };

    const queue = Array.from({ length: totalParts }, (_, i) => i);
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, totalParts) }, async () => {
        while (true) {
            const idx = queue.shift();
            if (idx === undefined) return;
            await uploadOnePart(idx);
        }
    });

    try {
        await Promise.all(workers);
    } catch (e) {
        try {
            await authFetch(`${API_URL}/uploads/multipart/abort`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, upload_id }),
            });
        } catch { /* best-effort */ }
        throw e;
    }

    const completeRes = await authFetch(`${API_URL}/uploads/multipart/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            key,
            upload_id,
            parts: partEtags.map((etag, i) => ({ part_number: i + 1, etag })),
        }),
    });
    if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error(err.detail || `Complete failed: HTTP ${completeRes.status}`);
    }
    const completed = await completeRes.json();
    return { url: completed.url || public_url, media_type };
}
