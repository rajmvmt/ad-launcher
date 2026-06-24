import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Plus, Trash2, ExternalLink, Copy, Check, RefreshCw, Activity, Eye, EyeOff, Code, ChevronDown, ChevronUp, Loader2, AlertTriangle, Pencil, Save, X, RotateCw, FileText, Lock, Unlock, Settings, Globe, Smartphone, Database, Search, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-red-100 text-red-700',
};

// ── ISP Type codes ───────────────────────────────────────────────────────────
const ISP_TYPES = [
  { code: 'DCH', label: 'Data Center / Hosting' },
  { code: 'SES', label: 'Search Engine Spider' },
  { code: 'COM', label: 'Commercial' },
  { code: 'GOV', label: 'Government' },
  { code: 'CDN', label: 'CDN' },
  { code: 'RSV', label: 'Reserved' },
];

// ── Cloaking Rules Panel (shared between Create & Edit) ─────────────────────
const RulesPanel = ({ rules, onChange, authFetch, showError }) => {
  const [expanded, setExpanded] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationResults, setLocationResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const toggle = (key) => onChange({ ...rules, [key]: !rules[key] });
  const toggleNested = (parent, key) => {
    const p = typeof rules[parent] === 'object' ? rules[parent] : {};
    onChange({ ...rules, [parent]: { ...p, [key]: !p[key] } });
  };
  const setNestedList = (parent, key, list) => {
    const p = typeof rules[parent] === 'object' ? rules[parent] : {};
    onChange({ ...rules, [parent]: { ...p, [key]: list } });
  };

  const handleLocationSearch = async () => {
    if (!locationSearch.trim()) return;
    setSearching(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/find-location/${encodeURIComponent(locationSearch)}`);
      if (res.ok) setLocationResults(await res.json());
    } catch { /* ignore */ }
    setSearching(false);
  };

  const addAllowCountry = (code) => {
    const loc = typeof rules.location === 'object' ? rules.location : {};
    const allow = [...(loc.allow_countries || [])];
    if (!allow.includes(code)) allow.push(code);
    onChange({ ...rules, location: { ...loc, enabled: true, allow_countries: allow } });
  };

  const removeAllowCountry = (code) => {
    const loc = typeof rules.location === 'object' ? rules.location : {};
    const allow = (loc.allow_countries || []).filter(c => c !== code);
    onChange({ ...rules, location: { ...loc, allow_countries: allow } });
  };

  const RuleToggle = ({ label, checked, onToggle, desc }) => (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input type="checkbox" checked={checked || false} onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
      <div>
        <span className="text-sm font-medium text-gray-700 group-hover:text-amber-700">{label}</span>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
    </label>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Settings size={14} /> Cloaking Rules
          <span className="text-xs font-normal text-gray-400">(smart defaults pre-selected)</span>
        </span>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-white">
          {/* Protection toggles — 2 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RuleToggle label="Proxy Detection" checked={rules.proxy_detection}
              onToggle={() => toggle('proxy_detection')} desc="Detect proxy/VPN usage" />
            <RuleToggle label="Sticky Cloaking" checked={rules.sticky_cloaking}
              onToggle={() => toggle('sticky_cloaking')} desc="Remember bot decisions per visitor" />
            <RuleToggle label="Timezone Discrepancy" checked={rules.timezone_discrepancy}
              onToggle={() => toggle('timezone_discrepancy')} desc="Cloak if browser TZ doesn't match IP" />
            <RuleToggle label="Cloak Uncommon ISPs" checked={rules.cloak_uncommon_isps}
              onToggle={() => toggle('cloak_uncommon_isps')} desc="Block traffic from unusual ISPs" />
            <RuleToggle label="Cloak Blacklisted PTRs" checked={rules.cloak_blacklisted_ptrs}
              onToggle={() => toggle('cloak_blacklisted_ptrs')} desc="Block known bad PTR records" />
            <RuleToggle label="Pass Query Strings" checked={rules.pass_full_query_strings}
              onToggle={() => toggle('pass_full_query_strings')} desc="Forward FB macros to money page" />
            <RuleToggle label="Headless Browser Detection"
              checked={rules.feature_tests?.enabled || rules.feature_tests?.headless_browser}
              onToggle={() => onChange({ ...rules, feature_tests: { enabled: !(rules.feature_tests?.enabled), headless_browser: !(rules.feature_tests?.enabled) } })}
              desc="Detect Puppeteer/Selenium/Playwright" />
            <RuleToggle label="Browser Switching" checked={rules.browser_switching?.enabled}
              onToggle={() => {
                const bs = typeof rules.browser_switching === 'object' ? rules.browser_switching : {};
                onChange({ ...rules, browser_switching: { ...bs, enabled: !bs.enabled, threshold: bs.threshold || 60 } });
              }}
              desc="Detect users switching browsers rapidly" />
          </div>

          {/* ISP Type Filtering */}
          <div className="border-t pt-3">
            <RuleToggle label="ISP Type Filtering" checked={rules.isp_type?.enabled}
              onToggle={() => {
                const isp = typeof rules.isp_type === 'object' ? rules.isp_type : {};
                onChange({ ...rules, isp_type: { ...isp, enabled: !isp.enabled, disallow: isp.disallow || ['DCH', 'SES'] } });
              }}
              desc="Block traffic by ISP type" />
            {rules.isp_type?.enabled && (
              <div className="ml-6 mt-2 flex flex-wrap gap-2">
                {ISP_TYPES.map(t => {
                  const active = (rules.isp_type?.disallow || []).includes(t.code);
                  return (
                    <button key={t.code} type="button"
                      onClick={() => {
                        const list = rules.isp_type?.disallow || [];
                        setNestedList('isp_type', 'disallow', active ? list.filter(c => c !== t.code) : [...list, t.code]);
                      }}
                      className={`px-2 py-1 text-xs rounded-md border transition-colors ${active ? 'bg-red-100 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300'}`}>
                      {active ? 'Block' : ''} {t.label} ({t.code})
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Global Databases */}
          <div className="border-t pt-3">
            <RuleToggle label="Global Bot Databases" checked={rules.global_databases?.enabled}
              onToggle={() => {
                const gdb = typeof rules.global_databases === 'object' ? rules.global_databases : {};
                onChange({ ...rules, global_databases: { ...gdb, enabled: !gdb.enabled, filter_assoc_cities: true } });
              }}
              desc="Use Traffic Armor's shared bot database" />
          </div>

          {/* Location Filtering */}
          <div className="border-t pt-3">
            <RuleToggle label="Geo-Location Filtering" checked={rules.location?.enabled}
              onToggle={() => {
                const loc = typeof rules.location === 'object' ? rules.location : {};
                onChange({ ...rules, location: { ...loc, enabled: !loc.enabled, allow_countries: loc.allow_countries || [], block_countries: loc.block_countries || [] } });
              }}
              desc="Only allow traffic from specific countries (applied to CF Worker)" />
            {rules.location?.enabled && (
              <div className="ml-6 mt-2 space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={locationSearch} onChange={e => setLocationSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLocationSearch())}
                    placeholder="Search country (e.g. United States, US)..."
                    className="flex-1 p-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-amber-500" />
                  <button type="button" onClick={handleLocationSearch} disabled={searching}
                    className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 flex items-center gap-1">
                    {searching ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Search
                  </button>
                </div>
                {locationResults.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(locationResults) ? locationResults : locationResults.data || []).slice(0, 20).map((loc, i) => (
                      <button key={i} type="button" onClick={() => addAllowCountry(loc.code || loc.iso_code || loc.name)}
                        className="px-2 py-0.5 text-xs bg-green-50 border border-green-200 rounded hover:bg-green-100 text-green-700">
                        + {loc.name || loc.label} ({loc.code || loc.iso_code || ''})
                      </button>
                    ))}
                  </div>
                )}
                {(rules.location?.allow_countries || []).length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500">Allowed countries:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rules.location.allow_countries.map(c => (
                        <span key={c} className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                          {c} <button type="button" onClick={() => removeAllowCountry(c)} className="hover:text-red-500"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Visit limits */}
          <div className="border-t pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RuleToggle label="Maximum Visits" checked={rules.maximum_visits?.enabled}
              onToggle={() => {
                const mv = typeof rules.maximum_visits === 'object' ? rules.maximum_visits : {};
                onChange({ ...rules, maximum_visits: { enabled: !mv.enabled, by_ip: true, by_cookie: true } });
              }}
              desc="Limit repeat visits per user (by IP + cookie)" />
            <RuleToggle label="Cross-Campaign Visits" checked={rules.cross_campaign_visits?.enabled}
              onToggle={() => {
                const ccv = typeof rules.cross_campaign_visits === 'object' ? rules.cross_campaign_visits : {};
                onChange({ ...rules, cross_campaign_visits: { enabled: !ccv.enabled, by_ip: true, by_cookie: true } });
              }}
              desc="Track visitors across all your campaigns" />
          </div>

          {/* FB-specific rules (TA recommended) */}
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-amber-600 mb-2">Facebook-Specific Filters</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RuleToggle label="Spoofed Devices" checked={rules.spoofed_devices?.enabled}
                onToggle={() => {
                  const sd = typeof rules.spoofed_devices === 'object' ? rules.spoofed_devices : {};
                  onChange({ ...rules, spoofed_devices: { ...sd, enabled: !sd.enabled } });
                }}
                desc="Detect spoofed device fingerprints" />
              <RuleToggle label="Browser Language Mismatch" checked={rules.browser_language?.enabled}
                onToggle={() => {
                  const bl = typeof rules.browser_language === 'object' ? rules.browser_language : {};
                  onChange({ ...rules, browser_language: { ...bl, enabled: !bl.enabled } });
                }}
                desc="Cloak if browser language doesn't match GEO" />
              <RuleToggle label="Uncommon Browsers" checked={rules.uncommon_browsers?.enabled}
                onToggle={() => {
                  const ub = typeof rules.uncommon_browsers === 'object' ? rules.uncommon_browsers : {};
                  onChange({ ...rules, uncommon_browsers: { ...ub, enabled: !ub.enabled } });
                }}
                desc="Filter rare/uncommon browser agents" />
              <RuleToggle label="Outdated Browsers" checked={rules.outdated_browsers?.enabled}
                onToggle={() => {
                  const ob = typeof rules.outdated_browsers === 'object' ? rules.outdated_browsers : {};
                  onChange({ ...rules, outdated_browsers: { ...ob, enabled: !ob.enabled, versions: 2 } });
                }}
                desc="Block browsers >2 versions behind" />
              <RuleToggle label="Require fbclid" checked={rules.url_contains?.enabled}
                onToggle={() => {
                  const uc = typeof rules.url_contains === 'object' ? rules.url_contains : {};
                  onChange({ ...rules, url_contains: { ...uc, enabled: !uc.enabled, require: 'fbclid', filter_blank_subids: true } });
                }}
                desc="Only allow URLs containing fbclid parameter" />
              <RuleToggle label="Block Duplicate URLs" checked={rules.block_duplicate_urls}
                onToggle={() => onChange({ ...rules, block_duplicate_urls: !rules.block_duplicate_urls })}
                desc="Block duplicate fbclid values" />
              <RuleToggle label="Traffic Pattern" checked={rules.traffic_pattern?.enabled}
                onToggle={() => {
                  const tp = typeof rules.traffic_pattern === 'object' ? rules.traffic_pattern : {};
                  onChange({ ...rules, traffic_pattern: { enabled: !tp.enabled, google: false } });
                }}
                desc="Analyze visitor traffic patterns" />
              <RuleToggle label="Touch Devices Only" checked={rules.touch_devices?.enabled}
                onToggle={() => {
                  const td = typeof rules.touch_devices === 'object' ? rules.touch_devices : {};
                  onChange({ ...rules, touch_devices: { ...td, enabled: !td.enabled } });
                }}
                desc="Mobile-only campaigns (filter non-touch)" />
            </div>
          </div>

          {/* JS Tests & Data Gathering */}
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">JS Fingerprint Tests</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RuleToggle label="JS Tests (hardwareConcurrency, deviceMemory, etc.)" checked={rules.js_tests?.enabled}
                onToggle={() => {
                  const jt = typeof rules.js_tests === 'object' ? rules.js_tests : {};
                  onChange({ ...rules, js_tests: { ...jt, enabled: !jt.enabled, hardware_concurrency_max: 8, device_memory_max: 16, cookie_enabled: true, webdriver_disallow: true, history_length_max: 1 } });
                }}
                desc="hardwareConcurrency<=8, deviceMemory<=16, cookieEnabled, webdriver=0, historyLength=1" />
              <RuleToggle label="Data Gathering (Fingerprint)" checked={rules.data_gathering?.screen_resolution}
                onToggle={() => {
                  const all = !rules.data_gathering?.screen_resolution;
                  onChange({ ...rules, data_gathering: { screen_resolution: all, fonts: all, webgl: all, canvas: all } });
                }}
                desc="Collect: Screen Resolution, Fonts, WebGL, Canvas" />
            </div>
          </div>

          {/* Google-specific (usually off for FB) */}
          <div className="border-t pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RuleToggle label="Google Click ID Validation" checked={rules.google_click_id?.enabled}
              onToggle={() => {
                const gci = typeof rules.google_click_id === 'object' ? rules.google_click_id : {};
                onChange({ ...rules, google_click_id: { enabled: !gci.enabled, valid: true } });
              }}
              desc="Validate GCLID (Google Ads only)" />
          </div>
        </div>
      )}
    </div>
  );
};

const CopyText = ({ label, value, color = 'text-gray-700' }) => {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handleCopy = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(value); } catch {
      const ta = document.createElement('textarea'); ta.value = value;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs group hover:bg-gray-50 rounded px-1.5 py-0.5 -ml-1.5 transition-colors" title="Click to copy">
      <span className="text-gray-400 w-20 shrink-0">{label}:</span>
      <span className={`font-medium ${color}`}>{value}</span>
      {copied
        ? <Check size={10} className="text-green-500 shrink-0" />
        : <Copy size={10} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
      }
    </button>
  );
};

const CopyButton = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const ta = document.createElement('textarea'); ta.value = value;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 transition-colors ${copied ? 'bg-green-100 text-green-700' : 'bg-amber-200 text-amber-800 hover:bg-amber-300'}`}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

// ── Lists Management Panel ──────────────────────────────────────────────────
const ListsPanel = ({ authFetch, showSuccess, showError }) => {
  const [userLists, setUserLists] = useState([]);
  const [globalLists, setGlobalLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingList, setEditingList] = useState(null);  // { type, id, label, content }
  const [saving, setSaving] = useState(false);
  const [newList, setNewList] = useState({ type: 'ip', label: '', content: '' });
  const [expandedList, setExpandedList] = useState(null); // "user-type-id" or "global-id"
  const [listDetail, setListDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const LIST_TYPES = [
    { value: 'ip', label: 'IP Addresses' },
    { value: 'ua', label: 'User Agents' },
    { value: 'referrer', label: 'Referrers' },
    { value: 'isp', label: 'ISP / ORG' },
  ];

  const loadLists = async () => {
    setLoading(true);
    try {
      const [userRes, globalRes] = await Promise.all([
        authFetch(`${API_URL}/traffic-armor/ta/lists`).then(r => r.ok ? r.json() : []),
        authFetch(`${API_URL}/traffic-armor/ta/lists/global-db`).then(r => r.ok ? r.json() : []),
      ]);
      setUserLists(Array.isArray(userRes) ? userRes : userRes?.data || userRes?.lists || []);
      setGlobalLists(Array.isArray(globalRes) ? globalRes : globalRes?.data || globalRes?.lists || []);
    } catch {
      showError('Failed to load lists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLists(); }, []);

  const handleCreate = async () => {
    if (!newList.label.trim() || !newList.content.trim()) {
      showError('Label and content are required');
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/lists/${newList.type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newList.label, content: newList.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create list');
      showSuccess(`List "${newList.label}" created`);
      setShowCreate(false);
      setNewList({ type: 'ip', label: '', content: '' });
      await loadLists();
    } catch (err) {
      showError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingList) return;
    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/lists/${editingList.type}/${editingList.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editingList.label, content: editingList.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update list');
      showSuccess(`List "${editingList.label}" updated`);
      setEditingList(null);
      await loadLists();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleViewDetail = async (listType, listId, key) => {
    if (expandedList === key) {
      setExpandedList(null);
      setListDetail(null);
      return;
    }
    setExpandedList(key);
    setLoadingDetail(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/lists/${listType}/${listId}`);
      if (res.ok) setListDetail(await res.json());
    } catch { /* ignore */ }
    setLoadingDetail(false);
  };

  const handleStartEdit = (list, type) => {
    const content = listDetail?.content || listDetail?.data?.content || '';
    setEditingList({
      type: type || list.type || 'ip',
      id: list.id,
      label: list.label || list.name || '',
      content: typeof content === 'string' ? content : (Array.isArray(content) ? content.join('\n') : ''),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={24} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  const renderListCard = (list, idx, isGlobal = false, listType = null) => {
    const key = `${isGlobal ? 'global' : 'user'}-${listType || list.type}-${list.id || idx}`;
    const isExpanded = expandedList === key;
    return (
      <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 truncate">{list.label || list.name || `List #${list.id}`}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${isGlobal ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {isGlobal ? 'Global' : (listType || list.type || 'custom').toUpperCase()}
              </span>
              {list.count !== undefined && (
                <span className="text-xs text-gray-400">{list.count} entries</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => handleViewDetail(listType || list.type || 'ip', list.id, key)}
              className={`p-1.5 rounded transition-colors ${isExpanded ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'}`}
              title="View contents">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {!isGlobal && (
              <button onClick={() => {
                if (!isExpanded) handleViewDetail(listType || list.type || 'ip', list.id, key);
                setTimeout(() => handleStartEdit(list, listType), isExpanded ? 0 : 500);
              }}
                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors" title="Edit">
                <Pencil size={14} />
              </button>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : listDetail ? (
              <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono bg-white rounded p-3 border border-gray-200">
                {typeof listDetail === 'string' ? listDetail
                  : listDetail.content || listDetail.data?.content
                  || JSON.stringify(listDetail.data || listDetail, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-gray-400">No content available</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Database size={18} className="text-amber-500" />
            Blocklists & Databases
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">Manage IP, user agent, referrer, and ISP blocklists on Traffic Armor</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium flex items-center gap-1.5">
          <Plus size={14} /> New List
        </button>
      </div>

      {/* Create List Form */}
      {showCreate && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">Create New List</h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Type</label>
              <select value={newList.type} onChange={e => setNewList(f => ({ ...f, type: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-500">
                {LIST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Label</label>
              <input type="text" value={newList.label} onChange={e => setNewList(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Known bot IPs, Suspicious user agents..."
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Content <span className="text-gray-400 font-normal">(one entry per line)</span>
            </label>
            <textarea value={newList.content} onChange={e => setNewList(f => ({ ...f, content: e.target.value }))}
              rows={6} placeholder={newList.type === 'ip' ? '192.168.1.1\n10.0.0.0/24\n...' : newList.type === 'ua' ? 'SomeBot/1.0\nBadCrawler\n...' : 'one entry per line...'}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500" />
            <p className="text-xs text-gray-400 mt-1">
              {newList.content.split('\n').filter(l => l.trim()).length} entries
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {creating ? 'Creating...' : 'Create List'}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Edit List Modal */}
      {editingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setEditingList(null)}>
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-lg w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Edit List</h4>
              <button onClick={() => setEditingList(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Label</label>
              <input type="text" value={editingList.label} onChange={e => setEditingList(f => ({ ...f, label: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                Content <span className="text-gray-400 font-normal">(one entry per line)</span>
              </label>
              <textarea value={editingList.content} onChange={e => setEditingList(f => ({ ...f, content: e.target.value }))}
                rows={10}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500" />
              <p className="text-xs text-gray-400 mt-1">
                {editingList.content.split('\n').filter(l => l.trim()).length} entries
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingList(null)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Your Lists */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <List size={14} /> Your Lists
        </h4>
        {userLists.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">No custom lists yet</p>
            <p className="text-xs text-gray-400 mt-1">Create IP, user agent, or referrer blocklists to use in your cloaking rules</p>
          </div>
        ) : (
          <div className="space-y-2">
            {userLists.map((list, i) => renderListCard(list, i, false))}
          </div>
        )}
      </div>

      {/* Global Databases */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Globe size={14} /> Global Bot Databases
          <span className="text-xs font-normal text-gray-400">(shared across all Traffic Armor users — read-only)</span>
        </h4>
        {globalLists.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">No global databases available</p>
          </div>
        ) : (
          <div className="space-y-2">
            {globalLists.map((list, i) => renderListCard(list, i, true, 'global_db'))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Click Log Panel ─────────────────────────────────────────────────────────
const ClickLogPanel = ({ authFetch, showError, campaigns }) => {
  const [clicks, setClicks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ campaign: '', cloak_reason: '', ip_address: '', page: 1 });
  const [expanded, setExpanded] = useState(null);

  const loadClicks = async (overrides = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const merged = { ...filters, ...overrides };
      for (const [k, v] of Object.entries(merged)) {
        if (v !== '' && v !== null && v !== undefined) params.set(k, v);
      }
      const res = await authFetch(`${API_URL}/traffic-armor/ta/clicks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setClicks(data?.data || []);
      } else {
        showError('Failed to load click logs');
      }
    } catch { showError('Failed to load click logs'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadClicks(); }, []);

  const REASON_LABELS = {
    'deadbolt': 'Deadbolt',
    'proxy': 'Proxy/VPN',
    'datacenter': 'Data Center IP',
    'bot': 'Bot Detected',
    'headless': 'Headless Browser',
    'spoofed': 'Spoofed Device',
    'timezone': 'Timezone Mismatch',
    'location': 'Location Blocked',
    'isp': 'ISP Blocked',
    'duplicate': 'Duplicate Visit',
    'browser_switching': 'Browser Switching',
    'max_visits': 'Max Visits Exceeded',
    'language': 'Language Mismatch',
    'outdated_browser': 'Outdated Browser',
    'uncommon_browser': 'Uncommon Browser',
    'url_filter': 'URL Filter (no fbclid)',
    'js_test': 'JS Test Failed',
    'global_db': 'Global Database Match',
    'traffic_pattern': 'Traffic Pattern',
  };

  const reasonColor = (reason) => {
    if (!reason || reason === 'allowed') return 'bg-green-100 text-green-700';
    if (reason.includes('deadbolt')) return 'bg-red-100 text-red-700';
    if (reason.includes('proxy') || reason.includes('datacenter') || reason.includes('vpn')) return 'bg-purple-100 text-purple-700';
    if (reason.includes('bot') || reason.includes('headless')) return 'bg-orange-100 text-orange-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Campaign</label>
            <select
              value={filters.campaign}
              onChange={e => setFilters(f => ({ ...f, campaign: e.target.value }))}
              className="p-2 border border-gray-300 rounded-lg text-sm bg-white min-w-[200px]"
            >
              <option value="">All campaigns</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.ta_campaign_number}>
                  {c.name} (#{c.ta_campaign_number})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Filter Reason</label>
            <input
              type="text"
              placeholder="e.g. proxy, bot, deadbolt..."
              value={filters.cloak_reason}
              onChange={e => setFilters(f => ({ ...f, cloak_reason: e.target.value }))}
              className="p-2 border border-gray-300 rounded-lg text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">IP Address</label>
            <input
              type="text"
              placeholder="e.g. 192.168.1.1"
              value={filters.ip_address}
              onChange={e => setFilters(f => ({ ...f, ip_address: e.target.value }))}
              className="p-2 border border-gray-300 rounded-lg text-sm w-40"
            />
          </div>
          <button
            onClick={() => loadClicks()}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
          <button
            onClick={() => { setFilters({ campaign: '', cloak_reason: '', ip_address: '', page: 1 }); loadClicks({ campaign: '', cloak_reason: '', ip_address: '', page: 1 }); }}
            className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 size={24} className="animate-spin text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Loading click logs...</p>
          </div>
        ) : !Array.isArray(clicks) || clicks.length === 0 ? (
          <div className="p-12 text-center">
            <Activity size={24} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No clicks recorded yet</p>
            <p className="text-xs text-gray-400 mt-1">Clicks will appear here once traffic hits your cloaked domains</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">IP</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Device</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Campaign</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {clicks.map((click, i) => (
                  <React.Fragment key={click.id || i}>
                    <tr
                      className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${expanded === i ? 'bg-gray-50' : ''}`}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                        {click.created_at ? new Date(click.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          click.allowed === '1' || click.allowed === true
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {click.allowed === '1' || click.allowed === true ? 'Allowed' : 'Blocked'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {click.cloak_reason ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${reasonColor(click.cloak_reason)}`}>
                            {REASON_LABELS[click.cloak_reason] || click.cloak_reason}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{click.ip_address || click.ip || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{click.device || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{click.location_label || click.country || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{click.campaign_label || click.campaign || '—'}</td>
                      <td className="px-4 py-1">
                        <ChevronDown size={14} className={`text-gray-400 transition-transform ${expanded === i ? 'rotate-180' : ''}`} />
                      </td>
                    </tr>
                    {expanded === i && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                            {click.visitor_id && <div><span className="font-medium text-gray-500">Visitor ID:</span> <span className="font-mono">{click.visitor_id}</span></div>}
                            {click.user_agent && <div className="col-span-2"><span className="font-medium text-gray-500">User Agent:</span> <span className="font-mono text-gray-600 break-all">{click.user_agent}</span></div>}
                            {click.referrer && <div className="col-span-2"><span className="font-medium text-gray-500">Referrer:</span> <span className="font-mono text-gray-600 break-all">{click.referrer}</span></div>}
                            {click.isp_name && <div><span className="font-medium text-gray-500">ISP:</span> {click.isp_name}</div>}
                            {click.org_name && <div><span className="font-medium text-gray-500">Org:</span> {click.org_name}</div>}
                            {click.os && <div><span className="font-medium text-gray-500">OS:</span> {click.os}</div>}
                            {click.browser && <div><span className="font-medium text-gray-500">Browser:</span> {click.browser}</div>}
                            {click.screen_resolution && <div><span className="font-medium text-gray-500">Screen:</span> {click.screen_resolution}</div>}
                            {click.language && <div><span className="font-medium text-gray-500">Language:</span> {click.language}</div>}
                            {click.timezone && <div><span className="font-medium text-gray-500">Timezone:</span> {click.timezone}</div>}
                            {click.destination_url && <div className="col-span-2"><span className="font-medium text-gray-500">Destination:</span> <span className="font-mono text-gray-600 break-all">{click.destination_url}</span></div>}
                            {click.safe_url && <div className="col-span-2"><span className="font-medium text-gray-500">Safe URL:</span> <span className="font-mono text-gray-600 break-all">{click.safe_url}</span></div>}
                            {click.url && <div className="col-span-2"><span className="font-medium text-gray-500">Request URL:</span> <span className="font-mono text-gray-600 break-all">{click.url}</span></div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Pagination */}
        {Array.isArray(clicks) && clicks.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{clicks.length} clicks shown (page {filters.page})</span>
            <div className="flex gap-2">
              <button
                onClick={() => { const p = Math.max(1, filters.page - 1); setFilters(f => ({ ...f, page: p })); loadClicks({ page: p }); }}
                disabled={filters.page <= 1}
                className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => { const p = filters.page + 1; setFilters(f => ({ ...f, page: p })); loadClicks({ page: p }); }}
                disabled={clicks.length < 25}
                className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TrafficArmor = () => {
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState([]);
  const [domains, setDomains] = useState([]);
  const [safePages, setSafePages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [fbPages, setFbPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [workerScript, setWorkerScript] = useState(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [taBalance, setTaBalance] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Default rules (smart defaults for FB cloaking)
  const [defaultRules, setDefaultRules] = useState(null);

  // Create form
  const [form, setForm] = useState({
    domain_id: '',
    ad_account_id: '',
    persona_id: '',
    fb_page_id: '',
    name: '',
    money_page_url: '',
    safe_page_id: '',
    consent_prompt: false,
    delivery_method: 'iframe',
    rules: null,  // null = use server defaults
  });
  const [generatingSafePage, setGeneratingSafePage] = useState(false);

  const loadData = async () => {
    try {
      const [campaignsRes, domainsRes, safePagesRes, adAccountsRes, personasRes, fbPagesRes] = await Promise.all([
        authFetch(`${API_URL}/traffic-armor`).then(r => r.ok ? r.json() : []),
        authFetch(`${API_URL}/traffic-armor/domains-info`).then(r => r.ok ? r.json() : []),
        authFetch(`${API_URL}/safe-pages/?status=completed`).then(r => r.ok ? r.json() : { items: [] }),
        authFetch(`${API_URL}/facebook/accounts`).then(r => r.ok ? r.json() : []),
        authFetch(`${API_URL}/personas/`).then(r => r.ok ? r.json() : []),
        authFetch(`${API_URL}/tracked-pages`).then(r => r.ok ? r.json() : []),
      ]);
      setCampaigns(campaignsRes);
      setDomains(Array.isArray(domainsRes) ? domainsRes : []);
      const spItems = safePagesRes?.items || (Array.isArray(safePagesRes) ? safePagesRes : []);
      setSafePages(spItems);
      setAdAccounts(Array.isArray(adAccountsRes) ? adAccountsRes : []);
      setPersonas(Array.isArray(personasRes) ? personasRes : []);
      setFbPages(Array.isArray(fbPagesRes) ? fbPagesRes : []);

      // Fetch live TA status and merge with campaigns
      if (Array.isArray(campaignsRes) && campaignsRes.some(c => c.ta_campaign_id)) {
        try {
          const liveRes = await authFetch(`${API_URL}/traffic-armor/ta/live-status`);
          if (liveRes.ok) {
            const liveStatus = await liveRes.json();
            setCampaigns(prev => prev.map(c => {
              const live = liveStatus[c.ta_campaign_id];
              if (!live) return c;
              return {
                ...c,
                deadbolt: live.deadbolt,
                ta_live: live,  // full live status object
              };
            }));
          }
        } catch { /* live status is best-effort */ }
      }
    } catch {
      showError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadBalance = async () => {
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/balance`);
      if (res.ok) setTaBalance(await res.json());
    } catch { /* ignore */ }
  };

  const loadDefaults = async () => {
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/ta/defaults`);
      if (res.ok) {
        const defs = await res.json();
        setDefaultRules(defs);
        setForm(f => ({ ...f, rules: defs }));
      }
    } catch { /* use inline fallback */ }
  };

  useEffect(() => {
    loadData();
    loadBalance();
    loadDefaults();
  }, []);

  // All domains available (multiple campaigns per domain allowed)
  const availableDomains = domains;

  const handleGenerateSafePage = async () => {
    if (!form.domain_id) {
      showError('Select a domain first');
      return;
    }
    const selectedDomain = domains.find(d => d.id === form.domain_id);
    setGeneratingSafePage(true);
    try {
      const res = await authFetch(`${API_URL}/safe-pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generator_type: 'blog',
          theme: 'health',
          language: 'en',
          domain_name: selectedDomain?.name || '',
          domain_id: form.domain_id,
          page_title: form.name || selectedDomain?.name || 'Health Tips',
          auto_deploy: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to generate safe page');
      // Add to safe pages list and auto-select
      setSafePages(prev => [data, ...prev]);
      setForm(f => ({ ...f, safe_page_id: data.id }));
      const msg = data.deploy_result?.success
        ? `Safe page generated and deployed to ${selectedDomain?.name}!`
        : 'Safe page generated!';
      showSuccess(msg);
    } catch (err) {
      showError(err.message);
    } finally {
      setGeneratingSafePage(false);
    }
  };

  const handleCreate = async () => {
    if (!form.domain_id || !form.name || !form.money_page_url) {
      showError('All fields are required');
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create campaign');
      if (data.ta_error) {
        showError(`Saved locally but Traffic Armor failed: ${data.ta_error}`);
      } else {
        const parts = [`Campaign created for ${data.domain_name}`];
        if (data.affiliate_url_created) parts.push(`Affiliate URL added`);
        // Auto-deploy worker if we have a campaign ID
        if (data.id) {
          try {
            const deployRes = await authFetch(`${API_URL}/traffic-armor/${data.id}/deploy`, { method: 'POST' });
            const deployData = await deployRes.json();
            if (deployRes.ok && deployData.success) {
              parts.push(`Deployed to ${data.domain_name}`);
            }
          } catch { /* non-critical */ }
        }
        showSuccess(parts.join('. '));
      }
      setShowCreate(false);
      setForm({ domain_id: '', ad_account_id: '', persona_id: '', fb_page_id: '', name: '', money_page_url: '', safe_page_id: '', consent_prompt: false, rules: defaultRules });
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      showSuccess('Cloaker campaign deleted');
      setDeleteConfirm(null);
      await loadData();
    } catch (err) {
      showError(err.message);
    }
  };

  const [deploying, setDeploying] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ money_page_url: '', safe_page_id: '', name: '', rules: {} });
  const [saving, setSaving] = useState(false);
  const [integrationCodeId, setIntegrationCodeId] = useState(null);
  const [integrationCode, setIntegrationCode] = useState('');
  const [savingIntegration, setSavingIntegration] = useState(false);

  const handleStartEdit = (c) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name || '',
      money_page_url: c.money_page_url || '',
      safe_page_id: c.safe_page_id || '',
      rules: c.ta_rules || defaultRules || {},
    });
  };

  const handleSaveEdit = async (id, redeploy = false) => {
    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update');
      showSuccess('Campaign updated');
      setEditingId(null);
      await loadData();
      if (redeploy) {
        await handleDeployWorker(id);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIntegrationCode = async (id) => {
    if (!integrationCode.trim()) return;
    setSavingIntegration(true);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/integration-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: integrationCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save');
      showSuccess(data.message);
      setIntegrationCodeId(null);
      setIntegrationCode('');
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setSavingIntegration(false);
    }
  };

  const handleDeployWorker = async (id) => {
    setDeploying(id);
    try {
      // Deploy safe page to Railway PHP cloaker service (TA handles all cloaking)
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/deploy`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to deploy');
      showSuccess(data.message);
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setDeploying(null);
    }
  };

  const handleGenerateWorker = async (id) => {
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/generate-worker`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to generate worker');
      setWorkerScript(data);
      setExpandedId(id);
    } catch (err) {
      showError(err.message);
    }
  };

  const [togglingDeadbolt, setTogglingDeadbolt] = useState(null);
  const [togglingConsent, setTogglingConsent] = useState(null);

  const handleToggleDeadbolt = async (id) => {
    setTogglingDeadbolt(id);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/toggle-deadbolt`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to toggle deadbolt');
      showSuccess(data.message);
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setTogglingDeadbolt(null);
    }
  };

  const handleToggleConsentPrompt = async (id) => {
    setTogglingConsent(id);
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/toggle-consent-prompt`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to toggle consent prompt');
      showSuccess(data.message);
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setTogglingConsent(null);
    }
  };

  const handlePreviewSafePage = async (id) => {
    try {
      const res = await authFetch(`${API_URL}/traffic-armor/${id}/preview-safe-page`);
      if (!res.ok) throw new Error('Failed to load safe page');
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      showError(err.message);
    }
  };

  const handleCopyScript = async () => {
    if (!workerScript?.worker_script) return;
    try {
      await navigator.clipboard.writeText(workerScript.worker_script);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = workerScript.worker_script;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedScript(true);
    showSuccess('Worker script copied to clipboard');
    setTimeout(() => setCopiedScript(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield size={24} className="text-amber-500" />
            Traffic Armor
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            TA cloaking — safe pages with injected JS, TA handles all visitor filtering
          </p>
        </div>
        <div className="flex items-center gap-3">
          {taBalance && (
            <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
              Balance: <span className="font-semibold text-gray-700">{taBalance?.data?.imps_remaining ? Number(taBalance.data.imps_remaining).toLocaleString() : '—'}</span> clicks
            </div>
          )}
          {activeTab === 'campaigns' && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm flex items-center gap-2"
            >
              <Plus size={16} />
              + New TA Campaign
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button onClick={() => setActiveTab('campaigns')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'campaigns' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Shield size={14} /> Campaigns
        </button>
        <button onClick={() => setActiveTab('clicks')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'clicks' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Activity size={14} /> Click Log
        </button>
        <button onClick={() => setActiveTab('lists')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'lists' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Database size={14} /> Blocklists
        </button>
      </div>

      {/* Click Log Tab */}
      {activeTab === 'clicks' && (
        <ClickLogPanel authFetch={authFetch} showError={showError} campaigns={campaigns} />
      )}

      {/* Lists Tab */}
      {activeTab === 'lists' && (
        <ListsPanel authFetch={authFetch} showSuccess={showSuccess} showError={showError} />
      )}

      {/* Campaigns Tab */}
      {activeTab === 'campaigns' && <>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Create Cloaker Campaign</h3>
          {/* Row 1: Domain, Ad Account, Persona, FB Page */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Domain</label>
              <select
                value={form.domain_id}
                onChange={e => {
                  const domainId = e.target.value;
                  const sel = domains.find(d => d.id === domainId);
                  // Auto-fill linked fields from domain
                  const suggestedName = sel?.persona_name
                    ? `${sel.persona_name} - ${sel.name}`
                    : sel ? sel.name : '';
                  setForm(f => ({
                    ...f,
                    domain_id: domainId,
                    ad_account_id: sel?.ad_account_id || f.ad_account_id,
                    persona_id: sel?.persona_id || f.persona_id,
                    fb_page_id: sel?.fb_page_id || f.fb_page_id,
                    name: f.name || suggestedName,
                  }));
                }}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
              >
                <option value="">Select domain...</option>
                {availableDomains.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}{!d.cloudflare_zone_id ? ' (no CF)' : ''}
                  </option>
                ))}
              </select>
              {availableDomains.length === 0 && !form.domain_id && (
                <p className="text-xs text-gray-400 mt-1">No domains available — add a domain first</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Ad Account</label>
              <select
                value={form.ad_account_id}
                onChange={e => setForm(f => ({ ...f, ad_account_id: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
              >
                <option value="">Select ad account...</option>
                {adAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Persona</label>
              <select
                value={form.persona_id}
                onChange={e => {
                  const pid = e.target.value;
                  const sel = personas.find(p => p.id === pid);
                  setForm(f => ({
                    ...f,
                    persona_id: pid,
                    // Auto-fill FB page from persona if persona has one
                    fb_page_id: sel?.fb_page_id || f.fb_page_id,
                  }));
                }}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
              >
                <option value="">Select persona...</option>
                {personas.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">FB Page</label>
              <select
                value={form.fb_page_id}
                onChange={e => setForm(f => ({ ...f, fb_page_id: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
              >
                <option value="">Select FB page...</option>
                {fbPages.map(p => (
                  <option key={p.id} value={p.fb_page_id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Row 2: Campaign Name, Money Page URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Campaign Name</label>
              <input
                type="text"
                placeholder="e.g. Akemi - Patricia"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Money Page URL</label>
              <input
                type="text"
                placeholder="https://clickflare.com/campaign/..."
                value={form.money_page_url}
                onChange={e => setForm(f => ({ ...f, money_page_url: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">Where real visitors go (must be a different domain)</p>
            </div>
          </div>
          {/* Safe Page */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Safe Page</label>
            <div className="flex gap-2">
              <select
                value={form.safe_page_id}
                onChange={e => setForm(f => ({ ...f, safe_page_id: e.target.value }))}
                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
              >
                <option value="">Built-in default (health blog)</option>
                {safePages.map(sp => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name || sp.page_title || `${sp.theme} — ${sp.language}`}
                    {sp.domain_name ? ` (${sp.domain_name})` : ''}
                    {sp.deployed ? ' — LIVE' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleGenerateSafePage}
                disabled={generatingSafePage || !form.domain_id}
                className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                title="Generate a safe page for the selected domain and auto-deploy it"
              >
                {generatingSafePage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {generatingSafePage ? 'Generating...' : 'Generate'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Pick an existing safe page or click Generate to create one for the selected domain (auto-deploys to domain).
            </p>
          </div>
          {/* Delivery Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Method (Allowed Visitors)</label>
            <select
              value={form.delivery_method || 'iframe'}
              onChange={e => setForm(f => ({
                ...f,
                delivery_method: e.target.value,
                consent_prompt: e.target.value === 'custom_js',
              }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
            >
              <option value="iframe">Iframe (default — TA loads money page in iframe)</option>
              <option value="custom_js">Custom JS / Consent Prompt (click → money page in new tab)</option>
              <option value="paste_html">Paste HTML (TA replaces page with redirect HTML)</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              {form.delivery_method === 'custom_js' && 'Cookie consent modal — allowed visitors click Accept → money page opens in new tab. Custom JS must be set in TA dashboard.'}
              {form.delivery_method === 'paste_html' && 'TA replaces page content with HTML meta-refresh redirect to money page. Paste HTML content must be set in TA dashboard.'}
              {(!form.delivery_method || form.delivery_method === 'iframe') && 'TA loads money page in an iframe overlay on the safe page.'}
            </p>
          </div>
          {/* Cloaking Rules */}
          {form.rules && (
            <RulesPanel rules={form.rules}
              onChange={r => setForm(f => ({ ...f, rules: r }))}
              authFetch={authFetch} showError={showError} />
          )}
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              {creating ? 'Creating...' : 'Create Campaign'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Campaign List */}
      {campaigns.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <Shield className="text-gray-400" size={24} />
          </div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">No cloaker campaigns yet</h3>
          <p className="text-xs text-gray-400">Create a cloaker campaign to link a domain to Traffic Armor</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map(c => (
            <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="p-5">
                {/* Header row: title + status */}
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">{c.name}</h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[c.status] || STATUS_COLORS.draft}`}>
                      {c.status}
                    </span>
                    {c.ta_campaign_number && (
                      <span className="text-xs text-gray-400 shrink-0">TA #{c.ta_campaign_number}</span>
                    )}
                  </div>
                  {/* Icon actions: preview, edit, code, delete */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => handlePreviewSafePage(c.id)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Preview Safe Page"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      onClick={() => editingId === c.id ? setEditingId(null) : handleStartEdit(c)}
                      className={`p-1.5 rounded-lg transition-colors ${editingId === c.id ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'}`}
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleGenerateWorker(c.id)}
                      className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      title="View Worker Script"
                    >
                      <Code size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(c.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {/* Action buttons row */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {!c.worker_deployed ? (
                    <button
                      onClick={() => handleDeployWorker(c.id)}
                      disabled={deploying === c.id}
                      className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      title="Deploy safe page + domain mapping to PHP service"
                    >
                      {deploying === c.id ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                      {deploying === c.id ? 'Deploying...' : 'Deploy'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDeployWorker(c.id)}
                      disabled={deploying === c.id}
                      className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      title="Re-deploy safe page + domain mapping"
                    >
                      {deploying === c.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      {deploying === c.id ? 'Deploying...' : 'Live'}
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleDeadbolt(c.id)}
                    disabled={togglingDeadbolt === c.id}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors ${
                      c.deadbolt
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    } disabled:opacity-50`}
                    title={c.deadbolt ? 'Deadbolt ON — all traffic sees safe page. Click to disable.' : 'Enable deadbolt — force all traffic to safe page for testing'}
                  >
                    {togglingDeadbolt === c.id ? <Loader2 size={12} className="animate-spin" /> : (c.deadbolt ? <Lock size={12} /> : <Unlock size={12} />)}
                    {c.deadbolt ? 'Deadbolt ON' : 'Deadbolt'}
                  </button>
                  <button
                    onClick={() => handleToggleConsentPrompt(c.id)}
                    disabled={togglingConsent === c.id}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors ${
                      c.consent_prompt
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    } disabled:opacity-50`}
                    title={c.consent_prompt ? 'Consent prompt ON — cookie modal active. Click to disable.' : 'Enable consent prompt — fake cookie modal, clicks open money page'}
                  >
                    {togglingConsent === c.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                    {c.consent_prompt ? 'Consent ON' : 'Consent'}
                  </button>
                  {c.ta_campaign_number && (
                    <a
                      href={`https://trafficarmor.com/campaigns/${c.ta_campaign_number}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors flex items-center gap-1.5"
                      title="Configure cloaking rules in TA dashboard"
                    >
                      <Settings size={12} />
                      Rules
                    </a>
                  )}
                </div>
                {/* Banners & details */}
                <div>
                  {/* Deadbolt warning banner */}
                  {c.deadbolt && (
                    <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <Lock size={14} className="text-red-500 shrink-0" />
                      <span className="text-xs font-medium text-red-700">DEADBOLT ACTIVE — All traffic sees safe page (testing mode)</span>
                    </div>
                  )}
                  {/* Delivery method banner */}
                  {!c.deadbolt && c.delivery_method && c.delivery_method !== 'iframe' && (
                    <div className={`mb-2 rounded-lg px-3 py-2 flex items-center gap-2 ${
                      c.delivery_method === 'custom_js' ? 'bg-blue-50 border border-blue-200' : 'bg-purple-50 border border-purple-200'
                    }`}>
                      <FileText size={14} className={c.delivery_method === 'custom_js' ? 'text-blue-500 shrink-0' : 'text-purple-500 shrink-0'} />
                      <span className={`text-xs font-medium ${c.delivery_method === 'custom_js' ? 'text-blue-700' : 'text-purple-700'}`}>
                        {c.delivery_method === 'custom_js' && 'CUSTOM JS / CONSENT PROMPT — Cookie modal, allowed visitors click → money page'}
                        {c.delivery_method === 'paste_html' && 'PASTE HTML — TA replaces page with redirect HTML for allowed visitors'}
                      </span>
                    </div>
                  )}
                  {/* Live TA Status */}
                  {c.ta_live && (
                    <div className="mb-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                        <span className="text-gray-500 mr-1">TA Live:</span>
                        <span className={`px-1.5 py-0.5 rounded ${c.ta_live.integration_method === 'JavaScript' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {c.ta_live.integration_method || '?'}
                        </span>
                        {c.ta_live.hybrid_mode && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Hybrid</span>}
                        {c.ta_live.cloak_proxies && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Proxy Det.</span>}
                        {c.ta_live.cloak_headless_browsers && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Headless</span>}
                        {c.ta_live.cloak_uncommon_isps && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Uncommon ISP</span>}
                        {c.ta_live.cloak_commercial_isps && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Commercial ISP</span>}
                        {c.ta_live.sticky_cloaking && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Sticky</span>}
                        {c.ta_live.cloak_spoofed_browser && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Spoofed Browser</span>}
                        {c.ta_live.cloak_spoofed_os && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Spoofed OS</span>}
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">IP:{c.ta_live.maximum_ip_visits} Cookie:{c.ta_live.maximum_browser_visits}</span>
                        <span className={`px-1.5 py-0.5 rounded ${c.ta_live.uncloaking_action === 'iframe' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {c.ta_live.uncloaking_action || 'none'}
                        </span>
                      </div>
                    </div>
                  )}
                  {c.ta_campaign_number && (
                    <div className="mb-2 flex justify-end">
                      <a
                        href={`https://trafficarmor.com/campaigns/${c.ta_campaign_number}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors shrink-0"
                      >
                        Open TA Dashboard
                      </a>
                    </div>
                  )}
                  {/* Ad URL — includes ?ta= param to route to correct TA campaign */}
                  {c.domain_name && (() => {
                    const taParam = c.ta_campaign_id ? `ta=${c.ta_campaign_id}&` : '';
                    const adUrl = `https://${c.domain_name}/?${taParam}campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}&site_source={{site_source_name}}`;
                    return (
                      <div className="mb-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-amber-700 shrink-0">FB Ad URL:</span>
                          <span className="text-xs font-mono font-medium text-amber-900 truncate">{adUrl}</span>
                        </div>
                        <CopyButton value={adUrl} />
                      </div>
                    );
                  })()}
                  <div className="space-y-0.5">
                    <CopyText label="Ad Account" value={c.ad_account_name} color="text-blue-600" />
                    <CopyText label="Persona" value={c.persona_name} color="text-amber-700" />
                    <CopyText label="FB Page" value={c.fb_page_name} color="text-purple-600" />
                    <CopyText label="Domain" value={c.domain_name} color="text-gray-700" />
                    <CopyText label="Money Page" value={c.money_page_url} color="text-green-600" />
                    <CopyText label="Safe Page" value={c.safe_page_name || '(built-in default)'} color="text-gray-500" />
                    {c.created_at && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-20 shrink-0">Created</span>
                        <span className="text-gray-500">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Edit Form */}
                {editingId === c.id && (
                  <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Campaign Name</label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Money Page URL</label>
                        <input
                          type="text"
                          value={editForm.money_page_url}
                          onChange={e => setEditForm(f => ({ ...f, money_page_url: e.target.value }))}
                          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Safe Page</label>
                        <select
                          value={editForm.safe_page_id}
                          onChange={e => setEditForm(f => ({ ...f, safe_page_id: e.target.value }))}
                          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                        >
                          <option value="">Built-in default (health blog)</option>
                          {safePages.map(sp => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name || sp.page_title || `${sp.theme} — ${sp.language}`} {sp.domain_name ? `(${sp.domain_name})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {/* Cloaking Rules in edit form */}
                    <RulesPanel rules={editForm.rules || {}}
                      onChange={r => setEditForm(f => ({ ...f, rules: r }))}
                      authFetch={authFetch} showError={showError} />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(c.id, false)}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                      {c.worker_deployed && (
                        <button
                          onClick={() => handleSaveEdit(c.id, true)}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                          Save & Re-deploy
                        </button>
                      )}
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Worker Script Panel */}
                {expandedId === c.id && workerScript && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Code size={14} />
                        Cloudflare Worker Script
                      </h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopyScript}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors ${
                            copiedScript ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-amber-100 hover:text-amber-700'
                          }`}
                        >
                          {copiedScript ? <Check size={12} /> : <Copy size={12} />}
                          {copiedScript ? 'Copied!' : 'Copy Script'}
                        </button>
                        <button
                          onClick={() => { setExpandedId(null); setWorkerScript(null); }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <ChevronUp size={14} />
                        </button>
                      </div>
                    </div>
                    <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto max-h-96 overflow-y-auto">
                      {workerScript.worker_script}
                    </pre>
                    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <h5 className="text-xs font-semibold text-amber-800 mb-1">Deployment Instructions:</h5>
                      <pre className="text-xs text-amber-700 whitespace-pre-wrap">{workerScript.instructions}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flow Diagram */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">How It Works</h3>
        <div className="flex flex-col sm:flex-row items-center gap-3 text-sm text-gray-600">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-center">
            <div className="font-medium text-blue-700">1. Create Campaign</div>
            <div className="text-xs text-blue-500">Set rules, safe page, money page</div>
          </div>
          <span className="text-gray-300 hidden sm:block">&rarr;</span>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-center">
            <div className="font-medium text-amber-700">2. Deploy</div>
            <div className="text-xs text-amber-500">Pushes safe page + domain mapping</div>
          </div>
          <span className="text-gray-300 hidden sm:block">&rarr;</span>
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-center">
            <div className="font-medium text-purple-700">3. FB Ad → Your Domain</div>
            <div className="text-xs text-purple-500">Traffic Armor cloaks automatically</div>
          </div>
          <span className="text-gray-300 hidden sm:block">&rarr;</span>
          <div className="space-y-2">
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 flex items-center gap-2">
              <Eye size={14} className="text-green-600" />
              <span className="font-medium text-green-700">Real visitor → Money Page</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
              <EyeOff size={14} className="text-gray-500" />
              <span className="font-medium text-gray-600">Bot/reviewer → Safe Page</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">Each domain maps to one campaign. Deploy pushes your safe page and links the domain to the right TA campaign automatically. No manual config needed.</p>
      </div>

      </>}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Campaign?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">This will archive the campaign on Traffic Armor and remove it from the tool.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrafficArmor;
