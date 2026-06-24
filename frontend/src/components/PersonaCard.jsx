import { useState, useRef, useEffect } from 'react';
import { MapPin, Briefcase, FileText, MessageSquare, Image, ChevronRight, Globe, Pencil, Trophy } from 'lucide-react';

const PersonaCard = ({ persona, onClick, onRename, onUpdate, fbPages = [], adAccounts = [], domains = [] }) => {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(persona.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== persona.name && onRename) {
      onRename(persona.id, trimmed);
    }
    setEditing(false);
  };

  const genderColor = persona.gender === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700';
  const hasContent = persona.post_count > 0 || persona.comment_count > 0 || persona.prompt_count > 0;

  const selectCls = "w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400 truncate";

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition-shadow cursor-pointer group ${persona.is_winner ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200'}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') { setEditName(persona.name); setEditing(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-lg font-semibold text-gray-900 border border-amber-400 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-amber-300 w-full"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              {persona.is_winner && <Trophy size={16} className="text-amber-500 shrink-0" />}
              <h3 className="text-lg font-semibold text-gray-900">{persona.name}</h3>
              {onRename && (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditName(persona.name); setEditing(true); }}
                  className="p-0.5 rounded text-gray-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all"
                  title="Rename persona"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${genderColor}`}>
              {persona.gender === 'female' ? 'Female' : 'Male'}, {persona.age}
            </span>
            {!persona.is_active && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
            )}
          </div>
        </div>
        <ChevronRight size={20} className="text-gray-300 group-hover:text-amber-500 transition-colors shrink-0" />
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MapPin size={14} className="text-gray-400 shrink-0" />
          <span>{persona.location_city}, {persona.location_state}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Briefcase size={14} className="text-gray-400 shrink-0" />
          <span className="truncate">{persona.occupation}</span>
        </div>
      </div>

      {/* Thumbnail */}
      {persona.thumbnail_url && (
        <div className="mb-3 relative group/photo">
          <img
            src={persona.thumbnail_url}
            alt={persona.name}
            className="w-full h-40 rounded-lg object-cover border border-gray-200"
          />
          {/* Full photo on hover */}
          <div className="fixed inset-0 hidden group-hover/photo:flex items-center justify-center z-50 pointer-events-none bg-black/30">
            <img
              src={persona.thumbnail_url}
              alt={persona.name}
              className="max-w-[400px] max-h-[500px] rounded-xl shadow-2xl border-2 border-white object-contain bg-white"
            />
          </div>
        </div>
      )}

      {/* Quick Assignments */}
      {onUpdate && (
        <div className="space-y-2 mb-3" onClick={(e) => e.stopPropagation()}>
          {/* FB Page */}
          <select
            className={selectCls}
            value={persona.fb_page_id || ''}
            onChange={(e) => onUpdate(persona.id, { fb_page_id: e.target.value || null })}
          >
            <option value="">-- FB Page --</option>
            {fbPages.map(p => (
              <option key={p.fb_page_id || p.id} value={p.fb_page_id || p.id}>{p.name}</option>
            ))}
          </select>

          {/* Ad Account */}
          <select
            className={selectCls}
            value={persona.fb_ad_account_id || ''}
            onChange={(e) => onUpdate(persona.id, { fb_ad_account_id: e.target.value || null })}
          >
            <option value="">-- Ad Account --</option>
            {adAccounts.map(a => (
              <option key={a.ad_account_id || a.id} value={a.ad_account_id || a.id}>{a.name}</option>
            ))}
          </select>

          {/* Domain */}
          <select
            className={selectCls}
            value={persona.domain_id || ''}
            onChange={(e) => onUpdate(persona.id, { domain_id: e.target.value || null })}
          >
            <option value="">-- Domain --</option>
            {domains.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Legacy display if no onUpdate (read-only cards) */}
      {!onUpdate && (persona.fb_page_name || persona.domain_name) && (
        <div className="space-y-1 mb-3">
          {persona.fb_page_name && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600">
              <span className="w-3 h-3 rounded-full bg-blue-500 inline-block shrink-0" />
              <span className="truncate">{persona.fb_page_name}</span>
            </div>
          )}
          {persona.domain_name && (
            <div className="flex items-center gap-1.5 text-xs text-green-600">
              <Globe size={12} className="shrink-0" />
              <span className="truncate">{persona.domain_name}</span>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FileText size={12} />
              {persona.post_count} posts
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare size={12} />
              {persona.comment_count} comments
            </span>
            <span className="flex items-center gap-1">
              <Image size={12} />
              {persona.prompt_count} prompts
            </span>
          </div>
          {hasContent && (
            <span className="w-2 h-2 rounded-full bg-green-400" title="Content generated" />
          )}
        </div>
      </div>
    </div>
  );
};

export default PersonaCard;
