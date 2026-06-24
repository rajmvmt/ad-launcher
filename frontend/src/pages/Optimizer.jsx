import React, { useState, useEffect } from 'react';
import {
    Zap, Loader, Play, Pause, TrendingUp, TrendingDown,
    DollarSign, Target, AlertTriangle, CheckCircle, ChevronDown,
    RefreshCw, Shield
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts } from '../lib/facebookApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function Optimizer() {
    const { authFetch } = useAuth();
    const { showSuccess, showError, showWarning } = useToast();

    // Connection & Account
    const [connections, setConnections] = useState([]);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [loadingSetup, setLoadingSetup] = useState(true);

    // Analysis state
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [executingId, setExecutingId] = useState(null);
    const [autoOptimizing, setAutoOptimizing] = useState(false);

    // Load connections on mount
    useEffect(() => {
        (async () => {
            try {
                const conns = await getConnections();
                setConnections(conns);
                const def = conns.find(c => c.is_default) || conns[0];
                if (def) setSelectedConnection(def);
            } catch (e) {
                console.error('Failed to load connections:', e);
            } finally {
                setLoadingSetup(false);
            }
        })();
    }, []);

    // Load ad accounts when connection changes
    useEffect(() => {
        if (!selectedConnection) return;
        (async () => {
            try {
                const accounts = await getAdAccounts(selectedConnection.id);
                setAdAccounts(accounts);
                const lastId = localStorage.getItem('browser_last_account');
                const last = accounts.find(a => a.id === lastId);
                setSelectedAccount(last || accounts[0] || null);
            } catch (e) {
                console.error('Failed to load accounts:', e);
            }
        })();
    }, [selectedConnection]);

    // Run Analysis
    const runAnalysis = async () => {
        if (!selectedAccount) return;
        setLoading(true);
        setAnalysis(null);
        try {
            const res = await authFetch(`${API_URL}/optimizer/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount.id,
                    connection_id: selectedConnection?.id,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Analysis failed');
            if (data.error) {
                showError(data.error);
                setAnalysis(data);
            } else {
                setAnalysis(data);
                showSuccess('Analysis complete');
            }
        } catch (e) {
            showError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Execute single recommendation
    const executeRec = async (rec) => {
        setExecutingId(rec.object_id);
        try {
            const res = await authFetch(`${API_URL}/optimizer/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount.id,
                    connection_id: selectedConnection?.id,
                    recommendation: rec,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Execute failed');
            if (data.error) {
                showError(data.error);
            } else {
                showSuccess(`${rec.action} executed on ${rec.object_name || rec.object_id}`);
            }
        } catch (e) {
            showError(e.message);
        } finally {
            setExecutingId(null);
        }
    };

    // Auto-optimize
    const runAutoOptimize = async () => {
        if (!selectedAccount) return;
        setAutoOptimizing(true);
        setAnalysis(null);
        try {
            const res = await authFetch(`${API_URL}/optimizer/auto-optimize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount.id,
                    connection_id: selectedConnection?.id,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Auto-optimize failed');
            setAnalysis(data.analysis);
            if (data.executed_count > 0) {
                showSuccess(`Auto-optimized: ${data.executed_count} high-priority actions executed`);
            } else {
                showWarning('Analysis complete. No high-priority pause actions to execute.');
            }
        } catch (e) {
            showError(e.message);
        } finally {
            setAutoOptimizing(false);
        }
    };

    const priorityColor = (p) => {
        if (p === 'high') return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
        if (p === 'medium') return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20';
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
    };

    const actionIcon = (action) => {
        if (action === 'pause') return <Pause size={14} className="text-red-500" />;
        if (action === 'scale') return <TrendingUp size={14} className="text-green-500" />;
        if (action === 'adjust_budget') return <DollarSign size={14} className="text-amber-500" />;
        return <Target size={14} className="text-blue-500" />;
    };

    if (loadingSetup) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader className="animate-spin text-amber-500" size={32} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Zap className="text-amber-500" size={28} />
                        Campaign Optimizer
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        AI-powered campaign analysis and optimization
                    </p>
                </div>
            </div>

            {/* Account Selector */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* Connection */}
                <div className="flex-1 min-w-0">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Connection</label>
                    <select
                        value={selectedConnection?.id || ''}
                        onChange={(e) => {
                            const c = connections.find(x => x.id === e.target.value);
                            setSelectedConnection(c);
                        }}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm py-2 px-3 text-gray-900 dark:text-gray-100"
                    >
                        {connections.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                {/* Account */}
                <div className="flex-1 min-w-0">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Account</label>
                    <select
                        value={selectedAccount?.id || ''}
                        onChange={(e) => {
                            const a = adAccounts.find(x => x.id === e.target.value);
                            setSelectedAccount(a);
                            if (a) localStorage.setItem('browser_last_account', a.id);
                        }}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm py-2 px-3 text-gray-900 dark:text-gray-100"
                    >
                        {adAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                        ))}
                    </select>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 sm:pt-0">
                    <button
                        onClick={runAnalysis}
                        disabled={loading || !selectedAccount}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                        {loading ? <Loader className="animate-spin" size={16} /> : <Zap size={16} />}
                        Run Analysis
                    </button>
                    <button
                        onClick={runAutoOptimize}
                        disabled={autoOptimizing || !selectedAccount}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                        title="Analyze + auto-pause high-priority losers"
                    >
                        {autoOptimizing ? <Loader className="animate-spin" size={16} /> : <Shield size={16} />}
                        Auto-Optimize
                    </button>
                </div>
            </div>

            {/* Loading State */}
            {(loading || autoOptimizing) && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
                    <Loader className="animate-spin text-amber-500 mx-auto mb-4" size={40} />
                    <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">
                        {autoOptimizing ? 'Running analysis & auto-optimizing...' : 'Claude is analyzing your campaigns...'}
                    </p>
                    <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">
                        This typically takes 15-30 seconds
                    </p>
                </div>
            )}

            {/* Results */}
            {analysis && !loading && !autoOptimizing && (
                <div className="space-y-6">
                    {/* Summary */}
                    {analysis.summary && (
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Account Health</h2>
                            <p className="text-gray-600 dark:text-gray-300">{analysis.summary}</p>
                        </div>
                    )}

                    {/* Stats Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                            <DollarSign className="mx-auto text-green-500 mb-1" size={24} />
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                ${(analysis.total_spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Total Spend</p>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                            <Target className="mx-auto text-blue-500 mb-1" size={24} />
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                {(analysis.total_results || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Total Results</p>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                            <TrendingUp className="mx-auto text-amber-500 mb-1" size={24} />
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                ${(analysis.avg_cpa || 0).toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Avg CPA</p>
                        </div>
                    </div>

                    {/* Top & Worst Performers */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Top Performers */}
                        {analysis.top_performers?.length > 0 && (
                            <div className="bg-white dark:bg-gray-900 rounded-xl border border-green-200 dark:border-green-800 p-4">
                                <h3 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-3 flex items-center gap-2">
                                    <TrendingUp size={16} /> Top Performers
                                </h3>
                                <div className="space-y-2">
                                    {analysis.top_performers.map((p, i) => (
                                        <div key={i} className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                                            <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{p.name}</p>
                                            <p className="text-xs text-green-600 dark:text-green-400 mt-1">{p.why}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Worst Performers */}
                        {analysis.worst_performers?.length > 0 && (
                            <div className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-800 p-4">
                                <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
                                    <TrendingDown size={16} /> Worst Performers
                                </h3>
                                <div className="space-y-2">
                                    {analysis.worst_performers.map((p, i) => (
                                        <div key={i} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                                            <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{p.name}</p>
                                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{p.why}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Recommendations Table */}
                    {analysis.recommendations?.length > 0 && (
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    Recommendations ({analysis.recommendations.length})
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            <th className="px-4 py-3">Action</th>
                                            <th className="px-4 py-3">Campaign / Ad</th>
                                            <th className="px-4 py-3">Reason</th>
                                            <th className="px-4 py-3">Priority</th>
                                            <th className="px-4 py-3 text-right">Execute</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {analysis.recommendations.map((rec, i) => (
                                            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className="flex items-center gap-1.5 font-medium capitalize">
                                                        {actionIcon(rec.action)}
                                                        {rec.action}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="font-medium text-gray-900 dark:text-white truncate max-w-xs">{rec.object_name || rec.object_id}</p>
                                                    <p className="text-xs text-gray-400">{rec.object_type} &middot; {rec.object_id}</p>
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-sm">
                                                    <p className="line-clamp-2">{rec.reason}</p>
                                                    {rec.details && (
                                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{rec.details}</p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${priorityColor(rec.priority)}`}>
                                                        {rec.priority}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                                    {(rec.action === 'pause' || rec.action === 'scale') ? (
                                                        <button
                                                            onClick={() => executeRec(rec)}
                                                            disabled={executingId === rec.object_id}
                                                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                                                rec.action === 'pause'
                                                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                                                                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                                                            }`}
                                                        >
                                                            {executingId === rec.object_id ? (
                                                                <Loader className="animate-spin" size={12} />
                                                            ) : rec.action === 'pause' ? (
                                                                <Pause size={12} />
                                                            ) : (
                                                                <TrendingUp size={12} />
                                                            )}
                                                            {rec.action === 'pause' ? 'Pause' : 'Scale'}
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-gray-400">Manual</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Raw error fallback */}
                    {analysis.error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                            <h3 className="text-red-700 dark:text-red-400 font-medium flex items-center gap-2">
                                <AlertTriangle size={16} /> Analysis Error
                            </h3>
                            <p className="text-sm text-red-600 dark:text-red-300 mt-1">{analysis.error}</p>
                            {analysis.raw && (
                                <pre className="mt-2 text-xs text-gray-500 dark:text-gray-400 overflow-auto max-h-40 bg-gray-100 dark:bg-gray-800 p-2 rounded">
                                    {analysis.raw}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!analysis && !loading && !autoOptimizing && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
                    <Zap className="mx-auto text-gray-300 dark:text-gray-600 mb-4" size={48} />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Ready to Optimize</h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                        Select an ad account and click "Run Analysis" to get AI-powered recommendations
                        for pausing losers, scaling winners, and adjusting budgets.
                    </p>
                </div>
            )}
        </div>
    );
}
