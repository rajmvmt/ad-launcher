import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    BarChart3, Loader, ChevronRight, RefreshCw, DollarSign,
    Eye, MousePointerClick, TrendingUp, TrendingDown, Play, Pause, ArrowUpDown,
    ArrowUp, ArrowDown, Search, Calendar, Link2, Copy, Pencil, Check, X, Image as ImageIcon,
    Upload, Target, Zap, Sparkles, Trash2, ShieldCheck, FolderOpen, Percent, Banknote, MousePointer,
    Clock, Shield, Sun, ExternalLink, MessageSquare, Waves, Plus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useBrands } from '../context/BrandContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts, getCampaignInsights, getAdSetInsights, getAdInsights, getAllAdInsights, updateObjectStatus, bulkUpdateStatus, deleteObject, duplicateAd, duplicateCampaign, duplicateAdSet, cloneCampaignToAccount, renameAd, renameObject, getAdPreview, editAdCreative, getCampaignBrandMap, tagCampaignBrand, scheduleBudgetChange, getScheduledBudgets, cancelScheduledBudget, getAutoSafeLog, getAccountBrandMap, getDaypartSchedules, upsertDaypartSchedule, deleteDaypartSchedule, toggleDaypartSchedule, getAdAlerts, getBudgetSurfConfigs, createBudgetSurf, updateBudgetSurf, deleteBudgetSurf, getBudgetSurfLogs, updateAdSet, updateCampaign, getBudgetSchedules, createBudgetSchedule, deleteBudgetScheduleApi, quickCreateAd, quickCreateAdSet, getSyncedCampaigns, getSyncedAdSets, getSyncedAds, getSyncedAllAds, getSyncStatus, triggerSync, getPages, getDailySyncedCampaigns, getDailySyncedAdSets, getDailySyncedAds, getDailySyncedAllAds, getDailySyncedAllAdSets, runPreflightCheck, getBidSchedules, quickUpdateBid } from '../lib/facebookApi';
import { fmt, fmtMoney, fmtPct, fmtBudget, parseCostPerResult, resultLabel, statusColor, statusLabel } from '../lib/campaignUtils';
import CampaignCard from '../components/CampaignCard';
import BidScheduleModal from '../components/BidScheduleModal';

const CTA_OPTIONS = [
    'NO_BUTTON', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US',
    'DOWNLOAD', 'BOOK_NOW', 'GET_QUOTE', 'BUY_TICKETS', 'DONATE_NOW',
];

const SAFE_AD_VARIATIONS = [
    { image: 'puppy.jpg', primary_text: 'Check out this helpful resource for more information.', headline: 'Learn More Today', description: 'Discover useful tips and information.' },
    { image: 'puppy2.jpg', primary_text: 'Looking for something new? Start here.', headline: 'Explore Now', description: 'Find helpful tips and ideas.' },
    { image: 'kitten.jpg', primary_text: 'Brighten your day with something wonderful.', headline: 'Something Special', description: 'Discover what everyone is talking about.' },
    { image: 'sunset.jpg', primary_text: 'Take a moment to discover something amazing.', headline: 'A Fresh Perspective', description: 'See what inspires people every day.' },
    { image: 'coffee.jpg', primary_text: 'Start your day with a great new find.', headline: 'Your Daily Inspiration', description: 'Simple ideas for a better day.' },
    { image: 'mountain.jpg', primary_text: 'Adventure awaits — find your next journey.', headline: 'Explore the World', description: 'Inspiration for your next adventure.' },
    { image: 'beach.jpg', primary_text: 'Relax and discover something new today.', headline: 'Unwind & Discover', description: 'Your go-to source for feel-good content.' },
    { image: 'garden.jpg', primary_text: 'Grow something beautiful today.', headline: 'Fresh Ideas Daily', description: 'Tips and inspiration for everyday life.' },
    { image: 'flowers.jpg', primary_text: 'Discover the beauty in everyday moments.', headline: 'Simple Joys', description: 'Little things that make a big difference.' },
];

function getRandomSafeAd(pageId) {
    const v = SAFE_AD_VARIATIONS[Math.floor(Math.random() * SAFE_AD_VARIATIONS.length)];
    // FB rejects google.com as a creative link (subcode 1487390). The Page's own
    // FB URL is always policy-safe because the link domain matches the Page.
    const safeUrl = pageId
        ? `https://www.facebook.com/${pageId}/`
        : 'https://www.facebook.com/';
    return {
        image_url: `https://pub-11870393a7f1464a9a0bf4fce09be525.r2.dev/safe-ad/${v.image}`,
        primary_text: v.primary_text,
        headline: v.headline,
        description: v.description,
        cta: 'LEARN_MORE',
        website_url: safeUrl,
    };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractIframeSrc(html) {
    const match = html.match(/src="([^"]+)"/);
    return match ? match[1].replace(/&amp;/g, '&') : null;
}


// ── Date presets ─────────────────────────────────────────────────

const datePresets = () => {
    const today = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const minus = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return [
        { label: 'Today', since: fmt(today), until: fmt(today) },
        { label: 'Yesterday', since: fmt(minus(1)), until: fmt(minus(1)) },
        { label: 'Last 7 days', since: fmt(minus(7)), until: fmt(today) },
        { label: 'Last 14 days', since: fmt(minus(14)), until: fmt(today) },
        { label: 'Last 30 days', since: fmt(minus(30)), until: fmt(today) },
        { label: 'This month', since: fmt(firstOfMonth), until: fmt(today) },
    ];
};

