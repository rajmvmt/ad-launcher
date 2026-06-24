const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/safe-pages';

const getAuthHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const authFetch = async (url, options = {}) => {
    return fetch(url, {
        ...options,
        headers: { ...options.headers, ...getAuthHeaders() },
    });
};

// ── Reference data ─────────────────────────────────

export async function getThemes() {
    const res = await authFetch(`${API_BASE}/themes`);
    if (!res.ok) throw new Error('Failed to fetch themes');
    return res.json();
}

export async function getLanguages() {
    const res = await authFetch(`${API_BASE}/languages`);
    if (!res.ok) throw new Error('Failed to fetch languages');
    return res.json();
}

export async function getBrandTemplates() {
    const res = await authFetch(`${API_BASE}/brand-templates`);
    if (!res.ok) throw new Error('Failed to fetch brand templates');
    return res.json();
}

// ── Safe Pages CRUD ────────────────────────────────

export async function getSafePages(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== '') qs.set(k, v);
    }
    const res = await authFetch(`${API_BASE}/?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch safe pages');
    return res.json();
}

export async function getSafePage(id) {
    const res = await authFetch(`${API_BASE}/${id}`);
    if (!res.ok) throw new Error('Failed to fetch safe page');
    return res.json();
}

export async function deleteSafePage(id) {
    const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete safe page');
    return res.json();
}

export async function bulkDeleteSafePages(ids) {
    const res = await authFetch(`${API_BASE}/bulk/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
    });
    if (!res.ok) throw new Error('Failed to bulk delete');
    return res.json();
}

// ── Generate ───────────────────────────────────────

export async function generateSafePage(data) {
    const res = await authFetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Generation failed');
    }
    return res.json();
}

// ── Deploy to domain ──────────────────────────────

export async function deploySafePage(id) {
    const res = await authFetch(`${API_BASE}/${id}/deploy`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Deploy failed');
    }
    return res.json();
}

// ── Deploy to domain via FTP ─────────────────────

export async function deploySafePageFtp(id, linkName) {
    const params = linkName ? `?link_name=${encodeURIComponent(linkName)}` : '';
    const res = await authFetch(`${API_BASE}/${id}/deploy-hosting${params}`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Deploy failed');
    }
    return res.json();
}

// ── Download (re-randomized) ───────────────────────

export async function downloadSafePage(id) {
    const res = await authFetch(`${API_BASE}/${id}/download`);
    if (!res.ok) throw new Error('Download failed');
    return res.blob();
}

// ── Uniqueizer ─────────────────────────────────────

export async function uniqueizeImage(file, degree = 'medium') {
    const formData = new FormData();
    formData.append('file', file);
    const res = await authFetch(`${API_BASE}/tools/uniqueize-image?degree=${degree}`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error('Image uniqueization failed');
    return res.blob();
}

export async function uniqueizeVideo(file, degree = 'medium') {
    const formData = new FormData();
    formData.append('file', file);
    const res = await authFetch(`${API_BASE}/tools/uniqueize-video?degree=${degree}`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error('Video uniqueization failed');
    return res.blob();
}

// ── Data Generators ────────────────────────────────

export async function getCountries() {
    const res = await authFetch(`${API_BASE}/tools/countries`);
    if (!res.ok) throw new Error('Failed to fetch countries');
    return res.json();
}

export async function generateAddress(country = 'US') {
    const res = await authFetch(`${API_BASE}/tools/generate-address?country=${country}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to generate address');
    return res.json();
}

export async function generatePhone(country = 'US') {
    const res = await authFetch(`${API_BASE}/tools/generate-phone?country=${country}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to generate phone');
    return res.json();
}

// ── Integration Code ──────────────────────────────

export async function setIntegrationCode(pageId, code) {
    const res = await authFetch(`${API_BASE}/${pageId}/integration-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save integration code');
    }
    return res.json();
}

// ── Code Presets ───────────────────────────────────

export async function getPresets(slot = null) {
    const qs = slot ? `?slot=${slot}` : '';
    const res = await authFetch(`${API_BASE}/presets${qs}`);
    if (!res.ok) throw new Error('Failed to fetch presets');
    return res.json();
}

export async function createPreset(data) {
    const res = await authFetch(`${API_BASE}/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create preset');
    return res.json();
}

export async function deletePreset(id) {
    const res = await authFetch(`${API_BASE}/presets/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete preset');
    return res.json();
}
