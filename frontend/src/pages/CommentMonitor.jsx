import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, ExternalLink, Eye, EyeOff, RefreshCw, Loader2, ChevronDown, ChevronRight, AlertTriangle, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
};

export default function CommentMonitor() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedAds, setExpandedAds] = useState(new Set());
    const [hidingComment, setHidingComment] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState('all'); // all, with_comments, questions

    const fetchComments = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_URL}/facebook/ad-comments`);
            if (!res.ok) throw new Error('Failed to fetch');
            const result = await res.json();
            setData(result);
            // Auto-expand ads that have comments
            const expanded = new Set();
            result.forEach(acct => {
                acct.ads.forEach(ad => {
                    if (ad.comments && ad.comments.length > 0) {
                        expanded.add(ad.ad_id);
                    }
                });
            });
            setExpandedAds(expanded);
        } catch (err) {
            showError(err.message || 'Failed to load comments');
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { fetchComments(); }, []);

    const toggleExpand = (adId) => {
        setExpandedAds(prev => {
            const next = new Set(prev);
            if (next.has(adId)) next.delete(adId);
            else next.add(adId);
            return next;
        });
    };

    const handleHide = async (commentId, isHidden) => {
        setHidingComment(commentId);
        try {
            const action = isHidden ? 'unhide' : 'hide';
            const res = await authFetch(`${API_URL}/facebook/comments/${commentId}/${action}`, { method: 'POST' });
            if (!res.ok) throw new Error(`Failed to ${action} comment`);
            showSuccess(`Comment ${isHidden ? 'unhidden' : 'hidden'}`);
            // Update local state
            setData(prev => prev.map(acct => ({
                ...acct,
                ads: acct.ads.map(ad => ({
                    ...ad,
                    comments: (ad.comments || []).map(c =>
                        c.id === commentId ? { ...c, is_hidden: !isHidden } :
                        { ...c, replies: (c.replies || []).map(r => r.id === commentId ? { ...r, is_hidden: !isHidden } : r) }
                    ),
                })),
            })));
        } catch (err) {
            showError(err.message);
        } finally {
            setHidingComment(null);
        }
    };

    // Stats
    const totalAds = data.reduce((s, a) => s + a.ads.length, 0);
    const totalComments = data.reduce((s, a) => s + a.ads.reduce((s2, ad) => {
        const comments = ad.comments || [];
        return s2 + comments.length + comments.reduce((s3, c) => s3 + (c.replies || []).length, 0);
    }, 0), 0);

    // Gather all comments flat for search/filter
    const allComments = [];
    data.forEach(acct => {
        acct.ads.forEach(ad => {
            (ad.comments || []).forEach(c => {
                allComments.push({ ...c, ad_name: ad.ad_name, account_name: acct.account_name, permalink: ad.permalink });
                (c.replies || []).forEach(r => {
                    allComments.push({ ...r, ad_name: ad.ad_name, account_name: acct.account_name, permalink: ad.permalink, is_reply: true });
                });
            });
        });
    });

    const isQuestion = (msg) => msg && (msg.includes('?') || /^(how|what|where|when|why|does|is|can|will|do)\b/i.test(msg));

    const filteredComments = allComments.filter(c => {
        if (searchQuery && !c.message?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (filterMode === 'questions' && !isQuestion(c.message)) return false;
        return true;
    });

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                        <MessageSquare size={28} className="text-amber-600" />
                        Comment Monitor
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        {totalAds} ads, {totalComments} comments across all accounts
                    </p>
                </div>
                <button
                    onClick={fetchComments}
                    disabled={loading}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {/* Search + Filter */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search comments..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-white"
                    />
                </div>
                <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {[
                        { value: 'all', label: 'All Comments' },
                        { value: 'questions', label: 'Questions Only' },
                    ].map(f => (
                        <button
                            key={f.value}
                            onClick={() => setFilterMode(f.value)}
                            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                                filterMode === f.value
                                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm font-medium'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={32} className="animate-spin text-amber-500" />
                    <span className="ml-3 text-gray-500">Loading ads and comments...</span>
                </div>
            )}

            {/* Filtered flat view when searching */}
            {(searchQuery || filterMode !== 'all') && !loading && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                        {filteredComments.length} {filterMode === 'questions' ? 'questions' : 'comments'} found
                    </h2>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                        {filteredComments.map((c, i) => (
                            <div key={c.id || i} className={`p-3 rounded-lg border ${c.is_hidden ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{c.from_name}</span>
                                            <span className="text-xs text-gray-400">{timeAgo(c.created_time)}</span>
                                            {c.is_reply && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">reply</span>}
                                            {c.is_hidden && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">hidden</span>}
                                        </div>
                                        <p className="text-sm text-gray-700 dark:text-gray-300">{c.message}</p>
                                        <p className="text-xs text-gray-400 mt-1">{c.account_name} — {c.ad_name}</p>
                                    </div>
                                    <button
                                        onClick={() => handleHide(c.id, c.is_hidden)}
                                        disabled={hidingComment === c.id}
                                        className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${c.is_hidden ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                        title={c.is_hidden ? 'Unhide' : 'Hide'}
                                    >
                                        {hidingComment === c.id ? <Loader2 size={14} className="animate-spin" /> : c.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Account-grouped view */}
            {!searchQuery && filterMode === 'all' && !loading && data.map(acct => (
                <div key={acct.account_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{acct.account_name}</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {acct.ads.length} ads, {acct.ads.reduce((s, ad) => s + (ad.comments || []).length, 0)} comments
                        </p>
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {acct.ads.map(ad => {
                            const comments = ad.comments || [];
                            const isExpanded = expandedAds.has(ad.ad_id);

                            return (
                                <div key={ad.ad_id}>
                                    {/* Ad row */}
                                    <div
                                        className="px-6 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                                        onClick={() => comments.length > 0 && toggleExpand(ad.ad_id)}
                                    >
                                        {comments.length > 0 ? (
                                            isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />
                                        ) : (
                                            <span className="w-4" />
                                        )}
                                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ad.status === 'ACTIVE' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                                        <span className="text-sm text-gray-900 dark:text-white flex-1 truncate">{ad.ad_name}</span>
                                        {comments.length > 0 && (
                                            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                                                {comments.length} comment{comments.length !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                        {ad.permalink && (
                                            <a
                                                href={ad.permalink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-blue-500 hover:text-blue-700 p-1"
                                                title="View on Facebook"
                                            >
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                    </div>

                                    {/* Comments */}
                                    {isExpanded && comments.length > 0 && (
                                        <div className="px-6 pb-4 pl-14 space-y-2">
                                            {comments.map(c => (
                                                <div key={c.id}>
                                                    <div className={`p-3 rounded-lg border ${c.is_hidden ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 opacity-60' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2 mb-0.5">
                                                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{c.from_name}</span>
                                                                    <span className="text-xs text-gray-400">{timeAgo(c.created_time)}</span>
                                                                    {c.is_hidden && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">hidden</span>}
                                                                    {isQuestion(c.message) && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">question</span>}
                                                                </div>
                                                                <p className="text-sm text-gray-700 dark:text-gray-300">{c.message}</p>
                                                            </div>
                                                            <button
                                                                onClick={() => handleHide(c.id, c.is_hidden)}
                                                                disabled={hidingComment === c.id}
                                                                className={`p-1.5 rounded-lg transition-colors ${c.is_hidden ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                                                title={c.is_hidden ? 'Unhide' : 'Hide'}
                                                            >
                                                                {hidingComment === c.id ? <Loader2 size={14} className="animate-spin" /> : c.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {/* Replies */}
                                                    {(c.replies || []).length > 0 && (
                                                        <div className="ml-6 mt-1 space-y-1">
                                                            {c.replies.map(r => (
                                                                <div key={r.id} className={`p-2.5 rounded-lg border ${r.is_hidden ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 opacity-60' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-600'}`}>
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div className="flex-1">
                                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{r.from_name}</span>
                                                                                <span className="text-xs text-gray-400">{timeAgo(r.created_time)}</span>
                                                                                {r.is_hidden && <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">hidden</span>}
                                                                            </div>
                                                                            <p className="text-xs text-gray-600 dark:text-gray-400">{r.message}</p>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => handleHide(r.id, r.is_hidden)}
                                                                            disabled={hidingComment === r.id}
                                                                            className={`p-1 rounded transition-colors ${r.is_hidden ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                                                        >
                                                                            {hidingComment === r.id ? <Loader2 size={12} className="animate-spin" /> : r.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
