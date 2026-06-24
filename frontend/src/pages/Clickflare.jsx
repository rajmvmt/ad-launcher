import React, { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
    Upload, RefreshCw, TrendingUp, TrendingDown, DollarSign,
    MousePointerClick, Target, Globe, Smartphone, Monitor,
    Clock, BarChart3, AlertTriangle, ChevronDown, ChevronUp,
    Zap, MapPin
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

function StatCard({ icon: Icon, label, value, sub, color = 'amber', trend }) {
    const colors = {
        amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
        green: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
        red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
        blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
        purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
    };

    return (
        <div className={`rounded-2xl border p-4 ${colors[color]}`}>
            <div className="flex items-center justify-between mb-2">
                <Icon size={18} className="opacity-70" />
                {trend !== undefined && (
                    <span className={`text-xs font-medium flex items-center gap-0.5 ${trend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                        {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {Math.abs(trend)}%
                    </span>
                )}
            </div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs opacity-70 mt-0.5">{label}</div>
            {sub && <div className="text-xs opacity-50 mt-1">{sub}</div>}
        </div>
    );
}

function CollapsibleSection({ title, icon: Icon, children, defaultOpen = false, badge }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Icon size={18} className="text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{title}</span>
                    {badge && (
                        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{badge}</span>
                    )}
                </div>
                {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {open && <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-3">{children}</div>}
        </div>
    );
}

function BreakdownRow({ name, clicks, conversions, revenue, cost, cvr, cpa, epc, roi, profit }) {
    const profitColor = profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
    return (
        <div className="py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate max-w-[55%]">{name}</span>
                <span className={`text-sm font-bold ${profitColor}`}>
                    {profit >= 0 ? '+' : ''}{fmt$(profit)}
                </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div><span className="text-gray-400">Clicks</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{fmtNum(clicks)}</span></div>
                <div><span className="text-gray-400">Conv</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{conversions}</span></div>
                <div><span className="text-gray-400">CVR</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{cvr}%</span></div>
                <div><span className="text-gray-400">CPA</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt$(cpa)}</span></div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <div><span className="text-gray-400">Rev</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt$(revenue)}</span></div>
                <div><span className="text-gray-400">Cost</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt$(cost)}</span></div>
                <div><span className="text-gray-400">EPC</span> <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt$(epc)}</span></div>
                <div><span className="text-gray-400">ROI</span> <span className={`font-medium ${roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{roi}%</span></div>
            </div>
        </div>
    );
}

function HourlyBar({ label, conversions, maxConv, revenue, cost }) {
    const pct = maxConv > 0 ? (conversions / maxConv * 100) : 0;
    const profit = revenue - cost;
    const barColor = profit >= 0 ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-400 dark:bg-red-500';
    return (
        <div className="flex items-center gap-2 py-1">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right font-mono">{label}</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-5 relative overflow-hidden">
                <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.max(pct, 2)}%` }} />
                {conversions > 0 && (
                    <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                        {conversions} conv
                    </span>
                )}
            </div>
            <span className={`text-xs w-16 text-right font-medium ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                {profit >= 0 ? '+' : ''}{fmt$(profit)}
            </span>
        </div>
    );
}

// Formatting helpers
function fmt$(v) {
    if (v === undefined || v === null) return '$0';
    return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(v) {
    return (v || 0).toLocaleString('en-US');
}


export default function Clickflare() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const uploadCSV = useCallback(async (file) => {
        if (!file) return;
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await authFetch(`${API_URL}/clickflare/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Upload failed');
            }
            const result = await resp.json();
            setData(result);
            showSuccess(`Parsed ${result.row_count} rows from ClickFlare`);
        } catch (e) {
            showError(e.message || 'Failed to parse CSV');
        } finally {
            setLoading(false);
        }
    }, [authFetch, showSuccess, showError]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) uploadCSV(file);
    }, [uploadCSV]);

    const handleFileSelect = useCallback((e) => {
        const file = e.target.files?.[0];
        if (file) uploadCSV(file);
    }, [uploadCSV]);

    const t = data?.totals;
    const insights = data?.insights;

    return (
        <div className="max-w-2xl mx-auto space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Clickflare</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Mobile-friendly performance stats</p>
                </div>
                {data && (
                    <label className="cursor-pointer flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-700">
                        <RefreshCw size={14} />
                        Reload
                        <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
                    </label>
                )}
            </div>

            {/* Upload Zone */}
            {!data && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
                        dragOver
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                            : 'border-gray-300 dark:border-gray-600 hover:border-amber-400 dark:hover:border-amber-500'
                    }`}
                >
                    {loading ? (
                        <div className="flex flex-col items-center gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500" />
                            <p className="text-gray-600 dark:text-gray-400">Parsing your data...</p>
                        </div>
                    ) : (
                        <label className="cursor-pointer flex flex-col items-center gap-3">
                            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center">
                                <Upload size={28} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-gray-100">Upload ClickFlare CSV</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Drag & drop or tap to browse</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                                    Export from ClickFlare → Reports → Download CSV
                                </p>
                            </div>
                            <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
                        </label>
                    )}
                </div>
            )}

            {/* Stats Dashboard */}
            {data && t && (
                <>
                    {/* Parsed info */}
                    <div className="text-xs text-gray-400 dark:text-gray-500 text-center">
                        {data.row_count} rows parsed {data.parsed_at && `• ${new Date(data.parsed_at).toLocaleString()}`}
                    </div>

                    {/* Top-level stat cards */}
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard
                            icon={DollarSign}
                            label="Profit"
                            value={`${t.profit >= 0 ? '+' : '-'}${fmt$(t.profit)}`}
                            color={t.profit >= 0 ? 'green' : 'red'}
                            sub={`${t.roi}% ROI`}
                        />
                        <StatCard
                            icon={TrendingUp}
                            label="Revenue"
                            value={fmt$(t.revenue)}
                            color="green"
                            sub={`Cost: ${fmt$(t.cost)}`}
                        />
                        <StatCard
                            icon={MousePointerClick}
                            label="Clicks"
                            value={fmtNum(t.clicks)}
                            color="blue"
                            sub={`EPC: ${fmt$(t.epc)}`}
                        />
                        <StatCard
                            icon={Target}
                            label="Conversions"
                            value={fmtNum(t.conversions)}
                            color="purple"
                            sub={`${t.cvr}% CVR • ${fmt$(t.cpa)} CPA`}
                        />
                    </div>

                    {/* Insights / Alerts */}
                    {insights && (insights.wasted_geos?.length > 0 || insights.dead_hours?.length > 0 || insights.peak_hour) && (
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-2">
                            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold text-sm">
                                <Zap size={16} /> Quick Insights
                            </div>
                            {insights.peak_hour && (
                                <p className="text-sm text-gray-700 dark:text-gray-300">
                                    <span className="font-medium">Peak hour:</span> {insights.peak_hour.label || insights.peak_hour.hour + ':00'} with {insights.peak_hour.conversions} conversions
                                </p>
                            )}
                            {insights.dead_hours?.length > 0 && (
                                <p className="text-sm text-red-600 dark:text-red-400">
                                    <AlertTriangle size={12} className="inline mr-1" />
                                    {insights.dead_hours.length} dead hour{insights.dead_hours.length > 1 ? 's' : ''} with clicks but zero conversions — consider dayparting
                                </p>
                            )}
                            {insights.wasted_geos?.length > 0 && (
                                <p className="text-sm text-red-600 dark:text-red-400">
                                    <AlertTriangle size={12} className="inline mr-1" />
                                    {insights.wasted_geos.length} geo{insights.wasted_geos.length > 1 ? 's' : ''} burning budget with 0 conversions: {insights.wasted_geos.map(g => g.name).join(', ')}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Campaigns / Sub1 */}
                    {data.campaigns?.length > 0 && (
                        <CollapsibleSection title="Campaigns" icon={BarChart3} badge={data.campaigns.length} defaultOpen>
                            {data.campaigns.map((c, i) => <BreakdownRow key={i} {...c} />)}
                        </CollapsibleSection>
                    )}

                    {/* Geo Breakdown */}
                    {data.geo?.length > 0 && (
                        <CollapsibleSection title="Geo Breakdown" icon={MapPin} badge={data.geo.length} defaultOpen>
                            {data.geo.map((g, i) => <BreakdownRow key={i} {...g} />)}
                        </CollapsibleSection>
                    )}

                    {/* Hourly */}
                    {data.hourly?.length > 0 && (
                        <CollapsibleSection title="Hourly Performance" icon={Clock} badge="24h" defaultOpen>
                            {(() => {
                                const maxConv = Math.max(...data.hourly.map(h => h.conversions), 1);
                                return data.hourly.map((h, i) => (
                                    <HourlyBar key={i} label={h.label} conversions={h.conversions} maxConv={maxConv} revenue={h.revenue} cost={h.cost} />
                                ));
                            })()}
                        </CollapsibleSection>
                    )}

                    {/* Devices */}
                    {data.devices?.length > 0 && (
                        <CollapsibleSection title="Device Breakdown" icon={Smartphone} badge={data.devices.length}>
                            {data.devices.map((d, i) => <BreakdownRow key={i} {...d} />)}
                        </CollapsibleSection>
                    )}

                    {/* OS */}
                    {data.os?.length > 0 && (
                        <CollapsibleSection title="OS Breakdown" icon={Monitor} badge={data.os.length}>
                            {data.os.map((o, i) => <BreakdownRow key={i} {...o} />)}
                        </CollapsibleSection>
                    )}
                </>
            )}
        </div>
    );
}
