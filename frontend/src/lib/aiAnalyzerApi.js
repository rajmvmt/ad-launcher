const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/ai-analyzer';

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

export async function deepAnalyzeSwipe(swipeId) {
    const res = await authFetch(`${API_BASE}/${swipeId}/analyze`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(err.detail || 'Deep analysis failed');
    }
    return res.json();
}

export async function analyzeUpload(formData) {
    const res = await authFetch(`${API_BASE}/analyze-upload`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload analysis failed' }));
        throw new Error(err.detail || 'Upload analysis failed');
    }
    return res.json();
}

export async function createSimilar(data) {
    const res = await authFetch(`${API_BASE}/create-similar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Create similar failed' }));
        throw new Error(err.detail || 'Create similar failed');
    }
    return res.json();
}

export async function generateSimilarImages(data) {
    const res = await authFetch(`${API_BASE}/generate-similar-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Image generation failed' }));
        throw new Error(err.detail || 'Image generation failed');
    }
    return res.json();
}
