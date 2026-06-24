import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { LayoutDashboard, DollarSign, Eye, MousePointer, Target, TrendingUp, Wand2, ShoppingBag, BarChart3, ArrowUpRight, Loader, RefreshCw, Percent, Tag, Banknote, TrendingDown, Zap, Settings, X, Check, Brain, Copy } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts, getDailyInsights, getAccountBrandMap, setAccountBrands, getCampaignInsights, getAllAdInsights, getAllAdSetInsights, getSyncedCampaigns, getSyncedAllAds, getSyncedAllAdSets, getCampaignBrandMap, getSyncStatus, getDailySyncedCampaigns, getDailySyncedAllAds, getDailySyncedAllAdSets } from '../lib/facebookApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minus = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };

const DATE_PRESETS = [
    { label: 'Today', since: () => fmt(new Date()), until: () => fmt(new Date()) },
    { label: 'Yesterday', since: () => fmt(minus(1)), until: () => fmt(minus(1)) },
    { label: 'Last 7 days', since: () => fmt(minus(7)), until: () => fmt(new Date()) },
    { label: 'Last 30 days', since: () => fmt(minus(30)), until: () => fmt(new Date()) },
];

const fmtMoney = (v) => {
    const n = parseFloat(v) || 0;
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${n.toFixed(2)}`;
};

const fmtNum = (v) => {
    const n = parseInt(v) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString();
};

const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
            <p className="font-medium text-gray-900 mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="text-gray-600">
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: p.color }} />
                    {p.name}: {(p.name === 'Spend' || p.name === 'Revenue') ? fmtMoney(p.value) : fmtNum(p.value)}
                </p>
            ))}
        </div>
    );
};

export default function Dashboard() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();
    const { brands } = useBrands();
    const navigate = useNavigate();
    const [briefBannerDismissed, setBriefBannerDismissed] = useState(false);

    // FB performance
    const [connections, setConnections] = useState([]);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [selectedBrand, setSelectedBrand] = useState(null);
    const [datePreset, setDatePreset] = useState(0); // Today default
    const [customSince, setCustomSince] = useState('');
    const [customUntil, setCustomUntil] = useState('');
    const [campaigns, setCampaigns] = useState([]);
    const [dailyData, setDailyData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [setupDone, setSetupDone] = useState(false);

    // Top ads + all ads/adsets
    const [topAds, setTopAds] = useState([]);
    const [allAds, setAllAds] = useState([]);
    const [allAdsets, setAllAdsets] = useState([]);

    // Account-brand mapping
    const [accountBrandMap, setAccountBrandMap] = useState({});
    const [campaignBrandMap, setCampaignBrandMap] = useState({}); // fb_campaign_id -> brand_id
    const [showBrandModal, setShowBrandModal] = useState(false);
    const [modalBrandIds, setModalBrandIds] = useState([]);
    const [savingBrands, setSavingBrands] = useState(false);

    // Legacy (removed — purchases now from FB insights)

    // Load connections + account-brand map
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
            } catch (e) { console.error('Failed to load connections:', e); }
        })();
    }, []);

    const ALL_ACCOUNTS = { id: '__all__', name: 'All Accounts' };

    // Load ad accounts when connection changes
    useEffect(() => {
        if (!selectedConnection) return;
        (async () => {
            try {
                const accounts = await getAdAccounts(selectedConnection.id);
                setAdAccounts(accounts);
                const lastId = localStorage.getItem('dashboard_last_account');
                if (lastId === '__all__' && accounts.length > 1) {
                    setSelectedAccount(ALL_ACCOUNTS);
                } else {
                    const last = accounts.find(a => a.id === lastId);
                    setSelectedAccount(last || accounts[0] || null);
                }
                setSetupDone(true);
            } catch (e) { console.error('Failed to load accounts:', e); }
        })();
    }, [selectedConnection]);

    // Filter brands by account mapping (if mapping exists for this account, only show those brands)
    const filteredBrands = useMemo(() => {
        if (!selectedAccount || selectedAccount.id === '__all__') return brands;
        const mapped = accountBrandMap[selectedAccount.id];
        if (!mapped || mapped.length === 0) return brands; // no mapping = show all
        return brands.filter(b => mapped.includes(b.id));
    }, [brands, selectedAccount, accountBrandMap]);

    // Open brand management modal
    const openBrandModal = useCallback(() => {
        const current = selectedAccount ? (accountBrandMap[selectedAccount.id] || []) : [];
        setModalBrandIds([...current]);
        setShowBrandModal(true);
    }, [selectedAccount, accountBrandMap]);

    // Save brand assignments
    const saveBrandAssignments = useCallback(async () => {
        if (!selectedAccount) return;
        setSavingBrands(true);
        try {
            await setAccountBrands(selectedAccount.id, modalBrandIds);
            setAccountBrandMap(prev => ({ ...prev, [selectedAccount.id]: [...modalBrandIds] }));
            setShowBrandModal(false);
            showSuccess('Brand assignments saved');
            if (selectedBrand && modalBrandIds.length > 0 && !modalBrandIds.includes(selectedBrand.id)) {
                setSelectedBrand(null);
            }
        } catch (e) {
            console.error('Failed to save brand assignments:', e);
            showError('Failed to save brand assignments');
        } finally {
            setSavingBrands(false);
        }
    }, [selectedAccount, modalBrandIds, selectedBrand]);

    // Fetch campaign insights + daily data
    const dateRange = useMemo(() => {
        if (datePreset === 'custom') return { since: customSince, until: customUntil };
        const p = DATE_PRESETS[datePreset];
        return { since: p.since(), until: p.until() };
    }, [datePreset, customSince, customUntil]);

    useEffect(() => {
        if (!selectedAccount) return;
        fetchInsights();
    }, [selectedAccount, dateRange, selectedBrand]);

    const fetchInsights = async () => {
        if (!selectedAccount) return;
        setLoading(true);
        try {
            localStorage.setItem('dashboard_last_account', selectedAccount.id);
            const brandId = selectedBrand?.id || null;
            const isAll = selectedAccount.id === '__all__';
            const accountsToFetch = isAll ? adAccounts : [selectedAccount];

            // ALL data from DB — zero live API calls for reporting
            const allResults = await Promise.all(accountsToFetch.map(async (acct) => {
                const [campaignResult, dailyResult, adsResult, adsetsResult] = await Promise.all([
                    getDailySyncedCampaigns(acct.id, dateRange.since, dateRange.until, selectedConnection?.id).catch(() => []),
                    getDailyInsights(acct.id, selectedConnection?.id, dateRange.since, dateRange.until, brandId).catch(() => []),
                    getDailySyncedAllAds(acct.id, dateRange.since, dateRange.until, selectedConnection?.id).catch(() => []),
                    getDailySyncedAllAdSets(acct.id, dateRange.since, dateRange.until, selectedConnection?.id).catch(() => []),
                ]);
                return { campaigns: campaignResult || [], daily: dailyResult || [], ads: adsResult || [], adsets: adsetsResult || [] };
            }));

            // Merge campaigns, ads, adsets
            const mergedCampaigns = allResults.flatMap(r => r.campaigns);
            const mergedAds = allResults.flatMap(r => r.ads);
            const mergedAdsets = allResults.flatMap(r => r.adsets);

            // Merge daily data by date
            const dailyMap = {};
            allResults.forEach(r => {
                (r.daily || []).forEach(d => {
                    if (!dailyMap[d.date]) {
                        dailyMap[d.date] = { date: d.date, spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0 };
                    }
                    dailyMap[d.date].spend += parseFloat(d.spend) || 0;
                    dailyMap[d.date].impressions += parseInt(d.impressions) || 0;
                    dailyMap[d.date].clicks += parseInt(d.clicks) || 0;
                    dailyMap[d.date].reach += parseInt(d.reach) || 0;
                    dailyMap[d.date].results += parseInt(d.results) || 0;
                });
            });
            const mergedDaily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

            setCampaigns(mergedCampaigns);
            setDailyData(mergedDaily);
            // Fetch campaign -> brand mapping for spend-by-brand
            getCampaignBrandMap(selectedConnection?.id).then(setCampaignBrandMap).catch(() => {});
            const sortedAds = mergedAds
                .filter(a => a.insights?.spend)
                .sort((a, b) => (parseFloat(b.insights?.spend) || 0) - (parseFloat(a.insights?.spend) || 0));
            setTopAds(sortedAds.slice(0, 3));
            setAllAds(sortedAds);
            const sortedAdsets = mergedAdsets
                .sort((a, b) => (parseFloat(b.insights?.spend) || 0) - (parseFloat(a.insights?.spend) || 0));
            setAllAdsets(sortedAdsets);
        } catch (e) {
            console.error('Failed to fetch insights:', e);
            setCampaigns([]);
            setDailyData([]);
        } finally {
            setLoading(false);
        }
    };

    // Campaign purchases lookup (from FB insights)
    const convByCampaign = useMemo(() => {
        const map = {};
        campaigns.forEach(c => {
            const ins = c.insights || {};
            map[c.id] = { conversions: parseInt(ins.results) || 0 };
        });
        return map;
    }, [campaigns]);

    // Aggregate metrics from daily insights (date-filtered via live FB API)
    const totals = useMemo(() => {
        let spend = 0, impressions = 0, clicks = 0, reach = 0, purchases = 0;
        dailyData.forEach(d => {
            spend += parseFloat(d.spend) || 0;
            impressions += parseInt(d.impressions) || 0;
            clicks += parseInt(d.clicks) || 0;
            reach += parseInt(d.reach) || 0;
            purchases += parseInt(d.results) || 0;
        });
        const ctr = impressions > 0 ? ((clicks / impressions) * 100) : 0;
        const cpc = clicks > 0 ? (spend / clicks) : 0;
        const cpm = impressions > 0 ? ((spend / impressions) * 1000) : 0;
        const cpa = purchases > 0 ? (spend / purchases) : 0;
        return { spend, impressions, clicks, reach, purchases, ctr, cpc, cpm, cpa };
    }, [dailyData]);

    // Spend by brand
    const spendByBrand = useMemo(() => {
        const brandTotals = {}; // brand_id -> { name, spend, purchases, campaigns }
        campaigns.forEach(c => {
            const brandId = campaignBrandMap[c.id];
            const key = brandId || '__untagged__';
            if (!brandTotals[key]) {
                const brand = brandId ? brands.find(b => b.id === brandId) : null;
                brandTotals[key] = { name: brand?.name || 'Untagged', spend: 0, purchases: 0, revenue: 0, campaigns: 0 };
            }
            brandTotals[key].spend += parseFloat(c.insights?.spend) || 0;
            brandTotals[key].purchases += parseInt(c.insights?.results) || 0;
            brandTotals[key].revenue += parseFloat(c.insights?.purchase_revenue) || 0;
            brandTotals[key].campaigns += 1;
        });
        return Object.entries(brandTotals)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => b.spend - a.spend);
    }, [campaigns, campaignBrandMap, brands]);

    // Top campaigns by spend
    const topCampaigns = useMemo(() => {
        return [...campaigns]
            .sort((a, b) => (parseFloat(b.insights?.spend) || 0) - (parseFloat(a.insights?.spend) || 0))
            .slice(0, 8);
    }, [campaigns]);

    // Chart data with formatted date labels
    const chartData = useMemo(() => {
        return dailyData.map(d => ({
            ...d,
            label: d.date ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
        }));
    }, [dailyData]);

    const hasRevenue = false;
    const kpis = [
        { label: 'Spend', value: fmtMoney(totals.spend), icon: DollarSign, color: 'bg-red-500' },
        { label: 'Purchases', value: totals.purchases > 0 ? fmtNum(totals.purchases) : '—', icon: TrendingUp, color: 'bg-amber-500' },
        { label: 'CPA', value: totals.cpa > 0 ? fmtMoney(totals.cpa) : '—', icon: Target, color: 'bg-orange-500' },
        { label: 'Impressions', value: fmtNum(totals.impressions), icon: Eye, color: 'bg-blue-500' },
        { label: 'Clicks', value: fmtNum(totals.clicks), icon: MousePointer, color: 'bg-green-500' },
        { label: 'CTR', value: `${totals.ctr.toFixed(2)}%`, icon: Target, color: 'bg-purple-500' },
        { label: 'CPC', value: fmtMoney(totals.cpc), icon: MousePointer, color: 'bg-indigo-500' },
        { label: 'CPM', value: totals.cpm > 0 ? fmtMoney(totals.cpm) : '—', icon: Percent, color: 'bg-pink-500' },
    ];

    const quickActions = [
        { label: 'Build Creatives', description: 'Create new image or video ads', icon: Wand2, path: '/build-creatives', color: 'from-amber-500 to-orange-500' },
        { label: 'Manage Brands', description: 'Update brand assets and profiles', icon: ShoppingBag, path: '/brands', color: 'from-orange-500 to-red-500' },
        { label: 'Campaign Browser', description: 'View campaigns, ad sets & ads', icon: BarChart3, path: '/reporting', color: 'from-amber-600 to-yellow-600' },
    ];

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <LayoutDashboard size={28} className="text-amber-600 sm:w-8 sm:h-8" />
                        Dashboard
                    </h1>
                    <p className="text-gray-500 mt-1">Performance overview</p>
                </div>
            </div>

            {/* Account Selector + Date Range */}
            {setupDone && (
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-6">
                    {connections.length > 1 && (
                        <select
                            value={selectedConnection?.id || ''}
                            onChange={(e) => setSelectedConnection(connections.find(c => c.id === e.target.value))}
                            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                        >
                            {connections.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    )}
                    {adAccounts.length > 0 && (
                        <select
                            value={selectedAccount?.id || ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSelectedAccount(val === '__all__' ? ALL_ACCOUNTS : adAccounts.find(a => a.id === val));
                            }}
                            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                        >
                            {adAccounts.length > 1 && <option value="__all__">All Accounts</option>}
                            {adAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name || a.id}</option>
                            ))}
                        </select>
                    )}
                    {brands.length > 0 && (
                        <div className="flex items-center gap-1">
                            <select
                                value={selectedBrand?.id || ''}
                                onChange={(e) => setSelectedBrand(e.target.value ? brands.find(b => b.id === e.target.value) : null)}
                                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                                <option value="">All Brands</option>
                                {filteredBrands.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                            {selectedAccount?.id !== '__all__' && <button
                                onClick={openBrandModal}
                                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                                title="Manage account brands"
                            >
                                <Settings size={16} />
                            </button>}
                        </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex bg-gray-100 rounded-lg p-0.5">
                            {DATE_PRESETS.map((p, i) => (
                                <button
                                    key={i}
                                    onClick={() => setDatePreset(i)}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${datePreset === i ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    {p.label}
                                </button>
                            ))}
                            <button
                                onClick={() => {
                                    if (datePreset !== 'custom') {
                                        setCustomSince(dateRange.since);
                                        setCustomUntil(dateRange.until);
                                    }
                                    setDatePreset('custom');
                                }}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${datePreset === 'custom' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Custom
                            </button>
                        </div>
                        {datePreset === 'custom' && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="date"
                                    value={customSince}
                                    onChange={(e) => setCustomSince(e.target.value)}
                                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                                <span className="text-gray-400 text-sm">to</span>
                                <input
                                    type="date"
                                    value={customUntil}
                                    onChange={(e) => setCustomUntil(e.target.value)}
                                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchInsights}
                            disabled={loading}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                        {loading && <span className="text-xs text-gray-400">Loading...</span>}
                    </div>
                </div>
            )}

            {/* KPI Cards — 4x2 grid */}
            {setupDone && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mb-6">
                    {kpis.map((kpi, i) => {
                        const Icon = kpi.icon;
                        return (
                            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className={`${kpi.color} w-8 h-8 rounded-lg flex items-center justify-center`}>
                                        <Icon className="text-white" size={16} />
                                    </div>
                                    <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{loading ? '—' : kpi.value}</div>
                            </div>
                        );
                    })}
                </div>
            )}


            {/* Daily Spend Chart */}
            {setupDone && chartData.length > 1 && !loading && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">Daily Spend {hasRevenue ? '& Revenue' : ''}</h2>
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                            <Tooltip content={<ChartTooltip />} />
                            <Area type="monotone" dataKey="spend" name="Spend" stroke="#f59e0b" strokeWidth={2} fill="url(#spendGradient)" />
                            {hasRevenue && <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#revenueGradient)" />}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Spend by Brand */}
            {setupDone && !loading && spendByBrand.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">Spend by Brand</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-gray-500 text-xs uppercase">
                                    <th className="text-left py-2 font-medium">Brand</th>
                                    <th className="text-right py-2 font-medium">Spend</th>
                                    <th className="text-right py-2 font-medium">Purchases</th>
                                    <th className="text-right py-2 font-medium">CPA</th>
                                    <th className="text-right py-2 font-medium">ROAS</th>
                                    <th className="text-right py-2 font-medium">Campaigns</th>
                                </tr>
                            </thead>
                            <tbody>
                                {spendByBrand.map((b) => {
                                    const cpa = b.purchases > 0 ? b.spend / b.purchases : 0;
                                    const revenue = b.revenue || 0;
                                    const roas = b.spend > 0 ? revenue / b.spend : 0;
                                    return (
                                        <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="py-2.5 font-medium text-gray-900">{b.name}</td>
                                            <td className="py-2.5 text-right font-semibold">${b.spend.toFixed(2)}</td>
                                            <td className="py-2.5 text-right">{b.purchases || '—'}</td>
                                            <td className="py-2.5 text-right">{b.purchases > 0 ? `$${cpa.toFixed(2)}` : '—'}</td>
                                            <td className="py-2.5 text-right">{roas > 0 ? `${roas.toFixed(2)}x` : '—'}</td>
                                            <td className="py-2.5 text-right text-gray-500">{b.campaigns}</td>
                                        </tr>
                                    );
                                })}
                                <tr className="font-semibold text-gray-900 border-t-2 border-gray-300">
                                    <td className="py-2.5">Total</td>
                                    <td className="py-2.5 text-right">${spendByBrand.reduce((s, b) => s + b.spend, 0).toFixed(2)}</td>
                                    <td className="py-2.5 text-right">{spendByBrand.reduce((s, b) => s + b.purchases, 0) || '—'}</td>
                                    <td className="py-2.5 text-right">{(() => { const ts = spendByBrand.reduce((s, b) => s + b.spend, 0); const tp = spendByBrand.reduce((s, b) => s + b.purchases, 0); return tp > 0 ? `$${(ts/tp).toFixed(2)}` : '—'; })()}</td>
                                    <td className="py-2.5 text-right">{(() => { const ts = spendByBrand.reduce((s, b) => s + b.spend, 0); const tr = spendByBrand.reduce((s, b) => s + (b.revenue || 0), 0); return ts > 0 && tr > 0 ? `${(tr/ts).toFixed(2)}x` : '—'; })()}</td>
                                    <td className="py-2.5 text-right text-gray-500">{spendByBrand.reduce((s, b) => s + b.campaigns, 0)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* All Campaigns List */}
            {setupDone && !loading && campaigns.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-gray-900">All Campaigns ({campaigns.length})</h2>
                        <Link to="/reporting" className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
                            Campaign Browser <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    {/* Mobile cards */}
                    <div className="sm:hidden space-y-2 max-h-[400px] overflow-y-auto">
                        {[...campaigns].sort((a, b) => (parseFloat(b.insights?.spend) || 0) - (parseFloat(a.insights?.spend) || 0)).map(c => {
                            const ins = c.insights || {};
                            const status = c.effective_status || c.status;
                            const cSpend = parseFloat(ins.spend) || 0;
                            const cConv = parseInt(ins.results) || 0;
                            return (
                                <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                            {status === 'ACTIVE' ? 'On' : 'Off'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span>Spend: <span className="font-semibold text-gray-900">{fmtMoney(cSpend)}</span></span>
                                        {cConv > 0 && <span>Conv: <span className="font-semibold">{fmtNum(cConv)}</span></span>}
                                        {cConv > 0 && <span className="text-amber-600">Purch: {fmtNum(cConv)}</span>}
                                        {cConv > 0 && cSpend > 0 && <span className="text-orange-600">CPA: {fmtMoney(cSpend / cConv)}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Desktop table */}
                    <div className="hidden sm:block max-h-[400px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 pr-4">Campaign</th>
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Status</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Spend</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Conv.</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CPA</th>
                                    {hasRevenue && <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Revenue</th>}
                                    {hasRevenue && <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 pl-3">Profit</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {[...campaigns].sort((a, b) => (parseFloat(b.insights?.spend) || 0) - (parseFloat(a.insights?.spend) || 0)).map(c => {
                                    const ins = c.insights || {};
                                    const status = c.effective_status || c.status;
                                    const cSpend = parseFloat(ins.spend) || 0;
                                    const cConv = parseInt(ins.results) || 0;
                                    const cCpa = cConv > 0 ? cSpend / cConv : 0;
                                    return (
                                        <tr key={c.id} className="hover:bg-gray-50">
                                            <td className="py-2.5 pr-4">
                                                <span className="text-sm font-medium text-gray-900 block truncate max-w-[300px]" title={c.name}>{c.name}</span>
                                            </td>
                                            <td className="py-2.5 px-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                    {status === 'ACTIVE' ? 'On' : 'Off'}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-sm font-medium text-gray-900">{fmtMoney(cSpend)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{cConv > 0 ? fmtNum(cConv) : '—'}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{cCpa > 0 ? fmtMoney(cCpa) : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* All Ad Sets */}
            {setupDone && !loading && allAdsets.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">All Ad Sets ({allAdsets.length})</h2>
                    {/* Mobile cards */}
                    <div className="sm:hidden space-y-2 max-h-[400px] overflow-y-auto">
                        {allAdsets.map(a => {
                            const ins = a.insights || {};
                            const status = a.effective_status || a.status;
                            const spend = parseFloat(ins.spend) || 0;
                            const budget = a.daily_budget ? `$${(a.daily_budget / 100).toFixed(0)}/d` : a.lifetime_budget ? `$${(a.lifetime_budget / 100).toFixed(0)} LT` : '—';
                            return (
                                <div key={a.id} className="border border-gray-100 rounded-lg p-3">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <span className="text-sm font-medium text-gray-900 truncate">{a.name}</span>
                                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                            {status === 'ACTIVE' ? 'On' : 'Off'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span>Budget: <span className="font-semibold text-gray-700">{budget}</span></span>
                                        <span>Spend: <span className="font-semibold text-gray-900">{fmtMoney(spend)}</span></span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Desktop table */}
                    <div className="hidden sm:block max-h-[400px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 pr-4">Ad Set</th>
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Status</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Budget</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Spend</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Impr.</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Clicks</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CTR</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CPC</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 pl-3">CPM</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {allAdsets.map(a => {
                                    const ins = a.insights || {};
                                    const status = a.effective_status || a.status;
                                    const spend = parseFloat(ins.spend) || 0;
                                    const budget = a.daily_budget ? `$${(a.daily_budget / 100).toFixed(0)}/d` : a.lifetime_budget ? `$${(a.lifetime_budget / 100).toFixed(0)} LT` : '—';
                                    return (
                                        <tr key={a.id} className="hover:bg-gray-50">
                                            <td className="py-2.5 pr-4"><span className="text-sm font-medium text-gray-900 block truncate max-w-[300px]" title={a.name}>{a.name}</span></td>
                                            <td className="py-2.5 px-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{status === 'ACTIVE' ? 'On' : 'Off'}</span></td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{budget}</td>
                                            <td className="py-2.5 px-3 text-right text-sm font-medium text-gray-900">{fmtMoney(spend)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{fmtNum(ins.impressions)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{fmtNum(ins.clicks)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{ins.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : '—'}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{ins.cpc ? fmtMoney(ins.cpc) : '—'}</td>
                                            <td className="py-2.5 pl-3 text-right text-sm text-gray-600">{ins.cpm ? fmtMoney(ins.cpm) : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* All Ads */}
            {setupDone && !loading && allAds.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">All Ads ({allAds.length})</h2>
                    {/* Mobile cards */}
                    <div className="sm:hidden space-y-2 max-h-[400px] overflow-y-auto">
                        {allAds.map(ad => {
                            const ins = ad.insights || {};
                            const cd = ad.creative_data || {};
                            const status = ad.effective_status || ad.status;
                            const spend = parseFloat(ins.spend) || 0;
                            const thumbUrl = cd.image_url || cd.thumbnail_url;
                            const name = ad.name || ins.ad_name || ad.id;
                            return (
                                <div key={ad.id} className="border border-gray-100 rounded-lg p-3 flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
                                        {thumbUrl ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Eye size={14} /></div>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2 mb-0.5">
                                            <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                                            <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                {status === 'ACTIVE' ? 'On' : 'Off'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-gray-500">
                                            <span>Spend: <span className="font-semibold text-gray-900">{fmtMoney(spend)}</span></span>
                                            <span>Clicks: <span className="font-semibold">{fmtNum(ins.clicks)}</span></span>
                                            {cd.is_video !== undefined && <span className="text-gray-400">{cd.is_video ? 'Video' : 'Image'}</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Desktop table */}
                    <div className="hidden sm:block max-h-[400px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 pr-4">Ad</th>
                                    <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Status</th>
                                    <th className="text-center text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Type</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Spend</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Impr.</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Clicks</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CTR</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CPC</th>
                                    <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 pl-3">CPM</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {allAds.map(ad => {
                                    const ins = ad.insights || {};
                                    const cd = ad.creative_data || {};
                                    const status = ad.effective_status || ad.status;
                                    const spend = parseFloat(ins.spend) || 0;
                                    const thumbUrl = cd.image_url || cd.thumbnail_url;
                                    const name = ad.name || ins.ad_name || ad.id;
                                    return (
                                        <tr key={ad.id} className="hover:bg-gray-50">
                                            <td className="py-2.5 pr-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
                                                        {thumbUrl ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Eye size={12} /></div>}
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-900 block truncate max-w-[250px]" title={name}>{name}</span>
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{status === 'ACTIVE' ? 'On' : 'Off'}</span></td>
                                            <td className="py-2.5 px-3 text-center text-xs text-gray-500">{cd.is_video ? 'Video' : 'Image'}</td>
                                            <td className="py-2.5 px-3 text-right text-sm font-medium text-gray-900">{fmtMoney(spend)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{fmtNum(ins.impressions)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{fmtNum(ins.clicks)}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{ins.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : '—'}</td>
                                            <td className="py-2.5 px-3 text-right text-sm text-gray-600">{ins.cpc ? fmtMoney(ins.cpc) : '—'}</td>
                                            <td className="py-2.5 pl-3 text-right text-sm text-gray-600">{ins.cpm ? fmtMoney(ins.cpm) : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Top Campaigns + Quick Actions side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Top Campaigns */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-gray-900">Top Campaigns by Spend</h2>
                        <Link to="/reporting" className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
                            View all <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    {!setupDone ? (
                        <div className="text-center py-8 text-gray-400">
                            <p>Connect a Facebook account in <Link to="/settings" className="text-amber-600 hover:underline">Settings</Link> to see performance data</p>
                        </div>
                    ) : loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader size={24} className="animate-spin text-gray-400" />
                        </div>
                    ) : topCampaigns.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <p>No campaign data for this period</p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile cards */}
                            <div className="sm:hidden space-y-2">
                                {topCampaigns.map(c => {
                                    const ins = c.insights || {};
                                    const status = c.effective_status || c.status;
                                    const cSpend = parseFloat(ins.spend) || 0;
                                    
                                    const cConversions = parseInt((c.insights || {}).results) || 0;
                                    const cCpa = cConversions > 0 ? cSpend / cConversions : 0;
                                    
                                    
                                    return (
                                        <div key={c.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                                                <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                    {status === 'ACTIVE' ? 'On' : 'Off'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 text-center">
                                                <div className="bg-gray-50 rounded px-2 py-1">
                                                    <div className="text-[10px] text-gray-400 uppercase">Spend</div>
                                                    <div className="text-sm font-semibold">{fmtMoney(ins.spend)}</div>
                                                </div>
                                                <div className="bg-gray-50 rounded px-2 py-1">
                                                    <div className="text-[10px] text-gray-400 uppercase">Conv.</div>
                                                    <div className="text-sm font-semibold">{cConversions > 0 ? fmtNum(cConversions) : '—'}</div>
                                                </div>
                                                <div className="bg-gray-50 rounded px-2 py-1">
                                                    <div className="text-[10px] text-gray-400 uppercase">CPA</div>
                                                    <div className="text-sm font-semibold">{cCpa > 0 ? fmtMoney(cCpa) : '—'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Desktop table */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 pr-4">Campaign</th>
                                            <th className="text-left text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Status</th>
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Spend</th>
                                            {hasRevenue && <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Revenue</th>}
                                            {hasRevenue && <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Profit</th>}
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Conv.</th>
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CPA</th>
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">Clicks</th>
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 px-3">CTR</th>
                                            <th className="text-right text-xs font-semibold text-gray-500 uppercase pb-3 pl-3">CPC</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {topCampaigns.map(c => {
                                            const ins = c.insights || {};
                                            const status = c.effective_status || c.status;
                                            const cSpend = parseFloat(ins.spend) || 0;
                                            
                                            const cConversions = parseInt((c.insights || {}).results) || 0;
                                            const cCpa = cConversions > 0 ? cSpend / cConversions : 0;
                                            
                                            
                                            return (
                                                <tr key={c.id} className="hover:bg-gray-50">
                                                    <td className="py-2.5 pr-4">
                                                        <span className="text-sm font-medium text-gray-900 block truncate max-w-[220px]" title={c.name}>{c.name}</span>
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                            {status === 'ACTIVE' ? 'On' : 'Off'}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right text-sm font-medium text-gray-900">{fmtMoney(ins.spend)}</td>
                                                    <td className="py-2.5 px-3 text-right text-sm text-gray-600">{cConversions > 0 ? fmtNum(cConversions) : '—'}</td>
                                                    <td className="py-2.5 px-3 text-right text-sm text-gray-600">{cCpa > 0 ? fmtMoney(cCpa) : '—'}</td>
                                                    <td className="py-2.5 px-3 text-right text-sm text-gray-600">{fmtNum(ins.clicks)}</td>
                                                    <td className="py-2.5 px-3 text-right text-sm text-gray-600">{ins.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : '—'}</td>
                                                    <td className="py-2.5 pl-3 text-right text-sm text-gray-600">{ins.cpc ? fmtMoney(ins.cpc) : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                {/* Top Ads + Quick Actions */}
                <div className="space-y-4">
                    {/* Top Ads by Spend */}
                    {topAds.length > 0 && !loading && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                            <h2 className="text-sm font-bold text-gray-900 mb-3">Top Ads by Spend</h2>
                            <div className="space-y-3">
                                {topAds.map((ad, i) => {
                                    const ins = ad.insights || {};
                                    const cd = ad.creative_data || {};
                                    const thumbUrl = cd.image_url || cd.thumbnail_url;
                                    const name = ad.name || ad.ad_name || ad.id;
                                    return (
                                        <div key={ad.id} className="flex items-start gap-3">
                                            {/* Rank */}
                                            <span className="text-xs font-bold text-gray-400 mt-1 w-4 shrink-0">#{i + 1}</span>
                                            {/* Thumbnail */}
                                            <div className="w-14 h-14 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
                                                {thumbUrl ? (
                                                    <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        <Eye size={16} />
                                                    </div>
                                                )}
                                            </div>
                                            {/* Info */}
                                            <div className="min-w-0 flex-1">
                                                <span className="text-xs font-medium text-gray-900 block truncate" title={name}>{name}</span>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-xs text-gray-500">Spend: <span className="font-semibold text-gray-900">{fmtMoney(ins.spend)}</span></span>
                                                    <span className="text-xs text-gray-500">Clicks: <span className="font-semibold text-gray-700">{fmtNum(ins.clicks)}</span></span>
                                                </div>
                                                {ins.ctr && <span className="text-[10px] text-gray-400">CTR: {parseFloat(ins.ctr).toFixed(2)}%</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <h2 className="text-lg font-bold text-gray-900">Quick Actions</h2>
                    {quickActions.map((action, i) => {
                        const Icon = action.icon;
                        return (
                            <Link
                                key={i}
                                to={action.path}
                                className="group bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:shadow-md transition-all flex items-center gap-4"
                            >
                                <div className={`bg-gradient-to-r ${action.color} w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                                    <Icon className="text-white" size={22} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 text-sm">{action.label}</h3>
                                    <p className="text-xs text-gray-500">{action.description}</p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Brand Management Modal */}
            {showBrandModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowBrandModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-900">Manage Account Brands</h3>
                            <button onClick={() => setShowBrandModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={18} /></button>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">
                            Select which brands are associated with <span className="font-medium text-gray-700">{selectedAccount?.name || selectedAccount?.id}</span>.
                            {modalBrandIds.length === 0 && ' When none are selected, all brands show in the filter.'}
                        </p>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto mb-4">
                            {brands.map(b => {
                                const checked = modalBrandIds.includes(b.id);
                                return (
                                    <label key={b.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-amber-300 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => setModalBrandIds(prev => checked ? prev.filter(id => id !== b.id) : [...prev, b.id])}
                                            className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                                        />
                                        <div className="flex items-center gap-2 min-w-0">
                                            {b.logo && <img src={b.logo} alt="" className="w-6 h-6 rounded-full object-cover" />}
                                            <span className="text-sm font-medium text-gray-900 truncate">{b.name}</span>
                                        </div>
                                    </label>
                                );
                            })}
                            {brands.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No brands found. Create brands first.</p>}
                        </div>
                        <div className="flex items-center justify-end gap-3">
                            <button onClick={() => setShowBrandModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                            <button onClick={saveBrandAssignments} disabled={savingBrands} className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2">
                                {savingBrands ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
