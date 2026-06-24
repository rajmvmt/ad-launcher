const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/outbrain';

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

// ── Marketers ─────────────────────────────────────────────────────

export async function getMarketers(connectionId = null) {
    let url = `${API_BASE}/marketers?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch Outbrain marketers');
    return res.json();
}

// ── Campaigns ─────────────────────────────────────────────────────

export async function getCampaigns(connectionId = null, marketerId = null) {
    let url = `${API_BASE}/campaigns?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    if (marketerId) url += `marketer_id=${marketerId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch Outbrain campaigns');
    return res.json();
}

export async function updateCampaignStatus(campaignId, enabled, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/status?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error('Failed to update campaign status');
    return res.json();
}

// ── PromotedLinks (Ads) ──────────────────────────────────────────

export async function getPromotedLinks(campaignId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}/promoted-links?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch promoted links');
    return res.json();
}

export async function updatePromotedLinkStatus(linkId, enabled, connectionId = null) {
    let url = `${API_BASE}/promoted-links/${linkId}/status?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error('Failed to update promoted link status');
    return res.json();
}

// ── Reporting ─────────────────────────────────────────────────────

export async function getCampaignReport(since, until, connectionId = null, marketerId = null) {
    let url = `${API_BASE}/reports/campaigns?since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (marketerId) url += `&marketer_id=${marketerId}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch campaign report');
    return res.json();
}

export async function getPromotedLinksReport(campaignId, since, until, connectionId = null) {
    let url = `${API_BASE}/reports/campaigns/${campaignId}/promoted-links?since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch promoted links report');
    return res.json();
}
