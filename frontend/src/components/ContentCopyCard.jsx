import { useState } from 'react';
import { Copy, Check, Edit2, X, Save, Trash2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const TYPE_COLORS = {
  // Post types
  origin_story: 'bg-amber-100 text-amber-800',
  update: 'bg-blue-100 text-blue-800',
  milestone: 'bg-green-100 text-green-800',
  week_by_week: 'bg-teal-100 text-teal-800',
  long_form: 'bg-amber-100 text-amber-800',
  number_drop: 'bg-blue-100 text-blue-800',
  old_clothes: 'bg-pink-100 text-pink-800',
  old_clothes_pants: 'bg-pink-100 text-pink-800',
  old_clothes_underwear: 'bg-fuchsia-100 text-fuchsia-800',
  gratitude: 'bg-purple-100 text-purple-800',
  for_anyone_struggling: 'bg-rose-100 text-rose-800',
  // Comment types
  author_link: 'bg-red-100 text-red-800',
  support_short: 'bg-sky-100 text-sky-800',
  support_story: 'bg-indigo-100 text-indigo-800',
  support_photo: 'bg-teal-100 text-teal-800',
  reply_to_real: 'bg-orange-100 text-orange-800',
  // Prompt types
  profile: 'bg-violet-100 text-violet-800',
  before: 'bg-rose-100 text-rose-800',
  after: 'bg-emerald-100 text-emerald-800',
  comment_photo: 'bg-cyan-100 text-cyan-800',
  lifestyle: 'bg-lime-100 text-lime-800',
};

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  posted: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  generated: 'bg-blue-100 text-blue-700',
};

const TYPE_LABELS = {
  origin_story: 'Origin Story',
  update: 'Update',
  milestone: 'Milestone',
  week_by_week: 'Week by Week Progress',
  long_form: 'Long Form Story',
  number_drop: 'Number Drop',
  old_clothes: 'Old Clothes',
  old_clothes_pants: 'Old Clothes - Pants',
  old_clothes_underwear: 'Old Clothes - Underwear',
  gratitude: 'Gratitude',
  for_anyone_struggling: 'For Anyone Struggling',
  author_link: 'Author Link Drop',
  support_short: 'Short Reaction',
  support_story: 'Story Comment',
  support_photo: 'Photo Comment',
  reply_to_real: 'Reply Template',
  profile: 'Profile Photo',
  before: 'Before Photo',
  after: 'After Photo',
  old_clothes_prompt: 'Old Clothes Photo',
  comment_photo: 'Comment Photo',
  lifestyle: 'Lifestyle Photo',
};

const ContentCopyCard = ({ type, headline, text, status = 'draft', onStatusChange, onTextChange, onHeadlineChange, onDelete }) => {
  const { showSuccess } = useToast();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [editHeadline, setEditHeadline] = useState(headline || '');

  const copyText = headline ? `${headline}\n\n${text}` : text;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      showSuccess('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = copyText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      showSuccess('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveEdit = () => {
    if (onTextChange && editText !== text) {
      onTextChange(editText);
    }
    if (onHeadlineChange && editHeadline !== (headline || '')) {
      onHeadlineChange(editHeadline);
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(text);
    setEditHeadline(headline || '');
    setEditing(false);
  };

  const typeColor = TYPE_COLORS[type] || 'bg-gray-100 text-gray-700';
  const statusColor = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
  const typeLabel = TYPE_LABELS[type] || type;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColor}`}>
            {typeLabel}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={handleSaveEdit} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Save">
                <Save size={14} />
              </button>
              <button onClick={handleCancelEdit} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors" title="Cancel">
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <button onClick={handleCopy} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors" title="Copy">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
              {onTextChange && (
                <button onClick={() => setEditing(true)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                  <Edit2 size={14} />
                </button>
              )}
              {onDelete && (
                <button onClick={onDelete} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            value={editHeadline}
            onChange={(e) => setEditHeadline(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            placeholder="Headline (short, punchy)"
          />
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg text-sm text-gray-700 leading-relaxed resize-y min-h-[100px] focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            rows={6}
          />
        </div>
      ) : (
        <div>
          {headline && <p className="text-sm font-semibold text-gray-900 mb-1">{headline}</p>}
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{text}</div>
        </div>
      )}

      {onStatusChange && !editing && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          >
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="scheduled">Scheduled</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      )}
    </div>
  );
};

export default ContentCopyCard;
