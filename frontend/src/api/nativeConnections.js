const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/native-connections';

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

export async function getConnections(platform = null) {
    let url = API_BASE;
    if (platform) url += `?platform=${platform}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch native connections');
    return res.json();
}

export async function getConnection(id) {
    const res = await authFetch(`${API_BASE}/${id}`);
    if (!res.ok) throw new Error('Failed to fetch connection');
    return res.json();
}

export async function createConnection(data) {
    const res = await authFetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create connection');
    }
    return res.json();
}

export async function updateConnection(id, data) {
    const res = await authFetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to update connection');
    }
    return res.json();
}

export async function deleteConnection(id) {
    const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete connection');
    return res.json();
}

export async function verifyConnection(id) {
    const res = await authFetch(`${API_BASE}/${id}/verify`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to verify connection');
    return res.json();
}

export async function setDefaultConnection(id) {
    const res = await authFetch(`${API_BASE}/${id}/set-default`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to set default');
    return res.json();
}
