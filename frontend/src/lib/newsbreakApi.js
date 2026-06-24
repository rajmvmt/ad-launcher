const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/newsbreak';

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

// ── Campaigns ─────────────────────────────────────────────────────

export async function getCampaigns(connectionId = null, adAccountId = null) {
    let url = `${API_BASE}/campaigns?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    if (adAccountId) url += `ad_account_id=${adAccountId}&`;
    const res = await authFetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to fetch NewsBreak campaigns');
    }
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

// ── Ad Sets ───────────────────────────────────────────────────────

export async function getAdSets(campaignId = null, connectionId = null) {
    let url = `${API_BASE}/adsets?`;
    if (campaignId) url += `campaign_id=${campaignId}&`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch ad sets');
    return res.json();
}

export async function updateAdSetStatus(adsetId, status, connectionId = null) {
    let url = `${API_BASE}/adsets/${adsetId}/status?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update ad set status');
    return res.json();
}

// ── Ads ───────────────────────────────────────────────────────────

export async function getAds(adSetId = null, connectionId = null) {
    let url = `${API_BASE}/ads?`;
    if (adSetId) url += `ad_set_id=${adSetId}&`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch ads');
    return res.json();
}

export async function updateAdStatus(adId, status, connectionId = null) {
    let url = `${API_BASE}/ads/${adId}/status?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update ad status');
    return res.json();
}

// ── Delete ────────────────────────────────────────────────────────

export async function deleteCampaign(campaignId, connectionId = null) {
    let url = `${API_BASE}/campaigns/${campaignId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete campaign');
    return res.json();
}

export async function deleteAdSet(adsetId, connectionId = null) {
    let url = `${API_BASE}/adsets/${adsetId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete ad set');
    return res.json();
}

export async function deleteAd(adId, connectionId = null) {
    let url = `${API_BASE}/ads/${adId}?`;
    if (connectionId) url += `connection_id=${connectionId}&`;
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete ad');
    return res.json();
}

// ── Reporting ─────────────────────────────────────────────────────

export async function getReport(since, until, connectionId = null, dimensions = 'CAMPAIGN') {
    let url = `${API_BASE}/reports?since=${since}&until=${until}&dimensions=${dimensions}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const res = await authFetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to fetch report (${res.status})`);
    }
    return res.json();
}
