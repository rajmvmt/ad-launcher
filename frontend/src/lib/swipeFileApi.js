const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/swipe-file';

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

// ── List / Search ────────────────────────────────────────────────────

export async function getSwipes(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== '') qs.set(k, v);
    }
    const res = await authFetch(`${API_BASE}/?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch swipe file');
    return res.json();
}

export async function getCollections() {
    const res = await authFetch(`${API_BASE}/collections`);
    if (!res.ok) throw new Error('Failed to fetch collections');
    return res.json();
}

export async function getStats() {
    const res = await authFetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
}

export async function getNiches() {
    const res = await authFetch(`${API_BASE}/niches`);
    if (!res.ok) throw new Error('Failed to fetch niches');
    return res.json();
}

export async function getCategories() {
    const res = await authFetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('Failed to fetch categories');
    return res.json();
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function createSwipe(data) {
    const res = await authFetch(API_BASE + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create swipe');
    return res.json();
}

export async function bulkCreateSwipes(items) {
    const res = await authFetch(`${API_BASE}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
    });
    if (!res.ok) throw new Error('Failed to bulk create swipes');
    return res.json();
}

export async function updateSwipe(id, data) {
    const res = await authFetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update swipe');
    return res.json();
}

export async function toggleStar(id) {
    const res = await authFetch(`${API_BASE}/${id}/star`, { method: 'PATCH' });
    if (!res.ok) throw new Error('Failed to toggle star');
    return res.json();
}

export async function deleteSwipe(id) {
    const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete swipe');
    return res.json();
}

export async function bulkDeleteSwipes(ids) {
    const qs = ids.map(id => `ids=${id}`).join('&');
    const res = await authFetch(`${API_BASE}/?${qs}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to bulk delete');
    return res.json();
}

// ── AI Analysis ──────────────────────────────────────────────────────

export async function analyzeSwipe(id) {
    const res = await authFetch(`${API_BASE}/${id}/analyze`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to analyze swipe');
    return res.json();
}

export async function analyzeBulk(ids) {
    const qs = ids.map(id => `ids=${id}`).join('&');
    const res = await authFetch(`${API_BASE}/analyze-bulk?${qs}`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to bulk analyze');
    return res.json();
}

// ── Ad Library Search ────────────────────────────────────────────────

export async function searchAdLibrary(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== '') qs.set(k, v);
    }
    try {
        const res = await authFetch(`${API_BASE.replace('/swipe-file', '/ad-library')}/search?${qs}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to search Ad Library');
        }
        return res.json();
    } catch (e) {
        if (e.message === 'Failed to fetch') throw new Error('Cannot reach backend server. Is it running?');
        throw e;
    }
}

export async function scrapeAdLibrary(params = {}) {
    const res = await authFetch(`${API_BASE.replace('/swipe-file', '/ad-library')}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to scrape Ad Library');
    return res.json();
}

export async function saveAdFromLibrary(ad) {
    const res = await authFetch(`${API_BASE.replace('/swipe-file', '/ad-library')}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ad),
    });
    if (!res.ok) throw new Error('Failed to save ad');
    return res.json();
}

// ── Refresh IG Thumbnails ───────────────────────────────────────────

export async function refreshIgThumbnails() {
    const res = await authFetch(`${API_BASE}/refresh-ig-thumbnails`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to refresh IG thumbnails');
    }
    return res.json();
}

