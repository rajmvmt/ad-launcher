import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import SafeCampaignModal from '../components/SafeCampaignModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const SafeWarmupPage = () => {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();
    const [accounts, setAccounts] = useState([]);
    const [pages, setPages] = useState([]);
    const [connections, setConnections] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState('');
    const [selectedPage, setSelectedPage] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [result, setResult] = useState(null);
    const [connectionId, setConnectionId] = useState('');

    // Load connections on mount
    useEffect(() => {
        const loadConns = async () => {
            try {
                const connRes = await authFetch(`${API_URL}/facebook-connections`);
                const conns = connRes.ok ? await connRes.json() : [];
                setConnections(conns);
                const activeConn = conns.find(c => c.is_active) || conns.find(c => c.is_default) || conns[0];
                if (activeConn) {
                    setConnectionId(activeConn.id);
                } else {
                    setLoadingAccounts(false);
                }
            } catch (e) {
                console.error('Failed to load connections:', e);
                setLoadingAccounts(false);
            }
        };
        loadConns();
    }, [authFetch]);

    // Load accounts and pages when connection changes
    useEffect(() => {
        if (!connectionId) return;
        const load = async () => {
            setLoadingAccounts(true);
            setSelectedAccount('');
            setSelectedPage('');
            try {
                const connParam = `?connection_id=${connectionId}`;
                const [acctRes, pagesRes] = await Promise.all([
                    authFetch(`${API_URL}/facebook/accounts${connParam}`),
                    authFetch(`${API_URL}/facebook/pages${connParam}`),
                ]);
                if (acctRes.ok) setAccounts(await acctRes.json());
                if (pagesRes.ok) {
                    const fbPages = await pagesRes.json();
                    setPages(fbPages.map(p => ({ id: p.id, fb_page_id: p.id, name: p.name })));
                }
            } catch (e) {
                console.error('Failed to load accounts:', e);
            } finally {
                setLoadingAccounts(false);
            }
        };
        load();
    }, [connectionId, authFetch]);

    const handleCreate = async () => {
        if (!selectedAccount || !selectedPage) {
            showError('Select an ad account and a page');
            return;
        }
        setLoading(true);
        setResult(null);
        try {
            const connParam = connectionId ? `?connection_id=${connectionId}` : '';
            const res = await authFetch(`${API_URL}/facebook/safe-engagement-campaign${connParam}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount,
                    page_id: selectedPage,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to create campaign');
            }
            const data = await res.json();
            setResult(data);
            showSuccess('Safe warmup campaign created!');
        } catch (err) {
            showError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-xl sm:text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                    <Shield size={28} className="text-green-600 sm:w-8 sm:h-8" />
                    Safe Warmup
                </h1>
                <p className="text-gray-600 text-sm sm:text-base">Create safe warmup campaigns to season your ad accounts</p>
            </div>

            {loadingAccounts ? (
                <div className="flex items-center justify-center h-48">
                    <Loader2 size={24} className="text-amber-500 animate-spin" />
                </div>
            ) : (
                <div className="space-y-6 max-w-2xl">
                    {/* Connection Selector */}
                    {connections.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Connection (BM)</label>
                            <select
                                value={connectionId}
                                onChange={(e) => setConnectionId(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                            >
                                {connections.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.name || c.id}{c.is_active ? ' (active)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Safe Conversion Campaign (AI-powered) — primary feature */}
                    <SafeCampaignModal
                        authFetch={authFetch}
                        accounts={accounts}
                        pages={pages}
                        connectionId={connectionId}
                    />

                    {/* Quick Engagement Warmup — existing simple feature */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                <Shield size={20} className="text-green-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Quick Engagement Warmup</h2>
                                <p className="text-xs text-gray-500">Creates a $5/day engagement campaign with page profile pic + safe copy. Auto-pauses at midnight.</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account</label>
                                    <select
                                        value={selectedAccount}
                                        onChange={(e) => setSelectedAccount(e.target.value)}
                                        className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                                    >
                                        <option value="">Select an ad account...</option>
                                        {accounts.map(a => (
                                            <option key={a.id || a.account_id} value={a.id || a.account_id}>
                                                {a.name || a.id || a.account_id}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">FB Page</label>
                                    <select
                                        value={selectedPage}
                                        onChange={(e) => setSelectedPage(e.target.value)}
                                        className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                                    >
                                        <option value="">Select a page...</option>
                                        {pages.map(p => (
                                            <option key={p.id} value={p.fb_page_id}>
                                                {p.name || p.fb_page_id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={handleCreate}
                                disabled={loading || !selectedAccount || !selectedPage}
                                className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Creating Campaign...
                                    </>
                                ) : (
                                    <>
                                        <Shield size={16} />
                                        Launch Quick Warmup ($5/day, auto-pause at midnight)
                                    </>
                                )}
                            </button>

                            {result && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <CheckCircle2 size={18} className="text-green-600" />
                                        <span className="font-semibold text-green-800">Campaign Live!</span>
                                    </div>
                                    <div className="text-sm text-green-700 space-y-1">
                                        <p><span className="font-medium">Campaign:</span> {result.campaign_name}</p>
                                        <p><span className="font-medium">Auto-pause:</span> {new Date(result.pauses_at).toLocaleString()}</p>
                                        <p className="text-xs text-green-600 mt-2">{result.message}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SafeWarmupPage;
