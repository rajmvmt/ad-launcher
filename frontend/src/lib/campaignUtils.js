// Shared formatting helpers for Campaign Browser

export const fmt = (n, decimals = 0) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

export const fmtMoney = (n) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtPct = (n) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toFixed(2) + '%';
};

// Budget comes from FB in cents
export const fmtBudget = (v) => {
    if (!v) return '—';
    return '$' + (Number(v) / 100).toFixed(2);
};

// Parse FB actions array → primary result (purchase > lead > complete_registration > link_click)
export const parseResults = (actions) => {
    if (!actions || !Array.isArray(actions)) return { type: null, value: 0 };
    const priority = [
        'offsite_conversion.fb_pixel_purchase',
        'offsite_conversion.fb_pixel_lead',
        'offsite_conversion.fb_pixel_complete_registration',
        'lead',
        'link_click',
    ];
    for (const p of priority) {
        const match = actions.find(a => a.action_type === p);
        if (match) return { type: p, value: Number(match.value) };
    }
    // fallback: first action
    if (actions.length > 0) return { type: actions[0].action_type, value: Number(actions[0].value) };
    return { type: null, value: 0 };
};

export const parseCostPerResult = (costPerAction, resultType) => {
    if (!costPerAction || !Array.isArray(costPerAction) || !resultType) return null;
    const match = costPerAction.find(a => a.action_type === resultType);
    return match ? Number(match.value) : null;
};

export const resultLabel = (type) => {
    if (!type) return 'Results';
    if (type.includes('purchase')) return 'Purchases';
    if (type.includes('lead')) return 'Leads';
    if (type.includes('registration')) return 'Registrations';
    if (type === 'link_click') return 'Link Clicks';
    return type.split('.').pop().replace(/_/g, ' ');
};

export const statusColor = (s) => {
    if (s === 'ACTIVE') return 'bg-green-100 text-green-700';
    if (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return 'bg-yellow-100 text-yellow-700';
    if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS') return 'bg-blue-100 text-blue-700';
    if (s === 'WITH_ISSUES' || s === 'CREDIT_CARD_NEEDED' || s === 'DISAPPROVED') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-500';
};

export const statusLabel = (s) => {
    if (s === 'ACTIVE') return 'On';
    if (s === 'PAUSED') return 'Off';
    if (s === 'CAMPAIGN_PAUSED') return 'Camp. Off';
    if (s === 'ADSET_PAUSED') return 'Set Off';
    if (s === 'PENDING_REVIEW') return 'Review';
    if (s === 'IN_PROCESS') return 'Processing';
    if (s === 'WITH_ISSUES') return 'Issues';
    if (s === 'DISAPPROVED') return 'Rejected';
    return s?.replace(/_/g, ' ') || '—';
};
