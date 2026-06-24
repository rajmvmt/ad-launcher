import React, { useState } from 'react';
import {
    Play, Pause, Loader, ChevronDown, ChevronUp,
    MoreHorizontal, Pencil, Copy, Trash2, ShieldCheck,
    Image as ImageIcon, FolderOpen, Eye, ExternalLink, MessageSquare,
    DollarSign, Sun
} from 'lucide-react';
import { fmt, fmtMoney, fmtPct, fmtBudget, statusColor, statusLabel } from '../lib/campaignUtils';

export default function CampaignCard({
    item, level, isAdLevel,
    // Handlers
    onToggleStatus, onDrillDown, onStartEditing,
    onOpenEditCreative, onOpenPreview,
    onOpenEditCampaign, onOpenEditAdSet, onOpenBudgetSchedule, onOpenDaypart,
    onSafeAdConfirm, onSafeAd, onCancelSafeAd,
    onDuplicate, onOpenDuplicatePopover, onCancelDuplicate,
    onDelete, onConfirmDelete, onCancelDelete,
    onClone,
    onToggleSelection, onTagBrand,
    // Everflow conversion data for this item
    convData,
    // State from parent
    togglingId, selectedIds, brands, brandMap,
    safeAdConfirmId, safeAdLoadingId,
    duplicatePopoverId, duplicatingId, duplicateName, onDuplicateNameChange,
    confirmDeleteItem, deletingId,
    adAccounts,
    showSuccess,
}) {
    const [expanded, setExpanded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    const ins = item.insights || {};
    const effectiveStatus = item.effective_status || item.status;
    const name = item.name || item.campaign_name || item.adset_name || item.ad_name || item.id;
    const canDrillDown = level === 'campaigns' || level === 'adsets';
    const nextLevel = level === 'campaigns' ? 'adsets' : 'ads';
    const cd = item.creative_data || {};
    const thumbUrl = cd.image_url || cd.thumbnail_url;
    const budget = item.daily_budget
        ? `${fmtBudget(item.daily_budget)}/day`
        : item.lifetime_budget
            ? `${fmtBudget(item.lifetime_budget)} lifetime`
            : null;

    return (
        <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border ${selectedIds.has(item.id) ? 'border-amber-400 bg-amber-50/30 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700'} p-4`}>
            {/* Name (clickable for drill-down) */}
            <div className="mb-2">
                {canDrillDown ? (
                    <button onClick={() => onDrillDown(item, nextLevel)} className="font-semibold text-amber-700 dark:text-amber-400 text-left text-sm">
                        {name}
                    </button>
                ) : (
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{name}</span>
                )}
            </div>

            {/* Controls row: checkbox, status, actions on left — objective on right */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => onToggleSelection(item.id)}
                        className="w-4 h-4 text-amber-600 rounded"
                    />
                    {['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'].includes(effectiveStatus) ? (
                        <button
                            onClick={() => onToggleStatus(item)}
                            disabled={togglingId === item.id}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusColor(effectiveStatus)} hover:opacity-80 disabled:opacity-50`}
                        >
                            {togglingId === item.id ? <Loader size={10} className="animate-spin" />
                                : effectiveStatus === 'ACTIVE' ? <Play size={10} fill="currentColor" />
                                    : <Pause size={10} />}
                            {statusLabel(effectiveStatus)}
                        </button>
                    ) : (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusColor(effectiveStatus)}`}>
                            {statusLabel(effectiveStatus)}
                        </span>
                    )}
                    {/* Actions menu */}
                    <div className="relative">
                        <button onClick={() => setMenuOpen(!menuOpen)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                            <MoreHorizontal size={18} className="text-gray-500 dark:text-gray-400" />
                        </button>
                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1.5 w-44 z-30">
                                    <button
                                        onClick={() => { setMenuOpen(false); onStartEditing(item); }}
                                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    >
                                        <Pencil size={14} /> Rename
                                    </button>
                                    {level === 'campaigns' && onOpenEditCampaign && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onOpenEditCampaign(item); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                        >
                                            <Pencil size={14} /> Edit Campaign
                                        </button>
                                    )}
                                    {level === 'adsets' && onOpenEditAdSet && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onOpenEditAdSet(item); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                        >
                                            <Pencil size={14} /> Edit Ad Set
                                        </button>
                                    )}
                                    {(level === 'campaigns' || level === 'adsets') && onOpenBudgetSchedule && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onOpenBudgetSchedule(item, level === 'campaigns' ? 'campaign' : 'adset'); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                        >
                                            <DollarSign size={14} /> Scale
                                        </button>
                                    )}
                                    {(level === 'campaigns' || level === 'adsets') && onOpenDaypart && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onOpenDaypart(item); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                        >
                                            <Sun size={14} /> Daypart
                                        </button>
                                    )}
                                    {isAdLevel && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onOpenEditCreative(item); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                        >
                                            <ImageIcon size={14} /> Edit Creative
                                        </button>
                                    )}
                                    {isAdLevel && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onSafeAdConfirm(item.id); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                        >
                                            <ShieldCheck size={14} /> Safe Ad
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setMenuOpen(false); onOpenDuplicatePopover(item); }}
                                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    >
                                        <Copy size={14} /> Duplicate
                                    </button>
                                    {level === 'campaigns' && adAccounts?.length > 1 && (
                                        <button
                                            onClick={() => { setMenuOpen(false); onClone(item); }}
                                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                        >
                                            <FolderOpen size={14} /> Clone to Account
                                        </button>
                                    )}
                                    <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                                    <button
                                        onClick={() => { setMenuOpen(false); onConfirmDelete(item.id); }}
                                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    >
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {level === 'campaigns' && item.objective && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                        {item.objective.replace('OUTCOME_', '').replace(/_/g, ' ')}
                    </span>
                )}
            </div>

            {/* Thumbnail (ads only) */}
            {isAdLevel && thumbUrl && (
                <button onClick={() => onOpenPreview(item)} className="mb-3 w-full">
                    <img src={thumbUrl} alt="" className="w-full max-h-40 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                </button>
            )}

            {/* Key metrics row */}
            <div className="grid grid-cols-3 gap-2 text-center mb-2">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-medium">Spend</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtMoney(ins.spend)}</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-medium">Clicks</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(ins.clicks)}</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-medium">CPC</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtMoney(ins.cpc)}</div>
                </div>
            </div>

            {/* Expand toggle */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
            >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? 'Less' : 'More'}
            </button>

            {/* Expanded details */}
            {expanded && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-2">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Clicks</span><span className="dark:text-gray-200">{fmt(ins.clicks)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">CPC</span><span className="dark:text-gray-200">{fmtMoney(ins.cpc)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">CPM</span><span className="dark:text-gray-200">{fmtMoney(ins.cpm)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">CTR</span><span className="dark:text-gray-200">{fmtPct(ins.ctr)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Impressions</span><span className="dark:text-gray-200">{fmt(ins.impressions)}</span></div>
                        {budget && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Budget</span><span className="dark:text-gray-200">{budget}</span></div>}
                        {(() => {
                            // Ad level: use Facebook website purchases. Campaign/adset: use Everflow.
                            const conv = isAdLevel ? Number(ins.results || 0) : (convData?.conversions || 0);
                            return (
                                <>
                                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Conv.</span><span className="dark:text-gray-200">{conv > 0 ? fmt(conv) : '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">CPA</span><span className="dark:text-gray-200">{conv > 0 ? fmtMoney(Number(ins.spend || 0) / conv) : '—'}</span></div>
                                </>
                            );
                        })()}
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Revenue</span><span className="dark:text-gray-200">{(convData?.total_revenue || 0) > 0 ? fmtMoney(convData.total_revenue) : '—'}</span></div>
                        {(() => {
                            const evRev = convData?.total_revenue || 0;
                            const spend = Number(ins.spend || 0);
                            const profit = evRev - spend;
                            const hasData = evRev > 0 || spend > 0;
                            return (
                                <div className="flex justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">Profit</span>
                                    <span className={hasData ? (profit >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium') : ''}>
                                        {hasData ? fmtMoney(profit) : '—'}
                                    </span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Brand tag (campaigns only) */}
                    {level === 'campaigns' && (
                        <div className="flex items-center justify-between text-sm pt-1">
                            <span className="text-gray-500 dark:text-gray-400">Brand</span>
                            <select
                                value={brandMap[item.id] || ''}
                                onChange={(e) => onTagBrand(item, e.target.value || null)}
                                className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 dark:text-gray-200"
                            >
                                <option value="">—</option>
                                {brands.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Ads: headline, type, review */}
                    {isAdLevel && (
                        <div className="space-y-1 text-sm pt-1">
                            {cd.headline && (
                                <div><span className="text-gray-500 dark:text-gray-400">Headline: </span><span className="text-gray-700 dark:text-gray-300">{cd.headline}</span></div>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Type</span>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cd.is_video ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'}`}>
                                    {cd.is_video ? 'Video' : 'Image'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Review</span>
                                {effectiveStatus === 'DISAPPROVED' ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Rejected</span>
                                ) : effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'IN_PROCESS' ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Pending</span>
                                ) : effectiveStatus === 'WITH_ISSUES' ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">Issues</span>
                                ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Approved</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Ad post links */}
                    {isAdLevel && (cd.post_url || cd.story_id) && (
                        <div className="flex items-center gap-2 pt-2">
                            <button
                                onClick={() => {
                                    const url = cd.post_url || `https://www.facebook.com/${cd.story_id}`;
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                            >
                                <ExternalLink size={14} />
                                View Post
                            </button>
                            <a
                                href={`/comment-farm?post_id=${encodeURIComponent(cd.story_id || '')}&post_text=${encodeURIComponent(item.name || '')}&target_type=ad`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 dark:text-purple-300 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 rounded-lg transition-colors"
                            >
                                <MessageSquare size={14} />
                                Seed
                            </a>
                        </div>
                    )}

                    {/* ID */}
                    <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-gray-400 dark:text-gray-500">ID</span>
                        <span
                            className="text-gray-400 dark:text-gray-500 font-mono cursor-pointer hover:text-amber-600 dark:hover:text-amber-400"
                            onClick={() => { navigator.clipboard.writeText(item.id); showSuccess('ID copied'); }}
                        >
                            {item.id}
                        </span>
                    </div>
                    {isAdLevel && cd.story_id && (
                        <div className="flex items-center justify-between text-xs pt-1">
                            <span className="text-gray-400 dark:text-gray-500">Post ID</span>
                            <span
                                className="text-gray-400 dark:text-gray-500 font-mono cursor-pointer hover:text-amber-600 dark:hover:text-amber-400"
                                title="Click to copy — paste this into Use Existing Post"
                                onClick={() => { navigator.clipboard.writeText(cd.story_id); showSuccess('Post ID copied'); }}
                            >
                                {cd.story_id}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Inline confirmations */}
            {safeAdConfirmId === item.id && (
                <div className="mt-2 pt-2 border-t border-amber-100 dark:border-amber-800 flex items-center justify-between">
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Replace with safe ad?</span>
                    <div className="flex gap-1">
                        <button
                            onClick={() => onSafeAd(item)}
                            disabled={safeAdLoadingId === item.id}
                            className="px-3 py-1 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50"
                        >
                            {safeAdLoadingId === item.id ? <Loader size={12} className="animate-spin" /> : 'Yes'}
                        </button>
                        <button onClick={onCancelSafeAd} className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">No</button>
                    </div>
                </div>
            )}

            {confirmDeleteItem === item.id && (
                <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-800 flex items-center justify-between">
                    <span className="text-xs text-red-600 font-medium">Delete this {isAdLevel ? 'ad' : level === 'campaigns' ? 'campaign' : 'ad set'}?</span>
                    <div className="flex gap-1">
                        <button
                            onClick={() => onDelete(item)}
                            disabled={deletingId === item.id}
                            className="px-3 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                        >
                            {deletingId === item.id ? <Loader size={12} className="animate-spin" /> : 'Yes'}
                        </button>
                        <button onClick={onCancelDelete} className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">No</button>
                    </div>
                </div>
            )}

            {duplicatePopoverId === item.id && (
                <div className="mt-2 pt-2 border-t border-blue-100 dark:border-blue-800">
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Duplicate name</label>
                    <input
                        type="text"
                        value={duplicateName}
                        onChange={(e) => onDuplicateNameChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onDuplicate(item, null, duplicateName);
                            if (e.key === 'Escape') onCancelDuplicate();
                        }}
                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-2 bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={onCancelDuplicate} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                        <button onClick={() => onDuplicate(item, null, duplicateName)} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">Duplicate</button>
                    </div>
                </div>
            )}
        </div>
    );
}
