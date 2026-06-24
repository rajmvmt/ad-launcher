import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Plus, Trash2, Play, Power, AlertCircle, Loader, X, Save, Bookmark } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import {
    getBidSchedules,
    createBidSchedule,
    updateBidSchedule,
    deleteBidSchedule,
    runBidScheduleNow,
    getBidSchedulePresets,
    createBidSchedulePreset,
    deleteBidSchedulePreset,
    applyBidSchedulePreset,
} from '../lib/facebookApi';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const formatBid = (cents) => `$${(cents / 100).toFixed(2)}`;
const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
const formatDays = (days) => {
    if (!days || days.length === 7) return 'Every day';
    if (JSON.stringify([...days].sort()) === JSON.stringify([0, 1, 2, 3, 4])) return 'Weekdays';
    if (JSON.stringify([...days].sort()) === JSON.stringify([5, 6])) return 'Weekends';
    return days.map(d => DAY_SHORT[d]).join(', ');
};

/**
 * Manages recurring bid-cap rules for a single FB campaign or adset.
 * Each rule = "at HH:MM in <tz> on <days>, set bid to $X".
 * Only takes effect when the object's bid_strategy is capped
 * (LOWEST_COST_WITH_BID_CAP / COST_CAP / BID_CAP).
 *
 * Props:
 *   item: the FB object row (must have id; name is shown if present)
 *   objectType: 'campaign' | 'adset'
 *   connectionId: FB connection id (from selectedConnection.id)
 *   adAccountId: FB ad account id (from selectedAccount.id) — required to create rules
 *   onClose: () => void
 *   onCountChange?: (fbObjectId, count) => void  - notify parent of rule count for badge
 */
