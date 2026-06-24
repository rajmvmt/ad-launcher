import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, TrendingUp, TrendingDown, ShoppingCart, Loader, RefreshCw, Calendar, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, Trophy, AlertTriangle, BarChart3, Download } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oDg7-UVSlXPMiOvVabsHbcjW7yx8GpOwMSGcIjMWfG0/edit';

const DATE_PRESETS = [
    { label: 'Yesterday', days: 1 },
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 14 days', days: 14 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
    { label: 'All Time', days: null },
];

const fmtMoney = (v) => {
    if (v == null) return '$0.00';
    const neg = v < 0;
    const abs = Math.abs(v);
    const str = abs >= 1000 ? `$${(abs/1000).toFixed(1)}k` : `$${abs.toFixed(2)}`;
    return neg ? `-${str}` : str;
};

// ── Mini Bar Chart (CSS-only) ───────────────────────────────────

function MiniBarChart({ data, labelKey, valueKey, colorFn }) {
    const max = Math.max(...data.map(d => Math.abs(d[valueKey])), 1);
    return (
        <div className="space-y-1.5">
            {data.map((d, i) => {
                const pct = Math.min(Math.abs(d[valueKey]) / max * 100, 100);
                const color = colorFn ? colorFn(d[valueKey]) : 'bg-blue-500';
                return (
                    <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-24 truncate text-right" title={d[labelKey]}>{d[labelKey]}</span>
                        <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                            <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-medium w-16 text-right ${d[valueKey] >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {fmtMoney(d[valueKey])}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ── Sparkline Profit Chart (CSS-only) ───────────────────────────

function ProfitChart({ dailyData }) {
    if (!dailyData.length) return null;
    const values = dailyData.map(d => d.profit);
    const max = Math.max(...values.map(Math.abs), 1);
    const chartHeight = 120;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                <TrendingUp size={14} /> Daily Profit Trend
            </h3>
            <div className="flex items-end gap-[2px]" style={{ height: chartHeight }}>
                {dailyData.map((d, i) => {
                    const absH = Math.max((Math.abs(d.profit) / max) * (chartHeight / 2), 2);
                    const isPos = d.profit >= 0;
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-center relative group" style={{ height: chartHeight }}>
                            {/* Zero line is at center */}
                            <div className="absolute w-full" style={{ top: '50%' }}>
                                {isPos ? (
                                    <div className="absolute bottom-0 w-full bg-green-400 dark:bg-green-500 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity"
                                        style={{ height: absH }} />
                                ) : (
                                    <div className="absolute top-0 w-full bg-red-400 dark:bg-red-500 rounded-b-sm opacity-80 hover:opacity-100 transition-opacity"
                                        style={{ height: absH }} />
                                )}
                            </div>
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap pointer-events-none">
                                {d.date}: {fmtMoney(d.profit)}
                            </div>
                        </div>
                    );
                })}
            </div>
            {/* Zero line */}
            <div className="relative -mt-[60px] mb-[60px]">
                <div className="border-t border-gray-300 dark:border-gray-600 border-dashed" />
            </div>
            {/* Date labels */}
            <div className="flex justify-between mt-1">
                <span className="text-[10px] text-gray-400">{dailyData[0]?.date}</span>
                <span className="text-[10px] text-gray-400">{dailyData[dailyData.length - 1]?.date}</span>
            </div>
        </div>
    );
}


export default function PnL() {
    const { showError } = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState(30);
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [appliedFrom, setAppliedFrom] = useState('');
    const [appliedTo, setAppliedTo] = useState('');
    const [sortKey, setSortKey] = useState('date');
    const [sortDir, setSortDir] = useState('desc');
    const [groupBy, setGroupBy] = useState('none');
    const [mediaFilter, setMediaFilter] = useState('all');
    const [offerFilter, setOfferFilter] = useState('all');
    const [campaignFilter, setCampaignFilter] = useState('all');

    const fetchData = async () => {
        setLoading(true);
        try {
            const fetchDays = (appliedFrom || appliedTo) ? null : days;
            const url = fetchDays ? `${API_BASE}/pnl?days=${fetchDays}` : `${API_BASE}/pnl`;
            const accessToken = localStorage.getItem('accessToken');
            const resp = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
            if (!resp.ok) throw new Error('Failed to fetch P&L data');
            setData(await resp.json());
        } catch (e) {
            showError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [days, appliedFrom, appliedTo]);

    const applyCustomDates = () => {
        setAppliedFrom(customFrom);
        setAppliedTo(customTo);
        setDays(null);
    };

    const toggleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ col }) => {
        if (sortKey !== col) return <ArrowUpDown size={12} className="text-gray-400" />;
        return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
    };

    // Unique campaigns for filter dropdown
    const campaignSources = useMemo(() => {
        if (!data?.rows) return [];
        const campaigns = new Set(data.rows.map(r => r.campaign).filter(Boolean));
        return [...campaigns].sort();
    }, [data]);

    // Unique offers for filter dropdown
    const offerSources = useMemo(() => {
        if (!data?.rows) return [];
        const offers = new Set(data.rows.map(r => r.offer).filter(Boolean));
        return [...offers].sort();
    }, [data]);

    // Unique media sources for filter dropdown
    const mediaSources = useMemo(() => {
        if (!data?.rows) return [];
        const sources = new Set(data.rows.map(r => r.media).filter(Boolean));
        return [...sources].sort();
    }, [data]);

    // Filtered rows (before grouping/sorting)
    const filteredRows = useMemo(() => {
        if (!data?.rows) return [];
        let rows = [...data.rows];
        if (appliedFrom) rows = rows.filter(r => r.date >= appliedFrom);
        if (appliedTo) rows = rows.filter(r => r.date <= appliedTo);
        if (mediaFilter !== 'all') rows = rows.filter(r => r.media === mediaFilter);
        if (offerFilter !== 'all') rows = rows.filter(r => r.offer === offerFilter);
        if (campaignFilter !== 'all') rows = rows.filter(r => r.campaign === campaignFilter);
        return rows;
    }, [data, appliedFrom, appliedTo, mediaFilter, offerFilter, campaignFilter]);

    const displayRows = useMemo(() => {
        let rows = [...filteredRows];

        if (groupBy !== 'none') {
            const groups = {};
            for (const r of rows) {
                let key;
                if (groupBy === 'date') key = r.date;
                else if (groupBy === 'campaign') key = r.campaign;
                else if (groupBy === 'offer') key = r.offer;
                else if (groupBy === 'media') key = r.media;
                else key = r.date;

                if (!groups[key]) {
                    groups[key] = { ...r, _key: key, _count: 1 };
                } else {
                    const g = groups[key];
                    g.spent += r.spent;
                    g.revenue += r.revenue;
                    g.cogs += r.cogs;
                    g.shipping += r.shipping;
                    g.processing += r.processing;
                    g.voids += r.voids;
                    g.handling += r.handling;
                    g.cs_cost += r.cs_cost;
                    g.profit += r.profit;
                    g.orders_platform += r.orders_platform;
                    g.orders_qs += r.orders_qs;
                    g._count += 1;
                }
            }
            rows = Object.values(groups).map(g => ({
                ...g,
                roi: g.spent > 0 ? Math.round((g.profit / g.spent) * 1000) / 10 : 0,
            }));
        }

        rows.sort((a, b) => {
            let va = a[sortKey], vb = b[sortKey];
            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'asc' ? va - vb : vb - va;
        });

        return rows;
    }, [filteredRows, sortKey, sortDir, groupBy]);

    // Summary
    const summary = useMemo(() => {
        const rows = filteredRows;
        if (!rows.length) return data?.summary || null;
        const total_spent = rows.reduce((s, r) => s + r.spent, 0);
        const total_revenue = rows.reduce((s, r) => s + r.revenue, 0);
        const total_net_revenue = rows.reduce((s, r) => s + (r.net_revenue || 0), 0);
        const total_fulfillment = rows.reduce((s, r) => s + (r.fulfillment_costs || 0), 0);
        const total_profit = rows.reduce((s, r) => s + r.profit, 0);
        const total_orders = rows.reduce((s, r) => s + (r.orders_qs || 0), 0);
        return {
            total_spent: Math.round(total_spent * 100) / 100,
            total_revenue: Math.round(total_revenue * 100) / 100,
            total_net_revenue: Math.round(total_net_revenue * 100) / 100,
            total_fulfillment: Math.round(total_fulfillment * 100) / 100,
            total_profit: Math.round(total_profit * 100) / 100,
            total_orders,
            roi: total_spent > 0 ? Math.round((total_profit / total_spent) * 1000) / 10 : 0,
            margin: total_revenue > 0 ? Math.round((total_profit / total_revenue) * 1000) / 10 : 0,
            aov: total_orders > 0 ? Math.round((total_revenue / total_orders) * 100) / 100 : 0,
            cpo: total_orders > 0 ? Math.round((total_spent / total_orders) * 100) / 100 : 0,
            ppo: total_orders > 0 ? Math.round((total_profit / total_orders) * 100) / 100 : 0,
            breakeven_roas: total_spent > 0 ? Math.round((total_net_revenue / total_spent) * 100) / 100 : 0,
        };
    }, [filteredRows, data]);

    // Export CSV
    const exportCSV = () => {
        const headers = ['Date','Campaign','Offer','Media','Orders','Spent','Revenue','Net Revenue','Fulfillment','Profit','Margin','ROI'];
        const csvRows = displayRows.map(r => [
            r.date, r.campaign, r.offer, r.media,
            r.orders_qs || 0,
            r.spent, r.revenue, r.net_revenue || 0, r.fulfillment_costs || 0,
            r.profit, r.margin ? `${r.margin}%` : '', r.roi ? `${r.roi}%` : ''
        ]);
        const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `pnl-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    };

    // Daily profit for chart (grouped by date)
    const dailyProfit = useMemo(() => {
        const byDate = {};
        for (const r of filteredRows) {
            if (!byDate[r.date]) byDate[r.date] = { date: r.date, profit: 0, spent: 0, revenue: 0 };
            byDate[r.date].profit += r.profit;
            byDate[r.date].spent += r.spent;
            byDate[r.date].revenue += r.revenue;
        }
        return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    }, [filteredRows]);

    // Top/bottom performers by campaign
    const performers = useMemo(() => {
        const byCampaign = {};
        for (const r of filteredRows) {
            if (!r.campaign) continue;
            if (!byCampaign[r.campaign]) byCampaign[r.campaign] = { campaign: r.campaign, profit: 0, spent: 0, revenue: 0 };
            byCampaign[r.campaign].profit += r.profit;
            byCampaign[r.campaign].spent += r.spent;
            byCampaign[r.campaign].revenue += r.revenue;
        }
        const sorted = Object.values(byCampaign).sort((a, b) => b.profit - a.profit);
        return {
            top: sorted.filter(c => c.profit > 0).slice(0, 3),
            bottom: sorted.filter(c => c.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 3),
        };
    }, [filteredRows]);

    // Media breakdown
    const mediaBreakdown = useMemo(() => {
        const byMedia = {};
        for (const r of filteredRows) {
            const m = r.media || 'unknown';
            if (!byMedia[m]) byMedia[m] = { media: m, profit: 0, spent: 0, revenue: 0 };
            byMedia[m].profit += r.profit;
            byMedia[m].spent += r.spent;
            byMedia[m].revenue += r.revenue;
        }
        return Object.values(byMedia).sort((a, b) => b.profit - a.profit);
    }, [filteredRows]);

    // Week-over-week comparison
    const wow = useMemo(() => {
        if (!filteredRows.length) return null;
        const today = new Date();
        const fmt = (d) => d.toISOString().split('T')[0];
        const thisWeekStart = new Date(today); thisWeekStart.setDate(today.getDate() - 6);
        const lastWeekStart = new Date(today); lastWeekStart.setDate(today.getDate() - 13);
        const lastWeekEnd = new Date(today); lastWeekEnd.setDate(today.getDate() - 7);

        const tw = { spent: 0, revenue: 0, profit: 0, orders: 0 };
        const lw = { spent: 0, revenue: 0, profit: 0, orders: 0 };

        for (const r of filteredRows) {
            if (r.date >= fmt(thisWeekStart) && r.date <= fmt(today)) {
                tw.spent += r.spent; tw.revenue += r.revenue; tw.profit += r.profit;
                tw.orders += r.orders_qs || 0;
            } else if (r.date >= fmt(lastWeekStart) && r.date <= fmt(lastWeekEnd)) {
                lw.spent += r.spent; lw.revenue += r.revenue; lw.profit += r.profit;
                lw.orders += r.orders_qs || 0;
            }
        }

        const delta = (curr, prev) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / Math.abs(prev)) * 100);

        return {
            thisWeek: tw, lastWeek: lw,
            deltaSpent: delta(tw.spent, lw.spent),
            deltaRevenue: delta(tw.revenue, lw.revenue),
            deltaProfit: delta(tw.profit, lw.profit),
            deltaOrders: delta(tw.orders, lw.orders),
        };
    }, [filteredRows]);

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P&L Summary</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Synced from Google Sheets
                        <a href={SHEET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 ml-2 text-blue-500 hover:text-blue-600">
                            Open Sheet <ExternalLink size={12} />
                        </a>
                    </p>
                </div>
                <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
                <button onClick={exportCSV} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-200">
                    <Download size={14} /> Export CSV
                </button>
            </div>

            {/* Date Presets */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Calendar size={14} className="text-gray-400" />
                {DATE_PRESETS.map(p => (
                    <button key={p.label} onClick={() => { setDays(p.days); setCustomFrom(''); setCustomTo(''); setAppliedFrom(''); setAppliedTo(''); }}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${days === p.days && !appliedFrom && !appliedTo ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                        {p.label}
                    </button>
                ))}
                <span className="mx-1 text-gray-300">|</span>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                <span className="text-xs text-gray-400">to</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                {(customFrom || customTo) && (
                    <button onClick={applyCustomDates}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
                )}
                {(appliedFrom || appliedTo) && (
                    <button onClick={() => { setCustomFrom(''); setCustomTo(''); setAppliedFrom(''); setAppliedTo(''); setDays(30); }}
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-600">Clear</button>
                )}
                <span className="mx-2 text-gray-300">|</span>
                <span className="text-xs text-gray-500">Campaign:</span>
                <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)}
                    className={`px-2 py-1 text-xs border rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 ${campaignFilter !== 'all' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                    <option value="all">All Campaigns</option>
                    {campaignSources.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-xs text-gray-500">Offer:</span>
                <select value={offerFilter} onChange={e => setOfferFilter(e.target.value)}
                    className={`px-2 py-1 text-xs border rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 ${offerFilter !== 'all' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                    <option value="all">All Offers</option>
                    {offerSources.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <span className="text-xs text-gray-500">Media:</span>
                <select value={mediaFilter} onChange={e => setMediaFilter(e.target.value)}
                    className={`px-2 py-1 text-xs border rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 ${mediaFilter !== 'all' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                    <option value="all">All Sources</option>
                    {mediaSources.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <span className="mx-2 text-gray-300">|</span>
                <span className="text-xs text-gray-500">Group:</span>
                {['none', 'date', 'campaign', 'offer', 'media'].map(g => (
                    <button key={g} onClick={() => setGroupBy(g)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${groupBy === g ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                        {g === 'none' ? 'Raw' : g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                ))}
            </div>

            {loading && !data ? (
                <div className="flex justify-center py-20"><Loader size={24} className="animate-spin text-gray-400" /></div>
            ) : (
                <>
                    {/* Active filter indicator */}
                    {(offerFilter !== 'all' || mediaFilter !== 'all' || campaignFilter !== 'all' || appliedFrom || appliedTo) && (
                        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg text-xs text-blue-700 dark:text-blue-400 flex-wrap">
                            <span className="font-medium">Filtering:</span>
                            {campaignFilter !== 'all' && <span className="bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 rounded">Campaign: {campaignFilter}</span>}
                            {offerFilter !== 'all' && <span className="bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 rounded">Offer: {offerFilter}</span>}
                            {mediaFilter !== 'all' && <span className="bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 rounded">Media: {mediaFilter}</span>}
                            {appliedFrom && <span className="bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 rounded">From: {appliedFrom}</span>}
                            {appliedTo && <span className="bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 rounded">To: {appliedTo}</span>}
                            <button onClick={() => { setOfferFilter('all'); setMediaFilter('all'); setCampaignFilter('all'); setAppliedFrom(''); setAppliedTo(''); setCustomFrom(''); setCustomTo(''); setDays(30); }}
                                className="ml-auto text-blue-500 hover:text-blue-700 font-medium">Clear All</button>
                        </div>
                    )}

                    {/* Summary Cards Row 1: Core metrics */}
                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1"><DollarSign size={14} /> Ad Spend</div>
                                <div className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(summary.total_spent)}</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1"><TrendingUp size={14} className="text-emerald-500" /> Net Revenue</div>
                                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(summary.total_net_revenue)}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">after COGS, shipping, fees</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
                                    {summary.total_profit >= 0 ? <TrendingUp size={14} className="text-green-500" /> : <TrendingDown size={14} className="text-red-500" />} Profit
                                </div>
                                <div className={`text-xl font-bold ${summary.total_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(summary.total_profit)}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">net revenue − ad spend</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1"><ShoppingCart size={14} /> Orders</div>
                                <div className="text-xl font-bold text-gray-900 dark:text-white">{summary.total_orders.toLocaleString()}</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">Margin</div>
                                <div className={`text-xl font-bold ${summary.margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{summary.margin}%</div>
                            </div>
                        </div>
                    )}

                    {/* Summary Cards Row 2: Unit economics */}
                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Break-Even CPA</div>
                                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{summary.total_orders > 0 ? fmtMoney(summary.total_net_revenue / summary.total_orders) : '—'}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">max CPA before loss</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Ad Spend CPA</div>
                                <div className={`text-lg font-bold ${summary.cpo > 0 && summary.total_orders > 0 && summary.cpo <= (summary.total_net_revenue / summary.total_orders) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(summary.cpo)}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">ad spend ÷ orders</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Gross AOV</div>
                                <div className="text-lg font-bold text-gray-900 dark:text-white">{fmtMoney(summary.aov)}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">revenue ÷ orders</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Profit Per Order</div>
                                <div className={`text-lg font-bold ${summary.ppo >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(summary.ppo)}</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">ROAS</div>
                                <div className={`text-lg font-bold ${summary.breakeven_roas >= 1 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{summary.breakeven_roas}x</div>
                            </div>
                        </div>
                    )}

                    {/* Week-over-Week Comparison */}
                    {wow && (wow.thisWeek.spent > 0 || wow.lastWeek.spent > 0) && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">This Week vs Last Week</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[
                                    { label: 'Spent', tw: wow.thisWeek.spent, lw: wow.lastWeek.spent, delta: wow.deltaSpent, invert: true },
                                    { label: 'Revenue', tw: wow.thisWeek.revenue, lw: wow.lastWeek.revenue, delta: wow.deltaRevenue },
                                    { label: 'Profit', tw: wow.thisWeek.profit, lw: wow.lastWeek.profit, delta: wow.deltaProfit },
                                    { label: 'Orders', tw: wow.thisWeek.orders, lw: wow.lastWeek.orders, delta: wow.deltaOrders },
                                ].map(m => {
                                    const isGood = m.invert ? m.delta <= 0 : m.delta >= 0;
                                    return (
                                        <div key={m.label}>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{m.label}</div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-sm font-bold text-gray-900 dark:text-white">
                                                    {m.label === 'Orders' ? m.tw : fmtMoney(m.tw)}
                                                </span>
                                                <span className={`text-xs font-medium flex items-center gap-0.5 ${isGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {m.delta > 0 ? <ArrowUp size={10} /> : m.delta < 0 ? <ArrowDown size={10} /> : null}
                                                    {Math.abs(m.delta)}%
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-gray-400">prev: {m.label === 'Orders' ? m.lw : fmtMoney(m.lw)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Profit Trend Chart */}
                    {dailyProfit.length > 1 && <ProfitChart dailyData={dailyProfit} />}

                    {/* Best/Worst Performers + Media Breakdown */}
                    {(performers.top.length > 0 || performers.bottom.length > 0 || mediaBreakdown.length > 0) && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            {/* Top Performers */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                                    <Trophy size={14} className="text-green-500" /> Top Campaigns
                                </h3>
                                {performers.top.length > 0 ? (
                                    <MiniBarChart data={performers.top} labelKey="campaign" valueKey="profit"
                                        colorFn={() => 'bg-green-400 dark:bg-green-500'} />
                                ) : (
                                    <p className="text-xs text-gray-400">No profitable campaigns</p>
                                )}
                            </div>

                            {/* Bottom Performers */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                                    <AlertTriangle size={14} className="text-red-500" /> Worst Campaigns
                                </h3>
                                {performers.bottom.length > 0 ? (
                                    <MiniBarChart data={performers.bottom} labelKey="campaign" valueKey="profit"
                                        colorFn={() => 'bg-red-400 dark:bg-red-500'} />
                                ) : (
                                    <p className="text-xs text-gray-400">No losing campaigns</p>
                                )}
                            </div>

                            {/* Media Breakdown */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                                    <BarChart3 size={14} className="text-blue-500" /> By Media Source
                                </h3>
                                {mediaBreakdown.length > 0 ? (
                                    <MiniBarChart data={mediaBreakdown} labelKey="media" valueKey="profit"
                                        colorFn={(v) => v >= 0 ? 'bg-blue-400 dark:bg-blue-500' : 'bg-red-400 dark:bg-red-500'} />
                                ) : (
                                    <p className="text-xs text-gray-400">No data</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                        {[
                                            { key: 'date', label: 'Date' },
                                            { key: 'campaign', label: 'Campaign' },
                                            { key: 'offer', label: 'Offer' },
                                            { key: 'media', label: 'Media' },
                                            { key: 'orders_qs', label: 'Orders' },
                                            { key: 'spent', label: 'Spent' },
                                            { key: 'revenue', label: 'Revenue' },
                                            { key: 'cogs', label: 'COGS' },
                                            { key: 'shipping', label: 'Ship' },
                                            { key: 'processing', label: 'Proc' },
                                            { key: 'voids', label: 'Voids/CB' },
                                            { key: 'net_revenue', label: 'Net Rev' },
                                            { key: 'profit', label: 'Profit' },
                                            { key: 'margin', label: 'Margin' },
                                            { key: 'roi', label: 'ROI' },
                                        ].map(col => (
                                            <th key={col.key} onClick={() => toggleSort(col.key)}
                                                className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                    {displayRows.map((row, i) => {
                                        const isLoss = (row.revenue > 0 || row.spent > 0) && row.profit < 0;
                                        return (
                                            <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${isLoss ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row.date}</td>
                                                <td className="px-3 py-2 text-gray-900 dark:text-white font-medium whitespace-nowrap">{row.campaign}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row.offer}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.media}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.orders_qs || '—'}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.spent ? fmtMoney(row.spent) : '—'}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.revenue ? fmtMoney(row.revenue) : '—'}</td>
                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.cogs ? fmtMoney(row.cogs) : '—'}</td>
                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.shipping ? fmtMoney(row.shipping) : '—'}</td>
                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.processing ? fmtMoney(row.processing) : '—'}</td>
                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.voids ? fmtMoney(row.voids) : '—'}</td>
                                                <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400 font-medium">
                                                    {row.net_revenue ? fmtMoney(row.net_revenue) : '—'}
                                                </td>
                                                <td className={`px-3 py-2 font-medium ${row.profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {row.revenue || row.spent ? fmtMoney(row.profit) : '—'}
                                                </td>
                                                <td className={`px-3 py-2 font-medium ${(row.margin || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {row.revenue > 0 ? `${row.margin}%` : '—'}
                                                </td>
                                                <td className={`px-3 py-2 font-medium ${row.roi >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {row.spent > 0 ? `${row.roi}%` : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Totals Row */}
                                    {displayRows.length > 0 && summary && (
                                        <tr className="bg-gray-100 dark:bg-gray-700/50 font-bold border-t-2 border-gray-300 dark:border-gray-600">
                                            <td className="px-3 py-2.5 text-gray-900 dark:text-white" colSpan={4}>TOTALS</td>
                                            <td className="px-3 py-2.5 text-gray-900 dark:text-white">{summary.total_orders}</td>
                                            <td className="px-3 py-2.5 text-gray-900 dark:text-white">{fmtMoney(summary.total_spent)}</td>
                                            <td className="px-3 py-2.5 text-gray-900 dark:text-white">{fmtMoney(summary.total_revenue)}</td>
                                            <td className="px-3 py-2.5 text-gray-500" colSpan={3}>—</td>
                                            <td className="px-3 py-2.5 text-emerald-600 dark:text-emerald-400">{fmtMoney(summary.total_net_revenue)}</td>
                                            <td className={`px-3 py-2.5 ${summary.total_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(summary.total_profit)}</td>
                                            <td className={`px-3 py-2.5 ${summary.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{summary.margin}%</td>
                                            <td className={`px-3 py-2.5 ${summary.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>{summary.roi}%</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {displayRows.length === 0 && !loading && (
                            <div className="text-center py-12 text-gray-500 dark:text-gray-400">No data for this period</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
