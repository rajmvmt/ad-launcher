const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/hosting-accounts';

export async function getHostingAccounts(authFetch) {
    const res = await authFetch(API_URL + '/');
    if (!res.ok) throw new Error('Failed to fetch hosting accounts');
    return res.json();
}

export async function getHostingAccount(authFetch, id) {
    const res = await authFetch(`${API_URL}/${id}`);
    if (!res.ok) throw new Error('Failed to fetch hosting account');
    return res.json();
}

export async function createHostingAccount(authFetch, data) {
    const res = await authFetch(API_URL + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create hosting account');
    }
    return res.json();
}

export async function updateHostingAccount(authFetch, id, data) {
    const res = await authFetch(`${API_URL}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update hosting account');
    }
    return res.json();
}

export async function deleteHostingAccount(authFetch, id) {
    const res = await authFetch(`${API_URL}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete hosting account');
    return res.json();
}

export async function testHostingConnection(authFetch, id) {
    const res = await authFetch(`${API_URL}/${id}/test`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to test connection');
    return res.json();
}

export async function addAddonDomain(authFetch, id, domainName) {
    const res = await authFetch(`${API_URL}/${id}/add-addon-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_name: domainName }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to add addon domain');
    }
    return res.json();
}

export async function listAddonDomains(authFetch, id) {
    const res = await authFetch(`${API_URL}/${id}/list-addon-domains`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to list addon domains');
    }
    return res.json();
}
