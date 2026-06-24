import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Search, Plus, Loader, RefreshCw, DollarSign, MousePointer, Eye, Target, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown, Play, Pause, ChevronRight, ExternalLink, Calendar } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useSearchParams } from 'react-router-dom';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/google-ads';

const getAuthHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const authFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...opts.headers, ...getAuthHeaders() } });

const fmtMoney = (v) => v == null || isNaN(v) ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v) => v == null || isNaN(v) ? '—' : Number(v).toLocaleString();
const fmtPct = (v) => v == null || isNaN(v) ? '—' : `${(Number(v) * 100).toFixed(2)}%`;

const DATE_PRESETS = [
    { label: 'Today', days: 0 },
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 14 days', days: 14 },
    { label: 'Last 30 days', days: 30 },
];

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function GoogleAds() {
    const { showSuccess, showError } = useToast();
    const [searchParams] = useSearchParams();

    const [connected, setConnected] = useState(null); // null = loading
    const [customerIds, setCustomerIds] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [datePreset, setDatePreset] = useState(2); // Last 14 days

    // Drill-down state
    const [level, setLevel] = useState('campaigns'); // campaigns, ad_groups, ads, keywords
    const [breadcrumbs, setBreadcrumbs] = useState([]);
    const [adGroups, setAdGroups] = useState([]);
    const [ads, setAds] = useState([]);
    const [keywords, setKeywords] = useState([]);

    const [sortKey, setSortKey] = useState('spend');
    const [sortDir, setSortDir] = useState('desc');

    const dateRange = useMemo(() => {
        const p = DATE_PRESETS[datePreset];
        const today = new Date();
        const since = new Date(); since.setDate(today.getDate() - p.days);
        return { since: fmt(since), until: fmt(today) };
    }, [datePreset]);

    // Check connection status
    useEffect(() => {
        authFetch(`${API_BASE}/connection`).then(r => r.json()).then(data => {
            setConnected(data.connected);
            setCustomerIds(data.customer_ids || []);
            setSelectedCustomer(data.selected_customer_id || '');
            if (data.connected && data.selected_customer_id) fetchCampaigns();
        }).catch(() => setConnected(false));

        if (searchParams.get('connected') === 'true') {
            showSuccess('Google Ads connected successfully!');
        }
    }, []);

    const handleConnect = async () => {
        const resp = await authFetch(`${API_BASE}/auth-url`);
        const data = await resp.json();
        window.location.href = data.url;
    };

    const handleSelectCustomer = async (custId) => {
        setSelectedCustomer(custId);
        await authFetch(`${API_BASE}/select-customer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: custId }),
        });
        fetchCampaigns();
    };

    const fetchCampaigns = async () => {
        setLoading(true);
        try {
            const resp = await authFetch(`${API_BASE}/campaigns?since=${dateRange.since}&until=${dateRange.until}`);
            if (!resp.ok) throw new Error('Failed to fetch campaigns');
            setCampaigns(await resp.json());
            setLevel('campaigns');
            setBreadcrumbs([]);
        } catch (e) { showError(e.message); }
        finally { setLoading(false); }
    };

    const drillToAdGroups = async (campaign) => {
        setLoading(true);
        try {
            const resp = await authFetch(`${API_BASE}/campaigns/${campaign.id}/ad-groups?since=${dateRange.since}&until=${dateRange.until}`);
            setAdGroups(await resp.json());
            setLevel('ad_groups');
            setBreadcrumbs([{ label: campaign.name, id: campaign.id }]);
        } catch (e) { showError(e.message); }
        finally { setLoading(false); }
    };

    const drillToAds = async (adGroup) => {
        setLoading(true);
        try {
            const resp = await authFetch(`${API_BASE}/ad-groups/${adGroup.id}/ads`);
            setAds(await resp.json());
            setLevel('ads');
            setBreadcrumbs(prev => [...prev, { label: adGroup.name, id: adGroup.id }]);
        } catch (e) { showError(e.message); }
        finally { setLoading(false); }
    };

    const drillToKeywords = async (adGroup) => {
        setLoading(true);
        try {
            const resp = await authFetch(`${API_BASE}/ad-groups/${adGroup.id}/keywords`);
            setKeywords(await resp.json());
            setLevel('keywords');
            setBreadcrumbs(prev => [...prev, { label: `${adGroup.name} Keywords`, id: adGroup.id }]);
        } catch (e) { showError(e.message); }
        finally { setLoading(false); }
    };

    const goBack = (index) => {
        if (index === -1) {
            setLevel('campaigns');
            setBreadcrumbs([]);
        } else {
            setBreadcrumbs(prev => prev.slice(0, index + 1));
            setLevel(index === 0 ? 'ad_groups' : 'ads');
        }
    };

    const toggleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ col }) => {
        if (sortKey !== col) return <ArrowUpDown size={12} className="text-gray-400" />;
        return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
    };

    const sortedData = (data) => {
        return [...data].sort((a, b) => {
            let va = a[sortKey], vb = b[sortKey];
            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
        });
    };

    // Not connected
    if (connected === null) return <div className="flex justify-center py-20"><Loader className="animate-spin text-blue-500" size={24} /></div>;

    if (!connected) {
        return (
            <div className="max-w-lg mx-auto mt-20 text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                    <Search size={32} className="text-blue-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Connect Google Ads</h1>
                <p className="text-gray-500 dark:text-gray-400">Connect your Google Ads account to manage campaigns, keywords, and view reporting.</p>
                <button onClick={handleConnect} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm">
                    Connect Google Ads Account
                </button>
            </div>
        );
    }

    // Connected but no customer selected
    if (!selectedCustomer && customerIds.length > 0) {
        return (
            <div className="max-w-lg mx-auto mt-20 space-y-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Select Google Ads Account</h1>
                <p className="text-gray-500 dark:text-gray-400">Choose which account to manage:</p>
                <div className="space-y-2">
                    {customerIds.map(cid => (
                        <button key={cid} onClick={() => handleSelectCustomer(cid)}
                            className="w-full text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-400 transition-colors">
                            <span className="font-mono text-sm text-gray-900 dark:text-white">{cid}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const currentData = level === 'campaigns' ? campaigns : level === 'ad_groups' ? adGroups : level === 'ads' ? ads : keywords;

    // Summary
    const totals = useMemo(() => {
        const data = level === 'campaigns' ? campaigns : level === 'ad_groups' ? adGroups : [];
        let spend = 0, clicks = 0, impressions = 0, conversions = 0;
        data.forEach(d => { spend += d.spend || 0; clicks += d.clicks || 0; impressions += d.impressions || 0; conversions += d.conversions || 0; });
        return {
            spend, clicks, impressions, conversions,
            cpa: conversions > 0 ? spend / conversions : 0,
            ctr: impressions > 0 ? clicks / impressions : 0,
        };
    }, [campaigns, adGroups, level]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                        <Search size={28} className="text-blue-500" />
                        Google Ads
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Account: {selectedCustomer}</p>
                </div>
                <button onClick={fetchCampaigns} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* Date Presets */}
            <div className="flex items-center gap-2 flex-wrap">
                <Calendar size={14} className="text-gray-400" />
                {DATE_PRESETS.map((p, i) => (
                    <button key={p.label} onClick={() => { setDatePreset(i); }}
                        className={`px-3 py-1.5 text-xs rounded-lg ${datePreset === i ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                        {p.label}
                    </button>
                ))}
            </div>

            {/* Breadcrumbs */}
            {breadcrumbs.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-gray-500">
                    <button onClick={() => goBack(-1)} className="hover:text-blue-500">Campaigns</button>
                    {breadcrumbs.map((b, i) => (
                        <React.Fragment key={i}>
                            <ChevronRight size={14} />
                            <button onClick={() => goBack(i)} className="hover:text-blue-500 truncate max-w-[200px]">{b.label}</button>
                        </React.Fragment>
                    ))}
                </div>
            )}

            {/* Summary Cards */}
            {(level === 'campaigns' || level === 'ad_groups') && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    {[
                        { label: 'Spend', value: fmtMoney(totals.spend), icon: DollarSign, color: 'text-red-500' },
                        { label: 'Clicks', value: fmtNum(totals.clicks), icon: MousePointer, color: 'text-green-500' },
                        { label: 'Impressions', value: fmtNum(totals.impressions), icon: Eye, color: 'text-blue-500' },
                        { label: 'Conversions', value: totals.conversions > 0 ? fmtNum(totals.conversions) : '—', icon: Target, color: 'text-amber-500' },
                        { label: 'CPA', value: totals.cpa > 0 ? fmtMoney(totals.cpa) : '—', icon: Target, color: 'text-orange-500' },
                        { label: 'CTR', value: fmtPct(totals.ctr), icon: TrendingUp, color: 'text-purple-500' },
                    ].map(kpi => (
                        <div key={kpi.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
                                <kpi.icon size={12} className={kpi.color} /> {kpi.label}
                            </div>
                            <div className="text-lg font-bold text-gray-900 dark:text-white">{kpi.value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Data Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader className="animate-spin text-blue-500" size={24} /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                                    {level === 'keywords' && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Match</th>}
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer" onClick={() => toggleSort('spend')}>
                                        <span className="inline-flex items-center gap-1">Spend <SortIcon col="spend" /></span>
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer" onClick={() => toggleSort('clicks')}>
                                        <span className="inline-flex items-center gap-1">Clicks <SortIcon col="clicks" /></span>
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer" onClick={() => toggleSort('impressions')}>
                                        <span className="inline-flex items-center gap-1">Impr. <SortIcon col="impressions" /></span>
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer" onClick={() => toggleSort('conversions')}>
                                        <span className="inline-flex items-center gap-1">Conv. <SortIcon col="conversions" /></span>
                                    </th>
                                    {level !== 'ads' && level !== 'keywords' && (
                                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {sortedData(currentData).map((item, i) => (
                                    <tr key={item.id || i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="px-4 py-3">
                                            {level === 'campaigns' ? (
                                                <button onClick={() => drillToAdGroups(item)} className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-sm text-left">
                                                    {item.name}
                                                </button>
                                            ) : level === 'ads' ? (
                                                <div className="text-sm">
                                                    <div className="font-medium text-gray-900 dark:text-white">{item.headlines?.[0] || item.name}</div>
                                                    <div className="text-xs text-gray-500 truncate max-w-[300px]">{item.descriptions?.[0]}</div>
                                                </div>
                                            ) : level === 'keywords' ? (
                                                <span className="font-mono text-sm text-gray-900 dark:text-white">{item.text}</span>
                                            ) : (
                                                <span className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                item.status === 'ENABLED' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' :
                                                item.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400' :
                                                'bg-gray-100 text-gray-600'
                                            }`}>
                                                {item.status === 'ENABLED' ? 'On' : item.status === 'PAUSED' ? 'Off' : item.status}
                                            </span>
                                        </td>
                                        {level === 'keywords' && <td className="px-4 py-3 text-xs text-gray-500">{item.match_type}</td>}
                                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">{fmtMoney(item.spend)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">{fmtNum(item.clicks)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">{fmtNum(item.impressions)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">{item.conversions > 0 ? fmtNum(item.conversions) : '—'}</td>
                                        {level !== 'ads' && level !== 'keywords' && (
                                            <td className="px-4 py-3 text-center">
                                                {level === 'campaigns' && (
                                                    <button onClick={() => drillToAdGroups(item)} className="text-xs text-blue-500 hover:text-blue-600">
                                                        Ad Groups →
                                                    </button>
                                                )}
                                                {level === 'ad_groups' && (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button onClick={() => drillToAds(item)} className="text-xs text-blue-500 hover:text-blue-600">Ads</button>
                                                        <button onClick={() => drillToKeywords(item)} className="text-xs text-purple-500 hover:text-purple-600">Keywords</button>
                                                    </div>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {currentData.length === 0 && !loading && (
                            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">No data for this period</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