// ── Main Component ───────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const CampaignBrowser = () => {
    const { showSuccess, showError, showWarning, showInfo } = useToast();
    const navigate = useNavigate();
    const { authFetch } = useAuth();
    const { brands } = useBrands();

    // Connection & Account
    const [connections, setConnections] = useState([]);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [loadingSetup, setLoadingSetup] = useState(true);

    // Date range
    const presets = useMemo(() => datePresets(), []);
    const [datePreset, setDatePreset] = useState(0); // Today
    const [customSince, setCustomSince] = useState('');
    const [customUntil, setCustomUntil] = useState('');

    const activeDateRange = useMemo(() => {
        if (datePreset === 'custom') return { since: customSince, until: customUntil };
        return presets[datePreset] || presets[2];
    }, [datePreset, customSince, customUntil, presets]);

    // Navigation: 'campaigns' | 'adsets' | 'ads' | 'all_ads'
    const [level, setLevel] = useState('campaigns');
    const [breadcrumbs, setBreadcrumbs] = useState([]); // [{label, level, id}]
    const isAdLevel = level === 'ads' || level === 'all_ads';

    // Data + cache
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastRefreshed, setLastRefreshed] = useState(null);

    // Sort
    const [sortKey, setSortKey] = useState('spend');
    const [sortDir, setSortDir] = useState('desc');

    // Status toggle in-progress
    const [togglingId, setTogglingId] = useState(null);

    // Ad actions
    const [duplicatingId, setDuplicatingId] = useState(null);
    const [duplicatePopoverId, setDuplicatePopoverId] = useState(null);
    const [duplicateName, setDuplicateName] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    // Clone to account
    const [cloneModalCampaign, setCloneModalCampaign] = useState(null);
    const [cloneTargetAccount, setCloneTargetAccount] = useState('');
    const [cloneName, setCloneName] = useState('');
    const [cloning, setCloning] = useState(false);

    // Bulk selection
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkActionLoading, setBulkActionLoading] = useState(false);

    // Bulk edit modal (ads level)
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    const [bulkEditData, setBulkEditData] = useState({ primary_text: '', headline: '', description: '', cta: 'LEARN_MORE', website_url: '' });
    const [bulkEditFields, setBulkEditFields] = useState({ primary_text: false, headline: false, description: false, cta: false, website_url: false });
    const [bulkEditSaving, setBulkEditSaving] = useState(false);
    const [bulkEditProgress, setBulkEditProgress] = useState('');

    // Bulk delete / duplicate
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [bulkDuplicateConfirm, setBulkDuplicateConfirm] = useState(false);

    // Delete
    const [deletingId, setDeletingId] = useState(null);
    const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);

    // Sync status
    const [syncStatus, setSyncStatus] = useState(null);
    const [syncing, setSyncing] = useState(false);


    // Safe Ad (quick swap to safe creative)
    const [safeAdConfirmId, setSafeAdConfirmId] = useState(null);
    const [safeAdLoadingId, setSafeAdLoadingId] = useState(null);

    // Brand tagging (campaign level)
    const [brandMap, setBrandMap] = useState({}); // fb_campaign_id → brand_id
    const [accountBrandMap, setAccountBrandMap] = useState({}); // ad_account_id → [brand_ids]

    // Legacy conversion data (unused — now using FB's cost_per_purchase directly)

    // Ad preview (Facebook Previews API)
    const [previewAd, setPreviewAd] = useState(null);
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewFormat, setPreviewFormat] = useState('DESKTOP_FEED_STANDARD');

    // Edit Creative modal
    const [editCreativeAd, setEditCreativeAd] = useState(null);
    const [editCreativeData, setEditCreativeData] = useState({
        primary_text: '', headline: '', description: '', cta: 'LEARN_MORE',
        website_url: '', image_url: '', image_hash: '', new_image_file: null, new_image_preview: '', page_id: '',
    });
    const [editCreativeSaving, setEditCreativeSaving] = useState(false);
    const [imageChanged, setImageChanged] = useState(false);

    // Quick Create Ad Set modal
    const [createAdSetModal, setCreateAdSetModal] = useState(null); // { campaignId, adAccountId }
    const [createAdSetData, setCreateAdSetData] = useState({ name: '', daily_budget: '', optimization_goal: 'OFFSITE_CONVERSIONS', countries: 'US', age_min: 18, age_max: 65 });
    const [createAdSetSaving, setCreateAdSetSaving] = useState(false);

    // Quick Create Ad modal
    const [createAdModal, setCreateAdModal] = useState(null); // { adsetId, adAccountId, campaignId }
    const [createAdSiblingAdsets, setCreateAdSiblingAdsets] = useState([]); // [{id, name}]
    const [createAdTargetAdsets, setCreateAdTargetAdsets] = useState(new Set());
    const [createAdSiblingsLoading, setCreateAdSiblingsLoading] = useState(false);
    const emptyAd = () => ({ name: '', page_id: '', image_url: '', primary_text: '', headline: '', description: '', cta: 'LEARN_MORE', website_url: '', mediaType: '', use_existing_post: false, existing_post_id: '' });
    const [createAdList, setCreateAdList] = useState([emptyAd()]);
    const [createAdSaving, setCreateAdSaving] = useState(false);
    const [createAdPages, setCreateAdPages] = useState([]);
    const [createAdPagesLoading, setCreateAdPagesLoading] = useState(false);
    const [createAdManualPageId, setCreateAdManualPageId] = useState(false);
    const [createAdUploading, setCreateAdUploading] = useState({}); // { [index]: true }
    const [createAdAiLoading, setCreateAdAiLoading] = useState({}); // { [index]: true }
    const [createAdDragOver, setCreateAdDragOver] = useState({}); // { [index]: true }

    // Fetch pages + set defaults when Create Ad modal opens
    useEffect(() => {
        if (!createAdModal) return;
        const acctId = createAdModal.adAccountId;
        // Load pages
        setCreateAdPagesLoading(true);
        getPages(acctId).then(pages => {
            setCreateAdPages(pages);
            const lastUsed = localStorage.getItem('lastUsedPageId');
            const defaultPageId = lastUsed && pages.some(p => p.id === lastUsed) ? lastUsed : (pages[0]?.id || '');
            if (defaultPageId) {
                setCreateAdList(list => list.map(a => a.page_id ? a : { ...a, page_id: defaultPageId }));
            }
        }).catch(() => {}).finally(() => setCreateAdPagesLoading(false));
        // Default URL from localStorage
        const defaultUrl = localStorage.getItem('defaultUrl_' + acctId) || '';
        if (defaultUrl) {
            setCreateAdList(list => list.map(a => a.website_url ? a : { ...a, website_url: defaultUrl }));
        }
        // Load sibling ad sets for the multi-target picker (used by "Use existing post" mode)
        if (createAdModal.campaignId) {
            setCreateAdSiblingsLoading(true);
            getAdSetInsights(createAdModal.campaignId, selectedConnection?.id, acctId)
                .then(rows => {
                    const siblings = (rows || []).map(r => ({ id: r.id || r.adset_id, name: r.name || r.adset_name || r.id }));
                    setCreateAdSiblingAdsets(siblings);
                })
                .catch(() => setCreateAdSiblingAdsets([]))
                .finally(() => setCreateAdSiblingsLoading(false));
        } else {
            setCreateAdSiblingAdsets([]);
        }
    }, [createAdModal]);

    // Budget Scheduling (FB native)
    const [budgetSchedModal, setBudgetSchedModal] = useState(null); // { id, type, name }
    const [budgetScheds, setBudgetScheds] = useState([]);
    const [budgetSchedLoading, setBudgetSchedLoading] = useState(false);
    const [budgetSchedForm, setBudgetSchedForm] = useState({ amount: '', start_hour: 9, end_hour: 15 });
    const [budgetSchedSaving, setBudgetSchedSaving] = useState(false);

    // Edit Campaign modal
    const [editCampaign, setEditCampaign] = useState(null);
    const [editCampaignData, setEditCampaignData] = useState({});
    const [editCampaignSaving, setEditCampaignSaving] = useState(false);

    // Edit Ad Set modal
    const [editAdSet, setEditAdSet] = useState(null);
    const [editAdSetData, setEditAdSetData] = useState({});
    const [editAdSetSaving, setEditAdSetSaving] = useState(false);

    // Scheduled budgets
    const [scheduledBudgets, setScheduledBudgets] = useState([]); // pending budget changes
    const [editingBudgetId, setEditingBudgetId] = useState(null); // item id being edited
    const [editBudgetValue, setEditBudgetValue] = useState('');
    const [editBudgetScheduledAt, setEditBudgetScheduledAt] = useState(''); // "YYYY-MM-DDTHH:MM" interpreted as EST
    const [schedulingBudget, setSchedulingBudget] = useState(false);

    // Auto-safe log
    const [autoSafeLog, setAutoSafeLog] = useState({}); // keyed by fb_ad_id

    // Rejected ads
    const [rejectedCount, setRejectedCount] = useState(0);
    const [rejectedAds, setRejectedAds] = useState([]);
    const [rejectedLoading, setRejectedLoading] = useState(false);

    // Budget Surfing
    const [surfConfigs, setSurfConfigs] = useState({}); // keyed by fb_object_id
    const [surfPopoverId, setSurfPopoverId] = useState(null);
    const [surfForm, setSurfForm] = useState({ base_budget: '', min_conversions: 10, noon_multiplier: 2, afternoon_multiplier: 4 });
    const [surfSaving, setSurfSaving] = useState(false);
    const [surfLogModal, setSurfLogModal] = useState(null); // config id to show logs for
    const [surfLogs, setSurfLogs] = useState([]);

    // Dayparting
    const [daypartSchedules, setDaypartSchedules] = useState({}); // keyed by fb_adset_id
    const [daypartPopoverId, setDaypartPopoverId] = useState(null);
    const [bidScheduleCounts, setBidScheduleCounts] = useState({}); // keyed by fb_object_id → rule count
    const [bidSchedulePopover, setBidSchedulePopover] = useState(null); // { item, objectType }
    const [editingBidId, setEditingBidId] = useState(null); // fb_object_id of inline-editing bid
    const [bidEditValue, setBidEditValue] = useState('');
    const [bidSaving, setBidSaving] = useState(false);
    // Stable identity so the modal's load effect doesn't re-fire forever.
    const openQuickBidEdit = useCallback((item) => {
        const dollars = item.bid_amount ? (item.bid_amount / 100).toFixed(2) : '';
        setEditingBidId(item.id);
        setBidEditValue(dollars);
    }, []);

    const cancelQuickBidEdit = useCallback(() => {
        setEditingBidId(null);
        setBidEditValue('');
    }, []);

    const handleSaveQuickBid = useCallback(async (item, objectType) => {
        const parsed = parseFloat(bidEditValue);
        if (!isFinite(parsed) || parsed <= 0) {
            showError('Enter a bid amount > $0.00');
            return;
        }
        const cents = Math.round(parsed * 100);
        if (item.bid_amount && cents === parseInt(item.bid_amount)) {
            cancelQuickBidEdit();
            return;
        }
        setBidSaving(true);
        try {
            const res = await quickUpdateBid({
                objectId: item.id,
                objectType,
                bidAmountCents: cents,
                connectionId: selectedConnection?.id,
            });
            if (res.action === 'updated') {
                showSuccess(`Bid → $${parsed.toFixed(2)}`);
            } else if (res.action === 'skipped_same') {
                showInfo('Bid unchanged (already set to that amount)');
            } else if (res.action === 'skipped_strategy') {
                showWarning(`Not on a capped bid strategy (${res.bid_strategy || 'unknown'}) — change strategy first`);
            }
            cancelQuickBidEdit();
            fetchData();
        } catch (e) {
            showError(e.message);
        } finally {
            setBidSaving(false);
        }
    }, [bidEditValue, selectedConnection, showError, showSuccess, showInfo, showWarning, cancelQuickBidEdit]);

    const handleBidScheduleCountChange = useCallback((objectId, count) => {
        setBidScheduleCounts(prev => ({ ...prev, [objectId]: count }));
    }, []);
    const [daypartForm, setDaypartForm] = useState({
        active_start_hour: 6, active_start_minute: 0,
        active_end_hour: 22, active_end_minute: 0,
        active_days: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'America/New_York',
    });
    const [daypartSaving, setDaypartSaving] = useState(false);

    // Magic wand AI copy
    const [wandLoading, setWandLoading] = useState(false);
    const [wandMenu, setWandMenu] = useState(false);
    const [generatedBodies, setGeneratedBodies] = useState([]);
    const [generatedHeadlines, setGeneratedHeadlines] = useState([]);

    // Filter brands by account-brand mapping
    const filteredBrands = useMemo(() => {
        if (!selectedAccount) return brands;
        const mapped = accountBrandMap[selectedAccount.id];
        if (!mapped || mapped.length === 0) return brands;
        return brands.filter(b => mapped.includes(b.id));
    }, [brands, selectedAccount, accountBrandMap]);

    // ── Load connections on mount ────────────────────────────────

    useEffect(() => {
        (async () => {
            try {
                const [conns, abMap] = await Promise.all([
                    getConnections(),
                    getAccountBrandMap().catch(() => ({})),
                ]);
                setConnections(conns);
                setAccountBrandMap(abMap);
                const def = conns.find(c => c.is_default) || conns[0];
                if (def) setSelectedConnection(def);
            } catch (e) {
                console.error('Failed to load connections:', e);
            } finally {
                setLoadingSetup(false);
            }
        })();
    }, []);

    // ── Load ad accounts when connection changes ─────────────────

    useEffect(() => {
        if (!selectedConnection) return;
        (async () => {
            try {
                const accounts = await getAdAccounts(selectedConnection.id);
                setAdAccounts(accounts);
                // Restore last or pick first
                const lastId = localStorage.getItem('browser_last_account');
                const last = accounts.find(a => a.id === lastId);
                setSelectedAccount(last || accounts[0] || null);
            } catch (e) {
                console.error('Failed to load accounts:', e);
            }
        })();
    }, [selectedConnection]);

    // ── Fetch rejected count when account loads ──
    useEffect(() => {
        if (selectedAccount) {
            fetchRejectedCount(selectedAccount.id);
        }
    }, [selectedAccount, selectedConnection]);

    // ── Fetch data when account/date/level/syncStatus changes ───────────────

    useEffect(() => {
        if (!selectedAccount) return;
        if (level === 'rejected_ads') return;
        fetchData(false);
    }, [selectedAccount, activeDateRange, level]);

    const fetchData = async (forceRefresh = false) => {
        if (!selectedAccount) return;

        setLoading(true);
        setError(null);
        try {
            const connId = selectedConnection?.id;
            const { since, until } = activeDateRange;
            let result;

            // ALL reporting data comes from DB — zero live API calls.
            // Fetch sync status for display purposes
            try {
                const freshStatus = await getSyncStatus(selectedAccount.id, connId);
                setSyncStatus(freshStatus);
            } catch { setSyncStatus(null); }

            // Use daily stats endpoints for any date range (aggregated server-side)
            if (level === 'all_ads') {
                result = await getDailySyncedAllAds(selectedAccount.id, since, until, connId).catch(() => []);
            } else if (level === 'campaigns') {
                result = await getDailySyncedCampaigns(selectedAccount.id, since, until, connId).catch(() => []);
            } else if (level === 'adsets') {
                const campaignId = breadcrumbs[breadcrumbs.length - 1]?.id;
                result = await getDailySyncedAdSets(selectedAccount.id, since, until, campaignId, connId).catch(() => []);
            } else if (level === 'ads') {
                const adsetId = breadcrumbs[breadcrumbs.length - 1]?.id;
                result = await getDailySyncedAds(selectedAccount.id, since, until, adsetId, connId).catch(() => []);
            }

            if (level === 'campaigns') {
                getCampaignBrandMap(connId).then(setBrandMap).catch(() => {});
            }

            setData(result || []);
            setLastRefreshed(Date.now());

            // Fetch scheduled budgets (non-blocking, DB only)
            getScheduledBudgets(selectedAccount.id, connId).then(setScheduledBudgets).catch(() => {});

            // Fetch auto-safe log at ad level (non-blocking, DB only)
            if (level === 'ads' || level === 'all_ads') {
                getAutoSafeLog(selectedAccount.id, connId).then(logs => {
                    const byAdId = {};
                    logs.forEach(l => { byAdId[l.fb_ad_id] = l; });
                    setAutoSafeLog(byAdId);
                }).catch(() => {});
            }

            // Fetch budget surf configs (non-blocking, DB only)
            if (level === 'campaigns' || level === 'adsets') {
                getBudgetSurfConfigs(selectedAccount.id, connId).then(configs => {
                    const byObjectId = {};
                    configs.forEach(c => { byObjectId[c.fb_object_id] = c; });
                    setSurfConfigs(byObjectId);
                }).catch(() => {});
            }

            // Fetch daypart schedules (non-blocking, DB only)
            if (level === 'campaigns' || level === 'adsets') {
                getDaypartSchedules(selectedAccount.id, connId).then(schedules => {
                    const byAdsetId = {};
                    schedules.forEach(s => { byAdsetId[s.fb_adset_id] = s; });
                    setDaypartSchedules(byAdsetId);
                }).catch(() => {});

                // Fetch bid schedule counts for the badge
                getBidSchedules({ adAccountId: selectedAccount.id }).then(rules => {
                    const counts = {};
                    rules.forEach(r => {
                        counts[r.fb_object_id] = (counts[r.fb_object_id] || 0) + 1;
                    });
                    setBidScheduleCounts(counts);
                }).catch(() => {});
            }
        } catch (e) {
            console.error('Fetch error:', e);
            setError(e.message);
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    // ── Navigation ───────────────────────────────────────────────

    const drillDown = (item, nextLevel) => {
        const label = item.name || item.campaign_name || item.adset_name || item.ad_name || item.id;
        setBreadcrumbs(prev => [...prev, { label, level: nextLevel, id: item.id }]);
        setLevel(nextLevel);
        setSelectedIds(new Set());
        setSortKey('spend');
        setSortDir('desc');
    };

    const navigateTo = (index) => {
        if (index < 0) {
            setBreadcrumbs([]);
            setLevel('campaigns');
        } else {
            setBreadcrumbs(prev => prev.slice(0, index + 1));
            setLevel(breadcrumbs[index].level);
        }
        setSelectedIds(new Set());
        setSortKey('spend');
        setSortDir('desc');
    };

    // ── Sort ─────────────────────────────────────────────────────

    const toggleSort = (key) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const sortedData = useMemo(() => {
        const arr = [...data];
        arr.sort((a, b) => {
            let va, vb;
            // Check insights for numeric fields
            const numFields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach'];
            if (numFields.includes(sortKey)) {
                va = Number(a.insights?.[sortKey] ?? a[sortKey] ?? 0);
                vb = Number(b.insights?.[sortKey] ?? b[sortKey] ?? 0);
            } else if (sortKey === 'budget') {
                va = Number(a.daily_budget || a.lifetime_budget || 0);
                vb = Number(b.daily_budget || b.lifetime_budget || 0);
            } else if (sortKey === 'ev_conversions') {
                va = Number(a.insights?.results || 0);
                vb = Number(b.insights?.results || 0);
            } else if (sortKey === 'ev_cpa') {
                const ac = Number(a.insights?.results || 0);
                const bc = Number(b.insights?.results || 0);
                va = ac > 0 ? Number(a.insights?.spend || 0) / ac : 0;
                vb = bc > 0 ? Number(b.insights?.spend || 0) / bc : 0;
            } else if (sortKey === 'status') {
                va = (a.effective_status || a.status || '').toString().toLowerCase();
                vb = (b.effective_status || b.status || '').toString().toLowerCase();
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (sortKey === 'id') {
                va = (a.id || '').toString();
                vb = (b.id || '').toString();
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (sortKey === 'post_id') {
                va = (a.creative_data?.post_id || '').toString();
                vb = (b.creative_data?.post_id || '').toString();
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (sortKey === 'headline') {
                va = (a.creative_data?.headline || '').toString().toLowerCase();
                vb = (b.creative_data?.headline || '').toString().toLowerCase();
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (sortKey === 'brand') {
                const brandName = (id) => {
                    const bid = brandMap[id];
                    if (!bid) return '';
                    const br = brands.find(x => x.id === bid);
                    return (br?.name || '').toLowerCase();
                };
                va = brandName(a.id);
                vb = brandName(b.id);
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else {
                va = (a[sortKey] || a.insights?.[sortKey] || '').toString().toLowerCase();
                vb = (b[sortKey] || b.insights?.[sortKey] || '').toString().toLowerCase();
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return sortDir === 'asc' ? va - vb : vb - va;
        });
        return arr;
    }, [data, sortKey, sortDir, brandMap, brands]);

    // ── Summary stats ────────────────────────────────────────────

    const summary = useMemo(() => {
        let spend = 0, impressions = 0, clicks = 0, reach = 0, fbResults = 0;
        data.forEach(item => {
            const ins = item.insights || {};
            spend += Number(ins.spend || 0);
            impressions += Number(ins.impressions || 0);
            clicks += Number(ins.clicks || 0);
            reach += Number(ins.reach || 0);
            fbResults += Number(ins.results || 0);
        });
        const conversions = fbResults;
        const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
        const cpc = clicks > 0 ? (spend / clicks) : 0;
        const cpm = impressions > 0 ? ((spend / impressions) * 1000) : 0;
        const cpa = conversions > 0 ? (spend / conversions) : 0;
        return { spend, impressions, clicks, reach, ctr, cpc, cpm, conversions, cpa, fbResults };
    }, [data]);

    // ── Status toggle ────────────────────────────────────────────

    const handleToggleStatus = async (item) => {
        const currentStatus = item.effective_status || item.status;
        const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        const objectType = level === 'campaigns' ? 'campaign' : level === 'adsets' ? 'adset' : 'ad';

        setTogglingId(item.id);
        try {
            await updateObjectStatus(item.id, objectType, newStatus, selectedConnection?.id);
            // Update local data
            setData(prev => prev.map(d =>
                d.id === item.id ? { ...d, status: newStatus, effective_status: newStatus } : d
            ));
            showSuccess(`${objectType} ${newStatus === 'ACTIVE' ? 'activated' : 'paused'}`);
        } catch (e) {
            showError('Failed to update status: ' + e.message);
        } finally {
            setTogglingId(null);
        }
    };

    // ── Account change ───────────────────────────────────────────

    const handleAccountChange = (acct) => {
        setSelectedAccount(acct);
        localStorage.setItem('browser_last_account', acct.id);
        setBreadcrumbs([]);
        setLevel('campaigns');
        setSelectedIds(new Set());
        // useEffect on selectedAccount handles fetchRejectedCount — don't double-fire.
    };

    const fetchRejectedCount = async (accountId) => {
        try {
            const connId = selectedConnection?.id;
            const result = await getAdAlerts(accountId, connId);
            setRejectedCount(result.count || 0);
            setRejectedAds(result.alerts || []);
        } catch (e) {
            console.warn('Failed to fetch rejected ads count:', e);
            setRejectedCount(0);
            setRejectedAds([]);
        }
    };

    // ── Bulk selection ──────────────────────────────────────────

    const toggleSelection = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === sortedData.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(sortedData.map(d => d.id)));
        }
    };

    const handleBulkStatus = async (newStatus) => {
        const objectType = level === 'campaigns' ? 'campaign' : level === 'adsets' ? 'adset' : 'ad';
        const items = [...selectedIds].map(id => ({ object_id: id, object_type: objectType }));
        setBulkActionLoading(true);
        try {
            const result = await bulkUpdateStatus(items, newStatus, selectedConnection?.id);
            const succeededSet = new Set(result.succeeded);
            setData(prev => prev.map(d =>
                succeededSet.has(d.id) ? { ...d, status: newStatus, effective_status: newStatus } : d
            ));
            setSelectedIds(new Set());
            showSuccess(`${result.succeeded.length} ${objectType}(s) ${newStatus === 'ACTIVE' ? 'activated' : 'paused'}`);
            if (result.failed?.length > 0) {
                showWarning(`${result.failed.length} failed to update`);
            }
        } catch (e) {
            showError('Bulk status update failed: ' + e.message);
        } finally {
            setBulkActionLoading(false);
        }
    };

    // ── Bulk Edit (ads level) ───────────────────────────────────

    const openBulkEdit = () => {
        setBulkEditData({ primary_text: '', headline: '', description: '', cta: 'LEARN_MORE', website_url: '' });
        setBulkEditFields({ primary_text: false, headline: false, description: false, cta: false, website_url: false });
        setBulkEditSaving(false);
        setBulkEditProgress('');
        setBulkEditOpen(true);
    };

    const handleBulkEdit = async () => {
        const checkedFields = Object.keys(bulkEditFields).filter(k => bulkEditFields[k]);
        if (checkedFields.length === 0) { showError('Select at least one field to edit'); return; }

        setBulkEditSaving(true);
        const ids = [...selectedIds];
        let succeeded = 0, failed = 0;

        for (let i = 0; i < ids.length; i++) {
            setBulkEditProgress(`Saving ${i + 1}/${ids.length}...`);
            const ad = sortedData.find(d => d.id === ids[i]);
            if (!ad) { failed++; continue; }
            const cd = ad.creative_data || {};

            // Merge: use new value for checked fields, keep existing for unchecked
            const payload = {
                ad_id: ad.id,
                ad_account_id: selectedAccount?.id,
                page_id: cd.page_id || '',
                image_url: cd.image_url || '',
                image_hash: cd.image_hash || '',
                primary_text: checkedFields.includes('primary_text') ? bulkEditData.primary_text : (cd.primary_text || ''),
                headline: checkedFields.includes('headline') ? bulkEditData.headline : (cd.headline || ''),
                description: checkedFields.includes('description') ? bulkEditData.description : (cd.description || ''),
                cta: checkedFields.includes('cta') ? bulkEditData.cta : (cd.cta || 'LEARN_MORE'),
                website_url: checkedFields.includes('website_url') ? bulkEditData.website_url : (cd.website_url || ''),
                name: ad.name || ad.ad_name || 'Ad',
            };

            try {
                await editAdCreative(payload, selectedConnection?.id);
                succeeded++;
            } catch (e) {
                console.error(`Bulk edit failed for ad ${ad.id}:`, e);
                failed++;
            }
        }

        setBulkEditSaving(false);
        setBulkEditOpen(false);
        setSelectedIds(new Set());
        if (succeeded > 0) showSuccess(`${succeeded} ad${succeeded > 1 ? 's' : ''} updated`);
        if (failed > 0) showWarning(`${failed} ad${failed > 1 ? 's' : ''} failed to update`);
        fetchData(true);
    };

    // ── Bulk Delete ──────────────────────────────────────────────

    const handleBulkDelete = async () => {
        setBulkDeleteConfirm(false);
        setBulkActionLoading(true);
        const objectType = level === 'campaigns' ? 'campaign' : level === 'adsets' ? 'adset' : 'ad';
        const ids = [...selectedIds];
        let succeeded = 0, failed = 0;

        for (const id of ids) {
            try {
                await deleteObject(id, objectType, selectedConnection?.id);
                succeeded++;
            } catch (e) {
                console.error(`Bulk delete failed for ${id}:`, e);
                failed++;
            }
        }

        setData(prev => prev.filter(d => !selectedIds.has(d.id) || failed > 0));
        setSelectedIds(new Set());
        setBulkActionLoading(false);
        if (succeeded > 0) showSuccess(`${succeeded} ${objectType}${succeeded > 1 ? 's' : ''} deleted`);
        if (failed > 0) showWarning(`${failed} failed to delete`);
        fetchData(true);
    };

    // ── Bulk Duplicate ───────────────────────────────────────────

    const handleBulkDuplicate = async () => {
        setBulkDuplicateConfirm(false);
        setBulkActionLoading(true);
        const ids = [...selectedIds];
        let succeeded = 0, failed = 0;
        const label = level === 'adsets' ? 'ad set' : level === 'campaigns' ? 'campaign' : 'ad';

        for (const id of ids) {
            const item = sortedData.find(d => d.id === id);
            const name = (item?.name || item?.ad_name || item?.adset_name || item?.campaign_name || 'Item') + ' (Copy)';
            try {
                if (level === 'adsets') {
                    await duplicateAdSet(id, selectedAccount?.id, selectedConnection?.id, name);
                } else if (level === 'campaigns') {
                    await duplicateCampaign(id, selectedAccount?.id, selectedConnection?.id, name);
                } else {
                    await duplicateAd(id, selectedAccount?.id, selectedConnection?.id, name);
                }
                succeeded++;
            } catch (e) {
                console.error(`Bulk duplicate failed for ${id}:`, e);
                failed++;
            }
        }

        setSelectedIds(new Set());
        setBulkActionLoading(false);
        if (succeeded > 0) showSuccess(`${succeeded} ${label}${succeeded > 1 ? 's' : ''} duplicated`);
        if (failed > 0) showWarning(`${failed} failed to duplicate`);
        fetchData(true);
    };

    // ── Bulk Safe ─────────────────────────────────────────────
    const [bulkSafeConfirm, setBulkSafeConfirm] = useState(false);

    const handleBulkSafe = async () => {
        setBulkSafeConfirm(false);
        setBulkActionLoading(true);
        const ids = [...selectedIds];
        let succeeded = 0, failed = 0;

        for (const id of ids) {
            const item = sortedData.find(d => d.id === id);
            const pageId = (item?.creative_data || {}).page_id;
            if (!pageId) {
                // Try to find page_id from other ads
                const otherPageId = sortedData.find(d => d.creative_data?.page_id)?.creative_data?.page_id;
                if (!otherPageId) { failed++; continue; }
                try {
                    const safeAd = getRandomSafeAd(otherPageId);
                    await editAdCreative({
                        ad_id: id,
                        ad_account_id: selectedAccount.id,
                        page_id: otherPageId,
                        ...safeAd,
                        name: `${item?.name || 'Ad'} - Safe ${new Date().toLocaleDateString()}`,
                    }, selectedConnection?.id);
                    try { await updateObjectStatus(id, 'ad', 'PAUSED', selectedConnection?.id); } catch (e) {}
                    succeeded++;
                } catch (e) { failed++; }
            } else {
                try {
                    const safeAd = getRandomSafeAd(pageId);
                    await editAdCreative({
                        ad_id: id,
                        ad_account_id: selectedAccount.id,
                        page_id: pageId,
                        ...safeAd,
                        name: `${item?.name || 'Ad'} - Safe ${new Date().toLocaleDateString()}`,
                    }, selectedConnection?.id);
                    try { await updateObjectStatus(id, 'ad', 'PAUSED', selectedConnection?.id); } catch (e) {}
                    succeeded++;
                } catch (e) { failed++; }
            }
        }

        setSelectedIds(new Set());
        setBulkActionLoading(false);
        if (succeeded > 0) showSuccess(`${succeeded} ad${succeeded > 1 ? 's' : ''} converted to safe and paused`);
        if (failed > 0) showWarning(`${failed} failed to convert`);
        fetchData(true);
    };

    // ── Duplicate (campaign / ad set / ad) ──────────────────────

    const openDuplicatePopover = (item) => {
        setDuplicatePopoverId(item.id);
        const name = item.name || item.campaign_name || item.adset_name || item.ad_name || 'Item';
        setDuplicateName(name + ' (Copy)');
    };

    const openCloneModal = (item) => {
        setCloneModalCampaign(item);
        setCloneName((item.name || 'Campaign') + ' (Clone)');
        setCloneTargetAccount('');
    };

    const handleClone = async () => {
        if (!cloneModalCampaign || !cloneTargetAccount) return;
        setCloning(true);
        try {
            const result = await cloneCampaignToAccount(
                cloneModalCampaign.id,
                cloneTargetAccount,
                selectedConnection?.id,
                cloneName || null,
            );
            showSuccess(`Cloned to ${result.target_account}: ${result.adsets_cloned} ad sets`);
            setCloneModalCampaign(null);
        } catch (e) {
            showError(e.message || 'Clone failed');
        } finally {
            setCloning(false);
        }
    };

    const handleDuplicate = async (item, objectLevel = null, customName = null) => {
        const lvl = objectLevel || level;
        setDuplicatingId(item.id);
        setDuplicatePopoverId(null);
        try {
            const nameArg = customName || null;
            if (lvl === 'campaigns') {
                const result = await duplicateCampaign(item.id, selectedAccount?.id, selectedConnection?.id, nameArg);
                showSuccess(`Campaign duplicated — ${result.adsets_duplicated} ad sets, ${result.ads_duplicated} ads copied`);
            } else if (lvl === 'adsets') {
                const result = await duplicateAdSet(item.id, selectedAccount?.id, selectedConnection?.id, nameArg);
                showSuccess(`Ad set duplicated — ${result.ads_duplicated} ads copied (starts 1am EST)`);
            } else {
                await duplicateAd(item.id, selectedAccount?.id, selectedConnection?.id, nameArg);
                showSuccess('Ad duplicated (starts PAUSED)');
            }
            fetchData();
        } catch (e) {
            if (e.message?.includes('403') || e.message?.toLowerCase().includes('permission') || e.message?.toLowerCase().includes('advertise')) {
                showError('Missing ADVERTISE permission on this ad\'s Page. Go to Business Manager → Pages → assign your user the ADVERTISE task, then retry.');
            } else {
                showError('Failed to duplicate: ' + e.message);
            }
        } finally {
            setDuplicatingId(null);
        }
    };

    // ── Schedule budget change ──────────────────────────────────

    const handleScheduleBudget = async (itemId, objectType) => {
        const dollars = parseFloat(editBudgetValue);
        if (!dollars || dollars <= 0) { showError('Enter a valid budget amount'); return; }
        if (!editBudgetScheduledAt) { showError('Pick a scheduled time'); return; }
        // datetime-local gives "YYYY-MM-DDTHH:MM" with no tz — backend treats naive as EST
        const scheduledForISO = editBudgetScheduledAt.length === 16 ? editBudgetScheduledAt + ':00' : editBudgetScheduledAt;
        setSchedulingBudget(true);
        try {
            const result = await scheduleBudgetChange(itemId, objectType, dollars, selectedAccount?.id, selectedConnection?.id, scheduledForISO);
            const whenLabel = new Date(result.scheduled_for).toLocaleString('en-US', {
                timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            showSuccess(`$${dollars.toFixed(2)}/day scheduled for ${whenLabel} EST`);
            setEditingBudgetId(null);
            setEditBudgetValue('');
            setEditBudgetScheduledAt('');
            getScheduledBudgets(selectedAccount?.id, selectedConnection?.id).then(setScheduledBudgets).catch(() => {});
        } catch (e) {
            showError('Failed to schedule budget: ' + e.message);
        } finally {
            setSchedulingBudget(false);
        }
    };

    const handleCancelScheduledBudget = async (changeId) => {
        try {
            await cancelScheduledBudget(changeId, selectedConnection?.id);
            showSuccess('Scheduled budget change cancelled');
            setScheduledBudgets(prev => prev.filter(s => s.id !== changeId));
        } catch (e) {
            showError('Failed to cancel: ' + e.message);
        }
    };

    // ── Rename ad ────────────────────────────────────────────────

    const startEditing = (item) => {
        setEditingId(item.id);
        setEditName(item.name || '');
    };

    const saveRename = async () => {
        if (!editingId || !editName.trim()) return;
        const objectType = level === 'campaigns' ? 'campaign' : level === 'adsets' ? 'adset' : 'ad';
        const label = level === 'campaigns' ? 'Campaign' : level === 'adsets' ? 'Ad Set' : 'Ad';
        try {
            await renameObject(editingId, objectType, editName.trim(), selectedConnection?.id);
            setData(prev => prev.map(d =>
                d.id === editingId ? { ...d, name: editName.trim() } : d
            ));
            showSuccess(`${label} renamed`);
        } catch (e) {
            showError('Failed to rename: ' + e.message);
        } finally {
            setEditingId(null);
            setEditName('');
        }
    };

    // ── Delete ─────────────────────────────────────────────────────

    const handleDelete = async (item) => {
        const objectType = level === 'campaigns' ? 'campaign' : level === 'adsets' ? 'adset' : 'ad';
        const label = level === 'campaigns' ? 'Campaign' : level === 'adsets' ? 'Ad Set' : 'Ad';
        setDeletingId(item.id);
        setConfirmDeleteItem(null);
        try {
            await deleteObject(item.id, objectType, selectedConnection?.id);
            setData(prev => prev.filter(d => d.id !== item.id));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(item.id); return next; });
            showSuccess(`${label} deleted`);
        } catch (e) {
            showError('Failed to delete: ' + e.message);
        } finally {
            setDeletingId(null);
        }
    };

    // ── Budget Surfing ──────────────────────────────────────────

    const openSurfPopover = (item) => {
        const existing = surfConfigs[item.id];
        if (existing) {
            setSurfForm({
                base_budget: (existing.base_budget_cents / 100).toFixed(2),
                min_conversions: existing.min_conversions,
                noon_multiplier: existing.noon_multiplier,
                afternoon_multiplier: existing.afternoon_multiplier,
            });
        } else {
            setSurfForm({
                base_budget: item.daily_budget ? (item.daily_budget / 100).toFixed(2) : '',
                min_conversions: 10,
                noon_multiplier: 2,
                afternoon_multiplier: 4,
            });
        }
        setSurfPopoverId(surfPopoverId === item.id ? null : item.id);
    };

    const saveSurfConfig = async (objectId) => {
        setSurfSaving(true);
        try {
            const connId = selectedConnection?.id || connections[0]?.id;
            const objectType = level === 'campaigns' ? 'campaign' : 'adset';
            const result = await createBudgetSurf({
                fb_object_id: objectId,
                object_type: objectType,
                ad_account_id: selectedAccount.id,
                connection_id: connId,
                base_budget_cents: Math.round(parseFloat(surfForm.base_budget) * 100),
                min_conversions: surfForm.min_conversions,
                noon_multiplier: surfForm.noon_multiplier,
                afternoon_multiplier: surfForm.afternoon_multiplier,
            });
            setSurfConfigs(prev => ({ ...prev, [objectId]: result }));
            setSurfPopoverId(null);
            showSuccess(`Budget surfing enabled: base $${surfForm.base_budget}/day, ${surfForm.noon_multiplier}x at noon, ${surfForm.afternoon_multiplier}x at 4pm`);
        } catch (e) {
            showError(e.message);
        } finally {
            setSurfSaving(false);
        }
    };

    const removeSurfConfig = async (objectId) => {
        const existing = surfConfigs[objectId];
        if (!existing) return;
        try {
            await deleteBudgetSurf(existing.id);
            setSurfConfigs(prev => {
                const next = { ...prev };
                delete next[objectId];
                return next;
            });
            setSurfPopoverId(null);
            showSuccess('Budget surfing removed');
        } catch (e) {
            showError(e.message);
        }
    };

    const toggleSurfEnabled = async (objectId) => {
        const existing = surfConfigs[objectId];
        if (!existing) return;
        try {
            const result = await updateBudgetSurf(existing.id, { enabled: !existing.enabled });
            setSurfConfigs(prev => ({ ...prev, [objectId]: result }));
            showSuccess(result.enabled ? 'Surfing enabled' : 'Surfing paused');
        } catch (e) {
            showError(e.message);
        }
    };

    const openSurfLogs = async (configId) => {
        setSurfLogModal(configId);
        try {
            const logs = await getBudgetSurfLogs(configId);
            setSurfLogs(logs);
        } catch (e) {
            setSurfLogs([]);
        }
    };

    // ── Dayparting ────────────────────────────────────────────────

    const openDaypartPopover = (item) => {
        const existing = daypartSchedules[item.id];
        if (existing) {
            setDaypartForm({
                active_start_hour: existing.active_start_hour,
                active_start_minute: existing.active_start_minute || 0,
                active_end_hour: existing.active_end_hour,
                active_end_minute: existing.active_end_minute || 0,
                active_days: existing.active_days || [0, 1, 2, 3, 4, 5, 6],
                timezone: existing.timezone || 'America/New_York',
            });
        } else {
            setDaypartForm({
                active_start_hour: 6, active_start_minute: 0,
                active_end_hour: 22, active_end_minute: 0,
                active_days: [0, 1, 2, 3, 4, 5, 6],
                timezone: 'America/New_York',
            });
        }
        setDaypartPopoverId(item.id);
    };

    const saveDaypartSchedule = async (adsetId) => {
        setDaypartSaving(true);
        try {
            const connId = selectedConnection?.id || connections[0]?.id;
            const objectType = level === 'campaigns' ? 'campaign' : 'adset';
            const result = await upsertDaypartSchedule({
                fb_adset_id: adsetId,
                object_type: objectType,
                ad_account_id: selectedAccount.id,
                connection_id: connId,
                ...daypartForm,
            });
            setDaypartSchedules(prev => ({ ...prev, [adsetId]: result }));
            setDaypartPopoverId(null);
            showSuccess(`Daypart schedule saved: ${daypartForm.active_start_hour}:${String(daypartForm.active_start_minute).padStart(2,'0')} – ${daypartForm.active_end_hour}:${String(daypartForm.active_end_minute).padStart(2,'0')}`);
        } catch (e) {
            showError(e.message);
        } finally {
            setDaypartSaving(false);
        }
    };

    const removeDaypartSchedule = async (adsetId) => {
        const existing = daypartSchedules[adsetId];
        if (!existing) return;
        try {
            await deleteDaypartSchedule(existing.id);
            setDaypartSchedules(prev => {
                const next = { ...prev };
                delete next[adsetId];
                return next;
            });
            setDaypartPopoverId(null);
            showSuccess('Daypart schedule removed');
        } catch (e) {
            showError(e.message);
        }
    };

    const handleToggleDaypart = async (adsetId) => {
        const existing = daypartSchedules[adsetId];
        if (!existing) return;
        try {
            const result = await toggleDaypartSchedule(existing.id);
            setDaypartSchedules(prev => ({ ...prev, [adsetId]: result }));
            showSuccess(result.enabled ? 'Daypart enabled' : 'Daypart paused');
        } catch (e) {
            showError(e.message);
        }
    };

    const toggleDaypartDay = (day) => {
        setDaypartForm(prev => {
            const days = prev.active_days.includes(day)
                ? prev.active_days.filter(d => d !== day)
                : [...prev.active_days, day].sort();
            return { ...prev, active_days: days };
        });
    };

    // ── Safe Ad (quick swap to safe creative) ─────────────────────

    const handleSafeAd = async (item) => {
        if (!selectedAccount?.id) {
            showError('No ad account selected. Please select an account first.');
            return;
        }
        if (!selectedConnection?.id) {
            showError('No Facebook connection selected.');
            return;
        }
        const cd = item.creative_data || {};
        let pageId = cd.page_id;
        if (!pageId) {
            // Boosted-post creatives: derive page_id from story_id (format: pageId_postId)
            const storyId = cd.story_id || cd.effective_object_story_id || '';
            if (storyId && String(storyId).includes('_')) {
                pageId = String(storyId).split('_')[0];
            }
        }
        if (!pageId) {
            // Last resort: borrow page_id from any other ad in the current view
            pageId = data.find(d => d?.creative_data?.page_id)?.creative_data?.page_id;
        }
        if (!pageId) {
            showError('Cannot swap creative: no page ID found on this ad.');
            return;
        }
        setSafeAdLoadingId(item.id);
        setSafeAdConfirmId(null);
        try {
            const preflight = await runPreflightCheck(pageId, selectedAccount.id, selectedConnection.id);
            if (!preflight.passed) {
                const failed = (preflight.checks || []).filter(c => !c.passed);
                const acctFail = failed.find(c => c.name === 'ad_account');
                const tokenFail = failed.find(c => c.name === 'token_valid' || c.name === 'scopes');
                let msg;
                if (acctFail) {
                    msg = `Ad account check failed: ${acctFail.detail || acctFail.label}. Reconnect Facebook in Settings or verify Business Manager access on this account.`;
                } else if (tokenFail) {
                    msg = `Facebook token issue: ${tokenFail.detail || tokenFail.label}. Re-authenticate in Settings.`;
                } else {
                    msg = `Pre-flight failed: ${failed.map(c => c.label).join('; ')}`;
                }
                throw new Error(msg);
            }
            const safeAd = getRandomSafeAd(pageId);
            await editAdCreative({
                ad_id: item.id,
                ad_account_id: selectedAccount.id,
                page_id: pageId,
                ...safeAd,
                name: `${item.name || 'Ad'} - Safe ${new Date().toLocaleDateString()}`,
            }, selectedConnection.id);
            // Pause the ad so the safe placeholder doesn't spend money
            try {
                await updateObjectStatus(item.id, 'ad', 'PAUSED', selectedConnection.id);
            } catch (e) {
                console.warn('Safe swap succeeded but failed to pause ad:', e);
            }
            showSuccess('Ad swapped to safe creative and paused!');
            fetchData(true);
        } catch (e) {
            showError('Failed to swap to safe ad: ' + e.message);
        } finally {
            setSafeAdLoadingId(null);
        }
    };

    // ── Budget Scheduling (FB Native) ─────────────────────────

    const openBudgetSchedule = async (item, objectType) => {
        setBudgetSchedModal({ id: item.id, type: objectType, name: item.name });
        setBudgetSchedForm({ amount: '', start_hour: 9, end_hour: 15 });
        setBudgetSchedLoading(true);
        try {
            const scheds = await getBudgetSchedules(item.id, objectType, selectedConnection?.id);
            setBudgetScheds(scheds);
        } catch (e) { setBudgetScheds([]); }
        finally { setBudgetSchedLoading(false); }
    };

    const handleCreateBudgetSchedule = async () => {
        if (!budgetSchedModal || !budgetSchedForm.amount) return;
        setBudgetSchedSaving(true);
        try {
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            await createBudgetSchedule(budgetSchedModal.id, {
                object_type: budgetSchedModal.type,
                budget_value: Math.round(parseFloat(budgetSchedForm.amount) * 100),
                budget_value_type: 'ABSOLUTE',
                time_start: `${today}T${String(budgetSchedForm.start_hour).padStart(2,'0')}:00:00`,
                time_end: `${today}T${String(budgetSchedForm.end_hour).padStart(2,'0')}:00:00`,
            }, selectedConnection?.id);
            showSuccess(`Budget schedule added: +$${budgetSchedForm.amount} from ${budgetSchedForm.start_hour}:00 to ${budgetSchedForm.end_hour}:00`);
            // Refresh schedules
            const scheds = await getBudgetSchedules(budgetSchedModal.id, budgetSchedModal.type, selectedConnection?.id);
            setBudgetScheds(scheds);
            setBudgetSchedForm({ amount: '', start_hour: 9, end_hour: 15 });
        } catch (e) { showError(e.message); }
        finally { setBudgetSchedSaving(false); }
    };

    const handleDeleteBudgetSchedule = async (scheduleId) => {
        try {
            await deleteBudgetScheduleApi(scheduleId, selectedConnection?.id);
            setBudgetScheds(prev => prev.filter(s => s.id !== scheduleId));
            showSuccess('Budget schedule removed');
        } catch (e) { showError(e.message); }
    };

    // ── Edit Campaign ──────────────────────────────────────────

    const openEditCampaign = (item) => {
        setEditCampaign(item);
        setEditCampaignData({
            name: item.name || '',
            daily_budget: item.daily_budget ? (item.daily_budget / 100).toFixed(2) : '',
            bid_strategy: item.bid_strategy || '',
            special_ad_categories: (item.special_ad_categories || []).join(', '),
        });
    };

    const handleSaveCampaign = async () => {
        if (!editCampaign) return;
        setEditCampaignSaving(true);
        try {
            const params = {};
            if (editCampaignData.name) params.name = editCampaignData.name;
            if (editCampaignData.daily_budget) params.daily_budget = Math.round(parseFloat(editCampaignData.daily_budget) * 100);
            if (editCampaignData.bid_strategy) params.bid_strategy = editCampaignData.bid_strategy;
            if (editCampaignData.special_ad_categories?.trim()) {
                params.special_ad_categories = editCampaignData.special_ad_categories.split(',').map(c => c.trim()).filter(Boolean);
            }

            await updateCampaign(editCampaign.id, params, selectedConnection?.id);
            showSuccess('Campaign updated');
            setEditCampaign(null);
            fetchData();
        } catch (e) {
            showError(e.message);
        } finally {
            setEditCampaignSaving(false);
        }
    };

    // ── Edit Ad Set ──────────────────────────────────────────────

    const openEditAdSet = (item) => {
        const targeting = item.targeting || {};
        const geoLocs = targeting.geo_locations || {};
        setEditAdSet(item);
        setEditAdSetData({
            name: item.name || '',
            daily_budget: item.daily_budget ? (item.daily_budget / 100).toFixed(2) : '',
            bid_amount: item.bid_amount ? (item.bid_amount / 100).toFixed(2) : '',
            optimization_goal: item.optimization_goal || '',
            age_min: targeting.age_min || 18,
            age_max: targeting.age_max || 65,
            genders: targeting.genders || [],
            countries: (geoLocs.countries || []).join(', '),
            start_time: item.start_time ? item.start_time.slice(0, 16) : '',
            end_time: item.end_time ? item.end_time.slice(0, 16) : '',
        });
    };

    const handleSaveAdSet = async () => {
        if (!editAdSet) return;
        setEditAdSetSaving(true);
        try {
            const params = {};
            if (editAdSetData.name) params.name = editAdSetData.name;
            if (editAdSetData.daily_budget) params.daily_budget = Math.round(parseFloat(editAdSetData.daily_budget) * 100);
            if (editAdSetData.bid_amount) params.bid_amount = Math.round(parseFloat(editAdSetData.bid_amount) * 100);
            if (editAdSetData.optimization_goal) params.optimization_goal = editAdSetData.optimization_goal;

            // Build targeting object
            const targeting = {};
            if (editAdSetData.age_min) targeting.age_min = parseInt(editAdSetData.age_min);
            if (editAdSetData.age_max) targeting.age_max = parseInt(editAdSetData.age_max);
            if (editAdSetData.genders?.length) targeting.genders = editAdSetData.genders;
            if (editAdSetData.countries?.trim()) {
                targeting.geo_locations = {
                    countries: editAdSetData.countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
                };
            }
            if (Object.keys(targeting).length > 0) params.targeting = targeting;
            if (editAdSetData.start_time) params.start_time = new Date(editAdSetData.start_time).toISOString();
            if (editAdSetData.end_time) params.end_time = new Date(editAdSetData.end_time).toISOString();

            await updateAdSet(editAdSet.id, params, selectedConnection?.id);
            showSuccess('Ad set updated');
            setEditAdSet(null);
            fetchData();
        } catch (e) {
            showError(e.message);
        } finally {
            setEditAdSetSaving(false);
        }
    };

    // ── Edit Creative ──────────────────────────────────────────────

    const openEditCreative = (item) => {
        const cd = item.creative_data || {};
        setEditCreativeAd(item);
        setEditCreativeData({
            primary_text: cd.primary_text || '',
            headline: cd.headline || '',
            description: cd.description || '',
            cta: cd.cta || 'LEARN_MORE',
            website_url: cd.website_url || '',
            image_url: cd.image_url || '',
            image_hash: cd.image_hash || '',
            new_image_file: null,
            new_image_preview: '',
            page_id: cd.page_id || '',
            is_video: !!cd.is_video,
            video_id: cd.video_id || '',
        });
        setImageChanged(false);
        setEditCreativeSaving(false);
        setWandMenu(false);
        setWandLoading(false);
        setGeneratedBodies([]);
        setGeneratedHeadlines([]);
    };

    const handleEditCreativeImageFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        setEditCreativeData(prev => ({ ...prev, new_image_file: file, new_image_preview: previewUrl }));
        setImageChanged(true);
    };

    const handleEditCreativePaste = (e) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imageItem = items.find(item => item.type.startsWith('image/'));
        if (imageItem) {
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (file) {
                const previewUrl = URL.createObjectURL(file);
                setEditCreativeData(prev => ({ ...prev, new_image_file: file, new_image_preview: previewUrl }));
                setImageChanged(true);
            }
        }
    };

    const saveEditCreative = async () => {
        if (!editCreativeAd) return;
        setEditCreativeSaving(true);
        try {
            let imageUrl = editCreativeData.image_url; // default: keep existing
            const isVideo = editCreativeData.is_video;

            if (!isVideo && imageChanged) {
                if (editCreativeData.new_image_file) {
                    // Upload file to backend first
                    const formData = new FormData();
                    const f = editCreativeData.new_image_file;
                    const ext = f.type === 'image/png' ? '.png' : f.type === 'image/webp' ? '.webp' : '.jpg';
                    formData.append('file', f, `upload${ext}`);
                    const token = localStorage.getItem('accessToken');
                    const uploadResp = await fetch(
                        (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/uploads/',
                        { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData }
                    );
                    if (!uploadResp.ok) throw new Error('Failed to upload image');
                    const uploadResult = await uploadResp.json();
                    imageUrl = uploadResult.url;
                } else if (editCreativeData.image_url?.startsWith('http')) {
                    // URL was pasted directly — use it as-is
                    imageUrl = editCreativeData.image_url;
                }
            }

            const editPayload = {
                ad_id: editCreativeAd.id,
                ad_account_id: selectedAccount?.id,
                page_id: editCreativeData.page_id,
                primary_text: editCreativeData.primary_text,
                headline: editCreativeData.headline,
                description: editCreativeData.description,
                cta: editCreativeData.cta,
                website_url: editCreativeData.website_url,
                name: `${editCreativeAd.name || 'Ad'} - Edited ${new Date().toLocaleDateString()}`,
            };
            if (isVideo) {
                editPayload.video_id = editCreativeData.video_id;
                // Skip thumbnail_url: FB CDN URLs can't be re-fetched; FB auto-generates
                // from the video if omitted.
            } else {
                editPayload.image_url = imageUrl;
                // Pass existing image_hash when image wasn't changed — avoids re-fetch from FB
                if (!imageChanged && editCreativeData.image_hash) {
                    editPayload.image_hash = editCreativeData.image_hash;
                }
            }
            await editAdCreative(editPayload, selectedConnection?.id);

            showSuccess('Creative updated successfully!');
            setEditCreativeAd(null);
            if (editCreativeData.new_image_preview) URL.revokeObjectURL(editCreativeData.new_image_preview);
            fetchData(true);
        } catch (e) {
            showError('Failed to edit creative: ' + e.message);
        } finally {
            setEditCreativeSaving(false);
        }
    };

    // ── Magic Wand AI copy ───────────────────────────────────────────

    const handleMagicWand = async (provider) => {
        setWandMenu(false);
        const imageUrl = editCreativeData.new_image_preview || editCreativeData.image_url;
        if (!imageUrl) {
            showWarning('No image available for AI analysis');
            return;
        }
        setWandLoading(true);
        setGeneratedBodies([]);
        setGeneratedHeadlines([]);
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
            const token = localStorage.getItem('accessToken');
            const formData = new FormData();
            formData.append('url', imageUrl);
            const resp = await fetch(
                `${API_URL}/video-analysis/analyze-image?provider=${provider}`,
                { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData }
            );
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'AI analysis failed');
            }
            const data = await resp.json();
            const bodies = data.bodies || [];
            const headlines = data.headlines || [];
            setGeneratedBodies(bodies);
            setGeneratedHeadlines(headlines);
            // Auto-fill with first result
            if (bodies.length > 0) {
                setEditCreativeData(prev => ({ ...prev, primary_text: bodies[0] }));
            }
            if (headlines.length > 0) {
                setEditCreativeData(prev => ({ ...prev, headline: headlines[0] }));
            }
            showSuccess(`${provider === 'safe' ? 'Safe' : 'AI'} copy generated!`);
        } catch (e) {
            showError('AI copy failed: ' + e.message);
        } finally {
            setWandLoading(false);
        }
    };

    // ── Ad preview (Facebook Previews API) ─────────────────────────

    const openPreview = async (item) => {
        setPreviewAd(item);
        setPreviewHtml('');
        setPreviewLoading(true);
        setPreviewFormat('DESKTOP_FEED_STANDARD');
        try {
            const result = await getAdPreview(item.id, 'DESKTOP_FEED_STANDARD', selectedConnection?.id);
            if (result.length > 0) {
                const url = extractIframeSrc(result[0].body);
                setPreviewHtml(url || '');
            }
        } catch (e) {
            console.error('Preview error:', e);
            setPreviewHtml('');
        } finally {
            setPreviewLoading(false);
        }
    };

    const switchPreviewFormat = async (format) => {
        setPreviewFormat(format);
        setPreviewHtml('');
        setPreviewLoading(true);
        try {
            const result = await getAdPreview(previewAd.id, format, selectedConnection?.id);
            if (result.length > 0) {
                const url = extractIframeSrc(result[0].body);
                setPreviewHtml(url || '');
            }
        } catch (e) {
            setPreviewHtml('');
        } finally {
            setPreviewLoading(false);
        }
    };

    // ── Sort header component ────────────────────────────────────

    const SortHeader = ({ label, field, className = '' }) => (
        <th
            className={`px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none ${className}`}
            onClick={() => toggleSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                {sortKey === field ? (
                    sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                ) : (
                    <ArrowUpDown size={13} className="text-gray-300 dark:text-gray-600" />
                )}
            </div>
        </th>
    );

    // ── Render ───────────────────────────────────────────────────

    if (loadingSetup) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader size={24} className="animate-spin text-amber-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 sm:gap-3">
                        <BarChart3 size={28} className="text-amber-600 sm:w-8 sm:h-8" />
                        FB Campaigns
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">Browse, manage, and create Facebook campaigns</p>
                </div>
                <div className="flex items-center gap-2">
                    {level === 'adsets' && breadcrumbs.length >= 1 && (
                        <button onClick={() => {
                            const campaignId = breadcrumbs[0]?.id;
                            setCreateAdSetModal({ campaignId, adAccountId: selectedAccount?.id });
                            setCreateAdSetData({ name: '', daily_budget: '', optimization_goal: 'OFFSITE_CONVERSIONS', countries: 'US', age_min: 18, age_max: 65 });
                        }}
                            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                            <Plus size={16} /> Create Ad Set
                        </button>
                    )}
                    {(level === 'ads') && breadcrumbs.length >= 2 && (
                        <button onClick={() => {
                            const adsetId = breadcrumbs[breadcrumbs.length - 1]?.id;
                            const campaignId = breadcrumbs[breadcrumbs.length - 2]?.id;
                            setCreateAdModal({ adsetId, adAccountId: selectedAccount?.id, campaignId });
                            setCreateAdList([emptyAd()]);
                            setCreateAdTargetAdsets(new Set([adsetId]));
                        }}
                            className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                            <Plus size={16} /> Create Ad
                        </button>
                    )}
                    <button onClick={() => navigate(`/facebook-campaigns?account_id=${selectedAccount?.id || ''}&connection_id=${selectedConnection?.id || ''}`)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                        <Plus size={16} /> Create Campaign
                    </button>
                </div>
            </div>

            {/* Top Bar: Connection, Account, Date Range */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3 sm:gap-4">
                    {/* Connection */}
                    {connections.length > 1 && (
                        <div className="w-full sm:w-auto sm:min-w-[180px]">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Connection</label>
                            <select
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                value={selectedConnection?.id || ''}
                                onChange={(e) => {
                                    const conn = connections.find(c => c.id === e.target.value);
                                    setSelectedConnection(conn);
                                    setSelectedAccount(null);
                                    setAdAccounts([]);
                                    setSelectedIds(new Set());
                                    setBreadcrumbs([]);
                                    setLevel('campaigns');
                                }}
                            >
                                {connections.map(c => (
                                    <option key={c.id} value={c.id}>{c.name || c.id}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Ad Account */}
                    <div className="w-full sm:w-auto sm:min-w-[220px]">
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Account</label>
                        <select
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            value={selectedAccount?.id || ''}
                            onChange={(e) => {
                                const acct = adAccounts.find(a => a.id === e.target.value);
                                if (acct) handleAccountChange(acct);
                            }}
                        >
                            {adAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name} ({a.accountId})</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Range */}
                    <div className="w-full sm:w-auto sm:min-w-[180px]">
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Date Range</label>
                        <select
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            value={datePreset}
                            onChange={(e) => setDatePreset(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}
                        >
                            {presets.map((p, i) => (
                                <option key={i} value={i}>{p.label}</option>
                            ))}
                            <option value="custom">Custom</option>
                        </select>
                    </div>

                    {/* Custom dates */}
                    {datePreset === 'custom' && (
                        <>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
                                <input
                                    type="date"
                                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200"
                                    value={customSince}
                                    onChange={(e) => setCustomSince(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
                                <input
                                    type="date"
                                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200"
                                    value={customUntil}
                                    onChange={(e) => setCustomUntil(e.target.value)}
                                />
                            </div>
                        </>
                    )}

                    {/* Refresh */}
                    <button
                        onClick={() => fetchData(true)}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors w-full sm:w-auto"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>

                {/* Date + sync status indicator */}
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                    <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        {activeDateRange.since} to {activeDateRange.until}
                    </div>
                    <div className="flex items-center gap-2">
                        {syncStatus?.synced ? (() => {
                            const syncedAt = new Date(syncStatus.last_synced_at);
                            const minutesAgo = Math.round((Date.now() - syncedAt.getTime()) / 60000);
                            return (
                                <span className="flex items-center gap-1">
                                    <span className={`w-1.5 h-1.5 rounded-full ${minutesAgo < 30 ? 'bg-green-500' : 'bg-amber-500'}`} />
                                    Synced {minutesAgo < 1 ? 'just now' : `${minutesAgo}m ago`}
                                    {' '}&middot; {syncStatus.campaigns_count} campaigns, {syncStatus.ads_count} ads
                                </span>
                            );
                        })() : (
                            <span className="text-amber-500">Not synced yet</span>
                        )}
                        <button
                            onClick={async () => {
                                setSyncing(true);
                                try {
                                    await triggerSync(selectedAccount.id, selectedConnection?.id);
                                    showSuccess('Sync started! Data will refresh in ~1 min.');
                                    // Poll for updated sync status after a delay
                                    setTimeout(() => {
                                        getSyncStatus(selectedAccount.id, selectedConnection?.id)
                                            .then(setSyncStatus).catch(() => {});
                                    }, 60000);
                                } catch (e) {
                                    showError('Failed to trigger sync: ' + e.message);
                                } finally {
                                    setSyncing(false);
                                }
                            }}
                            disabled={syncing || !selectedAccount}
                            className="text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
                        >
                            {syncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
            </div>

            {/* View Toggle + Breadcrumbs */}
            <div className="flex items-center gap-3">
                <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                    <button
                        onClick={() => { if (level === 'all_ads' || level === 'rejected_ads') { setLevel('campaigns'); setBreadcrumbs([]); setSelectedIds(new Set()); } }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${level !== 'all_ads' && level !== 'rejected_ads' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        Campaigns
                    </button>
                    <button
                        onClick={() => { setLevel('all_ads'); setBreadcrumbs([]); setSelectedIds(new Set()); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${level === 'all_ads' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        All Ads
                    </button>
                    <button
                        onClick={() => { setLevel('rejected_ads'); setBreadcrumbs([]); setSelectedIds(new Set()); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${level === 'rejected_ads' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        Rejected
                        {rejectedCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                                {rejectedCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {breadcrumbs.length > 0 && level !== 'all_ads' && (
                <>
                    {/* Mobile back button */}
                    <div className="sm:hidden">
                        <button
                            onClick={() => navigateTo(breadcrumbs.length - 2)}
                            className="flex items-center gap-2 w-full px-4 py-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm text-amber-700 dark:text-amber-400 font-medium text-sm active:bg-amber-50 dark:active:bg-gray-700"
                        >
                            <ChevronRight size={16} className="rotate-180" />
                            Back to {breadcrumbs.length === 1 ? 'All Campaigns' : breadcrumbs[breadcrumbs.length - 2]?.label}
                        </button>
                    </div>
                    {/* Desktop breadcrumbs */}
                    <div className="hidden sm:flex items-center gap-1 text-sm">
                        <button
                            onClick={() => navigateTo(-1)}
                            className="text-amber-600 hover:text-amber-700 font-medium"
                        >
                            All Campaigns
                        </button>
                        {breadcrumbs.map((bc, i) => (
                            <React.Fragment key={i}>
                                <ChevronRight size={14} className="text-gray-400" />
                                {i < breadcrumbs.length - 1 ? (
                                    <button
                                        onClick={() => navigateTo(i)}
                                        className="text-amber-600 hover:text-amber-700 font-medium"
                                    >
                                        {bc.label}
                                    </button>
                                ) : (
                                    <span className="text-gray-700 dark:text-gray-300 font-medium">{bc.label}</span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </>
            )}

            {/* Summary Cards — matches Dashboard KPIs */}
            {level !== 'rejected_ads' && (() => {
                const kpis = [
                    { label: 'Spend', value: fmtMoney(summary.spend), icon: DollarSign, color: 'text-red-500' },
                    { label: 'Purchases', value: summary.conversions > 0 ? fmt(summary.conversions) : '—', icon: Target, color: 'text-amber-500' },
                    { label: 'CPA', value: summary.cpa > 0 ? fmtMoney(summary.cpa) : '—', icon: Target, color: 'text-orange-500' },
                    { label: 'Impressions', value: fmt(summary.impressions), icon: Eye, color: 'text-blue-500' },
                    { label: 'Clicks', value: fmt(summary.clicks), icon: MousePointerClick, color: 'text-green-500' },
                    { label: 'CTR', value: fmtPct(summary.ctr), icon: TrendingUp, color: 'text-purple-500' },
                    { label: 'CPC', value: summary.cpc > 0 ? fmtMoney(summary.cpc) : '—', icon: MousePointer, color: 'text-indigo-500' },
                    { label: 'CPM', value: summary.cpm > 0 ? fmtMoney(summary.cpm) : '—', icon: Percent, color: 'text-pink-500' },
                ];
                return (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-2">
                        {kpis.map((kpi) => {
                            const Icon = kpi.icon;
                            return (
                                <div key={kpi.label} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[10px] font-medium mb-1 uppercase">
                                        <Icon size={12} className={kpi.color} /> {kpi.label}
                                    </div>
                                    <div className={`text-lg font-bold ${kpi.bold ? kpi.color : 'text-gray-900 dark:text-gray-100'}`}>{kpi.value}</div>
                                </div>
                            );
                        })}
                    </div>
                );
            })()}

            {/* Rejected Ads View */}
            {level === 'rejected_ads' && (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Shield size={18} className="text-red-500" />
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rejected Ads ({rejectedAds.length})</h3>
                        </div>
                        <button
                            onClick={() => fetchRejectedCount(selectedAccount.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            <RefreshCw size={12} />
                            Refresh
                        </button>
                    </div>
                    {rejectedAds.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                            <ShieldCheck size={40} className="mx-auto mb-3 text-green-400" />
                            <p className="text-green-600 font-medium">No rejected ads!</p>
                            <p className="text-sm mt-1">All ads on this account are in good standing.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {rejectedAds.map((ad) => (
                                <div key={ad.ad_id} className="px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                                <X size={10} />
                                                REJECTED
                                            </span>
                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ad.ad_name}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{ad.ad_id}</p>
                                        {ad.reasons && ad.reasons.length > 0 && (
                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                {ad.reasons.map((reason, i) => (
                                                    <span key={i} className="inline-block text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded">
                                                        {reason}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {safeAdConfirmId === ad.ad_id ? (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-amber-600 font-medium">Swap to safe?</span>
                                                <button
                                                    onClick={async () => {
                                                        setSafeAdLoadingId(ad.ad_id);
                                                        setSafeAdConfirmId(null);
                                                        try {
                                                            // Get page_id from the ad, or fall back to first page_id found in any synced ad
                                                            let pageId = ad.page_id;
                                                            if (!pageId) {
                                                                // Try to find a page_id from other ads in the same account
                                                                const otherAds = data.filter(d => d.creative_data?.page_id);
                                                                pageId = otherAds[0]?.creative_data?.page_id;
                                                            }
                                                            if (!pageId) {
                                                                showError('No page ID found — try safe-swapping from the Ads view instead.');
                                                                setSafeAdLoadingId(null);
                                                                return;
                                                            }
                                                            const preflight = await runPreflightCheck(pageId, selectedAccount.id, selectedConnection?.id);
                                                            if (!preflight.passed) {
                                                                const failed = (preflight.checks || []).filter(c => !c.passed);
                                                                const acctFail = failed.find(c => c.name === 'ad_account');
                                                                const tokenFail = failed.find(c => c.name === 'token_valid' || c.name === 'scopes');
                                                                let msg;
                                                                if (acctFail) {
                                                                    msg = `Ad account check failed: ${acctFail.detail || acctFail.label}. Reconnect Facebook in Settings or verify Business Manager access.`;
                                                                } else if (tokenFail) {
                                                                    msg = `Facebook token issue: ${tokenFail.detail || tokenFail.label}. Re-authenticate in Settings.`;
                                                                } else {
                                                                    msg = `Pre-flight failed: ${failed.map(c => c.label).join('; ')}`;
                                                                }
                                                                throw new Error(msg);
                                                            }
                                                            const safeAd = getRandomSafeAd(pageId);
                                                            await editAdCreative({
                                                                ad_id: ad.ad_id,
                                                                ad_account_id: selectedAccount.id,
                                                                page_id: pageId,
                                                                ...safeAd,
                                                                name: `${ad.ad_name} - Safe ${new Date().toLocaleDateString()}`,
                                                            }, selectedConnection?.id);
                                                            // Pause the ad so safe placeholder doesn't spend money
                                                            try {
                                                                await updateObjectStatus(ad.ad_id, 'ad', 'PAUSED', selectedConnection?.id);
                                                            } catch (e) {
                                                                console.warn('Safe swap succeeded but failed to pause:', e);
                                                            }
                                                            showSuccess(`"${ad.ad_name}" swapped to safe creative and paused!`);
                                                            fetchRejectedCount(selectedAccount.id);
                                                        } catch (e) {
                                                            showError('Failed to swap: ' + e.message);
                                                        } finally {
                                                            setSafeAdLoadingId(null);
                                                        }
                                                    }}
                                                    disabled={safeAdLoadingId === ad.ad_id}
                                                    className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {safeAdLoadingId === ad.ad_id ? <Loader size={12} className="animate-spin" /> : 'Yes, Safe It'}
                                                </button>
                                                <button
                                                    onClick={() => setSafeAdConfirmId(null)}
                                                    className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setSafeAdConfirmId(ad.ad_id)}
                                                disabled={safeAdLoadingId === ad.ad_id}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                                            >
                                                {safeAdLoadingId === ad.ad_id ? (
                                                    <Loader size={14} className="animate-spin" />
                                                ) : (
                                                    <ShieldCheck size={14} />
                                                )}
                                                Convert to Safe
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Mobile Card View */}
            {level !== 'rejected_ads' && <div className="sm:hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader size={24} className="animate-spin text-amber-600 mr-3" />
                        <span className="text-gray-500 dark:text-gray-400">Loading {level === 'all_ads' ? 'all ads' : level}...</span>
                    </div>
                ) : error ? (
                    <div className="text-center py-16">
                        <p className="text-red-500 mb-2">{error}</p>
                        <button onClick={() => fetchData(true)} className="text-amber-600 hover:underline text-sm">Try again</button>
                    </div>
                ) : data.length === 0 ? (
                    <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                        <BarChart3 size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                        <p>No {level === 'all_ads' ? 'ads' : level} found for this date range</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sort</label>
                            <select
                                value={sortKey}
                                onChange={(e) => setSortKey(e.target.value)}
                                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                                <option value="spend">Spend</option>
                                <option value="ev_conversions">Purchases</option>
                                <option value="ev_cpa">CPA</option>
                                <option value="budget">Budget</option>
                                <option value="clicks">Clicks</option>
                                <option value="cpc">CPC</option>
                                <option value="cpm">CPM</option>
                                <option value="ctr">CTR</option>
                                <option value="impressions">Impressions</option>
                                <option value="status">Status</option>
                                <option value="name">Name</option>
                                <option value="id">ID</option>
                                {isAdLevel && <option value="headline">Headline</option>}
                                {isAdLevel && <option value="post_id">Post ID</option>}
                                {level === 'campaigns' && <option value="objective">Objective</option>}
                                {level === 'campaigns' && <option value="brand">Brand</option>}
                            </select>
                            <button
                                type="button"
                                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                                aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
                                className="p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                                {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                            </button>
                        </div>
                        {sortedData.map((item) => (
                            <CampaignCard
                                key={item.id}
                                item={item}
                                level={level}
                                isAdLevel={isAdLevel}
                                onToggleStatus={handleToggleStatus}
                                onDrillDown={drillDown}
                                onStartEditing={startEditing}
                                onOpenEditCreative={openEditCreative}
                                onOpenPreview={openPreview}
                                onOpenEditCampaign={openEditCampaign}
                                onOpenEditAdSet={openEditAdSet}
                                onOpenBudgetSchedule={openBudgetSchedule}
                                onOpenDaypart={openDaypartPopover}
                                onSafeAdConfirm={(id) => setSafeAdConfirmId(id)}
                                onSafeAd={handleSafeAd}
                                onCancelSafeAd={() => setSafeAdConfirmId(null)}
                                onDuplicate={handleDuplicate}
                                onOpenDuplicatePopover={openDuplicatePopover}
                                onCancelDuplicate={() => setDuplicatePopoverId(null)}
                                onDelete={handleDelete}
                                onConfirmDelete={(id) => setConfirmDeleteItem(id)}
                                onCancelDelete={() => setConfirmDeleteItem(null)}
                                onClone={openCloneModal}
                                onToggleSelection={toggleSelection}
                                onTagBrand={async (item, brandId) => {
                                    setBrandMap(prev => ({ ...prev, [item.id]: brandId }));
                                    try {
                                        await tagCampaignBrand(item.id, brandId, item.name, item.objective);
                                    } catch (err) {
                                        showError('Failed to tag brand');
                                        setBrandMap(prev => ({ ...prev, [item.id]: brandMap[item.id] }));
                                    }
                                }}
                                togglingId={togglingId}
                                selectedIds={selectedIds}
                                brands={filteredBrands}
                                brandMap={brandMap}
                                safeAdConfirmId={safeAdConfirmId}
                                safeAdLoadingId={safeAdLoadingId}
                                duplicatePopoverId={duplicatePopoverId}
                                duplicatingId={duplicatingId}
                                duplicateName={duplicateName}
                                onDuplicateNameChange={setDuplicateName}
                                confirmDeleteItem={confirmDeleteItem}
                                deletingId={deletingId}
                                adAccounts={adAccounts}
                                showSuccess={showSuccess}
                                convData={{}}
                            />
                        ))}
                    </div>
                )}
            </div>}

            {/* Data Table (desktop) */}
            {level !== 'rejected_ads' && <div className="hidden sm:block bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader size={24} className="animate-spin text-amber-600 mr-3" />
                        <span className="text-gray-500 dark:text-gray-400">Loading {level === 'all_ads' ? 'all ads' : level}...</span>
                    </div>
                ) : error ? (
                    <div className="text-center py-16">
                        <p className="text-red-500 mb-2">{error}</p>
                        <button onClick={() => fetchData(true)} className="text-amber-600 hover:underline text-sm">Try again</button>
                    </div>
                ) : data.length === 0 ? (
                    <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                        <BarChart3 size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                        <p>No {level === 'all_ads' ? 'ads' : level} found for this date range</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                    <th className="px-3 py-3 w-10">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === sortedData.length && sortedData.length > 0}
                                            onChange={toggleSelectAll}
                                            className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
                                        />
                                    </th>
                                    <SortHeader label="Status" field="status" className="w-12" />
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                                    {isAdLevel && (
                                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase w-16">Preview</th>
                                    )}
                                    {isAdLevel && (
                                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase w-20">Review</th>
                                    )}
                                    {isAdLevel && (
                                        <SortHeader label="Ad ID" field="id" className="w-28" />
                                    )}
                                    {isAdLevel && (
                                        <SortHeader label="Post ID" field="post_id" className="w-32" />
                                    )}
                                    {!isAdLevel && (
                                        <SortHeader label={level === 'campaigns' ? 'Campaign' : 'Ad Set'} field="name" className="min-w-[200px]" />
                                    )}
                                    {!isAdLevel && (
                                        <SortHeader label={`${level === 'campaigns' ? 'Campaign' : 'Ad Set'} ID`} field="id" className="w-28" />
                                    )}
                                    {isAdLevel && (
                                        <SortHeader label="Headline" field="headline" className="max-w-[180px]" />
                                    )}
                                    <SortHeader label="Spend" field="spend" />
                                    <SortHeader label="Purchases" field="ev_conversions" />
                                    <SortHeader label="CPA" field="ev_cpa" />
                                    <SortHeader label="Budget" field="budget" />
                                    <SortHeader label="Clicks" field="clicks" />
                                    <SortHeader label="CPC" field="cpc" />
                                    <SortHeader label="CPM" field="cpm" />
                                    <SortHeader label="CTR" field="ctr" />
                                    {isAdLevel && (
                                        <SortHeader label="Ad" field="name" className="min-w-[150px]" />
                                    )}
                                    {isAdLevel && (
                                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                    )}
                                    <SortHeader label="Impr." field="impressions" />
                                    {level === 'campaigns' && (
                                        <SortHeader label="Objective" field="objective" />
                                    )}
                                    {level === 'campaigns' && (
                                        <SortHeader label="Brand" field="brand" className="w-32" />
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {sortedData.map((item) => {
                                    const ins = item.insights || {};
                                    const effectiveStatus = item.effective_status || item.status;
                                    const name = item.name || item.campaign_name || item.adset_name || item.ad_name || item.id;
                                    const budget = item.daily_budget ? `${fmtBudget(item.daily_budget)}/day` : item.lifetime_budget ? `${fmtBudget(item.lifetime_budget)} lifetime` : '—';
                                    const canDrillDown = (level === 'campaigns' || level === 'adsets');
                                    const nextLevel = level === 'campaigns' ? 'adsets' : 'ads';
                                    const cd = item.creative_data || {};
                                    const thumbUrl = cd.image_url || cd.thumbnail_url;

                                    return (
                                        <tr key={item.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${selectedIds.has(item.id) ? 'bg-amber-50/50 dark:bg-amber-900/20' : ''}`}>
                                            {/* Checkbox */}
                                            <td className="px-3 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(item.id)}
                                                    onChange={() => toggleSelection(item.id)}
                                                    className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
                                                />
                                            </td>

                                            {/* Status toggle */}
                                            <td className="px-4 py-3">
                                                {(['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'].includes(effectiveStatus)) ? (
                                                    <button
                                                        onClick={() => handleToggleStatus(item)}
                                                        disabled={togglingId === item.id}
                                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${statusColor(effectiveStatus)} hover:opacity-80 disabled:opacity-50`}
                                                        title={effectiveStatus === 'ACTIVE' ? 'Click to pause' : 'Click to activate'}
                                                    >
                                                        {togglingId === item.id ? (
                                                            <Loader size={10} className="animate-spin" />
                                                        ) : effectiveStatus === 'ACTIVE' ? (
                                                            <Play size={10} fill="currentColor" />
                                                        ) : (
                                                            <Pause size={10} />
                                                        )}
                                                        {statusLabel(effectiveStatus)}
                                                    </button>
                                                ) : (
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusColor(effectiveStatus)}`}>
                                                        {statusLabel(effectiveStatus)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    {!isAdLevel && (
                                                        <button
                                                            onClick={() => startEditing(item)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                                                        >
                                                            <Pencil size={14} />
                                                            Rename
                                                        </button>
                                                    )}
                                                    {level === 'campaigns' && (
                                                        <>
                                                        <button
                                                            onClick={() => openEditCampaign(item)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                        >
                                                            <Pencil size={14} />
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => openBudgetSchedule(item, 'campaign')}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                                                        >
                                                            <DollarSign size={14} />
                                                            Scale
                                                        </button>
                                                        </>
                                                    )}
                                                    {level === 'adsets' && (
                                                        <>
                                                        <button
                                                            onClick={() => openEditAdSet(item)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                        >
                                                            <Pencil size={14} />
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => openBudgetSchedule(item, 'adset')}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                                                        >
                                                            <DollarSign size={14} />
                                                            Scale
                                                        </button>
                                                        </>
                                                    )}
                                                    {isAdLevel && (
                                                        <button
                                                            onClick={() => openEditCreative(item)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                                                        >
                                                            <ImageIcon size={14} />
                                                            Edit
                                                        </button>
                                                    )}
                                                    {isAdLevel && (item.creative_data?.post_url || item.creative_data?.story_id) && (
                                                        <>
                                                            <button
                                                                onClick={() => {
                                                                    const url = item.creative_data?.post_url || `https://www.facebook.com/${item.creative_data?.story_id}`;
                                                                    window.open(url, '_blank', 'noopener,noreferrer');
                                                                }}
                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                                title="View ad post on Facebook"
                                                            >
                                                                <ExternalLink size={14} />
                                                                View
                                                            </button>
                                                            <a
                                                                href={`/comment-farm?post_id=${encodeURIComponent(item.creative_data?.story_id || '')}&post_text=${encodeURIComponent(item.name || '')}&target_type=ad`}
                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                                                                title="Seed comments on this ad's post"
                                                            >
                                                                <MessageSquare size={14} />
                                                                Seed
                                                            </a>
                                                        </>
                                                    )}
                                                    {isAdLevel && (
                                                        safeAdConfirmId === item.id ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-xs text-amber-600 font-medium">Safe?</span>
                                                                <button
                                                                    onClick={() => handleSafeAd(item)}
                                                                    disabled={safeAdLoadingId === item.id}
                                                                    className="px-2 py-1 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded transition-colors disabled:opacity-50"
                                                                >
                                                                    {safeAdLoadingId === item.id ? <Loader size={12} className="animate-spin" /> : 'Yes'}
                                                                </button>
                                                                <button
                                                                    onClick={() => setSafeAdConfirmId(null)}
                                                                    className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setSafeAdConfirmId(item.id)}
                                                                disabled={safeAdLoadingId === item.id}
                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                                                                title="Replace with safe image + neutral copy"
                                                            >
                                                                {safeAdLoadingId === item.id ? (
                                                                    <Loader size={14} className="animate-spin" />
                                                                ) : (
                                                                    <ShieldCheck size={14} />
                                                                )}
                                                                Safe
                                                            </button>
                                                        )
                                                    )}
                                                    <div className="relative">
                                                        <button
                                                            onClick={() => duplicatePopoverId === item.id ? setDuplicatePopoverId(null) : openDuplicatePopover(item)}
                                                            disabled={duplicatingId === item.id}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                            {duplicatingId === item.id ? (
                                                                <Loader size={14} className="animate-spin" />
                                                            ) : (
                                                                <Copy size={14} />
                                                            )}
                                                            Copy
                                                        </button>
                                                        {duplicatePopoverId === item.id && (
                                                            <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 w-72">
                                                                <input
                                                                    type="text"
                                                                    value={duplicateName}
                                                                    onChange={(e) => setDuplicateName(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') handleDuplicate(item, null, duplicateName);
                                                                        if (e.key === 'Escape') setDuplicatePopoverId(null);
                                                                    }}
                                                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-2 bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                                    autoFocus
                                                                />
                                                                <div className="flex gap-2 justify-end">
                                                                    <button onClick={() => setDuplicatePopoverId(null)} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                                                                    <button onClick={() => handleDuplicate(item, null, duplicateName)} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">Duplicate</button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {level === 'campaigns' && adAccounts.length > 1 && (
                                                        <button
                                                            onClick={() => openCloneModal(item)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                                                            title="Clone to another ad account"
                                                        >
                                                            <FolderOpen size={14} />
                                                            Clone
                                                        </button>
                                                    )}
                                                    {(level === 'campaigns' || level === 'adsets') && (
                                                        <button
                                                            onClick={() => openDaypartPopover(item)}
                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                                                daypartSchedules[item.id]
                                                                    ? daypartSchedules[item.id].enabled
                                                                        ? 'text-orange-700 bg-orange-50 hover:bg-orange-100'
                                                                        : 'text-gray-500 bg-gray-50 hover:bg-gray-100'
                                                                    : 'text-gray-600 bg-gray-50 hover:bg-gray-100'
                                                            }`}
                                                            title={daypartSchedules[item.id] ? `Daypart: ${daypartSchedules[item.id].active_start_hour}:${String(daypartSchedules[item.id].active_start_minute||0).padStart(2,'0')} – ${daypartSchedules[item.id].active_end_hour}:${String(daypartSchedules[item.id].active_end_minute||0).padStart(2,'0')}` : 'Set daypart schedule'}
                                                        >
                                                            <Sun size={14} />
                                                            {daypartSchedules[item.id] ? 'Daypart' : 'Daypart'}
                                                        </button>
                                                    )}
                                                    {(level === 'campaigns' || level === 'adsets') && (
                                                        editingBidId === item.id ? (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                                                <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">$</span>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0.01"
                                                                    autoFocus
                                                                    value={bidEditValue}
                                                                    onChange={e => setBidEditValue(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveQuickBid(item, level === 'campaigns' ? 'campaign' : 'adset');
                                                                        if (e.key === 'Escape') cancelQuickBidEdit();
                                                                    }}
                                                                    disabled={bidSaving}
                                                                    placeholder="0.00"
                                                                    className="w-16 px-1 py-0.5 text-xs bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-700 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-900 dark:text-gray-100"
                                                                />
                                                                <button
                                                                    onClick={() => handleSaveQuickBid(item, level === 'campaigns' ? 'campaign' : 'adset')}
                                                                    disabled={bidSaving}
                                                                    title="Save bid (Enter)"
                                                                    className="p-0.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded disabled:opacity-50"
                                                                >
                                                                    {bidSaving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                                                                </button>
                                                                <button
                                                                    onClick={cancelQuickBidEdit}
                                                                    disabled={bidSaving}
                                                                    title="Cancel (Esc)"
                                                                    className="p-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => openQuickBidEdit(item)}
                                                                title={item.bid_amount
                                                                    ? `Quick-edit bid cap (current $${(item.bid_amount/100).toFixed(2)})`
                                                                    : 'Set bid cap (requires capped bid strategy)'}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40"
                                                            >
                                                                <DollarSign size={14} />
                                                                {item.bid_amount ? `$${(item.bid_amount/100).toFixed(2)}` : 'Set Bid'}
                                                                <Pencil size={10} className="opacity-60" />
                                                            </button>
                                                        )
                                                    )}
                                                    {(level === 'campaigns' || level === 'adsets') && (
                                                        <button
                                                            onClick={() => setBidSchedulePopover({ item, objectType: level === 'campaigns' ? 'campaign' : 'adset' })}
                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                                                bidScheduleCounts[item.id]
                                                                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                                                                    : 'text-gray-600 bg-gray-50 hover:bg-gray-100'
                                                            }`}
                                                            title={bidScheduleCounts[item.id]
                                                                ? `${bidScheduleCounts[item.id]} bid-cap rule(s) on this ${level === 'campaigns' ? 'campaign' : 'adset'}`
                                                                : `Schedule bid-cap changes by hour (CBO ${level === 'campaigns' ? 'campaigns' : 'or ABO adsets'} on capped strategies)`}
                                                        >
                                                            <Clock size={14} />
                                                            Bid Cap
                                                            {bidScheduleCounts[item.id] > 0 && (
                                                                <span className="ml-0.5 px-1 py-0.5 text-[10px] font-bold rounded bg-amber-200 text-amber-900">
                                                                    {bidScheduleCounts[item.id]}
                                                                </span>
                                                            )}
                                                        </button>
                                                    )}
                                                    {confirmDeleteItem === item.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-xs text-red-600 font-medium">Sure?</span>
                                                            <button
                                                                onClick={() => handleDelete(item)}
                                                                disabled={deletingId === item.id}
                                                                className="px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors disabled:opacity-50"
                                                            >
                                                                {deletingId === item.id ? <Loader size={12} className="animate-spin" /> : 'Yes'}
                                                            </button>
                                                            <button
                                                                onClick={() => setConfirmDeleteItem(null)}
                                                                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setConfirmDeleteItem(item.id)}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 size={14} />
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Ad Preview thumbnail (ads only) */}
                                            {isAdLevel && (
                                                <td className="px-4 py-2">
                                                    <div className="group/thumb relative">
                                                        <button
                                                            onClick={() => openPreview(item)}
                                                            className="group relative w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:ring-2 hover:ring-amber-400 hover:shadow-md transition-all flex-shrink-0 bg-gray-50 dark:bg-gray-800"
                                                        >
                                                            {thumbUrl ? (
                                                                <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center">
                                                                    <ImageIcon size={20} className="text-gray-300" />
                                                                </div>
                                                            )}
                                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                                <Eye size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                            </div>
                                                        </button>
                                                        {/* Hover preview — full-size image */}
                                                        {thumbUrl && (
                                                            <div className="pointer-events-none absolute left-20 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-200 delay-200">
                                                                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-1.5 max-w-xs">
                                                                    <img src={thumbUrl} alt="" className="rounded-lg max-w-[280px] max-h-[280px] object-contain" />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                            {/* Review status (ads only) */}
                                            {isAdLevel && (
                                                <td className="px-3 py-3">
                                                    {effectiveStatus === 'DISAPPROVED' ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Rejected</span>
                                                    ) : effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'IN_PROCESS' ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Pending</span>
                                                    ) : effectiveStatus === 'WITH_ISSUES' ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">Issues</span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Approved</span>
                                                    )}
                                                    {autoSafeLog[item.id] && (
                                                        <span
                                                            className="inline-flex items-center gap-0.5 ml-1 text-xs text-purple-600 dark:text-purple-400"
                                                            title={`Auto-safed on ${new Date(autoSafeLog[item.id].safed_at).toLocaleDateString()}${autoSafeLog[item.id].rejection_reasons ? ' — ' + JSON.stringify(autoSafeLog[item.id].rejection_reasons) : ''}`}
                                                        >
                                                            <Shield size={12} />
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            {/* Ad ID (ads only) */}
                                            {isAdLevel && (
                                                <td className="px-3 py-3">
                                                    <span
                                                        className="text-xs text-gray-500 dark:text-gray-400 font-mono cursor-pointer hover:text-amber-600 dark:hover:text-amber-400"
                                                        onClick={() => { navigator.clipboard.writeText(item.id); }}
                                                        title="Click to copy"
                                                    >
                                                        {item.id}
                                                    </span>
                                                </td>
                                            )}
                                            {/* Post ID (ads only) — effective_object_story_id format pageId_postId */}
                                            {isAdLevel && (
                                                <td className="px-3 py-3">
                                                    {cd.story_id ? (
                                                        <span
                                                            className="text-xs text-gray-500 dark:text-gray-400 font-mono cursor-pointer hover:text-amber-600 dark:hover:text-amber-400 block truncate max-w-[140px]"
                                                            onClick={() => { navigator.clipboard.writeText(cd.story_id); showSuccess('Post ID copied'); }}
                                                            title={`Click to copy: ${cd.story_id}`}
                                                        >
                                                            {cd.story_id.includes('_') ? cd.story_id.split('_')[1] : cd.story_id}
                                                        </span>
                                                    ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                                                </td>
                                            )}

                                            {/* Name — campaigns/adsets only (ads moved to right) */}
                                            {!isAdLevel && (
                                            <td className="px-4 py-3">
                                                {editingId === item.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="text"
                                                            value={editName}
                                                            onChange={(e) => setEditName(e.target.value)}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditingId(null); setEditName(''); } }}
                                                            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 w-full bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                            autoFocus
                                                        />
                                                        <button onClick={saveRename} className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
                                                        <button onClick={() => { setEditingId(null); setEditName(''); }} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                                                    </div>
                                                ) : canDrillDown ? (
                                                    <div className="flex items-center gap-1 group/name">
                                                        <button
                                                            onClick={() => drillDown(item, nextLevel)}
                                                            className="font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 hover:underline text-left"
                                                        >
                                                            {name}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                                                            className="p-1 text-gray-300 hover:text-amber-600 opacity-0 group-hover/name:opacity-100 transition-opacity"
                                                            title="Rename"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 group/name">
                                                        <span className="font-semibold text-gray-900 dark:text-gray-100">{name}</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                                                            className="p-1 text-gray-300 hover:text-amber-600 opacity-0 group-hover/name:opacity-100 transition-opacity"
                                                            title="Rename"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                            )}

                                            {/* ID (campaigns/adsets only) */}
                                            {!isAdLevel && (
                                                <td className="px-3 py-3">
                                                    <span
                                                        className="text-xs text-gray-500 dark:text-gray-400 font-mono cursor-pointer hover:text-amber-600 dark:hover:text-amber-400"
                                                        onClick={() => { navigator.clipboard.writeText(item.id); showSuccess('ID copied'); }}
                                                        title="Click to copy"
                                                    >
                                                        {item.id}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Headline (ads only) */}
                                            {isAdLevel && (
                                                <td className="px-4 py-3 max-w-[180px]">
                                                    {cd.headline ? (
                                                        <span className="text-sm text-gray-700 dark:text-gray-300 block truncate" title={cd.headline}>
                                                            {cd.headline}
                                                        </span>
                                                    ) : <span className="text-gray-300 dark:text-gray-600 text-sm">—</span>}
                                                </td>
                                            )}

                                            {/* Spend */}
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ins.spend)}</td>

                                            {/* Purchases + CPA from FB */}
                                            {(() => {
                                                const conv = Number(ins.results || 0);
                                                const cpa = conv > 0 ? Number(ins.spend || 0) / conv : 0;
                                                return (
                                                    <>
                                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-medium">{conv > 0 ? fmt(conv) : '—'}</td>
                                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{cpa > 0 ? fmtMoney(cpa) : '—'}</td>
                                                    </>
                                                );
                                            })()}

                                            {/* Budget */}
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                                <div className="flex items-center gap-1">
                                                    <span>{budget}</span>
                                                    {(level === 'campaigns' || level === 'adsets') && item.daily_budget && (
                                                        <>
                                                            {(() => {
                                                                const objectType = level === 'campaigns' ? 'campaign' : 'adset';
                                                                const scheduled = scheduledBudgets.find(s => s.fb_object_id === item.id);
                                                                if (editingBudgetId === item.id) {
                                                                    return (
                                                                        <div className="flex items-center gap-1 ml-1">
                                                                            <span className="text-xs text-gray-400">$</span>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                min="1"
                                                                                value={editBudgetValue}
                                                                                onChange={e => setEditBudgetValue(e.target.value)}
                                                                                onKeyDown={e => { if (e.key === 'Enter') handleScheduleBudget(item.id, objectType); if (e.key === 'Escape') setEditingBudgetId(null); }}
                                                                                className="w-20 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                                                                autoFocus
                                                                                placeholder="0.00"
                                                                            />
                                                                            <input
                                                                                type="datetime-local"
                                                                                value={editBudgetScheduledAt}
                                                                                onChange={e => setEditBudgetScheduledAt(e.target.value)}
                                                                                className="text-xs px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                                                                title="Scheduled time (EST)"
                                                                            />
                                                                            <span className="text-[10px] text-gray-500">EST</span>
                                                                            <button
                                                                                onClick={() => handleScheduleBudget(item.id, objectType)}
                                                                                disabled={schedulingBudget}
                                                                                className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-50"
                                                                                title="Schedule budget change"
                                                                            >
                                                                                <Check size={12} />
                                                                            </button>
                                                                            <button onClick={() => setEditingBudgetId(null)} className="p-0.5 text-gray-400 hover:text-gray-600">
                                                                                <X size={12} />
                                                                            </button>
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <div className="flex items-center gap-1 ml-1">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setEditingBudgetId(item.id);
                                                                                setEditBudgetValue('');
                                                                                // Default: tonight 23:59 EST (user can override)
                                                                                const nowEst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
                                                                                const tonight = `${nowEst.getFullYear()}-${String(nowEst.getMonth()+1).padStart(2,'0')}-${String(nowEst.getDate()).padStart(2,'0')}T23:59`;
                                                                                setEditBudgetScheduledAt(tonight);
                                                                            }}
                                                                            className="p-0.5 text-gray-300 hover:text-amber-600 dark:text-gray-500 dark:hover:text-amber-400 transition-colors"
                                                                            title="Schedule budget change"
                                                                        >
                                                                            <Clock size={12} />
                                                                        </button>
                                                                        {scheduled && (
                                                                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title={`Scheduled: $${(scheduled.new_daily_budget / 100).toFixed(2)}/day at ${new Date(scheduled.scheduled_for).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} EST`}>
                                                                                → ${(scheduled.new_daily_budget / 100).toFixed(2)} @ {new Date(scheduled.scheduled_for).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                                                <button onClick={(e) => { e.stopPropagation(); handleCancelScheduledBudget(scheduled.id); }} className="p-0.5 text-gray-400 hover:text-red-500" title="Cancel scheduled change">
                                                                                    <X size={10} />
                                                                                </button>
                                                                            </span>
                                                                        )}
                                                                        {/* Budget Surfing button */}
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); openSurfPopover(item); }}
                                                                            className={`p-0.5 transition-colors ${surfConfigs[item.id] ? (surfConfigs[item.id].enabled ? 'text-cyan-500 hover:text-cyan-600' : 'text-gray-400 hover:text-cyan-500') : 'text-gray-300 hover:text-cyan-500 dark:text-gray-500 dark:hover:text-cyan-400'}`}
                                                                            title={surfConfigs[item.id] ? `Surfing: ${surfConfigs[item.id].current_phase} phase` : 'Enable budget surfing'}
                                                                        >
                                                                            <Waves size={12} />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </>
                                                    )}
                                                </div>
                                                {/* Surf Popover */}
                                                {surfPopoverId === item.id && (
                                                    <div className="absolute z-50 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 w-72" onClick={e => e.stopPropagation()}>
                                                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1">
                                                            <Waves size={14} className="text-cyan-500" /> Budget Surfing
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div>
                                                                <label className="text-xs text-gray-500 dark:text-gray-400">Base Budget ($/day)</label>
                                                                <input type="number" step="0.01" min="1" value={surfForm.base_budget} onChange={e => setSurfForm(f => ({ ...f, base_budget: e.target.value }))}
                                                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" />
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="text-xs text-gray-500 dark:text-gray-400">Min Conversions</label>
                                                                    <input type="number" min="1" value={surfForm.min_conversions} onChange={e => setSurfForm(f => ({ ...f, min_conversions: +e.target.value }))}
                                                                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs text-gray-500 dark:text-gray-400">Noon Multiplier</label>
                                                                    <input type="number" step="0.5" min="1" value={surfForm.noon_multiplier} onChange={e => setSurfForm(f => ({ ...f, noon_multiplier: +e.target.value }))}
                                                                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="text-xs text-gray-500 dark:text-gray-400">4 PM Multiplier</label>
                                                                <input type="number" step="0.5" min="1" value={surfForm.afternoon_multiplier} onChange={e => setSurfForm(f => ({ ...f, afternoon_multiplier: +e.target.value }))}
                                                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" />
                                                            </div>
                                                            <div className="text-xs text-gray-400 dark:text-gray-500">
                                                                Midnight: reset to base → Noon: {surfForm.noon_multiplier}x winners, pause losers → 4 PM: {surfForm.afternoon_multiplier}x winners
                                                            </div>
                                                            <div className="flex items-center gap-2 pt-1">
                                                                {surfConfigs[item.id] && (
                                                                    <>
                                                                        <button onClick={() => toggleSurfEnabled(item.id)} className="text-xs text-gray-500 hover:text-cyan-600">
                                                                            {surfConfigs[item.id].enabled ? 'Disable' : 'Enable'}
                                                                        </button>
                                                                        <button onClick={() => openSurfLogs(surfConfigs[item.id].id)} className="text-xs text-gray-500 hover:text-blue-600">
                                                                            Logs
                                                                        </button>
                                                                        <button onClick={() => removeSurfConfig(item.id)} className="text-xs text-red-400 hover:text-red-600">
                                                                            Remove
                                                                        </button>
                                                                    </>
                                                                )}
                                                                <div className="flex-1" />
                                                                <button onClick={() => setSurfPopoverId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                                                                <button onClick={() => saveSurfConfig(item.id)} disabled={surfSaving || !surfForm.base_budget}
                                                                    className="px-3 py-1 text-xs bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:opacity-50">
                                                                    {surfSaving ? <Loader size={12} className="animate-spin" /> : 'Save'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Clicks, CPC, CPM, CTR */}
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmt(ins.clicks)}</td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtMoney(ins.cpc)}</td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtMoney(ins.cpm)}</td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtPct(ins.ctr)}</td>

                                            {/* Ad Name (ads only) */}
                                            {isAdLevel && (
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1 group/name">
                                                    <span className="text-sm text-gray-500 dark:text-gray-400 block truncate max-w-[150px]" title={name}>{name}</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                                                        className="p-1 text-gray-300 hover:text-amber-600 opacity-0 group-hover/name:opacity-100 transition-opacity"
                                                        title="Rename"
                                                    >
                                                        <Pencil size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                            )}

                                            {/* Type (ads only) */}
                                            {isAdLevel && (
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cd.is_video ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'}`}>
                                                        {cd.is_video ? 'Video' : 'Image'}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Impressions — moved right */}
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmt(ins.impressions)}</td>

                                            {/* Objective (campaigns only) — moved right */}
                                            {level === 'campaigns' && (
                                                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                                    {(item.objective || '—').replace('OUTCOME_', '').replace(/_/g, ' ')}
                                                </td>
                                            )}
                                            {/* Brand tag (campaigns only) — moved right */}
                                            {level === 'campaigns' && (
                                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                    <select
                                                        value={brandMap[item.id] || ''}
                                                        onChange={async (e) => {
                                                            const newBrandId = e.target.value || null;
                                                            setBrandMap(prev => ({ ...prev, [item.id]: newBrandId }));
                                                            try {
                                                                await tagCampaignBrand(item.id, newBrandId, item.name, item.objective);
                                                            } catch (err) {
                                                                showError('Failed to tag brand');
                                                                setBrandMap(prev => ({ ...prev, [item.id]: brandMap[item.id] }));
                                                            }
                                                        }}
                                                        className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-gray-200 hover:border-amber-400 focus:ring-1 focus:ring-amber-500 focus:border-amber-500 w-full max-w-[120px]"
                                                    >
                                                        <option value="">—</option>
                                                        {filteredBrands.map(b => (
                                                            <option key={b.id} value={b.id}>{b.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>}

            {/* Bulk Action Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-4 sm:bottom-6 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-40 bg-gray-900 text-white rounded-2xl shadow-2xl px-3 sm:px-6 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 overflow-x-auto">
                    <span className="text-xs sm:text-sm font-medium whitespace-nowrap">{selectedIds.size} sel.</span>
                    <div className="w-px h-5 sm:h-6 bg-gray-700 flex-shrink-0" />
                    <button
                        onClick={() => handleBulkStatus('ACTIVE')}
                        disabled={bulkActionLoading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {bulkActionLoading ? <Loader size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                        Activate
                    </button>
                    <button
                        onClick={() => handleBulkStatus('PAUSED')}
                        disabled={bulkActionLoading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {bulkActionLoading ? <Loader size={14} className="animate-spin" /> : <Pause size={14} />}
                        Pause
                    </button>
                    {isAdLevel && (
                        <>
                            <div className="w-px h-6 bg-gray-700" />
                            <button
                                onClick={openBulkEdit}
                                disabled={bulkActionLoading}
                                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                <Pencil size={14} />
                                Edit
                            </button>
                            <button
                                onClick={() => setBulkSafeConfirm(true)}
                                disabled={bulkActionLoading}
                                className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                <ShieldCheck size={14} />
                                Safe
                            </button>
                        </>
                    )}
                    <div className="w-px h-6 bg-gray-700" />
                    <button
                        onClick={() => setBulkDuplicateConfirm(true)}
                        disabled={bulkActionLoading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <Copy size={14} />
                        Duplicate
                    </button>
                    <div className="w-px h-6 bg-gray-700" />
                    <button
                        onClick={() => setBulkDeleteConfirm(true)}
                        disabled={bulkActionLoading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="p-2 text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Bulk Edit Modal */}
            {bulkEditOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Bulk Edit ({selectedIds.size} ad{selectedIds.size > 1 ? 's' : ''})</h3>
                            <button onClick={() => setBulkEditOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={20} /></button>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Only checked fields will be updated. Unchecked fields keep each ad's existing values.</p>
                        <div className="space-y-4">
                            {/* Primary Text */}
                            <div>
                                <label className="flex items-center gap-2 mb-1.5">
                                    <input type="checkbox" checked={bulkEditFields.primary_text}
                                        onChange={e => setBulkEditFields(f => ({ ...f, primary_text: e.target.checked }))}
                                        className="rounded border-gray-300 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Primary Text</span>
                                </label>
                                <textarea rows={3} disabled={!bulkEditFields.primary_text}
                                    value={bulkEditData.primary_text}
                                    onChange={e => setBulkEditData(d => ({ ...d, primary_text: e.target.value }))}
                                    placeholder="Enter new primary text..."
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 disabled:bg-gray-50 dark:disabled:bg-gray-800/50 disabled:text-gray-400 dark:disabled:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            {/* Headline */}
                            <div>
                                <label className="flex items-center gap-2 mb-1.5">
                                    <input type="checkbox" checked={bulkEditFields.headline}
                                        onChange={e => setBulkEditFields(f => ({ ...f, headline: e.target.checked }))}
                                        className="rounded border-gray-300 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Headline</span>
                                </label>
                                <input type="text" disabled={!bulkEditFields.headline}
                                    value={bulkEditData.headline}
                                    onChange={e => setBulkEditData(d => ({ ...d, headline: e.target.value }))}
                                    placeholder="Enter new headline..."
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 disabled:bg-gray-50 dark:disabled:bg-gray-800/50 disabled:text-gray-400 dark:disabled:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            {/* Description */}
                            <div>
                                <label className="flex items-center gap-2 mb-1.5">
                                    <input type="checkbox" checked={bulkEditFields.description}
                                        onChange={e => setBulkEditFields(f => ({ ...f, description: e.target.checked }))}
                                        className="rounded border-gray-300 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</span>
                                </label>
                                <input type="text" disabled={!bulkEditFields.description}
                                    value={bulkEditData.description}
                                    onChange={e => setBulkEditData(d => ({ ...d, description: e.target.value }))}
                                    placeholder="Enter new description..."
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 disabled:bg-gray-50 dark:disabled:bg-gray-800/50 disabled:text-gray-400 dark:disabled:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            {/* CTA */}
                            <div>
                                <label className="flex items-center gap-2 mb-1.5">
                                    <input type="checkbox" checked={bulkEditFields.cta}
                                        onChange={e => setBulkEditFields(f => ({ ...f, cta: e.target.checked }))}
                                        className="rounded border-gray-300 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Call to Action</span>
                                </label>
                                <select disabled={!bulkEditFields.cta}
                                    value={bulkEditData.cta}
                                    onChange={e => setBulkEditData(d => ({ ...d, cta: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 disabled:bg-gray-50 dark:disabled:bg-gray-800/50 disabled:text-gray-400 dark:disabled:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                    {CTA_OPTIONS.map(opt => <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>)}
                                </select>
                            </div>
                            {/* Website URL */}
                            <div>
                                <label className="flex items-center gap-2 mb-1.5">
                                    <input type="checkbox" checked={bulkEditFields.website_url}
                                        onChange={e => setBulkEditFields(f => ({ ...f, website_url: e.target.checked }))}
                                        className="rounded border-gray-300 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Website URL</span>
                                </label>
                                <input type="url" disabled={!bulkEditFields.website_url}
                                    value={bulkEditData.website_url}
                                    onChange={e => setBulkEditData(d => ({ ...d, website_url: e.target.value }))}
                                    placeholder="https://..."
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 disabled:bg-gray-50 dark:disabled:bg-gray-800/50 disabled:text-gray-400 dark:disabled:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setBulkEditOpen(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
                            <button onClick={handleBulkEdit} disabled={bulkEditSaving || !Object.values(bulkEditFields).some(Boolean)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                {bulkEditSaving ? <><Loader size={14} className="animate-spin" />{bulkEditProgress}</> : `Apply to ${selectedIds.size} ad${selectedIds.size > 1 ? 's' : ''}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Delete Confirmation */}
            {bulkDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
                        <Trash2 size={32} className="mx-auto text-red-500 mb-3" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete {selectedIds.size} ad{selectedIds.size > 1 ? 's' : ''}?</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">This cannot be undone. The ads will be permanently deleted from Facebook.</p>
                        <div className="flex justify-center gap-3">
                            <button onClick={() => setBulkDeleteConfirm(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg">Cancel</button>
                            <button onClick={handleBulkDelete}
                                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium">
                                <Trash2 size={14} />Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Duplicate Confirmation */}
            {bulkDuplicateConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
                        <Copy size={32} className="mx-auto text-sky-500 mb-3" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Duplicate {selectedIds.size} {level === 'adsets' ? 'ad set' : level === 'campaigns' ? 'campaign' : 'ad'}{selectedIds.size > 1 ? 's' : ''}?</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">New copies will be created in paused state.</p>
                        <div className="flex justify-center gap-3">
                            <button onClick={() => setBulkDuplicateConfirm(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg">Cancel</button>
                            <button onClick={handleBulkDuplicate}
                                className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium">
                                <Copy size={14} />Duplicate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Safe Confirmation */}
            {bulkSafeConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
                        <ShieldCheck size={32} className="mx-auto text-orange-500 mb-3" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Safe {selectedIds.size} ad{selectedIds.size > 1 ? 's' : ''}?</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Each ad will be converted to a safe placeholder image and paused. This cannot be undone.</p>
                        <div className="flex justify-center gap-3">
                            <button onClick={() => setBulkSafeConfirm(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg">Cancel</button>
                            <button onClick={handleBulkSafe}
                                className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium">
                                <ShieldCheck size={14} />Safe & Pause
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Row count */}
            {!loading && data.length > 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500 text-right">
                    {data.length} {level}
                </div>
            )}

            {/* Ad Preview Modal — uses Facebook Previews API */}
            {previewAd && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                    onClick={() => setPreviewAd(null)}
                >
                    <div
                        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-[520px] w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                            <div className="min-w-0">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">Ad Preview</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{previewAd.name}</p>
                            </div>
                            <button
                                onClick={() => setPreviewAd(null)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Placement toggle */}
                        <div className="flex gap-2 p-4 pb-2 flex-wrap">
                            {[
                                { format: 'DESKTOP_FEED_STANDARD', label: 'Desktop Feed' },
                                { format: 'MOBILE_FEED_STANDARD', label: 'Mobile Feed' },
                                { format: 'INSTAGRAM_STANDARD', label: 'Instagram' },
                                { format: 'INSTAGRAM_STORY', label: 'IG Story' },
                            ].map(({ format, label }) => (
                                <button
                                    key={format}
                                    onClick={() => switchPreviewFormat(format)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                        previewFormat === format
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Facebook-rendered preview */}
                        <div className="p-4 pt-2 flex justify-center min-h-[300px]">
                            {previewLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader size={24} className="animate-spin text-amber-600" />
                                </div>
                            ) : previewHtml ? (
                                <iframe
                                    src={previewHtml}
                                    className="w-full border-0"
                                    style={{ minHeight: '500px' }}
                                    title="Ad Preview"
                                />
                            ) : (
                                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                                    <ImageIcon size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                                    <p>No preview available</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Clone Campaign Modal */}
            {cloneModalCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setCloneModalCampaign(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Clone Campaign to Another Account</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Copies campaign + ad sets (PAUSED). Creatives are not copied — add them after.</p>

                        <div className="space-y-3 mb-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Name</label>
                                <input
                                    type="text"
                                    value={cloneName}
                                    onChange={(e) => setCloneName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Ad Account</label>
                                <select
                                    value={cloneTargetAccount}
                                    onChange={(e) => setCloneTargetAccount(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                                >
                                    <option value="">Select account...</option>
                                    {adAccounts.filter(a => a.id !== selectedAccount?.id).map(a => (
                                        <option key={a.id} value={a.id}>{a.name || a.id}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setCloneModalCampaign(null)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClone}
                                disabled={!cloneTargetAccount || cloning}
                                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {cloning ? <Loader size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                                Clone Campaign
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Creative Modal */}
            {editCreativeAd && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                    onClick={() => !editCreativeSaving && setEditCreativeAd(null)}
                    onPaste={handleEditCreativePaste}
                >
                    <div
                        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-[640px] w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit Creative</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    Creates a new creative and updates this ad &middot; {editCreativeAd.name}
                                </p>
                            </div>
                            <button
                                onClick={() => !editCreativeSaving && setEditCreativeAd(null)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                                disabled={editCreativeSaving}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Image / Video */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {editCreativeData.is_video ? 'Video (thumbnail)' : 'Image'}
                                </label>
                                <div className="flex items-start gap-4">
                                    <div className="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0 bg-gray-50 dark:bg-gray-800 relative">
                                        <img
                                            src={editCreativeData.new_image_preview || editCreativeData.image_url}
                                            alt="Creative"
                                            className="w-full h-full object-cover"
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                        {editCreativeData.is_video && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white text-[10px] font-semibold uppercase tracking-wider">
                                                Video
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        {editCreativeData.is_video ? (
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                Video file stays the same. Edit copy, CTA, and URL below.
                                            </p>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg cursor-pointer text-sm text-gray-700 dark:text-gray-300 transition-colors">
                                                        <Upload size={14} />
                                                        Upload
                                                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleEditCreativeImageFile} />
                                                    </label>
                                                    <span className="text-xs text-gray-400">or Ctrl+V to paste</span>
                                                </div>
                                                <input type="text" placeholder="Or paste image URL..."
                                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && e.target.value.startsWith('http')) {
                                                            setEditCreativeData(prev => ({ ...prev, image_url: e.target.value, new_image_file: null, new_image_preview: e.target.value }));
                                                            setImageChanged(true);
                                                            e.target.value = '';
                                                        }
                                                    }}
                                                />
                                                {imageChanged && <p className="text-xs text-amber-600 font-medium">Image will be replaced</p>}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Primary Text + Magic Wand */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Primary Text (Body)</label>
                                    <div className="relative">
                                        <button
                                            onClick={() => setWandMenu(!wandMenu)}
                                            disabled={wandLoading}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {wandLoading ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                            AI Copy
                                        </button>
                                        {wandMenu && (
                                            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 w-44 z-50">
                                                <button onClick={() => handleMagicWand('gemini')} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-amber-50 text-amber-700">
                                                    <Sparkles size={14} /> Gemini Flash
                                                </button>
                                                <button onClick={() => handleMagicWand('sonnet')} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-purple-50 text-purple-700">
                                                    <Sparkles size={14} /> Claude Sonnet
                                                </button>
                                                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                                                <button onClick={() => handleMagicWand('safe')} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-blue-50 text-blue-700">
                                                    <Sparkles size={14} /> Safe Copy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <textarea
                                    value={editCreativeData.primary_text}
                                    onChange={(e) => setEditCreativeData(prev => ({ ...prev, primary_text: e.target.value }))}
                                    rows={3}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    placeholder="Main ad body text..."
                                />
                                {generatedBodies.length > 1 && (
                                    <div className="flex gap-1 mt-1 flex-wrap">
                                        {generatedBodies.map((b, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setEditCreativeData(prev => ({ ...prev, primary_text: b }))}
                                                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${editCreativeData.primary_text === b ? 'bg-amber-200 text-amber-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                            >Variation {i + 1}</button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Headline */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Headline</label>
                                <input
                                    type="text"
                                    value={editCreativeData.headline}
                                    onChange={(e) => setEditCreativeData(prev => ({ ...prev, headline: e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    placeholder="Ad headline..."
                                />
                                {generatedHeadlines.length > 1 && (
                                    <div className="flex gap-1 mt-1 flex-wrap">
                                        {generatedHeadlines.map((h, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setEditCreativeData(prev => ({ ...prev, headline: h }))}
                                                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${editCreativeData.headline === h ? 'bg-amber-200 text-amber-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                            >Variation {i + 1}</button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={editCreativeData.description}
                                    onChange={(e) => setEditCreativeData(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    placeholder="Link description..."
                                />
                            </div>

                            {/* CTA + Website URL */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Call to Action</label>
                                    <select
                                        value={editCreativeData.cta}
                                        onChange={(e) => setEditCreativeData(prev => ({ ...prev, cta: e.target.value }))}
                                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    >
                                        {CTA_OPTIONS.map(cta => (
                                            <option key={cta} value={cta}>{cta.replace(/_/g, ' ')}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Website URL</label>
                                    <input
                                        type="url"
                                        value={editCreativeData.website_url}
                                        onChange={(e) => setEditCreativeData(prev => ({ ...prev, website_url: e.target.value }))}
                                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                        placeholder="https://..."
                                    />
                                </div>
                            </div>

                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
                                <strong>Note:</strong> Saving creates a new creative and updates this ad to use it. The old creative remains in your ad account.
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => setEditCreativeAd(null)}
                                disabled={editCreativeSaving}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveEditCreative}
                                disabled={editCreativeSaving || !editCreativeData.primary_text.trim() || !editCreativeData.headline.trim() || !editCreativeData.website_url.trim()}
                                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {editCreativeSaving ? (
                                    <><Loader size={14} className="animate-spin" /> Saving...</>
                                ) : (
                                    'Save Creative'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Quick Create Ad Set Modal */}
            {createAdSetModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCreateAdSetModal(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[500px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create Ad Set</h3>
                            <button onClick={() => setCreateAdSetModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Set Name</label>
                                <input type="text" value={createAdSetData.name} onChange={e => setCreateAdSetData(d => ({ ...d, name: e.target.value }))}
                                    placeholder="e.g. US - 25-55 - Broad"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Daily Budget ($)</label>
                                    <input type="number" step="1" min="1" value={createAdSetData.daily_budget} onChange={e => setCreateAdSetData(d => ({ ...d, daily_budget: e.target.value }))}
                                        placeholder="e.g. 50"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Optimization</label>
                                    <select value={createAdSetData.optimization_goal} onChange={e => setCreateAdSetData(d => ({ ...d, optimization_goal: e.target.value }))}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                                        <option value="OFFSITE_CONVERSIONS">Conversions</option>
                                        <option value="LINK_CLICKS">Link Clicks</option>
                                        <option value="IMPRESSIONS">Impressions</option>
                                        <option value="LANDING_PAGE_VIEWS">Landing Page Views</option>
                                        <option value="REACH">Reach</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Countries (comma-separated)</label>
                                <input type="text" value={createAdSetData.countries} onChange={e => setCreateAdSetData(d => ({ ...d, countries: e.target.value }))}
                                    placeholder="US, CA, GB"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Age Min</label>
                                    <input type="number" min="13" max="65" value={createAdSetData.age_min} onChange={e => setCreateAdSetData(d => ({ ...d, age_min: +e.target.value }))}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Age Max</label>
                                    <input type="number" min="13" max="65" value={createAdSetData.age_max} onChange={e => setCreateAdSetData(d => ({ ...d, age_max: +e.target.value }))}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setCreateAdSetModal(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            <button onClick={async () => {
                                setCreateAdSetSaving(true);
                                try {
                                    const countries = createAdSetData.countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
                                    await quickCreateAdSet({
                                        name: createAdSetData.name,
                                        campaign_id: createAdSetModal.campaignId,
                                        ad_account_id: createAdSetModal.adAccountId,
                                        daily_budget: Math.round(parseFloat(createAdSetData.daily_budget) * 100),
                                        optimization_goal: createAdSetData.optimization_goal,
                                        targeting: {
                                            age_min: createAdSetData.age_min,
                                            age_max: createAdSetData.age_max,
                                            geo_locations: { countries },
                                        },
                                    }, selectedConnection?.id);
                                    showSuccess('Ad Set created!');
                                    setCreateAdSetModal(null);
                                    fetchData();
                                } catch (e) { showError(e.message); }
                                finally { setCreateAdSetSaving(false); }
                            }} disabled={createAdSetSaving || !createAdSetData.name || !createAdSetData.daily_budget}
                                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                                {createAdSetSaving ? <Loader size={14} className="animate-spin" /> : 'Create Ad Set'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Create Ad Modal */}
            {createAdModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCreateAdModal(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[700px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create Ad{createAdList.length > 1 ? `s (${createAdList.length})` : ''}</h3>
                            <button onClick={() => setCreateAdModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-6">
                            {createAdList.map((ad, idx) => {
                                const updateAd = (field, value) => setCreateAdList(list => list.map((a, i) => i === idx ? { ...a, [field]: value } : a));
                                const inputCls = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white";
                                const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

                                // File upload handler
                                const handleFileUpload = async (file) => {
                                    if (!file) return;
                                    const isVideo = file.type.startsWith('video/');
                                    const isImage = file.type.startsWith('image/');
                                    if (!isVideo && !isImage) { showError('Please upload an image or video file'); return; }
                                    setCreateAdUploading(u => ({ ...u, [idx]: true }));
                                    try {
                                        const formData = new FormData();
                                        formData.append('file', file);
                                        const resp = await authFetch((import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/uploads/upload', { method: 'POST', body: formData });
                                        if (!resp.ok) throw new Error('Upload failed');
                                        const data = await resp.json();
                                        updateAd('image_url', data.url);
                                        updateAd('mediaType', isVideo ? 'video' : 'image');
                                    } catch (e) { showError(e.message || 'Upload failed'); }
                                    finally { setCreateAdUploading(u => ({ ...u, [idx]: false })); }
                                };

                                // AI copy generation
                                const handleAiGenerate = async (provider = 'gemini') => {
                                    if (!ad.image_url) return;
                                    setCreateAdAiLoading(l => ({ ...l, [idx]: true }));
                                    try {
                                        const resp = await authFetch(
                                            (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + `/video-analysis/analyze-image?provider=${provider}`,
                                            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: ad.image_url, ad_account_id: createAdModal.adAccountId }) }
                                        );
                                        if (!resp.ok) throw new Error('AI generation failed');
                                        const data = await resp.json();
                                        if (data.primary_text) updateAd('primary_text', data.primary_text);
                                        if (data.headline) updateAd('headline', data.headline);
                                        if (data.description) updateAd('description', data.description);
                                        showSuccess('AI copy generated!');
                                    } catch (e) { showError(e.message || 'AI generation failed'); }
                                    finally { setCreateAdAiLoading(l => ({ ...l, [idx]: false })); }
                                };

                                return (
                                    <div key={idx} className={createAdList.length > 1 ? "border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4 relative" : "space-y-4"}>
                                        {createAdList.length > 1 && (
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Ad #{idx + 1}</span>
                                                <button onClick={() => setCreateAdList(list => list.filter((_, i) => i !== idx))}
                                                    className="text-red-400 hover:text-red-600 text-xs flex items-center gap-1"><Trash2 size={12} /> Remove</button>
                                            </div>
                                        )}

                                        {/* Ad Name */}
                                        <div>
                                            <label className={labelCls}>Ad Name</label>
                                            <input type="text" value={ad.name} onChange={e => updateAd('name', e.target.value)}
                                                placeholder="e.g. Detox Tea - Before After - V2" className={inputCls} />
                                        </div>

                                        {/* Page Selector */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Facebook Page</label>
                                                <button type="button" onClick={() => setCreateAdManualPageId(v => !v)}
                                                    className="text-xs text-blue-500 hover:text-blue-600">{createAdManualPageId ? 'Use dropdown' : 'Enter ID manually'}</button>
                                            </div>
                                            {createAdManualPageId ? (
                                                <input type="text" value={ad.page_id} onChange={e => updateAd('page_id', e.target.value)}
                                                    placeholder="Facebook Page ID" className={inputCls} />
                                            ) : (
                                                <select value={ad.page_id} onChange={e => { updateAd('page_id', e.target.value); if (e.target.value) localStorage.setItem('lastUsedPageId', e.target.value); }}
                                                    className={inputCls}>
                                                    <option value="">{createAdPagesLoading ? 'Loading pages...' : 'Select a page'}</option>
                                                    {createAdPages.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
                                                </select>
                                            )}
                                        </div>

                                        {/* Use Existing Post toggle */}
                                        <div className="flex items-center gap-2 pt-1">
                                            <input type="checkbox" id={`use-existing-${idx}`} checked={ad.use_existing_post}
                                                onChange={e => updateAd('use_existing_post', e.target.checked)}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                            <label htmlFor={`use-existing-${idx}`} className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                                                Use existing post (carry over likes/comments/shares)
                                            </label>
                                        </div>

                                        {ad.use_existing_post && (
                                            <>
                                            <div>
                                                <label className={labelCls}>Existing Post ID</label>
                                                <input type="text" value={ad.existing_post_id}
                                                    onChange={e => updateAd('existing_post_id', e.target.value)}
                                                    placeholder="123456789_987654321 or just 987654321"
                                                    className={inputCls} />
                                                <p className="text-[10px] text-gray-400 mt-1">
                                                    Format: <code>pageId_postId</code>. If you only paste the post ID, the selected Page above will be used.
                                                </p>
                                            </div>
                                            {idx === 0 && (
                                                <div>
                                                    <div className="flex items-center justify-between mb-1">
                                                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                            Spread to ad sets ({createAdTargetAdsets.size} selected)
                                                        </label>
                                                        {createAdSiblingAdsets.length > 1 && (
                                                            <div className="flex items-center gap-2">
                                                                <button type="button" onClick={() => setCreateAdTargetAdsets(new Set(createAdSiblingAdsets.map(s => s.id)))}
                                                                    className="text-xs text-blue-500 hover:text-blue-600">All</button>
                                                                <span className="text-gray-300">|</span>
                                                                <button type="button" onClick={() => setCreateAdTargetAdsets(new Set([createAdModal.adsetId]))}
                                                                    className="text-xs text-blue-500 hover:text-blue-600">Just current</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-40 overflow-y-auto p-2 bg-white dark:bg-gray-900">
                                                        {createAdSiblingsLoading && <div className="text-xs text-gray-400 px-2 py-1">Loading ad sets...</div>}
                                                        {!createAdSiblingsLoading && createAdSiblingAdsets.length === 0 && <div className="text-xs text-gray-400 px-2 py-1">Only current ad set available</div>}
                                                        {createAdSiblingAdsets.map(s => (
                                                            <label key={s.id} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer">
                                                                <input type="checkbox"
                                                                    checked={createAdTargetAdsets.has(s.id)}
                                                                    onChange={e => {
                                                                        const next = new Set(createAdTargetAdsets);
                                                                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                                                                        setCreateAdTargetAdsets(next);
                                                                    }}
                                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                                                <span className="truncate flex-1">{s.name}</span>
                                                                {s.id === createAdModal.adsetId && <span className="text-[9px] text-gray-400 uppercase">current</span>}
                                                            </label>
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 mt-1">The same post-ID ad will be created in each selected ad set, carrying over engagement.</p>
                                                </div>
                                            )}
                                            </>
                                        )}

                                        {/* Media Upload Zone */}
                                        {!ad.use_existing_post && (<>
                                        <div>
                                            <label className={labelCls}>Image / Video</label>
                                            <div
                                                className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${createAdDragOver[idx] ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'}`}
                                                onDragOver={e => { e.preventDefault(); setCreateAdDragOver(d => ({ ...d, [idx]: true })); }}
                                                onDragLeave={() => setCreateAdDragOver(d => ({ ...d, [idx]: false }))}
                                                onDrop={e => { e.preventDefault(); setCreateAdDragOver(d => ({ ...d, [idx]: false })); const file = e.dataTransfer.files[0]; if (file) handleFileUpload(file); }}
                                                onPaste={e => { const items = e.clipboardData?.items; if (items) { for (const item of items) { if (item.type.startsWith('image/') || item.type.startsWith('video/')) { handleFileUpload(item.getAsFile()); break; } } } }}
                                                tabIndex={0}
                                            >
                                                {createAdUploading[idx] ? (
                                                    <div className="flex items-center justify-center gap-2 py-4">
                                                        <Loader size={16} className="animate-spin text-blue-500" />
                                                        <span className="text-sm text-gray-500">Uploading...</span>
                                                    </div>
                                                ) : ad.image_url ? (
                                                    <div className="space-y-2">
                                                        {ad.mediaType === 'video' ? (
                                                            <video src={ad.image_url} className="max-h-32 mx-auto rounded" controls muted />
                                                        ) : (
                                                            <img src={ad.image_url} alt="Preview" className="max-h-32 mx-auto rounded object-contain" />
                                                        )}
                                                        <button onClick={() => { updateAd('image_url', ''); updateAd('mediaType', ''); }}
                                                            className="text-xs text-red-500 hover:text-red-600">Remove</button>
                                                    </div>
                                                ) : (
                                                    <div className="py-4">
                                                        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                                                        <p className="text-sm text-gray-500 dark:text-gray-400">Drag & drop or paste an image/video</p>
                                                        <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                                                        <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="absolute inset-0 opacity-0 cursor-pointer"
                                                            onChange={e => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); }} />
                                                    </div>
                                                )}
                                            </div>
                                            {/* URL input fallback */}
                                            <div className="mt-2">
                                                <input type="text" value={ad.image_url} onChange={e => { updateAd('image_url', e.target.value); updateAd('mediaType', e.target.value.match(/\.(mp4|mov|webm)/i) ? 'video' : 'image'); }}
                                                    placeholder="Or paste image/video URL directly..." className={inputCls} />
                                            </div>
                                        </div>

                                        {/* AI Generate Button */}
                                        {ad.image_url && (
                                            <div className="flex items-center gap-2">
                                                <button type="button" onClick={() => handleAiGenerate('gemini')} disabled={createAdAiLoading[idx]}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-500/20 disabled:opacity-50">
                                                    {createAdAiLoading[idx] ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                    Generate with AI (Gemini)
                                                </button>
                                                <button type="button" onClick={() => handleAiGenerate('claude')} disabled={createAdAiLoading[idx]}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-500/20 disabled:opacity-50">
                                                    {createAdAiLoading[idx] ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                    Claude
                                                </button>
                                            </div>
                                        )}

                                        {/* Primary Text */}
                                        <div>
                                            <label className={labelCls}>Primary Text (ad copy)</label>
                                            <textarea value={ad.primary_text} onChange={e => updateAd('primary_text', e.target.value)}
                                                rows={3} placeholder="The main ad copy..." className={inputCls} />
                                        </div>

                                        {/* Headline + Description */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>Headline</label>
                                                <input type="text" value={ad.headline} onChange={e => updateAd('headline', e.target.value)} className={inputCls} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Description</label>
                                                <input type="text" value={ad.description} onChange={e => updateAd('description', e.target.value)} className={inputCls} />
                                            </div>
                                        </div>

                                        {/* CTA + Website URL */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>CTA Button</label>
                                                <select value={ad.cta} onChange={e => updateAd('cta', e.target.value)} className={inputCls}>
                                                    {CTA_OPTIONS.map(cta => <option key={cta} value={cta}>{cta.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNo Button\b/, 'No Button')}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Website URL</label>
                                                <input type="text" value={ad.website_url} onChange={e => updateAd('website_url', e.target.value)}
                                                    placeholder="https://..." className={inputCls} />
                                            </div>
                                        </div>
                                        </>
                                        )}

                                        {/* Ad Preview */}
                                        {(ad.image_url || ad.primary_text || ad.headline) && (
                                            <div>
                                                <label className={labelCls}>Preview</label>
                                                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 max-w-sm">
                                                    {/* Page header */}
                                                    <div className="flex items-center gap-2 px-3 py-2">
                                                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                                                            {(createAdPages.find(p => p.id === ad.page_id)?.name || 'P')[0]}
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-900 dark:text-white">{createAdPages.find(p => p.id === ad.page_id)?.name || 'Your Page'}</div>
                                                            <div className="text-[10px] text-gray-400">Sponsored</div>
                                                        </div>
                                                    </div>
                                                    {/* Primary text */}
                                                    {ad.primary_text && <p className="px-3 pb-2 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-line line-clamp-3">{ad.primary_text}</p>}
                                                    {/* Media */}
                                                    {ad.image_url && (
                                                        ad.mediaType === 'video' ? (
                                                            <video src={ad.image_url} className="w-full aspect-video object-cover bg-gray-100" muted />
                                                        ) : (
                                                            <img src={ad.image_url} alt="" className="w-full aspect-video object-cover bg-gray-100" />
                                                        )
                                                    )}
                                                    {/* Headline + CTA bar */}
                                                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800">
                                                        <div className="min-w-0 flex-1 mr-2">
                                                            {ad.headline && <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{ad.headline}</div>}
                                                            {ad.description && <div className="text-[10px] text-gray-500 truncate">{ad.description}</div>}
                                                        </div>
                                                        {ad.cta !== 'NO_BUTTON' && (
                                                            <span className="shrink-0 px-2 py-1 bg-blue-600 text-white text-[10px] font-semibold rounded">
                                                                {ad.cta.replace(/_/g, ' ')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Add Another Ad Button */}
                            <button type="button" onClick={() => {
                                const lastAd = createAdList[createAdList.length - 1];
                                setCreateAdList(list => [...list, { ...emptyAd(), page_id: lastAd.page_id, website_url: lastAd.website_url, cta: lastAd.cta }]);
                            }}
                                className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-2">
                                <Plus size={14} /> Add Another Ad
                            </button>
                        </div>
                        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setCreateAdModal(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            <button onClick={async () => {
                                setCreateAdSaving(true);
                                try {
                                    let created = 0;
                                    let failed = 0;
                                    for (const ad of createAdList) {
                                        const isExistingPost = ad.use_existing_post && ad.existing_post_id;
                                        if (!isExistingPost && (!ad.page_id || !ad.image_url || !ad.website_url)) continue;
                                        if (isExistingPost && !ad.existing_post_id.trim()) continue;
                                        // For existing-post mode, fan out to selected target ad sets; otherwise just current
                                        const targets = isExistingPost ? Array.from(createAdTargetAdsets) : [createAdModal.adsetId];
                                        for (const targetAdsetId of targets) {
                                            try {
                                                await quickCreateAd({
                                                    name: ad.name,
                                                    page_id: ad.page_id,
                                                    image_url: ad.image_url,
                                                    primary_text: ad.primary_text,
                                                    headline: ad.headline,
                                                    description: ad.description,
                                                    cta: ad.cta,
                                                    website_url: ad.website_url,
                                                    existing_post_id: isExistingPost ? ad.existing_post_id.trim() : undefined,
                                                    adset_id: targetAdsetId,
                                                    ad_account_id: createAdModal.adAccountId,
                                                }, selectedConnection?.id);
                                                created++;
                                            } catch (err) {
                                                failed++;
                                                console.error('quickCreateAd failed for adset', targetAdsetId, err);
                                            }
                                        }
                                    }
                                    if (failed > 0) {
                                        showWarning(`${created} ad${created !== 1 ? 's' : ''} created, ${failed} failed`);
                                    } else {
                                        showSuccess(`${created} ad${created !== 1 ? 's' : ''} created!`);
                                    }
                                    setCreateAdModal(null);
                                    setCreateAdList([emptyAd()]);
                                    fetchData();
                                } catch (e) { showError(e.message); }
                                finally { setCreateAdSaving(false); }
                            }} disabled={createAdSaving || !createAdList.some(a => (a.use_existing_post && a.existing_post_id?.trim()) || (a.page_id && a.image_url && a.website_url))}
                                className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50">
                                {createAdSaving ? <Loader size={14} className="animate-spin" /> : (() => {
                                    const usingExistingPost = createAdList.some(a => a.use_existing_post && a.existing_post_id?.trim());
                                    const total = usingExistingPost ? createAdList.filter(a => a.use_existing_post && a.existing_post_id?.trim()).length * createAdTargetAdsets.size + createAdList.filter(a => !a.use_existing_post).length : createAdList.length;
                                    return `Create ${total > 1 ? total + ' Ads' : 'Ad'}`;
                                })()}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Budget Schedule Modal (FB Native) */}
            {budgetSchedModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBudgetSchedModal(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[500px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <DollarSign size={18} className="text-emerald-500" /> Budget Schedule
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{budgetSchedModal.name}</p>
                            </div>
                            <button onClick={() => setBudgetSchedModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Add budget during peak hours using Facebook's native scheduling. No learning phase reset. Up to 9x base budget.
                            </p>

                            {/* Add new schedule */}
                            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-4 space-y-3">
                                <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Add Schedule</h4>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Additional Budget ($)</label>
                                    <input type="number" step="1" min="1" value={budgetSchedForm.amount} onChange={e => setBudgetSchedForm(f => ({ ...f, amount: e.target.value }))}
                                        placeholder="e.g. 500 = add $500 on top of base"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start Hour</label>
                                        <select value={budgetSchedForm.start_hour} onChange={e => setBudgetSchedForm(f => ({ ...f, start_hour: +e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                                            {Array.from({length: 24}, (_, i) => i).map(h => (
                                                <option key={h} value={h}>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">End Hour</label>
                                        <select value={budgetSchedForm.end_hour} onChange={e => setBudgetSchedForm(f => ({ ...f, end_hour: +e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                                            {Array.from({length: 24}, (_, i) => i).map(h => (
                                                <option key={h} value={h}>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {/* Quick presets */}
                                <div className="flex gap-2 flex-wrap">
                                    {[
                                        { label: '9AM-3PM +$500', amount: '500', start: 9, end: 15 },
                                        { label: '9AM-3PM +$1K', amount: '1000', start: 9, end: 15 },
                                        { label: '6AM-10PM +$2K', amount: '2000', start: 6, end: 22 },
                                        { label: '9AM-12PM +$800', amount: '800', start: 9, end: 12 },
                                    ].map(p => (
                                        <button key={p.label} onClick={() => setBudgetSchedForm({ amount: p.amount, start_hour: p.start, end_hour: p.end })}
                                            className="px-2 py-1 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={handleCreateBudgetSchedule} disabled={budgetSchedSaving || !budgetSchedForm.amount}
                                    className="w-full px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium disabled:opacity-50">
                                    {budgetSchedSaving ? <Loader size={14} className="animate-spin mx-auto" /> : 'Add Budget Schedule'}
                                </button>
                            </div>

                            {/* Existing schedules */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Active Schedules</h4>
                                {budgetSchedLoading ? (
                                    <div className="flex justify-center py-4"><Loader size={16} className="animate-spin text-gray-400" /></div>
                                ) : budgetScheds.length === 0 ? (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">No budget schedules set. Add one above.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {budgetScheds.map(s => (
                                            <div key={s.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                                <div>
                                                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                        +${((s.budget_value || 0) / 100).toFixed(0)}
                                                    </span>
                                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                                        {s.time_start ? new Date(s.time_start).toLocaleString() : '?'} — {s.time_end ? new Date(s.time_end).toLocaleString() : '?'}
                                                    </span>
                                                </div>
                                                <button onClick={() => handleDeleteBudgetSchedule(s.id)}
                                                    className="text-red-400 hover:text-red-600 transition-colors">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bid Cap Schedule Modal */}
            {bidSchedulePopover && (
                <BidScheduleModal
                    item={bidSchedulePopover.item}
                    objectType={bidSchedulePopover.objectType}
                    connectionId={selectedConnection?.id}
                    adAccountId={selectedAccount?.id}
                    onClose={() => setBidSchedulePopover(null)}
                    onCountChange={handleBidScheduleCountChange}
                />
            )}

            {/* Daypart Modal */}
            {daypartPopoverId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDaypartPopoverId(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[420px]" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                <Sun size={18} className="text-orange-500" /> Daypart Schedule
                            </h3>
                            <button onClick={() => setDaypartPopoverId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Active Start</label>
                                    <div className="flex gap-1">
                                        <select value={daypartForm.active_start_hour} onChange={e => setDaypartForm(f => ({...f, active_start_hour: +e.target.value}))}
                                            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-900 dark:text-gray-200">
                                            {Array.from({length:24},(_,i)=>i).map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}
                                        </select>
                                        <select value={daypartForm.active_start_minute} onChange={e => setDaypartForm(f => ({...f, active_start_minute: +e.target.value}))}
                                            className="w-16 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-900 dark:text-gray-200">
                                            {[0,15,30,45].map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Active End</label>
                                    <div className="flex gap-1">
                                        <select value={daypartForm.active_end_hour} onChange={e => setDaypartForm(f => ({...f, active_end_hour: +e.target.value}))}
                                            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-900 dark:text-gray-200">
                                            {Array.from({length:24},(_,i)=>i).map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}
                                        </select>
                                        <select value={daypartForm.active_end_minute} onChange={e => setDaypartForm(f => ({...f, active_end_minute: +e.target.value}))}
                                            className="w-16 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-900 dark:text-gray-200">
                                            {[0,15,30,45].map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Active Days <span className="text-gray-400 font-normal">(green = ads run, gray = ads paused)</span></label>
                                <div className="flex gap-1.5">
                                    {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d, i) => {
                                        const active = daypartForm.active_days.includes(i);
                                        return (
                                            <button key={i} onClick={() => toggleDaypartDay(i)}
                                                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors border-2 ${
                                                    active
                                                        ? 'bg-green-500 border-green-600 text-white shadow-sm'
                                                        : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:bg-gray-200'
                                                }`}>
                                                {active ? `${d} ✓` : d}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Timezone</label>
                                <select value={daypartForm.timezone} onChange={e => setDaypartForm(f => ({...f, timezone: e.target.value}))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:text-gray-200">
                                    <option value="America/New_York">Eastern (ET)</option>
                                    <option value="America/Chicago">Central (CT)</option>
                                    <option value="America/Denver">Mountain (MT)</option>
                                    <option value="America/Los_Angeles">Pacific (PT)</option>
                                    <option value="UTC">UTC</option>
                                </select>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Our cron job will automatically pause this {level === 'campaigns' ? 'campaign' : 'ad set'} outside these hours and reactivate during active hours.
                            </p>
                        </div>
                        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                            {daypartSchedules[daypartPopoverId] && (
                                <>
                                    <button onClick={async () => { await handleToggleDaypart(daypartPopoverId); setDaypartPopoverId(null); }}
                                        className={`px-3 py-2 text-xs font-medium rounded-lg ${daypartSchedules[daypartPopoverId].enabled ? 'text-gray-600 bg-gray-100 hover:bg-gray-200' : 'text-green-700 bg-green-50 hover:bg-green-100'}`}>
                                        {daypartSchedules[daypartPopoverId].enabled ? 'Disable' : 'Enable'}
                                    </button>
                                    <button onClick={async () => { await removeDaypartSchedule(daypartPopoverId); setDaypartPopoverId(null); }}
                                        className="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg">
                                        Remove
                                    </button>
                                </>
                            )}
                            <div className="flex-1" />
                            <button onClick={() => setDaypartPopoverId(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            <button onClick={() => saveDaypartSchedule(daypartPopoverId)} disabled={daypartSaving}
                                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50">
                                {daypartSaving ? <Loader size={14} className="animate-spin" /> : 'Save Daypart'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Campaign Modal */}
            {editCampaign && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditCampaign(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[500px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Campaign</h3>
                            <button onClick={() => setEditCampaign(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                                <input type="text" value={editCampaignData.name} onChange={e => setEditCampaignData(d => ({ ...d, name: e.target.value }))}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Daily Budget ($)</label>
                                <input type="number" step="0.01" min="1" value={editCampaignData.daily_budget} onChange={e => setEditCampaignData(d => ({ ...d, daily_budget: e.target.value }))}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                            </div>
                            {(() => {
                                const isAbo = !editCampaign?.daily_budget && !editCampaign?.lifetime_budget;
                                const enteringBudget = !!(editCampaignData.daily_budget && parseFloat(editCampaignData.daily_budget) > 0);
                                const bidDisabled = isAbo && !enteringBudget;
                                return (
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Bid Strategy</label>
                                        <select
                                            value={editCampaignData.bid_strategy}
                                            disabled={bidDisabled}
                                            onChange={e => setEditCampaignData(d => ({ ...d, bid_strategy: e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed">
                                            <option value="">Don't change</option>
                                            <option value="LOWEST_COST_WITHOUT_CAP">Lowest Cost (no cap)</option>
                                            <option value="LOWEST_COST_WITH_BID_CAP">Bid Cap</option>
                                            <option value="COST_CAP">Cost Cap</option>
                                            <option value="LOWEST_COST_WITH_MIN_ROAS">Min ROAS</option>
                                        </select>
                                        {bidDisabled && (
                                            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                                                ABO campaign — edit bid strategy on each ad set, or set a Daily Budget above to convert to CBO.
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Special Ad Categories</label>
                                <input type="text" value={editCampaignData.special_ad_categories} onChange={e => setEditCampaignData(d => ({ ...d, special_ad_categories: e.target.value }))}
                                    placeholder="HOUSING, CREDIT, EMPLOYMENT (or leave blank for none)"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <p className="text-[10px] text-gray-400 mt-1">Comma-separated. Leave blank for no special categories.</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setEditCampaign(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            <button onClick={handleSaveCampaign} disabled={editCampaignSaving}
                                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                                {editCampaignSaving ? <Loader size={14} className="animate-spin" /> : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Ad Set Modal */}
            {editAdSet && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditAdSet(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[500px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Ad Set</h3>
                            <button onClick={() => setEditAdSet(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                                <input type="text" value={editAdSetData.name} onChange={e => setEditAdSetData(d => ({ ...d, name: e.target.value }))}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Daily Budget ($)</label>
                                    <input type="number" step="0.01" min="1" value={editAdSetData.daily_budget} onChange={e => setEditAdSetData(d => ({ ...d, daily_budget: e.target.value }))}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Bid Cap ($)</label>
                                    <input type="number" step="0.01" min="0" value={editAdSetData.bid_amount} onChange={e => setEditAdSetData(d => ({ ...d, bid_amount: e.target.value }))}
                                        placeholder="0 = auto"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Optimization Goal</label>
                                <select value={editAdSetData.optimization_goal} onChange={e => setEditAdSetData(d => ({ ...d, optimization_goal: e.target.value }))}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                                    <option value="">Don't change</option>
                                    <option value="OFFSITE_CONVERSIONS">Conversions</option>
                                    <option value="LINK_CLICKS">Link Clicks</option>
                                    <option value="IMPRESSIONS">Impressions</option>
                                    <option value="REACH">Reach</option>
                                    <option value="LANDING_PAGE_VIEWS">Landing Page Views</option>
                                    <option value="VALUE">Value</option>
                                </select>
                            </div>
                            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Targeting</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Age Min</label>
                                        <input type="number" min="13" max="65" value={editAdSetData.age_min} onChange={e => setEditAdSetData(d => ({ ...d, age_min: e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Age Max</label>
                                        <input type="number" min="13" max="65" value={editAdSetData.age_max} onChange={e => setEditAdSetData(d => ({ ...d, age_max: e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gender</label>
                                    <div className="flex gap-2">
                                        {[{ label: 'All', value: [] }, { label: 'Male', value: [1] }, { label: 'Female', value: [2] }].map(g => (
                                            <button key={g.label} onClick={() => setEditAdSetData(d => ({ ...d, genders: g.value }))}
                                                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                                    JSON.stringify(editAdSetData.genders) === JSON.stringify(g.value)
                                                        ? 'bg-blue-600 text-white border-blue-600'
                                                        : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                                                }`}>
                                                {g.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Countries (comma-separated codes)</label>
                                    <input type="text" value={editAdSetData.countries} onChange={e => setEditAdSetData(d => ({ ...d, countries: e.target.value }))}
                                        placeholder="US, CA, GB"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Schedule</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start Time</label>
                                        <input type="datetime-local" value={editAdSetData.start_time} onChange={e => setEditAdSetData(d => ({ ...d, start_time: e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">End Time</label>
                                        <input type="datetime-local" value={editAdSetData.end_time} onChange={e => setEditAdSetData(d => ({ ...d, end_time: e.target.value }))}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setEditAdSet(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            <button onClick={handleSaveAdSet} disabled={editAdSetSaving}
                                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                                {editAdSetSaving ? <Loader size={14} className="animate-spin" /> : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Budget Surf Log Modal */}
            {surfLogModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSurfLogModal(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Waves size={16} className="text-cyan-500" /> Surf Action Log
                            </h3>
                            <button onClick={() => setSurfLogModal(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                        </div>
                        <div className="overflow-y-auto max-h-[70vh] p-4">
                            {surfLogs.length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No actions logged yet</p>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                            <th className="text-left py-2 px-2">Time</th>
                                            <th className="text-left py-2 px-2">Action</th>
                                            <th className="text-left py-2 px-2">Phase</th>
                                            <th className="text-right py-2 px-2">Budget</th>
                                            <th className="text-right py-2 px-2">Conv</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {surfLogs.map(log => (
                                            <tr key={log.id} className="border-b border-gray-100 dark:border-gray-700/50">
                                                <td className="py-1.5 px-2 text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                                                <td className="py-1.5 px-2">
                                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                                                        log.action === 'doubled' || log.action === 'quadrupled' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                        log.action === 'paused' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                        log.action === 'reset' || log.action === 'reactivated' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                        'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                                    }`}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td className="py-1.5 px-2 text-gray-500">{log.phase}</td>
                                                <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-300">
                                                    {log.new_budget_cents != null ? `$${(log.new_budget_cents / 100).toFixed(2)}` : '—'}
                                                </td>
                                                <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-300">{log.conversions ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CampaignBrowser;
