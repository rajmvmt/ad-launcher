import React, { useState, useEffect, useCallback } from 'react';
import { Globe, Plus, Search, Loader, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock, XCircle, ChevronDown, ChevronUp, Settings, X, Sparkles, Copy, Server, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts } from '../lib/facebookApi';
import { getHostingAccounts, createHostingAccount, updateHostingAccount, deleteHostingAccount, testHostingConnection, addAddonDomain, listAddonDomains } from '../lib/hostingApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const STATUS_STYLES = {
    active:     { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', icon: CheckCircle },
    registered: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', icon: Clock },
    pending:    { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
    expired:    { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: XCircle },
    failed:     { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: AlertCircle },
};

export default function Domains() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();
    const { brands } = useBrands();

    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterBrand, setFilterBrand] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    // Register modal
    const [showRegister, setShowRegister] = useState(false);
    const [searchDomain, setSearchDomain] = useState('');
    const [checkResult, setCheckResult] = useState(null);
    const [checking, setChecking] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [regBrand, setRegBrand] = useState('');
    const [regAccount, setRegAccount] = useState('');
    const [regNotes, setRegNotes] = useState('');
    const [regStep, setRegStep] = useState('');

    // AI suggestions
    const [showSuggest, setShowSuggest] = useState(false);
    const [suggestNiche, setSuggestNiche] = useState('general');
    const [suggesting, setSuggesting] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const [availabilityChecked, setAvailabilityChecked] = useState(true);

    // DNS panel
    const [expandedDomain, setExpandedDomain] = useState(null);
    const [dnsData, setDnsData] = useState(null);
    const [dnsLoading, setDnsLoading] = useState(false);
    const [newRecord, setNewRecord] = useState({ record_type: 'CNAME', name: '', value: '', proxied: true });
    const [addingDns, setAddingDns] = useState(false);

    // Edit modal
    const [editDomain, setEditDomain] = useState(null);
    const [editBrand, setEditBrand] = useState('');
    const [editAccount, setEditAccount] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [saving, setSaving] = useState(false);

    // Delete
    const [deletingId, setDeletingId] = useState(null);

    // Ad accounts (loaded from FB connections)
    const [adAccounts, setAdAccounts] = useState([]);

    // Hosting accounts
    const [hostingAccounts, setHostingAccounts] = useState([]);
    const [showHostingPanel, setShowHostingPanel] = useState(false);
    const [showAddHosting, setShowAddHosting] = useState(false);
    const [hostingForm, setHostingForm] = useState({ name: '', ftp_host: '', ftp_port: 21, ftp_username: '', ftp_password: '', ftp_protocol: 'ftp', primary_domain: '', base_path: 'public_html', cpanel_host: '', cpanel_username: '', cpanel_api_token: '' });
    const [savingHosting, setSavingHosting] = useState(false);
    const [testingHosting, setTestingHosting] = useState(null);
    const [editHosting, setEditHosting] = useState(null);
    const [editHostingForm, setEditHostingForm] = useState({});
    const [editHostingAccount, setEditHostingAccount] = useState('');
    const [addonDomain, setAddonDomain] = useState('');
    const [addingAddon, setAddingAddon] = useState(null);
    const [addonDomains, setAddonDomains] = useState({});
    const [addingToHosting, setAddingToHosting] = useState(null);

    const fetchHostingAccounts = useCallback(async () => {
        try {
            const data = await getHostingAccounts(authFetch);
            setHostingAccounts(data);
        } catch (e) {
            console.warn('Failed to load hosting accounts:', e);
        }
    }, [authFetch]);

    useEffect(() => {
        (async () => {
            try {
                const conns = await getConnections();
                const def = conns.find(c => c.is_default) || conns[0];
                if (def) {
                    const accounts = await getAdAccounts(def.id);
                    setAdAccounts(accounts);
                }
            } catch (e) {
                console.warn('Failed to load ad accounts:', e);
            }
        })();
        fetchHostingAccounts();
    }, [fetchHostingAccounts]);

    const fetchDomains = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filterBrand) params.set('brand_id', filterBrand);
            if (filterStatus) params.set('status', filterStatus);
            const res = await authFetch(`${API_URL}/domains?${params}`);
            if (res.ok) setDomains(await res.json());
        } catch { showError('Failed to load domains'); }
        finally { setLoading(false); }
    }, [authFetch, filterBrand, filterStatus]);

    useEffect(() => { fetchDomains(); }, [fetchDomains]);

    // ── Check availability ──────────────────────────
    const handleCheck = async () => {
        if (!searchDomain.trim()) return;
        setChecking(true);
        setCheckResult(null);
        try {
            const res = await authFetch(`${API_URL}/domains/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: searchDomain.trim().toLowerCase() }),
            });
            if (res.ok) setCheckResult(await res.json());
            else showError('Failed to check domain');
        } catch { showError('Failed to check domain'); }
        finally { setChecking(false); }
    };

    // ── Register ────────────────────────────────────
    const handleRegister = async () => {
        if (!checkResult?.available) return;
        setRegistering(true);
        setRegStep('Registering on Namecheap...');
        try {
            const res = await authFetch(`${API_URL}/domains/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: searchDomain.trim().toLowerCase(),
                    brand_id: regBrand || null,
                    ad_account_id: regAccount || null,
                    notes: regNotes || null,
                }),
            });
            const data = await res.json();
            if (data.status === 'active') {
                showSuccess(`${searchDomain} registered and DNS configured!`);
                closeRegister();
                fetchDomains();
            } else if (data.status === 'registered') {
                showSuccess(`${searchDomain} registered but DNS setup needs retry`);
                closeRegister();
                fetchDomains();
            } else {
                showError(data.message || `Registration failed at step: ${data.step}`);
            }
        } catch { showError('Registration failed'); }
        finally { setRegistering(false); setRegStep(''); }
    };

    const closeRegister = () => {
        setShowRegister(false);
        setSearchDomain('');
        setCheckResult(null);
        setRegBrand('');
        setRegAccount('');
        setRegNotes('');
        setSuggestions([]);
        setShowSuggest(false);
    };

    const handleSuggest = async () => {
        setSuggesting(true);
        setSuggestions([]);
        try {
            const res = await authFetch(`${API_URL}/domains/suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ niche: suggestNiche }),
            });
            if (res.ok) {
                const data = await res.json();
                setSuggestions(data.suggestions || []);
                setAvailabilityChecked(data.availability_checked !== false);
            } else {
                const err = await res.json();
                showError(err.detail || 'Failed to generate suggestions');
            }
        } catch { showError('Failed to generate suggestions'); }
        finally { setSuggesting(false); }
    };

    const pickSuggestion = (domain) => {
        setSearchDomain(domain);
        setCheckResult({ domain, available: true });
        setSuggestions([]);
        setShowSuggest(false);
    };

    // ── DNS panel ───────────────────────────────────
    const toggleDns = async (domainId) => {
        if (expandedDomain === domainId) { setExpandedDomain(null); return; }
        setExpandedDomain(domainId);
        setDnsLoading(true);
        try {
            const res = await authFetch(`${API_URL}/domains/${domainId}`);
            if (res.ok) setDnsData(await res.json());
        } catch {}
        finally { setDnsLoading(false); }
    };

    const handleAddDns = async (domainId) => {
        if (!newRecord.name || !newRecord.value) { showError('Name and value are required'); return; }
        setAddingDns(true);
        try {
            const res = await authFetch(`${API_URL}/domains/${domainId}/dns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newRecord),
            });
            if (res.ok) {
                showSuccess('DNS record created');
                setNewRecord({ record_type: 'CNAME', name: '', value: '', proxied: true });
                toggleDns(domainId); // refresh
            } else {
                const err = await res.json();
                showError(err.detail || 'Failed to create record');
            }
        } catch { showError('Failed to create DNS record'); }
        finally { setAddingDns(false); }
    };

    const handleDeleteDns = async (domainId, recordId) => {
        try {
            const res = await authFetch(`${API_URL}/domains/${domainId}/dns/${recordId}`, { method: 'DELETE' });
            if (res.ok) { showSuccess('DNS record deleted'); toggleDns(domainId); }
            else showError('Failed to delete record');
        } catch { showError('Failed to delete record'); }
    };

    // ── Retry setup ─────────────────────────────────
    const handleRetry = async (domainId) => {
        try {
            const res = await authFetch(`${API_URL}/domains/${domainId}/retry-setup`, { method: 'POST' });
            if (res.ok) { showSuccess('DNS setup retried'); fetchDomains(); }
            else showError('Retry failed');
        } catch { showError('Retry failed'); }
    };

    // ── Edit ────────────────────────────────────────
    const openEdit = (d) => {
        setEditDomain(d);
        setEditBrand(d.brand_id || '');
        setEditAccount(d.ad_account_id || '');
        setEditHostingAccount(d.hosting_account_id || '');
        setEditNotes(d.notes || '');
    };

    const handleSaveEdit = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${API_URL}/domains/${editDomain.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brand_id: editBrand || null, ad_account_id: editAccount || null, hosting_account_id: editHostingAccount || null, notes: editNotes || null }),
            });
            if (res.ok) { showSuccess('Domain updated'); setEditDomain(null); fetchDomains(); }
            else showError('Failed to update');
        } catch { showError('Failed to update'); }
        finally { setSaving(false); }
    };

    // ── Delete ──────────────────────────────────────
    const handleDelete = async (id) => {
        setDeletingId(id);
        try {
            const res = await authFetch(`${API_URL}/domains/${id}`, { method: 'DELETE' });
            if (res.ok) { showSuccess('Domain removed'); fetchDomains(); }
            else showError('Failed to delete');
        } catch { showError('Failed to delete'); }
        finally { setDeletingId(null); }
    };

    const handleAddToHosting = async (domainId) => {
        setAddingToHosting(domainId);
        try {
            const res = await authFetch(`${API_URL}/domains/${domainId}/add-to-hosting`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                showError(data.detail || data.message || 'Failed to add to hosting');
            } else if (data.success) {
                showSuccess(data.message + (data.a_record_added ? ' + A record added' : ''));
                fetchDomains();
            } else {
                showError(data.message || 'Failed to add to hosting');
            }
        } catch (e) { showError('Failed to add to hosting: ' + e.message); }
        finally { setAddingToHosting(null); }
    };

    // ── Hosting Accounts ──────────────────────────────
    const handleCreateHosting = async () => {
        if (!hostingForm.name || !hostingForm.ftp_host || !hostingForm.ftp_username || !hostingForm.ftp_password) {
            showError('Name, host, username, and password are required');
            return;
        }
        setSavingHosting(true);
        try {
            await createHostingAccount(authFetch, hostingForm);
            showSuccess('Hosting account created');
            setShowAddHosting(false);
            setHostingForm({ name: '', ftp_host: '', ftp_port: 21, ftp_username: '', ftp_password: '', ftp_protocol: 'ftp', primary_domain: '', base_path: 'public_html' });
            fetchHostingAccounts();
        } catch (e) { showError(e.message); }
        finally { setSavingHosting(false); }
    };

    const handleTestHosting = async (id) => {
        setTestingHosting(id);
        try {
            const result = await testHostingConnection(authFetch, id);
            if (result.success) showSuccess(result.message || 'Connected successfully');
            else showError(result.message || 'Connection failed');
        } catch (e) { showError(e.message); }
        finally { setTestingHosting(null); }
    };

    const handleDeleteHosting = async (id) => {
        try {
            await deleteHostingAccount(authFetch, id);
            showSuccess('Hosting account deleted');
            fetchHostingAccounts();
        } catch (e) { showError(e.message); }
    };

    const handleUpdateHosting = async () => {
        setSavingHosting(true);
        try {
            await updateHostingAccount(authFetch, editHosting.id, editHostingForm);
            showSuccess('Hosting account updated');
            setEditHosting(null);
            fetchHostingAccounts();
        } catch (e) { showError(e.message); }
        finally { setSavingHosting(false); }
    };

    const handleAddAddonDomain = async (hostingId) => {
        if (!addonDomain.trim()) return;
        setAddingAddon(hostingId);
        try {
            const result = await addAddonDomain(authFetch, hostingId, addonDomain.trim());
            if (result.success) {
                showSuccess(result.message);
                setAddonDomain('');
                // Refresh addon domain list
                handleListAddons(hostingId);
            } else {
                showError(result.message || 'Failed to add addon domain');
            }
        } catch (e) { showError(e.message); }
        finally { setAddingAddon(null); }
    };

    const handleListAddons = async (hostingId) => {
        try {
            const result = await listAddonDomains(authFetch, hostingId);
            if (result.success) {
                setAddonDomains(prev => ({ ...prev, [hostingId]: result.domains }));
            }
        } catch (e) { console.warn('Failed to list addons:', e); }
    };

    const brandName = (brandId) => brands?.find(b => b.id === brandId)?.name || '';
    const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
                        <Globe size={28} className="text-amber-600" />
                        Domains
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">Register, manage & configure domain DNS</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowHostingPanel(!showHostingPanel)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Server size={14} /> Hosting ({hostingAccounts.length})
                    </button>
                    <button onClick={() => setShowRegister(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors">
                        <Plus size={14} /> Register Domain
                    </button>
                    <button onClick={fetchDomains} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}
                    className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    <option value="">All Brands</option>
                    {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                    className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="registered">Registered</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                </select>
            </div>

            {/* Hosting Accounts Panel */}
            {showHostingPanel && (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <Server size={18} className="text-amber-600" /> Hosting Accounts
                        </h2>
                        <button onClick={() => setShowAddHosting(!showAddHosting)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg">
                            <Plus size={12} /> Add Account
                        </button>
                    </div>

                    {/* Add Hosting Form */}
                    {showAddHosting && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Account Name</label>
                                    <input className={inputCls} placeholder="e.g. Namecheap Main" value={hostingForm.name}
                                        onChange={(e) => setHostingForm(f => ({ ...f, name: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Protocol</label>
                                    <select className={inputCls} value={hostingForm.ftp_protocol}
                                        onChange={(e) => setHostingForm(f => ({ ...f, ftp_protocol: e.target.value, ftp_port: e.target.value === 'sftp' ? 22 : 21 }))}>
                                        <option value="ftp">FTP</option>
                                        <option value="sftp">SFTP</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">FTP Host</label>
                                    <input className={inputCls} placeholder="ftp.example.com" value={hostingForm.ftp_host}
                                        onChange={(e) => setHostingForm(f => ({ ...f, ftp_host: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Port</label>
                                    <input className={inputCls} type="number" value={hostingForm.ftp_port}
                                        onChange={(e) => setHostingForm(f => ({ ...f, ftp_port: parseInt(e.target.value) || 21 }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                                    <input className={inputCls} placeholder="username" value={hostingForm.ftp_username}
                                        onChange={(e) => setHostingForm(f => ({ ...f, ftp_username: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                                    <input className={inputCls} type="password" placeholder="password" value={hostingForm.ftp_password}
                                        onChange={(e) => setHostingForm(f => ({ ...f, ftp_password: e.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Primary Domain</label>
                                    <input className={inputCls} placeholder="e.g. advicealchemy.com" value={hostingForm.primary_domain}
                                        onChange={(e) => setHostingForm(f => ({ ...f, primary_domain: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Base Path</label>
                                    <input className={inputCls} value={hostingForm.base_path}
                                        onChange={(e) => setHostingForm(f => ({ ...f, base_path: e.target.value }))} />
                                </div>
                            </div>
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                                <p className="text-xs font-medium text-gray-500 mb-2">cPanel API (optional — enables adding addon domains)</p>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">cPanel Host</label>
                                        <input className={inputCls} placeholder="server.web-hosting.com" value={hostingForm.cpanel_host}
                                            onChange={(e) => setHostingForm(f => ({ ...f, cpanel_host: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">cPanel Username</label>
                                        <input className={inputCls} placeholder="username" value={hostingForm.cpanel_username}
                                            onChange={(e) => setHostingForm(f => ({ ...f, cpanel_username: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">API Token</label>
                                        <input className={inputCls} type="password" placeholder="cPanel API token" value={hostingForm.cpanel_api_token}
                                            onChange={(e) => setHostingForm(f => ({ ...f, cpanel_api_token: e.target.value }))} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <button onClick={handleCreateHosting} disabled={savingHosting}
                                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50">
                                    {savingHosting ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                                    Create
                                </button>
                                <button onClick={() => setShowAddHosting(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                            </div>
                        </div>
                    )}

                    {/* Hosting Account List */}
                    {hostingAccounts.length === 0 ? (
                        <div className="p-6 text-center text-sm text-gray-400">No hosting accounts yet. Add one to deploy safe pages via FTP.</div>
                    ) : (
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                            {hostingAccounts.map(h => (
                                <div key={h.id} className="p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900 dark:text-gray-100">{h.name}</span>
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 uppercase">{h.ftp_protocol}</span>
                                                {h.cpanel_configured && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600">cPanel</span>}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {h.ftp_username}@{h.ftp_host}:{h.ftp_port} &middot; {h.base_path}
                                                {h.primary_domain && <> &middot; Primary: {h.primary_domain}</>}
                                                {h.domain_count > 0 && <> &middot; {h.domain_count} domain{h.domain_count !== 1 ? 's' : ''}</>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleTestHosting(h.id)} disabled={testingHosting === h.id}
                                                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50">
                                                {testingHosting === h.id ? <Loader size={12} className="animate-spin" /> : <Wifi size={12} />} Test
                                            </button>
                                            {h.cpanel_configured && (
                                                <button onClick={() => handleListAddons(h.id)}
                                                    className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700">
                                                    <Globe size={12} /> Addons
                                                </button>
                                            )}
                                            <button onClick={() => { setEditHosting(h); setEditHostingForm({ name: h.name, ftp_host: h.ftp_host, ftp_port: h.ftp_port, ftp_username: h.ftp_username, ftp_password: '', ftp_protocol: h.ftp_protocol, primary_domain: h.primary_domain || '', base_path: h.base_path, cpanel_host: h.cpanel_host || '', cpanel_username: h.cpanel_username || '', cpanel_api_token: '' }); }}
                                                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700">
                                                <Settings size={12} /> Edit
                                            </button>
                                            <button onClick={() => handleDeleteHosting(h.id)}
                                                className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Add Addon Domain */}
                                    {h.cpanel_configured && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                                                placeholder="Add addon domain (e.g. newsite.com)"
                                                value={addingAddon === h.id ? addonDomain : addonDomain}
                                                onChange={(e) => setAddonDomain(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddAddonDomain(h.id)}
                                            />
                                            <button onClick={() => handleAddAddonDomain(h.id)} disabled={addingAddon === h.id || !addonDomain.trim()}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50">
                                                {addingAddon === h.id ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
                                                Add to Hosting
                                            </button>
                                        </div>
                                    )}

                                    {/* Addon domains list */}
                                    {addonDomains[h.id] && addonDomains[h.id].length > 0 && (
                                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                                            <p className="text-xs font-medium text-gray-500 mb-2">Addon Domains on cPanel ({addonDomains[h.id].length})</p>
                                            <div className="flex flex-wrap gap-2">
                                                {addonDomains[h.id].map(d => (
                                                    <span key={d.domain} className="text-xs px-2.5 py-1 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                                                        {d.domain}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Edit Hosting Account Modal */}
            {editHosting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit {editHosting.name}</h2>
                            <button onClick={() => setEditHosting(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                                <input className={inputCls} value={editHostingForm.name || ''}
                                    onChange={(e) => setEditHostingForm(f => ({ ...f, name: e.target.value }))} />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">FTP Host</label>
                                    <input className={inputCls} value={editHostingForm.ftp_host || ''}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, ftp_host: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Port</label>
                                    <input className={inputCls} type="number" value={editHostingForm.ftp_port || 21}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, ftp_port: parseInt(e.target.value) || 21 }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                                    <input className={inputCls} value={editHostingForm.ftp_username || ''}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, ftp_username: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Password (blank = keep)</label>
                                    <input className={inputCls} type="password" placeholder="********" value={editHostingForm.ftp_password || ''}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, ftp_password: e.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Primary Domain</label>
                                    <input className={inputCls} value={editHostingForm.primary_domain || ''}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, primary_domain: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Base Path</label>
                                    <input className={inputCls} value={editHostingForm.base_path || ''}
                                        onChange={(e) => setEditHostingForm(f => ({ ...f, base_path: e.target.value }))} />
                                </div>
                            </div>
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                                <p className="text-xs font-medium text-gray-500 mb-2">cPanel API</p>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">cPanel Host</label>
                                            <input className={inputCls} placeholder="server.web-hosting.com" value={editHostingForm.cpanel_host || ''}
                                                onChange={(e) => setEditHostingForm(f => ({ ...f, cpanel_host: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">cPanel Username</label>
                                            <input className={inputCls} value={editHostingForm.cpanel_username || ''}
                                                onChange={(e) => setEditHostingForm(f => ({ ...f, cpanel_username: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">API Token (blank = keep)</label>
                                        <input className={inputCls} type="password" placeholder="********" value={editHostingForm.cpanel_api_token || ''}
                                            onChange={(e) => setEditHostingForm(f => ({ ...f, cpanel_api_token: e.target.value }))} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-1">
                                <button onClick={handleUpdateHosting} disabled={savingHosting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                                    {savingHosting ? <Loader size={14} className="animate-spin" /> : null} Save
                                </button>
                                <button onClick={() => setEditHosting(null)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Domain List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader size={24} className="animate-spin text-amber-600 mr-3" />
                    <span className="text-gray-500 dark:text-gray-400">Loading domains...</span>
                </div>
            ) : domains.length === 0 ? (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
                    <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Globe className="text-amber-600" size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No domains yet</h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">Register your first domain to get started.</p>
                    <button onClick={() => setShowRegister(true)} className="text-amber-600 font-medium hover:underline">
                        Register a Domain
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {domains.map((d) => {
                        const st = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
                        const StIcon = st.icon;
                        const isExpanded = expandedDomain === d.id;
                        return (
                            <div key={d.id} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                                {/* Card header */}
                                <div className="p-4">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">{d.name}</h3>
                                            <button
                                                onClick={() => { navigator.clipboard.writeText(d.name); showSuccess('Copied!'); }}
                                                className="text-gray-400 hover:text-amber-500 shrink-0"
                                                title="Copy domain"
                                            >
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>
                                            <StIcon size={12} /> {d.status}
                                        </span>
                                    </div>
                                    <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
                                        {d.brand_id && <div>Brand: <span className="text-gray-700 dark:text-gray-300">{brandName(d.brand_id)}</span></div>}
                                        {d.ad_account_id && <div>Account: <span className="text-gray-700 dark:text-gray-300">{adAccounts.find(a => a.id === d.ad_account_id)?.name || d.ad_account_id}</span></div>}
                                        {d.hosting_account_id && <div>Hosting: <span className="text-gray-700 dark:text-gray-300">{hostingAccounts.find(h => h.id === d.hosting_account_id)?.name || 'Linked'}</span></div>}
                                        {d.expires_at && <div>Expires: {new Date(d.expires_at).toLocaleDateString()}</div>}
                                        <div className="flex items-center gap-1">
                                            DNS: {d.dns_configured
                                                ? <span className="text-green-600 flex items-center gap-1"><CheckCircle size={12} /> Configured</span>
                                                : <span className="text-amber-600 flex items-center gap-1"><AlertCircle size={12} /> Not configured</span>
                                            }
                                        </div>
                                    </div>
                                    {/* Actions */}
                                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                                        <button onClick={() => toggleDns(d.id)} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} DNS
                                        </button>
                                        <button onClick={() => openEdit(d)} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                                            <Settings size={12} /> Edit
                                        </button>
                                        {!d.dns_configured && d.status !== 'pending' && (
                                            <button onClick={() => handleRetry(d.id)} className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700">
                                                <RefreshCw size={12} /> Retry DNS
                                            </button>
                                        )}
                                        {!d.hosting_account_id && hostingAccounts.some(h => h.cpanel_configured) && (
                                            <button onClick={() => handleAddToHosting(d.id)} disabled={addingToHosting === d.id}
                                                className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50">
                                                {addingToHosting === d.id ? <Loader size={12} className="animate-spin" /> : <Server size={12} />} Add to Hosting
                                            </button>
                                        )}
                                        <button onClick={() => handleDelete(d.id)} disabled={deletingId === d.id}
                                            className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 ml-auto disabled:opacity-50">
                                            {deletingId === d.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                                        </button>
                                    </div>
                                </div>

                                {/* DNS Records Panel */}
                                {isExpanded && (
                                    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3">
                                        {d.cloudflare_nameservers && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                <span className="font-medium">Cloudflare NS:</span> {d.cloudflare_nameservers.join(', ')}
                                            </div>
                                        )}
                                        {dnsLoading ? (
                                            <div className="flex items-center gap-2 py-4 justify-center text-sm text-gray-400">
                                                <Loader size={14} className="animate-spin" /> Loading records...
                                            </div>
                                        ) : (
                                            <>
                                                {dnsData?.dns_records?.length > 0 ? (
                                                    <table className="w-full text-xs">
                                                        <thead>
                                                            <tr className="text-left text-gray-500 dark:text-gray-400">
                                                                <th className="pb-1 font-medium">Type</th>
                                                                <th className="pb-1 font-medium">Name</th>
                                                                <th className="pb-1 font-medium">Value</th>
                                                                <th className="pb-1 font-medium w-8"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="text-gray-700 dark:text-gray-300">
                                                            {dnsData.dns_records.map(r => (
                                                                <tr key={r.id} className="border-t border-gray-200 dark:border-gray-700">
                                                                    <td className="py-1.5 font-mono">{r.record_type}</td>
                                                                    <td className="py-1.5">{r.name}</td>
                                                                    <td className="py-1.5 truncate max-w-[140px]" title={r.value}>{r.value}</td>
                                                                    <td className="py-1.5">
                                                                        <button onClick={() => handleDeleteDns(d.id, r.id)} className="text-red-400 hover:text-red-600">
                                                                            <Trash2 size={12} />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                ) : (
                                                    <p className="text-xs text-gray-400 dark:text-gray-500">No DNS records tracked</p>
                                                )}

                                                {/* Add Record */}
                                                {d.cloudflare_zone_id && (
                                                    <div className="flex items-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                                        <select value={newRecord.record_type} onChange={(e) => setNewRecord(r => ({ ...r, record_type: e.target.value }))}
                                                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200 w-20">
                                                            <option>A</option><option>CNAME</option><option>TXT</option><option>MX</option>
                                                        </select>
                                                        <input placeholder="Name" value={newRecord.name} onChange={(e) => setNewRecord(r => ({ ...r, name: e.target.value }))}
                                                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200 flex-1" />
                                                        <input placeholder="Value" value={newRecord.value} onChange={(e) => setNewRecord(r => ({ ...r, value: e.target.value }))}
                                                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200 flex-1" />
                                                        <button onClick={() => handleAddDns(d.id)} disabled={addingDns}
                                                            className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:opacity-50">
                                                            {addingDns ? <Loader size={12} className="animate-spin" /> : 'Add'}
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Register Domain Modal */}
            {showRegister && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <Globe size={20} className="text-amber-600" /> Register Domain
                            </h2>
                            <button onClick={closeRegister} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            {/* AI Suggestions */}
                            <div>
                                <button onClick={() => setShowSuggest(!showSuggest)}
                                    className="flex items-center gap-2 text-sm font-medium text-amber-600 hover:text-amber-700 mb-2">
                                    <Sparkles size={14} /> {showSuggest ? 'Hide' : 'Suggest Names with AI'}
                                </button>
                                {showSuggest && (
                                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <select value={suggestNiche} onChange={(e) => setSuggestNiche(e.target.value)}
                                                className="text-sm border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                                <option value="general">General</option>
                                                <option value="health">Health & Wellness</option>
                                                <option value="finance">Finance</option>
                                                <option value="lifestyle">Lifestyle</option>
                                            </select>
                                            <button onClick={handleSuggest} disabled={suggesting}
                                                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                                                {suggesting ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                                {suggesting ? 'Generating...' : 'Generate'}
                                            </button>
                                        </div>
                                        {suggestions.length > 0 && (
                                            <div>
                                                {!availabilityChecked && (
                                                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">Availability not checked — Namecheap API not configured</p>
                                                )}
                                                <div className="flex flex-wrap gap-2">
                                                    {suggestions.map((s) => (
                                                        <button key={s} onClick={() => pickSuggestion(s)}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-800 dark:text-gray-200 transition-colors">
                                                            {availabilityChecked && <CheckCircle size={12} className="text-green-500" />}
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {suggesting && (
                                            <div className="flex items-center gap-2 text-sm text-amber-600 py-2">
                                                <Loader size={14} className="animate-spin" /> Generating names & checking availability...
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Search */}
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Domain Name</label>
                                <div className="flex gap-2">
                                    <input className={inputCls} placeholder="example.com" value={searchDomain}
                                        onChange={(e) => { setSearchDomain(e.target.value); setCheckResult(null); }}
                                        onKeyDown={(e) => e.key === 'Enter' && handleCheck()} />
                                    <button onClick={handleCheck} disabled={checking || !searchDomain.trim()}
                                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 whitespace-nowrap">
                                        {checking ? <Loader size={14} className="animate-spin" /> : <Search size={14} />} Check
                                    </button>
                                </div>
                            </div>

                            {/* Availability result */}
                            {checkResult && (
                                <div className={`p-3 rounded-lg text-sm ${checkResult.available
                                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
                                    {checkResult.available
                                        ? <span className="flex items-center gap-2"><CheckCircle size={16} /> <strong>{checkResult.domain}</strong> is available!</span>
                                        : <span className="flex items-center gap-2"><XCircle size={16} /> <strong>{checkResult.domain}</strong> is not available</span>
                                    }
                                </div>
                            )}

                            {/* Registration form (only if available) */}
                            {checkResult?.available && (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Brand (optional)</label>
                                            <select value={regBrand} onChange={(e) => setRegBrand(e.target.value)} className={inputCls}>
                                                <option value="">No brand</option>
                                                {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Account (optional)</label>
                                            <select className={inputCls} value={regAccount} onChange={(e) => setRegAccount(e.target.value)}>
                                                <option value="">No account</option>
                                                {adAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes (optional)</label>
                                        <input className={inputCls} placeholder="What is this domain for?" value={regNotes} onChange={(e) => setRegNotes(e.target.value)} />
                                    </div>
                                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-500 dark:text-gray-400">
                                        <strong>Auto-setup will:</strong>
                                        <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                                            <li>Register domain on Namecheap</li>
                                            <li>Add zone to Cloudflare</li>
                                            <li>Set nameservers on Namecheap to Cloudflare</li>
                                        </ol>
                                        <p className="mt-1">Then add <code className="text-amber-600">landers.domain.com</code> in LanderLab to finish setup.</p>
                                    </div>
                                    {regStep && (
                                        <div className="flex items-center gap-2 text-sm text-amber-600">
                                            <Loader size={14} className="animate-spin" /> {regStep}
                                        </div>
                                    )}
                                    <button onClick={handleRegister} disabled={registering}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                                        {registering ? <Loader size={14} className="animate-spin" /> : <Globe size={14} />}
                                        {registering ? 'Registering...' : 'Register & Setup'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Domain Modal */}
            {editDomain && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit {editDomain.name}</h2>
                            <button onClick={() => setEditDomain(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={20} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Brand</label>
                                <select value={editBrand} onChange={(e) => setEditBrand(e.target.value)} className={inputCls}>
                                    <option value="">No brand</option>
                                    {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ad Account</label>
                                <select className={inputCls} value={editAccount} onChange={(e) => setEditAccount(e.target.value)}>
                                    <option value="">No account</option>
                                    {adAccounts.filter(a => !domains.some(dd => dd.ad_account_id === a.id && dd.id !== editDomain?.id)).map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Hosting Account</label>
                                <select className={inputCls} value={editHostingAccount} onChange={(e) => setEditHostingAccount(e.target.value)}>
                                    <option value="">No hosting</option>
                                    {hostingAccounts.map(h => <option key={h.id} value={h.id}>{h.name} ({h.ftp_host})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                                <input className={inputCls} placeholder="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                            </div>
                            <div className="flex gap-3 pt-1">
                                <button onClick={handleSaveEdit} disabled={saving}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                                    {saving ? <Loader size={14} className="animate-spin" /> : null} Save
                                </button>
                                <button onClick={() => setEditDomain(null)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
