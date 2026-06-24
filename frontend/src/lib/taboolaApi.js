const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/taboola';

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

export async function getCampaigns(connectionId = null, accountId = null) {
    let url = `${API_BASE}/campaigns?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    if (accountId) url += `account_id=${accountId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch Taboola campaigns');
    return res.json();
}

export async function getCampaign(campaignId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch campaign');
    return res.json();
}

export async function createCampaign(data, connectionId = null, accountId = null) {
    let url = `${API_BASE}/campaigns?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    if (accountId) url += `account_id=${accountId}&`;
    const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create campaign');
    return res.json();
}

export async function updateCampaign(campaignId, data, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update campaign');
    return res.json();
}

export async function updateCampaignStatus(campaignId, status, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/status?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update campaign status');
    return res.json();
}

export async function deleteCampaign(campaignId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete campaign');
    return res.json();
}

export async function getCampaignItems(campaignId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/items?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch campaign items');
    return res.json();
}

export async function createCampaignItem(campaignId, data, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/items?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create campaign item');
    return res.json();
}

export async function updateCampaignItem(campaignId, itemId, data, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/items/${itemId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update campaign item');
    return res.json();
}

export async function deleteCampaignItem(campaignId, itemId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/items/${itemId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete campaign item');
    return res.json();
}

export async function getCampaignReport(since, until, connectionId = null, accountId = null) {
    let url = `${API_BASE}/reports/campaigns?since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (accountId) url += `&account_id=${accountId}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch campaign report');
    return res.json();
}

export async function getCampaignItemsReport(campaignId, since, until, connectionId = null) {
    let url = `${API_BASE}/reports/campaigns/${campaignId}/items?since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch items report');
    return res.json();
}
