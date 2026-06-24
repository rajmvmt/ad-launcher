import React, { useState, useEffect } from 'react';
import {
    Megaphone, Loader, ChevronRight, RefreshCw, Play, Pause,
    ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, Eye, Trash2, X,
    MousePointerClick, DollarSign, TrendingUp, Target, ExternalLink
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { getConnections } from '../api/nativeConnections';
import * as taboolaApi from '../lib/taboolaApi';
import * as newsbreakApi from '../lib/newsbreakApi';
import * as outbrainApi from '../lib/outbrainApi';

const fmt = (n, decimals = 0) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const fmtMoney = (n) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtPct = (n) => {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toFixed(2) + '%';
};

const DATE_PRESETS = [
    { label: 'Today', days: 0 },
    { label: 'Yesterday', days: 1 },
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 14 days', days: 14 },
    { label: 'Last 30 days', days: 30 },
];

function getDateRange(days) {
    const end = new Date();
    const start = new Date();
    if (days === 0) return { since: end.toISOString().split('T')[0], until: end.toISOString().split('T')[0] };
    if (days === 1) { start.setDate(start.getDate() - 1); return { since: start.toISOString().split('T')[0], until: start.toISOString().split('T')[0] }; }
    start.setDate(start.getDate() - days);
    return { since: start.toISOString().split('T')[0], until: end.toISOString().split('T')[0] };
}

const PLATFORMS = [
    { id: 'taboola', label: 'Taboola' },
    { id: 'newsbreak', label: 'NewsBreak' },
    { id: 'outbrain', label: 'Outbrain' },
];

export default function NativeAds() {
    const { showError, showSuccess } = useToast();
    const [platform, setPlatform] = useState('newsbreak');
    const [connections, setConnections] = useState([]);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [loading, setLoading] = useState(false);
    const [datePreset, setDatePreset] = useState(7);
    const [dateRange, setDateRange] = useState(getDateRange(7));

    // Drill-down state
    const [level, setLevel] = useState('campaigns');
    const [campaigns, setCampaigns] = useState([]);
    const [drillData, setDrillData] = useState([]);
    const [drillData2, setDrillData2] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [selectedAdSet, setSelectedAdSet] = useState(null);
    const [sortKey, setSortKey] = useState('spend');
    const [sortDir, setSortDir] = useState('desc');

    // Bulk & action state
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [togglingId, setTogglingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [bulkLoading, setBulkLoading] = useState(false);

    useEffect(() => { loadConnections(); }, [platform]);

    const loadConnections = async () => {
        try {
            const conns = await getConnections(platform);
            setConnections(conns);
            setSelectedConnection(conns.find(c => c.is_default) || conns[0] || null);
        } catch { setConnections([]); setSelectedConnection(null); }
    };

    useEffect(() => {
        if (selectedConnection) loadCampaigns();
    }, [selectedConnection, dateRange]);

    // ── Helpers ────────────────────────────────────────────────────

    // Pick the first defined value across a list of possible keys (case-insensitive).
    const pick = (obj, keys) => {
        if (!obj) return undefined;
        for (const k of keys) {
            if (obj[k] != null) return obj[k];
            const upper = k.toUpperCase();
            if (obj[upper] != null) return obj[upper];
            const lower = k.toLowerCase();
            if (obj[lower] != null) return obj[lower];
        }
        return undefined;
    };

    const normalizeMetrics = (r) => {
        if (!r) return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, conversions: 0, cpa: 0 };
        // Some APIs nest metrics under `metrics` — flatten by merging.
        const src = r.metrics ? { ...r, ...r.metrics } : r;
        return {
            spend: parseFloat(pick(src, ['cost', 'spent', 'spend', 'COST', 'SPEND', 'totalCost']) || 0),
            impressions: parseInt(pick(src, ['impression', 'impressions', 'IMPRESSION', 'IMPRESSIONS', 'imps']) || 0),
            clicks: parseInt(pick(src, ['click', 'clicks', 'CLICK', 'CLICKS']) || 0),
            ctr: parseFloat(pick(src, ['ctr', 'CTR']) || 0),
            cpc: parseFloat(pick(src, ['cpc', 'ecpc', 'CPC']) || 0),
            conversions: parseInt(pick(src, ['conversion', 'conversions', 'CONVERSION', 'CONVERSIONS', 'totalConversions']) || 0),
            cpa: parseFloat(pick(src, ['cpa', 'totalCpa', 'CPA']) || 0),
        };
    };

    const buildReportMap = (report, idField) => {
        const rows = Array.isArray(report) ? report : report?.rows || report?.list || report?.records || report?.data || [];
        // Accept multiple ID field variants that NewsBreak / other APIs might return.
        const idAliases = {
            campaignId: ['campaignId', 'campaign_id', 'campaignID', 'CAMPAIGN', 'campaign'],
            adSetId: ['adSetId', 'ad_set_id', 'adsetId', 'adsetID', 'AD_SET', 'adset'],
            adId: ['adId', 'ad_id', 'adID', 'AD', 'ad'],
        };
        const keys = idAliases[idField] || [idField];
        const map = {};
        rows.forEach(r => {
            // Some APIs nest IDs under `dimensions`.
            const src = r.dimensions ? { ...r, ...r.dimensions } : r;
            const id = pick(src, keys) || src.id;
            if (id) map[id] = r;
        });
        return map;
    };

    // ── Platform-agnostic loaders ────────────────────────────────

    const loadCampaigns = async () => {
        if (!selectedConnection) return;
        setLoading(true);
        setLevel('campaigns');
        setCampaigns([]);
        setSelectedIds(new Set());
        try {
            if (platform === 'taboola') {
                const [camps, report] = await Promise.all([
                    taboolaApi.getCampaigns(selectedConnection.id),
                    taboolaApi.getCampaignReport(dateRange.since, dateRange.until, selectedConnection.id).catch(() => []),
                ]);
                const reportMap = {};
                (Array.isArray(report) ? report : []).forEach(r => { reportMap[r.campaign || r.campaign_id || r.id] = r; });
                setCampaigns((Array.isArray(camps) ? camps : []).map(c => ({
                    id: c.id, name: c.name, status: c.is_active ? 'RUNNING' : 'PAUSED',
                    ...normalizeMetrics(reportMap[c.id]),
                })));
            } else if (platform === 'newsbreak') {
                const [camps, report] = await Promise.all([
                    newsbreakApi.getCampaigns(selectedConnection.id),
                    newsbreakApi.getReport(dateRange.since, dateRange.until, selectedConnection.id, 'CAMPAIGN').catch(e => {
                        showError(`NewsBreak report error: ${e.message}`);
                        return [];
                    }),
                ]);
                const list = Array.isArray(camps) ? camps : camps?.records || camps?.rows || [];
                const reportMap = buildReportMap(report, 'campaignId');
                setCampaigns(list.map(c => ({
                    id: c.id, name: c.name, status: c.onlineStatus || c.status || 'ON',
                    ...normalizeMetrics(reportMap[c.id]),
                })));
            } else if (platform === 'outbrain') {
                const [camps, report] = await Promise.all([
                    outbrainApi.getCampaigns(selectedConnection.id),
                    outbrainApi.getCampaignReport(dateRange.since, dateRange.until, selectedConnection.id).catch(() => []),
                ]);
                const reportMap = {};
                (Array.isArray(report) ? report : []).forEach(r => {
                    const id = r.metadata?.id || r.id;
                    const m = r.metrics || r;
                    reportMap[id] = m;
                });
                setCampaigns((Array.isArray(camps) ? camps : []).map(c => ({
                    id: c.id, name: c.name, status: c.enabled ? 'RUNNING' : 'PAUSED',
                    cpc_bid: c.cpc,
                    ...normalizeMetrics(reportMap[c.id]),
                })));
            }
        } catch (e) {
            showError(`Failed to load campaigns: ${e.message}`);
        }
        setLoading(false);
    };

    const drillDown = async (campaign) => {
        setSelectedCampaign(campaign);
        setLoading(true);
        setSelectedIds(new Set());
        try {
            if (platform === 'newsbreak') {
                setLevel('adsets');
                const [adsets, report] = await Promise.all([
                    newsbreakApi.getAdSets(campaign.id, selectedConnection.id),
                    newsbreakApi.getReport(dateRange.since, dateRange.until, selectedConnection.id, 'AD_SET').catch(e => {
                        showError(`NewsBreak ad set report error: ${e.message}`);
                        return [];
                    }),
                ]);
                const reportMap = buildReportMap(report, 'adSetId');
                setDrillData((Array.isArray(adsets) ? adsets : adsets?.records || []).map(a => ({
                    id: a.id, name: a.name, status: a.status || a.onlineStatus || 'ON',
                    ...normalizeMetrics(reportMap[a.id]),
                })));
            } else if (platform === 'outbrain') {
                setLevel('ads');
                const links = await outbrainApi.getPromotedLinks(campaign.id, selectedConnection.id);
                setDrillData((Array.isArray(links) ? links : []).map(l => ({
                    id: l.id, name: l.text || l.title, url: l.url, status: l.enabled ? 'RUNNING' : 'PAUSED',
                    thumbnail: l.cachedImageUrl || l.thumbnailUrl,
                })));
            } else if (platform === 'taboola') {
                setLevel('ads');
                const items = await taboolaApi.getCampaignItems(campaign.id, selectedConnection.id);
                setDrillData((Array.isArray(items) ? items : []).map(i => ({
                    id: i.id, name: i.title || i.name, url: i.url, status: i.is_active ? 'RUNNING' : 'PAUSED',
                    thumbnail: i.thumbnail_url,
                })));
            }
        } catch (e) { showError(`Failed to drill down: ${e.message}`); }
        setLoading(false);
    };

    const drillToAds = async (adset) => {
        setSelectedAdSet(adset);
        setLevel('ads');
        setLoading(true);
        setSelectedIds(new Set());
        try {
            const [ads, report] = await Promise.all([
                newsbreakApi.getAds(adset.id, selectedConnection.id),
                newsbreakApi.getReport(dateRange.since, dateRange.until, selectedConnection.id, 'AD').catch(e => {
                    showError(`NewsBreak ad report error: ${e.message}`);
                    return [];
                }),
            ]);
            const reportMap = buildReportMap(report, 'adId');
            setDrillData2((Array.isArray(ads) ? ads : ads?.records || []).map(a => ({
                id: a.id, name: a.name || a.creative?.headline, status: a.status || a.onlineStatus || 'ON',
                headline: a.creative?.headline, description: a.creative?.description,
                thumbnail: a.creative?.assetUrl, url: a.creative?.clickThroughUrl,
                ...normalizeMetrics(reportMap[a.id]),
            })));
        } catch (e) { showError(`Failed to load ads: ${e.message}`); }
        setLoading(false);
    };

    // ── Status toggle ─────────────────────────────────────────────

    const handleToggleStatus = async (item) => {
        if (platform !== 'newsbreak') return;
        const newStatus = isActive(item.status) ? 'OFF' : 'ON';
        setTogglingId(item.id);
        try {
            if (level === 'campaigns') {
                await newsbreakApi.updateCampaignStatus(item.id, newStatus, selectedConnection.id);
                setCampaigns(prev => prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c));
            } else if (level === 'adsets') {
                await newsbreakApi.updateAdSetStatus(item.id, newStatus, selectedConnection.id);
                setDrillData(prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a));
            } else if (level === 'ads') {
                await newsbreakApi.updateAdStatus(item.id, newStatus, selectedConnection.id);
                const updater = prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a);
                if (drillData2.length) setDrillData2(updater);
                else setDrillData(updater);
            }
            showSuccess(`Status changed to ${newStatus}`);
        } catch (e) { showError(`Failed to toggle: ${e.message}`); }
        setTogglingId(null);
    };

    // ── Delete ────────────────────────────────────────────────────

    const handleDelete = async (item) => {
        if (platform !== 'newsbreak') return;
        try {
            if (level === 'campaigns') {
                await newsbreakApi.deleteCampaign(item.id, selectedConnection.id);
                setCampaigns(prev => prev.filter(c => c.id !== item.id));
            } else if (level === 'adsets') {
                await newsbreakApi.deleteAdSet(item.id, selectedConnection.id);
                setDrillData(prev => prev.filter(a => a.id !== item.id));
            } else if (level === 'ads') {
                await newsbreakApi.deleteAd(item.id, selectedConnection.id);
                if (drillData2.length) setDrillData2(prev => prev.filter(a => a.id !== item.id));
                else setDrillData(prev => prev.filter(a => a.id !== item.id));
            }
            showSuccess('Deleted successfully');
        } catch (e) { showError(`Failed to delete: ${e.message}`); }
        setDeletingId(null);
    };

    // ── Bulk actions ──────────────────────────────────────────────

    const handleBulkStatus = async (newStatus) => {
        if (platform !== 'newsbreak' || selectedIds.size === 0) return;
        setBulkLoading(true);
        let success = 0;
        for (const id of selectedIds) {
            try {
                if (level === 'campaigns') await newsbreakApi.updateCampaignStatus(id, newStatus, selectedConnection.id);
                else if (level === 'adsets') await newsbreakApi.updateAdSetStatus(id, newStatus, selectedConnection.id);
                else await newsbreakApi.updateAdStatus(id, newStatus, selectedConnection.id);
                success++;
            } catch { /* continue */ }
        }
        // Update local state
        const updater = prev => prev.map(item =>
            selectedIds.has(item.id) ? { ...item, status: newStatus } : item
        );
        if (level === 'campaigns') setCampaigns(updater);
        else if (level === 'adsets') setDrillData(updater);
        else if (drillData2.length) setDrillData2(updater);
        else setDrillData(updater);
        showSuccess(`Updated ${success} of ${selectedIds.size} items`);
        setSelectedIds(new Set());
        setBulkLoading(false);
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        const data = currentData;
        if (selectedIds.size === data.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(data.map(d => d.id)));
    };

    // ── Sorting ───────────────────────────────────────────────────

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ col }) => {
        if (sortKey !== col) return <ArrowUpDown size={12} className="text-gray-300" />;
        return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
    };

    const sortList = (list) => [...list].sort((a, b) => {
        let va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
        if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
        return sortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
    });

    const handleDatePreset = (days) => { setDatePreset(days); setDateRange(getDateRange(days)); };

    const goBack = () => {
        setSelectedIds(new Set());
        if (level === 'ads' && platform === 'newsbreak' && selectedAdSet) {
            setLevel('adsets'); setSelectedAdSet(null); setDrillData2([]);
        } else {
            setLevel('campaigns'); setSelectedCampaign(null); setDrillData([]); setDrillData2([]);
        }
    };

    // Summary
    const currentData = level === 'campaigns' ? campaigns : level === 'adsets' ? drillData : drillData2.length ? drillData2 : drillData;
    const summary = {
        spend: currentData.reduce((s, r) => s + (parseFloat(r.spend || 0)), 0),
        impressions: currentData.reduce((s, r) => s + (parseInt(r.impressions || 0)), 0),
        clicks: currentData.reduce((s, r) => s + (parseInt(r.clicks || 0)), 0),
        conversions: currentData.reduce((s, r) => s + (parseInt(r.conversions || 0)), 0),
    };
    summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions * 100) : 0;
    summary.cpc = summary.clicks > 0 ? (summary.spend / summary.clicks) : 0;
    summary.cpa = summary.conversions > 0 ? (summary.spend / summary.conversions) : 0;

    const isActive = (status) => ['RUNNING', 'ON', 'ACTIVE', 'true'].includes(String(status).toUpperCase());
    const isNewsbreak = platform === 'newsbreak';

    const tableProps = {
        onSort: handleSort, SortIcon, isActive, fmtMoney, fmt, fmtPct,
        selectedIds, onToggleSelect: toggleSelect, onToggleSelectAll: toggleSelectAll,
        onToggleStatus: isNewsbreak ? handleToggleStatus : null,
        togglingId, deletingId, setDeletingId,
        onDelete: isNewsbreak ? handleDelete : null,
    };

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <Megaphone className="text-amber-600" size={28} />
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Native Ads</h1>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
                {/* Platform Tabs */}
                <div className="flex border-b border-gray-200 overflow-x-auto">
                    {PLATFORMS.map(p => (
                        <button key={p.id} onClick={() => { setPlatform(p.id); setLevel('campaigns'); setCampaigns([]); setDrillData([]); setDrillData2([]); setSelectedIds(new Set()); }}
                            className={`px-4 sm:px-6 py-3 font-medium text-sm transition-colors whitespace-nowrap ${platform === p.id ? 'text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>

                <div className="p-3 sm:p-6">
                    {connections.length === 0 ? (
                        <div className="text-center py-12">
                            <Megaphone className="mx-auto text-gray-300 mb-4" size={48} />
                            <h3 className="text-lg font-semibold text-gray-600 mb-2">No {PLATFORMS.find(p => p.id === platform)?.label} Connections</h3>
                            <p className="text-gray-400 text-sm">Go to Settings → Native Ads to add your API credentials.</p>
                        </div>
                    ) : (
                        <>
                            {/* Controls */}
                            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-4">
                                <select value={selectedConnection?.id || ''} onChange={e => setSelectedConnection(connections.find(c => c.id === e.target.value))}
                                    className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                    {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
                                    {DATE_PRESETS.map(p => (
                                        <button key={p.days} onClick={() => handleDatePreset(p.days)}
                                            className={`px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${datePreset === p.days ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={loadCampaigns} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 self-start">
                                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                </button>
                            </div>

                            {/* Mobile Back Button */}
                            {level !== 'campaigns' && (
                                <button onClick={goBack}
                                    className="sm:hidden flex items-center gap-2 mb-3 px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium w-full">
                                    <ChevronLeft size={18} />
                                    Back to {level === 'ads' && selectedAdSet ? 'Ad Sets' : 'Campaigns'}
                                </button>
                            )}
                            {/* Desktop Breadcrumb */}
                            {level !== 'campaigns' && (
                                <div className="hidden sm:flex items-center gap-2 mb-4 text-sm">
                                    <button onClick={goBack} className="text-amber-600 hover:underline flex items-center gap-1">
                                        <ChevronLeft size={14} /> {level === 'ads' && selectedAdSet ? 'Ad Sets' : 'Campaigns'}
                                    </button>
                                    <ChevronRight size={14} className="text-gray-400" />
                                    <span className="text-gray-700 font-medium truncate">{selectedAdSet?.name || selectedCampaign?.name}</span>
                                </div>
                            )}

                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3 mb-4">
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><DollarSign size={12} />Spend</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmtMoney(summary.spend)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Eye size={12} />Impr.</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmt(summary.impressions)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><MousePointerClick size={12} />Clicks</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmt(summary.clicks)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><TrendingUp size={12} />CTR</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmtPct(summary.ctr)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><DollarSign size={12} />CPC</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmtMoney(summary.cpc)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Target size={12} />Conv.</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{fmt(summary.conversions)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Target size={12} />CPA</div>
                                    <div className="text-base sm:text-lg font-bold text-gray-900">{summary.cpa > 0 ? fmtMoney(summary.cpa) : '—'}</div>
                                </div>
                            </div>

                            {/* Table / Cards */}
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader className="animate-spin text-amber-500" size={24} />
                                    <span className="ml-2 text-gray-500">Loading...</span>
                                </div>
                            ) : (
                                <>
                                    {/* Mobile Card View */}
                                    <div className="sm:hidden space-y-2">
                                        {(level === 'campaigns' ? sortList(campaigns) : level === 'adsets' ? sortList(drillData) : sortList(drillData2.length ? drillData2 : drillData)).map(item => (
                                            <NativeAdCard
                                                key={item.id}
                                                item={item}
                                                level={level}
                                                isActive={isActive}
                                                fmtMoney={fmtMoney}
                                                fmt={fmt}
                                                fmtPct={fmtPct}
                                                onDrill={level === 'campaigns' ? drillDown : level === 'adsets' ? drillToAds : null}
                                                onToggleStatus={isNewsbreak ? handleToggleStatus : null}
                                                togglingId={togglingId}
                                                selectedIds={selectedIds}
                                                onToggleSelect={toggleSelect}
                                                onDelete={isNewsbreak ? handleDelete : null}
                                                deletingId={deletingId}
                                                setDeletingId={setDeletingId}
                                            />
                                        ))}
                                        {(level === 'campaigns' ? campaigns : level === 'adsets' ? drillData : drillData2.length ? drillData2 : drillData).length === 0 && (
                                            <div className="text-center py-8 text-gray-400 text-sm">No {level} found</div>
                                        )}
                                    </div>

                                    {/* Desktop Table View */}
                                    <div className="hidden sm:block">
                                        {level === 'campaigns' ? (
                                            <CampaignTable data={sortList(campaigns)} onDrill={drillDown} {...tableProps} />
                                        ) : level === 'adsets' ? (
                                            <AdSetTable data={sortList(drillData)} onDrill={drillToAds} {...tableProps} />
                                        ) : (
                                            <AdsTable data={sortList(drillData2.length ? drillData2 : drillData)} {...tableProps} />
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Bulk Action Bar */}
                            {selectedIds.size > 0 && isNewsbreak && (
                                <div className="fixed bottom-6 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 bg-gray-900 text-white rounded-xl shadow-2xl px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-4 z-50">
                                    <span className="text-sm font-medium">{selectedIds.size} sel.</span>
                                    <button onClick={() => handleBulkStatus('ON')} disabled={bulkLoading}
                                        className="px-3 sm:px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1">
                                        <Play size={12} /> <span className="hidden sm:inline">Activate</span><span className="sm:hidden">On</span>
                                    </button>
                                    <button onClick={() => handleBulkStatus('OFF')} disabled={bulkLoading}
                                        className="px-3 sm:px-4 py-1.5 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1">
                                        <Pause size={12} /> <span className="hidden sm:inline">Pause</span><span className="sm:hidden">Off</span>
                                    </button>
                                    <button onClick={() => setSelectedIds(new Set())} className="p-1 hover:bg-gray-700 rounded ml-auto sm:ml-0">
                                        <X size={16} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Mobile Card Component ─────────────────────────────────────────

function NativeAdCard({ item, level, isActive, fmtMoney, fmt, fmtPct, onDrill, onToggleStatus, togglingId, selectedIds, onToggleSelect, onDelete, deletingId, setDeletingId }) {
    const active = isActive(item.status);
    return (
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-start gap-2">
                {onToggleStatus && (
                    <input type="checkbox" checked={selectedIds.has(item.id)}
                        onChange={() => onToggleSelect(item.id)} className="rounded border-gray-300 mt-1" />
                )}
                {level === 'ads' && item.thumbnail && (
                    <img src={item.thumbnail} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                    <button onClick={onDrill ? () => onDrill(item) : undefined}
                        className={`font-medium text-sm text-gray-900 truncate block w-full text-left ${onDrill ? 'hover:text-amber-600' : ''}`}>
                        {item.name || item.headline || '—'}
                    </button>
                    {item.description && <div className="text-xs text-gray-400 truncate">{item.description}</div>}
                </div>
                <StatusBadge active={active} loading={togglingId === item.id}
                    onClick={onToggleStatus ? () => onToggleStatus(item) : null} />
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg px-2 py-1.5">
                    <div className="text-[10px] text-gray-400 uppercase">Spend</div>
                    <div className="text-sm font-semibold text-gray-900">{fmtMoney(item.spend)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-2 py-1.5">
                    <div className="text-[10px] text-gray-400 uppercase">Clicks</div>
                    <div className="text-sm font-semibold text-gray-900">{fmt(item.clicks)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-2 py-1.5">
                    <div className="text-[10px] text-gray-400 uppercase">{item.conversions > 0 ? 'CPA' : 'CPC'}</div>
                    <div className="text-sm font-semibold text-gray-900">{item.cpa > 0 ? fmtMoney(item.cpa) : fmtMoney(item.cpc)}</div>
                </div>
            </div>

            {/* Secondary metrics row */}
            <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                <span>Impr: {fmt(item.impressions)}</span>
                <span>CTR: {fmtPct(item.ctr)}</span>
                <span>Conv: {fmt(item.conversions)}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
                {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-600 hover:underline flex items-center gap-1 truncate max-w-[60%]">
                        <ExternalLink size={10} />
                        <span className="truncate">{item.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
                    </a>
                )}
                {onDelete && (
                    <div className="ml-auto">
                        {deletingId === item.id ? (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-red-600">Delete?</span>
                                <button onClick={() => onDelete(item)} className="text-xs text-red-600 font-bold">Yes</button>
                                <button onClick={() => setDeletingId(null)} className="text-xs text-gray-400">No</button>
                            </div>
                        ) : (
                            <button onClick={() => setDeletingId(item.id)} className="p-1 text-gray-400 hover:text-red-500">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Table Components ──────────────────────────────────────────────

function CampaignTable({ data, onSort, SortIcon, onDrill, isActive, fmtMoney, fmt, fmtPct,
    selectedIds, onToggleSelect, onToggleSelectAll, onToggleStatus, togglingId, deletingId, setDeletingId, onDelete }) {
    return (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full">
                <thead className="bg-gray-50">
                    <tr>
                        {onToggleStatus && <th className="px-3 py-3 w-10">
                            <input type="checkbox" checked={data.length > 0 && selectedIds.size === data.length}
                                onChange={onToggleSelectAll} className="rounded border-gray-300" />
                        </th>}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Campaign</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                        <SortHeader label="Spend" col="spend" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Impr." col="impressions" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Clicks" col="clicks" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CTR" col="ctr" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPC" col="cpc" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Conv." col="conversions" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPA" col="cpa" onSort={onSort} SortIcon={SortIcon} />
                        {onDelete && <th className="px-3 py-3 w-10"></th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {data.length === 0 ? (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No campaigns found</td></tr>
                    ) : data.map(c => (
                        <tr key={c.id} className="hover:bg-amber-50/50 group">
                            {onToggleStatus && <td className="px-3 py-3">
                                <input type="checkbox" checked={selectedIds.has(c.id)}
                                    onChange={() => onToggleSelect(c.id)} className="rounded border-gray-300" />
                            </td>}
                            <td className="px-4 py-3 cursor-pointer" onClick={() => onDrill(c)}>
                                <div className="font-medium text-gray-900 text-sm truncate max-w-[280px] hover:text-amber-600" title={c.name}>{c.name}</div>
                            </td>
                            <td className="px-4 py-3">
                                <StatusBadge active={isActive(c.status)} loading={togglingId === c.id}
                                    onClick={onToggleStatus ? () => onToggleStatus(c) : null} />
                            </td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(c.spend)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(c.impressions)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(c.clicks)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtPct(c.ctr)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(c.cpc)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(c.conversions)}</td>
                            <td className="px-4 py-3 text-right text-sm">{c.cpa > 0 ? fmtMoney(c.cpa) : '—'}</td>
                            {onDelete && <td className="px-3 py-3">
                                <DeleteAction id={c.id} deletingId={deletingId} setDeletingId={setDeletingId} onDelete={() => onDelete(c)} />
                            </td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AdSetTable({ data, onSort, SortIcon, onDrill, isActive, fmtMoney, fmt, fmtPct,
    selectedIds, onToggleSelect, onToggleSelectAll, onToggleStatus, togglingId, deletingId, setDeletingId, onDelete }) {
    return (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full">
                <thead className="bg-gray-50">
                    <tr>
                        {onToggleStatus && <th className="px-3 py-3 w-10">
                            <input type="checkbox" checked={data.length > 0 && selectedIds.size === data.length}
                                onChange={onToggleSelectAll} className="rounded border-gray-300" />
                        </th>}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ad Set</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                        <SortHeader label="Spend" col="spend" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Impr." col="impressions" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Clicks" col="clicks" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CTR" col="ctr" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPC" col="cpc" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Conv." col="conversions" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPA" col="cpa" onSort={onSort} SortIcon={SortIcon} />
                        {onDelete && <th className="px-3 py-3 w-10"></th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {data.length === 0 ? (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No ad sets found</td></tr>
                    ) : data.map(a => (
                        <tr key={a.id} className="hover:bg-amber-50/50 group">
                            {onToggleStatus && <td className="px-3 py-3">
                                <input type="checkbox" checked={selectedIds.has(a.id)}
                                    onChange={() => onToggleSelect(a.id)} className="rounded border-gray-300" />
                            </td>}
                            <td className="px-4 py-3 cursor-pointer" onClick={() => onDrill(a)}>
                                <div className="font-medium text-gray-900 text-sm truncate max-w-[280px] hover:text-amber-600" title={a.name}>{a.name}</div>
                            </td>
                            <td className="px-4 py-3">
                                <StatusBadge active={isActive(a.status)} loading={togglingId === a.id}
                                    onClick={onToggleStatus ? () => onToggleStatus(a) : null} />
                            </td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(a.spend)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(a.impressions)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(a.clicks)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtPct(a.ctr)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(a.cpc)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(a.conversions)}</td>
                            <td className="px-4 py-3 text-right text-sm">{a.cpa > 0 ? fmtMoney(a.cpa) : '—'}</td>
                            {onDelete && <td className="px-3 py-3">
                                <DeleteAction id={a.id} deletingId={deletingId} setDeletingId={setDeletingId} onDelete={() => onDelete(a)} />
                            </td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AdsTable({ data, onSort, SortIcon, isActive, fmtMoney, fmt, fmtPct,
    selectedIds, onToggleSelect, onToggleSelectAll, onToggleStatus, togglingId, deletingId, setDeletingId, onDelete }) {
    return (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full">
                <thead className="bg-gray-50">
                    <tr>
                        {onToggleStatus && <th className="px-3 py-3 w-10">
                            <input type="checkbox" checked={data.length > 0 && selectedIds.size === data.length}
                                onChange={onToggleSelectAll} className="rounded border-gray-300" />
                        </th>}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-16">Ad</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Headline</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                        <SortHeader label="Spend" col="spend" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Clicks" col="clicks" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPC" col="cpc" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CTR" col="ctr" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="Conv." col="conversions" onSort={onSort} SortIcon={SortIcon} />
                        <SortHeader label="CPA" col="cpa" onSort={onSort} SortIcon={SortIcon} />
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">URL</th>
                        {onDelete && <th className="px-3 py-3 w-10"></th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {data.length === 0 ? (
                        <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">No ads found</td></tr>
                    ) : data.map(a => (
                        <tr key={a.id} className="hover:bg-amber-50/50 group">
                            {onToggleStatus && <td className="px-3 py-3">
                                <input type="checkbox" checked={selectedIds.has(a.id)}
                                    onChange={() => onToggleSelect(a.id)} className="rounded border-gray-300" />
                            </td>}
                            <td className="px-4 py-3">
                                {a.thumbnail
                                    ? <img src={a.thumbnail} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200"
                                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                    : null}
                                <div className={`w-14 h-14 bg-gray-100 rounded-lg items-center justify-center text-gray-300 ${a.thumbnail ? 'hidden' : 'flex'}`}
                                    style={a.thumbnail ? { display: 'none' } : {}}>
                                    <Eye size={18} />
                                </div>
                            </td>
                            <td className="px-4 py-3">
                                <div className="font-medium text-gray-900 text-sm truncate max-w-[250px]" title={a.name || a.headline}>
                                    {a.name || a.headline || '—'}
                                </div>
                                {a.description && <div className="text-xs text-gray-400 truncate max-w-[250px]">{a.description}</div>}
                            </td>
                            <td className="px-4 py-3">
                                <StatusBadge active={isActive(a.status)} loading={togglingId === a.id}
                                    onClick={onToggleStatus ? () => onToggleStatus(a) : null} />
                            </td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(a.spend)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(a.clicks)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtMoney(a.cpc)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmtPct(a.ctr)}</td>
                            <td className="px-4 py-3 text-right text-sm">{fmt(a.conversions)}</td>
                            <td className="px-4 py-3 text-right text-sm">{a.cpa > 0 ? fmtMoney(a.cpa) : '—'}</td>
                            <td className="px-4 py-3">
                                {a.url ? (
                                    <a href={a.url} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-amber-600 hover:underline truncate max-w-[160px] block flex items-center gap-1">
                                        <ExternalLink size={10} />
                                        <span className="truncate">{a.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
                                    </a>
                                ) : <span className="text-xs text-gray-300">—</span>}
                            </td>
                            {onDelete && <td className="px-3 py-3">
                                <DeleteAction id={a.id} deletingId={deletingId} setDeletingId={setDeletingId} onDelete={() => onDelete(a)} />
                            </td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Shared Components ─────────────────────────────────────────────

function SortHeader({ label, col, onSort, SortIcon }) {
    return (
        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer" onClick={() => onSort(col)}>
            <span className="flex items-center justify-end gap-1">{label} <SortIcon col={col} /></span>
        </th>
    );
}

function StatusBadge({ active, loading, onClick }) {
    const cls = active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500';
    const hoverCls = onClick ? 'cursor-pointer hover:ring-2 hover:ring-amber-300' : '';
    return (
        <button onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
            disabled={loading}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all ${cls} ${hoverCls} disabled:opacity-50`}>
            {loading ? <Loader size={10} className="animate-spin" />
                : active ? <Play size={10} /> : <Pause size={10} />}
            {active ? 'Active' : 'Paused'}
        </button>
    );
}

function DeleteAction({ id, deletingId, setDeletingId, onDelete }) {
    if (deletingId === id) {
        return (
            <div className="flex items-center gap-1">
                <span className="text-xs text-red-600 font-medium">Sure?</span>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="text-xs text-red-600 font-bold hover:underline">Yes</button>
                <button onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                    className="text-xs text-gray-400 hover:underline">No</button>
            </div>
        );
    }
    return (
        <button onClick={(e) => { e.stopPropagation(); setDeletingId(id); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all">
            <Trash2 size={14} />
        </button>
    );
}
