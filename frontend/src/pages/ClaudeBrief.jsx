import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Brain, Copy, Upload, X, Loader, FileText, ClipboardCheck, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts } from '../lib/facebookApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const RANGE_OPTIONS = [
    { value: '1d', label: 'Today' },
    { value: '7d', label: '7 Days' },
    { value: '14d', label: '14 Days' },
    { value: '30d', label: '30 Days' },
];

export default function ClaudeBrief() {
    const { authFetch } = useAuth();
    const { showSuccess, showError, showInfo } = useToast();

    // Connection & account
    const [connections, setConnections] = useState([]);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);

    // Brief settings
    const [range, setRange] = useState('1d');
    const [cpaTarget, setCpaTarget] = useState(() => {
        const saved = localStorage.getItem('claude_brief_cpa_target');
        return saved ? parseFloat(saved) : 30;
    });

    // State
    const [briefText, setBriefText] = useState('');
    const [clickflareText, setClickflareText] = useState('');
    const [loadingBrief, setLoadingBrief] = useState(false);
    const [loadingClickflare, setLoadingClickflare] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [dragOver, setDragOver] = useState(false);

    // Load connections
    useEffect(() => {
        (async () => {
            try {
                const conns = await getConnections();
                setConnections(conns);
                const def = conns.find(c => c.is_default) || conns[0];
                if (def) setSelectedConnection(def);
            } catch (e) { console.error('Failed to load connections:', e); }
        })();
    }, []);

    // Load accounts when connection changes
    useEffect(() => {
        if (!selectedConnection) return;
        (async () => {
            try {
                const accounts = await getAdAccounts(selectedConnection.id);
                setAdAccounts(accounts);
                const lastId = localStorage.getItem('claude_brief_last_account');
                const last = accounts.find(a => a.id === lastId);
                setSelectedAccount(last || accounts[0] || null);
            } catch (e) { console.error('Failed to load accounts:', e); }
        })();
    }, [selectedConnection]);

    // Save CPA target to localStorage
    useEffect(() => {
        localStorage.setItem('claude_brief_cpa_target', String(cpaTarget));
    }, [cpaTarget]);

    const getAuthHeaders = () => {
        const token = localStorage.getItem('accessToken');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    };

    // Fetch Meta brief
    const fetchBrief = useCallback(async () => {
        if (!selectedAccount) {
            showError('Select an ad account first');
            return;
        }
        setLoadingBrief(true);
        try {
            localStorage.setItem('claude_brief_last_account', selectedAccount.id);
            const params = new URLSearchParams({
                range,
                cpa_target: String(cpaTarget),
                account_id: selectedAccount.id,
            });
            if (selectedConnection?.id) {
                params.set('connection_id', selectedConnection.id);
            }
            const resp = await fetch(`${API_URL}/claude-brief?${params}`, {
                headers: getAuthHeaders(),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to generate brief');
            }
            const text = await resp.text();
            setBriefText(text);
            return text;
        } catch (e) {
            showError(e.message || 'Failed to generate brief');
            return null;
        } finally {
            setLoadingBrief(false);
        }
    }, [selectedAccount, selectedConnection, range, cpaTarget]);

    // Fallback copy using execCommand for when Clipboard API is unavailable
    const fallbackCopy = useCallback((text) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } catch {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }, []);

    // Copy brief to clipboard
    const copyBrief = useCallback(async () => {
        let text = briefText;
        if (!text) {
            text = await fetchBrief();
            if (!text) return;
        }
        try {
            await navigator.clipboard.writeText(text);
            showSuccess('Brief copied -- paste into Claude');
        } catch (e) {
            if (fallbackCopy(text)) {
                showSuccess('Brief copied -- paste into Claude');
            } else {
                showError('Failed to copy to clipboard');
            }
        }
    }, [briefText, fetchBrief, fallbackCopy]);

    // Preview brief
    const previewBrief = useCallback(async () => {
        let text = briefText;
        if (!text) {
            text = await fetchBrief();
            if (!text) return;
        }
        setPreviewContent(text);
        setPreviewTitle('Meta Campaign Brief');
        setShowPreview(true);
    }, [briefText, fetchBrief]);

    // Upload ClickFlare CSV
    const uploadClickflare = useCallback(async (file) => {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError('Only CSV files are accepted');
            return;
        }
        setLoadingClickflare(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch(`${API_URL}/parse-clickflare`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to parse CSV');
            }
            const text = await resp.text();
            setClickflareText(text);
            showSuccess('ClickFlare CSV parsed successfully');
        } catch (e) {
            showError(e.message || 'Failed to parse ClickFlare CSV');
        } finally {
            setLoadingClickflare(false);
        }
    }, []);

    // Copy ClickFlare brief
    const copyClickflare = useCallback(async () => {
        if (!clickflareText) return;
        try {
            await navigator.clipboard.writeText(clickflareText);
            showSuccess('ClickFlare brief copied -- paste into Claude');
        } catch (e) {
            if (fallbackCopy(clickflareText)) {
                showSuccess('ClickFlare brief copied -- paste into Claude');
            } else {
                showError('Failed to copy to clipboard');
            }
        }
    }, [clickflareText, fallbackCopy]);

    // Preview ClickFlare
    const previewClickflare = useCallback(() => {
        setPreviewContent(clickflareText);
        setPreviewTitle('ClickFlare Data Brief');
        setShowPreview(true);
    }, [clickflareText]);

    // Combined brief
    const combinedText = useMemo(() => {
        if (briefText && clickflareText) {
            return briefText + '\n\n\n' + clickflareText;
        }
        return '';
    }, [briefText, clickflareText]);

    const copyCombined = useCallback(async () => {
        if (!combinedText) return;
        try {
            await navigator.clipboard.writeText(combinedText);
            showSuccess('Combined brief copied -- paste into Claude');
        } catch (e) {
            if (fallbackCopy(combinedText)) {
                showSuccess('Combined brief copied -- paste into Claude');
            } else {
                showError('Failed to copy to clipboard');
            }
        }
    }, [combinedText, fallbackCopy]);

    // Drag and drop handlers
    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) uploadClickflare(file);
    };
    const handleFileInput = (e) => {
        const file = e.target.files[0];
        if (file) uploadClickflare(file);
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <Brain size={28} className="text-amber-600 sm:w-8 sm:h-8" />
                        Claude Brief
                    </h1>
                    <p className="text-gray-500 mt-1">Generate campaign briefs for Claude analysis</p>
                </div>
            </div>

            {/* Meta Brief Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Meta Campaign Brief</h2>

                {/* Controls */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-4">
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
                            onChange={(e) => setSelectedAccount(adAccounts.find(a => a.id === e.target.value))}
                            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                        >
                            {adAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name || a.id}</option>
                            ))}
                        </select>
                    )}

                    {/* Range selector */}
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                        {RANGE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => { setRange(opt.value); setBriefText(''); }}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${range === opt.value ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* CPA Target */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-500 whitespace-nowrap">CPA Target:</label>
                        <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={cpaTarget}
                                onChange={(e) => setCpaTarget(Math.max(1, parseFloat(e.target.value) || 1))}
                                className="w-20 pl-6 pr-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                            />
                        </div>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={copyBrief}
                        disabled={loadingBrief}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium text-sm transition-colors"
                    >
                        {loadingBrief ? <Loader size={16} className="animate-spin" /> : <Copy size={16} />}
                        Copy Claude Brief
                    </button>
                    <button
                        onClick={previewBrief}
                        disabled={loadingBrief}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 text-sm transition-colors"
                    >
                        <Eye size={16} />
                        Preview
                    </button>
                    {briefText && (
                        <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                            <ClipboardCheck size={14} />
                            Brief ready
                        </span>
                    )}
                </div>

                {/* Brief Output */}
                {briefText && (
                    <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 max-h-[400px] overflow-y-auto">
                        <pre className="text-sm text-gray-800 font-mono whitespace-pre-wrap leading-relaxed">{briefText}</pre>
                    </div>
                )}
            </div>

            {/* ClickFlare CSV Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Upload ClickFlare CSV</h2>

                {/* Drop zone */}
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                        dragOver ? 'border-amber-400 bg-amber-50' : 'border-gray-300 hover:border-gray-400'
                    }`}
                    onClick={() => document.getElementById('clickflare-file').click()}
                >
                    <input
                        id="clickflare-file"
                        type="file"
                        accept=".csv"
                        onChange={handleFileInput}
                        className="hidden"
                    />
                    {loadingClickflare ? (
                        <div className="flex flex-col items-center gap-2">
                            <Loader size={24} className="animate-spin text-amber-500" />
                            <p className="text-sm text-gray-500">Parsing CSV...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <Upload size={24} className="text-gray-400" />
                            <p className="text-sm text-gray-600">
                                <span className="font-medium text-amber-600">Click to upload</span> or drag and drop
                            </p>
                            <p className="text-xs text-gray-400">CSV files only</p>
                        </div>
                    )}
                </div>

                {/* ClickFlare actions */}
                {clickflareText && (
                    <div className="flex flex-wrap gap-3 mt-4">
                        <button
                            onClick={copyClickflare}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium transition-colors"
                        >
                            <Copy size={16} />
                            Copy ClickFlare Brief
                        </button>
                        <button
                            onClick={previewClickflare}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors"
                        >
                            <Eye size={16} />
                            Preview
                        </button>
                        <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                            <ClipboardCheck size={14} />
                            ClickFlare data ready
                        </span>
                    </div>
                )}
            </div>

            {/* Combined brief button */}
            {combinedText && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-6 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Combined Brief Ready</h3>
                            <p className="text-sm text-gray-500 mt-1">Meta + ClickFlare data merged into one paste</p>
                        </div>
                        <button
                            onClick={copyCombined}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium text-sm transition-colors"
                        >
                            <FileText size={16} />
                            Copy Combined Brief
                        </button>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {showPreview && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-200">
                            <h3 className="text-lg font-bold text-gray-900">{previewTitle}</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(previewContent);
                                            showSuccess('Copied to clipboard');
                                        } catch (e) {
                                            if (fallbackCopy(previewContent)) {
                                                showSuccess('Copied to clipboard');
                                            } else {
                                                showError('Failed to copy');
                                            }
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium transition-colors"
                                >
                                    <Copy size={14} />
                                    Copy
                                </button>
                                <button onClick={() => setShowPreview(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                        <div className="overflow-auto p-4 flex-1">
                            <pre className="text-sm text-gray-800 font-mono whitespace-pre-wrap leading-relaxed">{previewContent}</pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
