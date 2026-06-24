const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/campaign-templates';

const getAuthHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export async function listTemplates() {
    const res = await fetch(API_URL, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load templates');
    return res.json();
}

export async function createTemplate(name, campaignConfig, adsetConfig) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name, campaign_config: campaignConfig, adset_config: adsetConfig }),
    });
    if (!res.ok) throw new Error('Failed to save template');
    return res.json();
}

export async function deleteTemplate(id) {
    const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to delete template');
    return res.json();
}
