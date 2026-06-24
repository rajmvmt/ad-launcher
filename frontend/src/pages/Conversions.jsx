import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Banknote, Target, DollarSign, TrendingUp, Calendar, Loader, Copy, RefreshCw, Plus, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmt, fmtMoney } from '../lib/campaignUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const PAGE_SIZE = 50;

const datePresets = () => {
    const today = new Date();
    const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const minus = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return [
        { label: 'Today', since: f(today), until: f(today) },
        { label: 'Yesterday', since: f(minus(1)), until: f(minus(1)) },
        { label: 'Last 7 days', since: f(minus(7)), until: f(today) },
        { label: 'Last 14 days', since: f(minus(14)), until: f(today) },
        { label: 'Last 30 days', since: f(minus(30)), until: f(today) },
        { label: 'This month', since: f(firstOfMonth), until: f(today) },
    ];
};

const emptyForm = { fb_campaign_id: '', fb_adset_id: '', fb_ad_id: '', payout: '', revenue: '', offer_id: '', transaction_id: '' };

export default function Conversions() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();

    const presets = useMemo(() => datePresets(), []);
    const [datePreset, setDatePreset] = useState(2);
    const [customSince, setCustomSince] = useState('');
    const [customUntil, setCustomUntil] = useState('');

    const activeDateRange = useMemo(() => {
        if (datePreset === 'custom') return { since: customSince, until: customUntil };
        return presets[datePreset] || presets[2];
    }, [datePreset, customSince, customUntil, presets]);

    const [summary, setSummary] = useState(null);
    const [daily, setDaily] = useState([]);
    const [recent, setRecent] = useState([]);
    const [recentTotal, setRecentTotal] = useState(0);
    const [recentPage, setRecentPage] = useState(0);
    const [loading, setLoading] = useState(true);

    // Manual conversion form
    const [showManualForm, setShowManualForm] = useState(false);
    const [manualForm, setManualForm] = useState(emptyForm);
    const [submitting, setSubmitting] = useState(false);

    const postbackUrl = `${API_URL}/conversions/postback?click_id={sub2}&campaign_id={sub4}&adset_id={sub5}&ad_id={sub6}&revenue={payout_amount}&transaction_id={transaction_id}&offer_id={offer_id}`;

    const fetchRecent = useCallback(async (page = 0) => {
        try {
            const res = await authFetch(`${API_URL}/conversions/recent?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
            if (res.ok) {
                const data = await res.json();
                setRecent(data.items || data);
                setRecentTotal(data.total || 0);
            }
        } catch {}
    }, [authFetch]);

    const fetchData = async () => {
        setLoading(true);
        const { since, until } = activeDateRange;
        try {
            const [summaryRes, dailyRes] = await Promise.all([
                authFetch(`${API_URL}/conversions/summary?since=${since}&until=${until}`),
                authFetch(`${API_URL}/conversions/daily?since=${since}&until=${until}`),
            ]);
            if (summaryRes.ok) setSummary(await summaryRes.json());
            if (dailyRes.ok) setDaily(await dailyRes.json());
            await fetchRecent(recentPage);
        } catch (e) {
            showError('Failed to load conversion data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [activeDateRange]);

    const handlePageChange = (newPage) => {
        setRecentPage(newPage);
        fetchRecent(newPage);
    };

    const handleManualSubmit = async (e) => {
        e.preventDefault();
        if (!manualForm.revenue && !manualForm.payout) {
            showError('Please enter at least a revenue or payout amount');
            return;
        }
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_URL}/conversions/manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fb_campaign_id: manualForm.fb_campaign_id || null,
                    fb_adset_id: manualForm.fb_adset_id || null,
                    fb_ad_id: manualForm.fb_ad_id || null,
                    payout: parseFloat(manualForm.payout) || 0,
                    revenue: parseFloat(manualForm.revenue) || 0,
                    offer_id: manualForm.offer_id || null,
                    transaction_id: manualForm.transaction_id || null,
                    status: 'approved',
                }),
            });
            const data = await res.json();
            if (res.ok && data.status === 'ok') {
                showSuccess('Conversion created successfully');
                setManualForm(emptyForm);
                setShowManualForm(false);
                fetchData();
            } else if (data.status === 'duplicate') {
                showError(`Duplicate transaction ID: ${data.transaction_id}`);
            } else {
                showError('Failed to create conversion');
            }
        } catch {
            showError('Failed to create conversion');
        } finally {
            setSubmitting(false);
        }
    };

    const totals = summary?.totals || {};
    const avgRevPerConv = totals.conversions > 0 ? totals.total_revenue / totals.conversions : 0;
    const totalPages = Math.ceil(recentTotal / PAGE_SIZE);

    const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
                        <Banknote size={28} className="text-green-600" />
                        Conversions
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">Everflow conversion tracking & revenue</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowManualForm(!showManualForm)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                    >
                        <Plus size={14} />
                        Push Conversion
                    </button>
                    <button
                        onClick={fetchData}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Manual Conversion Form */}
            {showManualForm && (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                        <Send size={14} className="text-green-600" />
                        Push Manual Conversion
                    </h3>
                    <form onSubmit={handleManualSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Campaign ID</label>
                                <input className={inputCls} placeholder="e.g. 120212345678" value={manualForm.fb_campaign_id} onChange={(e) => setManualForm(f => ({ ...f, fb_campaign_id: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Set ID</label>
                                <input className={inputCls} placeholder="e.g. 120212345679" value={manualForm.fb_adset_id} onChange={(e) => setManualForm(f => ({ ...f, fb_adset_id: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad ID</label>
                                <input className={inputCls} placeholder="e.g. 120212345680" value={manualForm.fb_ad_id} onChange={(e) => setManualForm(f => ({ ...f, fb_ad_id: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Payout ($)</label>
                                <input className={inputCls} type="number" step="0.01" min="0" placeholder="0.00" value={manualForm.payout} onChange={(e) => setManualForm(f => ({ ...f, payout: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Revenue ($) *</label>
                                <input className={inputCls} type="number" step="0.01" min="0" placeholder="0.00" value={manualForm.revenue} onChange={(e) => setManualForm(f => ({ ...f, revenue: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Offer ID</label>
                                <input className={inputCls} placeholder="Optional" value={manualForm.offer_id} onChange={(e) => setManualForm(f => ({ ...f, offer_id: e.target.value }))} />
                            </div>
                            <div className="sm:col-span-2 lg:col-span-3">
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Transaction ID</label>
                                <input className={inputCls} placeholder="Optional — used for deduplication" value={manualForm.transaction_id} onChange={(e) => setManualForm(f => ({ ...f, transaction_id: e.target.value }))} />
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                            <button
                                type="submit"
                                disabled={submitting}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {submitting ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                                {submitting ? 'Submitting...' : 'Submit Conversion'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowManualForm(false); setManualForm(emptyForm); }}
                                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Date Range Selector */}
            <div className="flex flex-wrap items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                <div className="flex flex-wrap gap-1">
                    {presets.map((p, i) => (
                        <button
                            key={p.label}
                            onClick={() => setDatePreset(i)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                datePreset === i
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                    <button
                        onClick={() => setDatePreset('custom')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            datePreset === 'custom'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                        }`}
                    >
                        Custom
                    </button>
                </div>
                {datePreset === 'custom' && (
                    <div className="flex items-center gap-2">
                        <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 dark:bg-gray-800 dark:text-gray-300" />
                        <span className="text-gray-400 text-xs">to</span>
                        <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 dark:bg-gray-800 dark:text-gray-300" />
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader size={24} className="animate-spin text-green-600 mr-3" />
                    <span className="text-gray-500 dark:text-gray-400">Loading conversions...</span>
                </div>
            ) : (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium mb-1">
                                <Target size={14} /> Conversions
                            </div>
                            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(totals.conversions || 0)}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium mb-1">
                                <DollarSign size={14} /> Payout
                            </div>
                            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(totals.total_payout || 0)}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium mb-1">
                                <TrendingUp size={14} /> Revenue
                            </div>
                            <div className="text-2xl font-bold text-green-600">{fmtMoney(totals.total_revenue || 0)}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-medium mb-1">
                                <Banknote size={14} /> Avg Rev/Conv
                            </div>
                            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{avgRevPerConv > 0 ? fmtMoney(avgRevPerConv) : '—'}</div>
                        </div>
                    </div>

                    {/* Daily Chart */}
                    {daily.length === 0 ? (
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
                            <p className="text-gray-400 dark:text-gray-500 text-sm">No conversion data for this date range</p>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Daily Conversions & Revenue</h3>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={daily}>
                                        <defs>
                                            <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb' }}
                                            formatter={(value, name) => [name === 'revenue' ? `$${Number(value).toFixed(2)}` : value, name === 'revenue' ? 'Revenue' : 'Conversions']}
                                        />
                                        <Area yAxisId="left" type="monotone" dataKey="conversions" stroke="#16a34a" fill="url(#convGrad)" strokeWidth={2} />
                                        <Area yAxisId="right" type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#revGrad)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex items-center justify-center gap-6 mt-3 text-xs text-gray-500 dark:text-gray-400">
                                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-green-600 rounded" /> Conversions</div>
                                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-blue-600 rounded" /> Revenue</div>
                            </div>
                        </div>
                    )}

                    {/* Conversions Log Table */}
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                Conversions Log
                                {recentTotal > 0 && <span className="ml-2 text-xs font-normal text-gray-400">({fmt(recentTotal)} total)</span>}
                            </h3>
                            {totalPages > 1 && (
                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <button
                                        onClick={() => handlePageChange(recentPage - 1)}
                                        disabled={recentPage === 0}
                                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                    <span>Page {recentPage + 1} of {totalPages}</span>
                                    <button
                                        onClick={() => handlePageChange(recentPage + 1)}
                                        disabled={recentPage >= totalPages - 1}
                                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
                                    >
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Desktop table */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Time</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Source</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Campaign ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Ad Set ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Ad ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Payout</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Revenue</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Offer</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Transaction</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {recent.length === 0 ? (
                                        <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">No conversions yet</td></tr>
                                    ) : recent.map((c) => (
                                        <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    c.source === 'manual'
                                                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                                }`}>{c.source || 'everflow'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{c.fb_campaign_id || '—'}</td>
                                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{c.fb_adset_id || '—'}</td>
                                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{c.fb_ad_id || '—'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{fmtMoney(c.payout)}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-green-600">{fmtMoney(c.revenue)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    c.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                                }`}>{c.status}</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{c.offer_id || '—'}</td>
                                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[120px]" title={c.transaction_id}>{c.transaction_id || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile card view */}
                        <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                            {recent.length === 0 ? (
                                <div className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">No conversions yet</div>
                            ) : recent.map((c) => (
                                <div key={c.id} className="p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                c.source === 'manual'
                                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                            }`}>{c.source || 'everflow'}</span>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                c.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                            }`}>{c.status}</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div><span className="text-gray-500 dark:text-gray-400">Payout: </span><span className="text-gray-900 dark:text-gray-100">{fmtMoney(c.payout)}</span></div>
                                        <div><span className="text-gray-500 dark:text-gray-400">Revenue: </span><span className="text-green-600 font-medium">{fmtMoney(c.revenue)}</span></div>
                                    </div>
                                    {c.fb_campaign_id && (
                                        <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">Campaign: {c.fb_campaign_id}</div>
                                    )}
                                    {c.fb_ad_id && (
                                        <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">Ad: {c.fb_ad_id}</div>
                                    )}
                                    {c.offer_id && (
                                        <div className="text-xs text-gray-400 dark:text-gray-500">Offer: {c.offer_id}</div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Bottom pagination */}
                        {totalPages > 1 && (
                            <div className="px-4 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                <span>Showing {recentPage * PAGE_SIZE + 1}–{Math.min((recentPage + 1) * PAGE_SIZE, recentTotal)} of {fmt(recentTotal)}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handlePageChange(recentPage - 1)}
                                        disabled={recentPage === 0}
                                        className="px-3 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        onClick={() => handlePageChange(recentPage + 1)}
                                        disabled={recentPage >= totalPages - 1}
                                        className="px-3 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Postback URL */}
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Everflow Postback URL</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Configure this URL in your Everflow offer settings as an S2S postback.</p>
                        <div className="flex items-start gap-2">
                            <code className="flex-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-gray-700 dark:text-gray-300 break-all select-all">
                                {postbackUrl}
                            </code>
                            <button
                                onClick={() => { navigator.clipboard.writeText(postbackUrl); showSuccess('Postback URL copied'); }}
                                className="flex-shrink-0 p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                title="Copy to clipboard"
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
