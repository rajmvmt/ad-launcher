import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const CampaignContext = createContext();

export const useCampaign = () => {
    const context = useContext(CampaignContext);
    if (!context) {
        throw new Error('useCampaign must be used within CampaignProvider');
    }
    return context;
};

const STORAGE_KEY = 'mvmt_campaign_wizard_draft_v1';

const tomorrowAt1am = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(1, 0, 0, 0);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const hours = String(tomorrow.getHours()).padStart(2, '0');
    const minutes = String(tomorrow.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const defaultCampaignData = () => ({
    id: null,
    name: '',
    objective: 'OUTCOME_SALES',
    budgetType: 'ABO',
    dailyBudget: 0,
    bidStrategy: '',
    status: 'ACTIVE',
    fbCampaignId: null,
    isExisting: false,
    brandId: null
});

const defaultAdsetData = () => ({
    id: null,
    name: '',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    dailyBudget: 0,
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    bidAmount: 0,
    targeting: {
        genders: [],
        publisher_platforms: ['facebook', 'instagram'],
        geo_locations: {
            countries: ['US'],
            excluded_countries: [],
            regions: [],
            excluded_regions: [],
            cities: [],
            excluded_cities: [],
            geo_markets: [],
            excluded_geo_markets: []
        },
        ageMin: 18,
        ageMax: 65
    },
    advantageAudience: 0,
    startTime: tomorrowAt1am(),
    pixelId: '',
    conversionEvent: 'PURCHASE',
    attributionSetting: '7d_click',
    status: 'ACTIVE',
    fbAdsetId: null,
    isExisting: false
});

const defaultCreativeData = () => ({
    creativeMode: 'per_creative',
    creativeName: '',
    creatives: [],
    bodies: [''],
    headlines: [''],
    description: '',
    cta: 'LEARN_MORE',
    websiteUrl: '',
    pageId: '',
    instagramId: null,
    existingPostCopies: 1
});

// We deliberately don't persist the `creatives` array — File objects and
// blob: URLs can't survive a page refresh, and the resulting half-restored
// state caused confusing errors. Existing-post creatives (just an ID) are
// the exception: they have no media to lose.
const isExistingPostCreative = (c) => !!c?.existing_post_id;

const loadDraft = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
};

const hasDraftInStorage = () => {
    const d = loadDraft();
    if (!d) return false;
    // Consider it a draft only if the user actually entered something
    return !!(
        d.campaignData?.name ||
        d.adsetData?.name ||
        d.creativeData?.creativeName ||
        (d.creativeData?.creatives && d.creativeData.creatives.length > 0) ||
        (d.adsData && d.adsData.length > 0)
    );
};

export const CampaignProvider = ({ children }) => {
    // Lazy init: rehydrate from localStorage on first mount
    const draft = loadDraft();

    const [campaignData, setCampaignData] = useState(() => ({ ...defaultCampaignData(), ...(draft?.campaignData || {}) }));
    const [adsetData, setAdsetData] = useState(() => ({ ...defaultAdsetData(), ...(draft?.adsetData || {}) }));
    const [creativeData, setCreativeData] = useState(() => {
        const merged = { ...defaultCreativeData(), ...(draft?.creativeData || {}) };
        // Only restore existing-post creatives (no media to lose). Uploaded
        // videos/images aren't restored — user re-adds after refresh.
        merged.creatives = (merged.creatives || []).filter(isExistingPostCreative);
        return merged;
    });
    // adsData rows reference creative IDs, which won't exist after we drop the
    // creatives. Skip restoring adsData — it'll be regenerated when the user
    // re-uploads media on the Creative step.
    const [adsData, setAdsData] = useState([]);
    const [addingNewAd, setAddingNewAd] = useState(false);
    const [selectedAdAccount, setSelectedAdAccount] = useState(() => draft?.selectedAdAccount || null);
    const [selectedConnection, setSelectedConnection] = useState(() => draft?.selectedConnection || null);

    const [hasDraft, setHasDraft] = useState(() => hasDraftInStorage());

    // Persist to localStorage on any change. Debounce the writes a tick to avoid
    // hammering storage during rapid state updates.
    const persistTimer = useRef(null);
    useEffect(() => {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            try {
                const snapshot = {
                    campaignData,
                    adsetData,
                    creativeData: {
                        ...creativeData,
                        // Only persist existing-post creatives (no media). Uploaded media
                        // can't survive refresh; not worth the half-restored confusion.
                        creatives: (creativeData.creatives || []).filter(isExistingPostCreative),
                    },
                    // Don't persist adsData — its rows reference creative IDs that we
                    // won't restore.
                    selectedAdAccount,
                    selectedConnection,
                    savedAt: Date.now(),
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
                setHasDraft(hasDraftInStorage());
            } catch (e) {
                // Ignore quota/serialization errors — persistence is best-effort
                console.warn('[CampaignContext] failed to persist draft:', e?.message);
            }
        }, 250);
        return () => persistTimer.current && clearTimeout(persistTimer.current);
    }, [campaignData, adsetData, creativeData, adsData, selectedAdAccount, selectedConnection]);

    const clearDraft = () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
        setHasDraft(false);
    };

    const resetWizard = () => {
        setCampaignData(defaultCampaignData());
        setAdsetData(defaultAdsetData());
        setCreativeData(defaultCreativeData());
        setAdsData([]);
        setSelectedAdAccount(null);
        setSelectedConnection(null);
        clearDraft();
    };

    const value = {
        campaignData,
        setCampaignData,
        adsetData,
        setAdsetData,
        creativeData,
        setCreativeData,
        adsData,
        setAdsData,
        selectedAdAccount,
        setSelectedAdAccount,
        selectedConnection,
        setSelectedConnection,
        addingNewAd,
        setAddingNewAd,
        resetWizard,
        hasDraft,
        clearDraft
    };

    return (
        <CampaignContext.Provider value={value}>
            {children}
        </CampaignContext.Provider>
    );
};