export default function BidScheduleModal({ item, objectType, connectionId, adAccountId, onClose, onCountChange }) {
    const { showSuccess, showError } = useToast();
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    // Add-new form
    const [form, setForm] = useState({
        hour: 6,
        minute: 0,
        bid_dollars: '2.50',
        timezone: 'America/New_York',
        active_days: [0, 1, 2, 3, 4, 5, 6],
        label: '',
    });

    // Stash latest callback in a ref so `load` doesn't re-create when the parent
    // passes a fresh inline arrow each render — that would re-fire the effect and
    // hammer the API in a loop (which the UI agent caught).
    const onCountChangeRef = useRef(onCountChange);
    useEffect(() => { onCountChangeRef.current = onCountChange; }, [onCountChange]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getBidSchedules({ fbObjectId: item.id });
            setRules(data);
            onCountChangeRef.current?.(item.id, data.length);
        } catch (e) {
            showError(`Failed to load schedules: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, [item.id, showError]);

    useEffect(() => { load(); }, [load]);

    // ── Presets ──────────────────────────────────────────────────────
    const [presets, setPresets] = useState([]);
    const [selectedPresetId, setSelectedPresetId] = useState('');
    const [replaceOnApply, setReplaceOnApply] = useState(false);
    const [savePresetOpen, setSavePresetOpen] = useState(false);
    const [savePresetName, setSavePresetName] = useState('');

    const loadPresets = useCallback(async () => {
        try {
            setPresets(await getBidSchedulePresets());
        } catch (e) {
            // non-fatal — empty list is fine
        }
    }, []);
    useEffect(() => { loadPresets(); }, [loadPresets]);

    const applyPreset = async () => {
        if (!selectedPresetId) return;
        if (!adAccountId || !connectionId) { showError('No ad account / connection selected'); return; }
        setBusy(true);
        try {
            const res = await applyBidSchedulePreset(selectedPresetId, {
                fb_object_id: item.id,
                object_type: objectType,
                ad_account_id: adAccountId,
                connection_id: connectionId,
                replace: replaceOnApply,
            });
            const created = res.created?.length || 0;
            const skipped = res.skipped_duplicates?.length || 0;
            const parts = [];
            if (created) parts.push(`${created} added`);
            if (skipped) parts.push(`${skipped} skipped (duplicate time)`);
            if (replaceOnApply) parts.unshift('replaced existing');
            showSuccess(`Preset applied: ${parts.join(', ') || 'no changes'}`);
            setSelectedPresetId('');
            await load();
        } catch (e) {
            showError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const saveAsPreset = async () => {
        const name = savePresetName.trim();
        if (!name) { showError('Name is required'); return; }
        if (rules.length === 0) { showError('No rules to save'); return; }
        setBusy(true);
        try {
            await createBidSchedulePreset({
                name,
                rules: rules.map(r => ({
                    hour: r.hour,
                    minute: r.minute || 0,
                    bid_amount_cents: r.bid_amount_cents,
                    active_days: r.active_days,
                    timezone: r.timezone,
                    label: r.label,
                })),
            });
            showSuccess(`Preset "${name}" saved`);
            setSavePresetOpen(false);
            setSavePresetName('');
            await loadPresets();
        } catch (e) {
            showError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const removePreset = async (preset) => {
        try {
            await deleteBidSchedulePreset(preset.id);
            showSuccess(`Deleted "${preset.name}"`);
            await loadPresets();
            if (selectedPresetId === preset.id) setSelectedPresetId('');
        } catch (e) {
            showError(e.message);
        }
    };

    const toggleDay = (d) => {
        setForm(f => ({
            ...f,
            active_days: f.active_days.includes(d)
                ? f.active_days.filter(x => x !== d)
                : [...f.active_days, d].sort(),
        }));
    };

    const addRule = async () => {
        const bidCents = Math.round(parseFloat(form.bid_dollars) * 100);
        if (!(bidCents > 0)) { showError('Bid must be > $0'); return; }
        if (form.active_days.length === 0) { showError('Pick at least one day'); return; }
        if (!adAccountId) { showError('No ad account selected'); return; }
        if (!connectionId) { showError('No FB connection selected'); return; }
        setBusy(true);
        try {
            await createBidSchedule({
                fb_object_id: item.id,
                object_type: objectType,
                ad_account_id: adAccountId,
                connection_id: connectionId,
                hour: +form.hour,
                minute: +form.minute || 0,
                bid_amount_cents: bidCents,
                active_days: form.active_days,
                timezone: form.timezone,
                label: form.label || null,
                enabled: true,
            });
            showSuccess('Rule added');
            setForm(f => ({ ...f, label: '' }));
            await load();
        } catch (e) {
            showError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const toggleRule = async (rule) => {
        const next = !rule.enabled;
        setRules(rows => rows.map(r => r.id === rule.id ? { ...r, enabled: next } : r));
        try {
            await updateBidSchedule(rule.id, { enabled: next });
            await load();
        } catch (e) {
            setRules(rows => rows.map(r => r.id === rule.id ? { ...r, enabled: rule.enabled } : r));
            showError(e.message);
        }
    };

    const runNow = async (rule) => {
        try {
            const res = await runBidScheduleNow(rule.id);
            const action = res.fb_result?.action;
            if (action === 'updated') showSuccess(`Applied ${formatBid(rule.bid_amount_cents)}`);
            else if (action === 'skipped_same') showSuccess('Already at this bid');
            else if (action === 'skipped_strategy') showError(`Skipped: ${res.fb_result?.bid_strategy} not capped`);
            await load();
        } catch (e) {
            showError(e.message);
            await load();
        }
    };

    const remove = async (rule) => {
        try {
            await deleteBidSchedule(rule.id);
            showSuccess('Rule deleted');
            await load();
        } catch (e) {
            showError(e.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-800 w-full md:max-w-xl md:rounded-xl shadow-xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Clock size={18} className="text-amber-500" /> Bid Cap Schedule
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>

                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    <div className="truncate">
                        <span className="uppercase font-semibold text-gray-600 dark:text-gray-300">{objectType}</span>
                        <span className="mx-2">·</span>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{item.name}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        Only fires on capped strategies (BID_CAP / COST_CAP / LOWEST_COST_WITH_BID_CAP). Other rules are skipped silently.
                    </div>
                </div>

                {/* Existing rules */}
                <div className="flex-1 overflow-y-auto">
                    <div className="px-5 py-3">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                            Active rules ({rules.length})
                        </div>
                        {loading ? (
                            <div className="text-center py-6 text-gray-400"><Loader size={16} className="animate-spin inline" /></div>
                        ) : rules.length === 0 ? (
                            <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                                No schedule rules yet
                            </div>
                        ) : (
                            <ul className="space-y-2">
                                {rules.sort((a, b) => (a.hour * 60 + (a.minute || 0)) - (b.hour * 60 + (b.minute || 0))).map(rule => (
                                    <li key={rule.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2 flex-wrap">
                                                <span className="font-mono font-semibold text-sm">{formatTime(rule.hour, rule.minute)}</span>
                                                <span className="text-xs text-gray-400">{rule.timezone.replace('America/', '')}</span>
                                                <span className="font-mono font-semibold text-sm text-green-700 dark:text-green-400">{formatBid(rule.bid_amount_cents)}</span>
                                                <span className="text-xs text-gray-500">{formatDays(rule.active_days)}</span>
                                                {rule.label && <span className="text-xs text-gray-400">· {rule.label}</span>}
                                            </div>
                                            {rule.last_error && (
                                                <div className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5 truncate">
                                                    <AlertCircle size={11} /> {rule.last_error.slice(0, 80)}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => toggleRule(rule)}
                                                title={rule.enabled ? 'Disable' : 'Enable'}
                                                aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                                                className={`p-1.5 rounded ${rule.enabled ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                                            >
                                                <Power size={14} />
                                            </button>
                                            <button
                                                onClick={() => runNow(rule)}
                                                title="Run now"
                                                aria-label="Run rule now"
                                                className="p-1.5 rounded text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                                            >
                                                <Play size={14} />
                                            </button>
                                            <button
                                                onClick={() => remove(rule)}
                                                title="Delete"
                                                aria-label="Delete rule"
                                                className="p-1.5 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Presets bar */}
                    <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-amber-50/40 dark:bg-amber-900/10">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                            <Bookmark size={12} /> Presets
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="flex-1 flex gap-2">
                                <select
                                    value={selectedPresetId}
                                    onChange={e => setSelectedPresetId(e.target.value)}
                                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                >
                                    <option value="">— pick a preset to apply —</option>
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} ({p.rule_count} rule{p.rule_count === 1 ? '' : 's'})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={applyPreset}
                                    disabled={!selectedPresetId || busy}
                                    className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-40 flex items-center gap-1"
                                >
                                    {busy ? <Loader size={12} className="animate-spin" /> : 'Apply'}
                                </button>
                            </div>
                            <button
                                onClick={() => { setSavePresetName(''); setSavePresetOpen(true); }}
                                disabled={rules.length === 0}
                                title={rules.length === 0 ? 'Add some rules first' : 'Save current rules as a preset'}
                                className="px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded disabled:opacity-40 flex items-center gap-1.5 justify-center"
                            >
                                <Save size={12} /> Save current as preset
                            </button>
                        </div>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <input
                                type="checkbox"
                                checked={replaceOnApply}
                                onChange={e => setReplaceOnApply(e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            Replace existing rules on apply (default: append + skip duplicates by time)
                        </label>
                        {selectedPresetId && (() => {
                            const p = presets.find(x => x.id === selectedPresetId);
                            if (!p) return null;
                            return (
                                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                                    <span className="truncate">
                                        Preview: {(p.rules || []).map(r =>
                                            `${String(r.hour).padStart(2, '0')}:${String(r.minute || 0).padStart(2, '0')} $${(r.bid_amount_cents / 100).toFixed(2)}`
                                        ).join(' · ')}
                                    </span>
                                    <button
                                        onClick={() => removePreset(p)}
                                        className="ml-2 text-red-500 hover:underline flex-shrink-0"
                                    >
                                        Delete preset
                                    </button>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Save preset inline modal */}
                    {savePresetOpen && (
                        <div className="px-5 py-3 border-t border-amber-200 dark:border-amber-800 bg-amber-100/40 dark:bg-amber-900/20">
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Save these {rules.length} rule{rules.length === 1 ? '' : 's'} as a preset
                            </div>
                            <div className="flex gap-2">
                                <input
                                    autoFocus
                                    value={savePresetName}
                                    onChange={e => setSavePresetName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveAsPreset(); if (e.key === 'Escape') setSavePresetOpen(false); }}
                                    placeholder="e.g. FSP-USA, FSP-CAN, peak/valley"
                                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                />
                                <button
                                    onClick={() => setSavePresetOpen(false)}
                                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={saveAsPreset}
                                    disabled={busy || !savePresetName.trim()}
                                    className="px-3 py-1.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-50"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Add new rule */}
                    <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Add new rule</div>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <div>
                                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Hour</label>
                                <select
                                    value={form.hour}
                                    onChange={e => setForm(f => ({ ...f, hour: +e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                >
                                    {Array.from({ length: 24 }, (_, i) => i).map(h => (
                                        <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Minute</label>
                                <select
                                    value={form.minute}
                                    onChange={e => setForm(f => ({ ...f, minute: +e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                >
                                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Bid ($)</label>
                                <input
                                    type="number" min="0.01" step="0.01"
                                    value={form.bid_dollars}
                                    onChange={e => setForm(f => ({ ...f, bid_dollars: e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                />
                            </div>
                        </div>
                        <div className="mb-3">
                            <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Days</label>
                            <div className="flex gap-1">
                                {DAY_SHORT.map((d, i) => {
                                    const active = form.active_days.includes(i);
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => toggleDay(i)}
                                            aria-label={d}
                                            aria-pressed={active}
                                            className={`flex-1 py-1.5 text-[11px] font-semibold rounded border-2 ${
                                                active
                                                    ? 'bg-green-500 border-green-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500'
                                            }`}
                                        >{d.slice(0, 1)}</button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Timezone</label>
                                <select
                                    value={form.timezone}
                                    onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                >
                                    <option value="America/New_York">Eastern (ET)</option>
                                    <option value="America/Chicago">Central (CT)</option>
                                    <option value="America/Denver">Mountain (MT)</option>
                                    <option value="America/Los_Angeles">Pacific (PT)</option>
                                    <option value="UTC">UTC</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Label (optional)</label>
                                <input
                                    value={form.label}
                                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                                    placeholder="peak hours"
                                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 dark:text-gray-200"
                                />
                            </div>
                        </div>
                        <button
                            onClick={addRule}
                            disabled={busy}
                            className="w-full py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {busy ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                            Add rule
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-end px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
