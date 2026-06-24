import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  MessageSquare, Plus, Trash2, Play, Loader2, RefreshCw, Sparkles,
  Check, X, Clock, AlertCircle, Heart,
  ThumbsUp, Image, Reply, ExternalLink, Edit2, Save
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getPersonas } from '../lib/personaApi';
import { getConnections } from '../api/facebookConnections';
import {
  createJob, listJobs, getJob, deleteJob, generateConversation,
  addCommenters, updateEntry, deleteEntry, executeJob, getJobStatus
} from '../lib/commentFarmApi';

const ENTRY_TYPE_LABELS = {
  link_drop: 'Link Drop',
  testimonial: 'Testimonial',
  short_reaction: 'Reaction',
  validation: 'Validation',
  question: 'Question',
  reply: 'Reply',
  relateable: 'Relateable',
  pending_generation: 'Awaiting Generation',
};

const ENTRY_TYPE_COLORS = {
  link_drop: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  testimonial: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  short_reaction: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  validation: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
  question: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  reply: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
  relateable: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400',
  pending_generation: 'bg-gray-100 text-gray-500 dark:bg-gray-700/20 dark:text-gray-500',
};

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400',
  posted: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  skipped: 'bg-gray-100 text-gray-500 dark:bg-gray-600/20 dark:text-gray-500',
  done: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-600/20 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
};

const CommentFarm = () => {
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [editMessage, setEditMessage] = useState('');
  const pollingRef = useRef(null);

  const [newJob, setNewJob] = useState({
    target_post_id: '', target_type: 'manual', connection_id: '',
    owner_persona_id: '', commenter_persona_ids: [], affiliate_url: '',
    original_post_text: '', name: '',
  });

  const loadJobs = useCallback(async () => {
    try { setJobs(await listJobs(authFetch)); } catch (err) { console.error(err); }
  }, [authFetch]);

  const loadJob = useCallback(async (jobId) => {
    try { setSelectedJob(await getJob(authFetch, jobId)); } catch (err) { showError('Failed to load job'); }
  }, [authFetch]);

  useEffect(() => {
    const postId = searchParams.get('post_id');
    const personaId = searchParams.get('persona_id');
    const postText = searchParams.get('post_text');
    if (postId) {
      setNewJob(prev => ({
        ...prev, target_post_id: postId,
        owner_persona_id: personaId || prev.owner_persona_id,
        original_post_text: postText || prev.original_post_text,
        target_type: searchParams.get('target_type') || 'manual',
      }));
      setShowCreateForm(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  useEffect(() => {
    const init = async () => {
      try {
        const [personaData, connData] = await Promise.all([
          getPersonas(authFetch, { isActive: true }),
          getConnections(authFetch),
        ]);
        setPersonas(personaData);
        setConnections(connData);
        await loadJobs();
      } catch (err) { showError('Failed to load data'); }
      finally { setLoading(false); }
    };
    init();
  }, [authFetch]);

  useEffect(() => { return () => { if (pollingRef.current) clearInterval(pollingRef.current); }; }, []);

  const startPolling = (jobId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const status = await getJobStatus(authFetch, jobId);
        setSelectedJob(prev => prev ? { ...prev, ...status } : prev);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          await loadJob(jobId);
          await loadJobs();
          showSuccess(status.status === 'completed' ? 'Comment farm completed!' : 'Comment farm finished with errors');
        }
      } catch (err) { console.error(err); }
    }, 5000);
  };

  const personasWithPages = personas.filter(p => p.fb_page_id);

  const toggleCommenter = (personaId) => {
    setNewJob(prev => ({
      ...prev,
      commenter_persona_ids: prev.commenter_persona_ids.includes(personaId)
        ? prev.commenter_persona_ids.filter(id => id !== personaId)
        : [...prev.commenter_persona_ids, personaId],
    }));
  };

  const handleCreate = async () => {
    if (!newJob.target_post_id || !newJob.connection_id || !newJob.owner_persona_id) {
      showError('Fill in target post ID, connection, and owner persona'); return;
    }
    if (newJob.commenter_persona_ids.length < 2) {
      showError('Select at least 2 commenter personas'); return;
    }
    setCreating(true);
    try {
      const job = await createJob(authFetch, newJob);
      await addCommenters(authFetch, job.id, newJob.commenter_persona_ids);
      showSuccess('Comment farm job created!');
      setShowCreateForm(false);
      setNewJob({ target_post_id: '', target_type: 'manual', connection_id: '', owner_persona_id: '', commenter_persona_ids: [], affiliate_url: '', original_post_text: '', name: '' });
      await loadJobs();
      await loadJob(job.id);
    } catch (err) { showError(err.message); }
    finally { setCreating(false); }
  };

  const handleGenerate = async () => {
    if (!selectedJob) return;
    setGenerating(true);
    try {
      const data = await generateConversation(authFetch, selectedJob.id);
      setSelectedJob(data);
      showSuccess(`Generated ${data.entries?.length || 0} comments + ${data.reactions?.length || 0} reactions`);
    } catch (err) { showError(err.message); }
    finally { setGenerating(false); }
  };

  const handleExecute = async () => {
    if (!selectedJob) return;
    setExecuting(true);
    try {
      await executeJob(authFetch, selectedJob.id);
      showSuccess('Comment farm launched! Posting with staggered delays...');
      startPolling(selectedJob.id);
      await loadJob(selectedJob.id);
    } catch (err) { showError(err.message); }
    finally { setExecuting(false); }
  };

  const handleDelete = async (jobId) => {
    try {
      await deleteJob(authFetch, jobId);
      showSuccess('Job deleted');
      if (selectedJob?.id === jobId) setSelectedJob(null);
      await loadJobs();
    } catch (err) { showError(err.message); }
  };

  const handleSaveEntry = async (entryId) => {
    try {
      await updateEntry(authFetch, entryId, { message: editMessage });
      setEditingEntry(null);
      await loadJob(selectedJob.id);
      showSuccess('Comment updated');
    } catch (err) { showError(err.message); }
  };

  const handleDeleteEntry = async (entryId) => {
    try { await deleteEntry(authFetch, entryId); await loadJob(selectedJob.id); }
    catch (err) { showError(err.message); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Warning if not enough personas */}
      {personasWithPages.length < 3 && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-800 dark:text-amber-400 font-medium text-sm">Not enough personas with FB pages</p>
            <p className="text-amber-600 dark:text-amber-400/70 text-xs mt-1">
              You have {personasWithPages.length} personas with FB pages. Need at least 3 (1 owner + 2 commenters).
            </p>
          </div>
        </div>
      )}

      {/* Create Button */}
      <div className="flex justify-end">
        <button onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Job
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New Comment Farm Job</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Job Name (optional)</label>
              <input type="text" value={newJob.name} onChange={e => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. David Johnson origin story"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">FB Connection</label>
              <select value={newJob.connection_id} onChange={e => setNewJob(prev => ({ ...prev, connection_id: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                <option value="">Select connection...</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Target FB Post ID</label>
            <input type="text" value={newJob.target_post_id} onChange={e => setNewJob(prev => ({ ...prev, target_post_id: e.target.value }))}
              placeholder="pageId_postId (e.g. 123456789_987654321)"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Format: pageId_postId. Find from persona post or ad story ID.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Original Post Text</label>
            <textarea value={newJob.original_post_text} onChange={e => setNewJob(prev => ({ ...prev, original_post_text: e.target.value }))}
              placeholder="Paste the full post text here (AI uses this to generate relevant comments)..."
              rows={3}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Affiliate URL (for link drop)</label>
            <input type="text" value={newJob.affiliate_url} onChange={e => setNewJob(prev => ({ ...prev, affiliate_url: e.target.value }))}
              placeholder="https://example.com/offer"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Post Owner (who made the post)</label>
            <select value={newJob.owner_persona_id} onChange={e => setNewJob(prev => ({ ...prev, owner_persona_id: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
              <option value="">Select owner persona...</option>
              {personasWithPages.map(p => <option key={p.id} value={p.id}>{p.name} ({p.age}yo {p.gender}, {p.location_city})</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              Comment Squad ({newJob.commenter_persona_ids.length} selected)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
              {personasWithPages.filter(p => p.id !== newJob.owner_persona_id).map(p => {
                const selected = newJob.commenter_persona_ids.includes(p.id);
                return (
                  <button key={p.id} onClick={() => toggleCommenter(p.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-all ${
                      selected
                        ? 'bg-amber-50 dark:bg-amber-600/15 border-amber-400 dark:border-amber-500'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      selected ? 'bg-amber-500 border-amber-500' : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="truncate">
                      <div className="font-medium text-gray-900 dark:text-white text-xs truncate">{p.name}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-500">{p.age}yo {p.gender}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Job
            </button>
            <button onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Layout: Jobs List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job List */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm py-4">No jobs yet. Create one to get started.</p>
          ) : (
            jobs.map(job => (
              <button key={job.id} onClick={() => loadJob(job.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                  selectedJob?.id === job.id
                    ? 'bg-amber-50 dark:bg-amber-600/10 border-amber-300 dark:border-amber-500 shadow-sm'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900 dark:text-white text-sm truncate">
                    {job.name || `Job ${job.id.slice(0, 8)}`}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[job.status]}`}>
                    {job.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {job.owner_persona_name && <span>{job.owner_persona_name} &middot; </span>}
                  {job.total_entries} comments &middot; {job.posted_entries} posted
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {new Date(job.created_at).toLocaleDateString()}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Job Detail */}
        <div className="lg:col-span-2">
          {selectedJob ? (
            <div className="space-y-4">
              {/* Job Header Card */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedJob.name || `Job ${selectedJob.id.slice(0, 8)}`}
                  </h2>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE[selectedJob.status]}`}>
                    {selectedJob.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Post ID</span>
                    <p className="text-gray-900 dark:text-white font-mono text-xs truncate mt-0.5">{selectedJob.target_post_id}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Owner</span>
                    <p className="text-gray-900 dark:text-white text-sm mt-0.5">{selectedJob.owner_persona_name || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Comments</span>
                    <p className="text-gray-900 dark:text-white text-sm mt-0.5">{selectedJob.total_entries}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Progress</span>
                    <p className="text-sm mt-0.5">
                      <span className="text-green-600 dark:text-green-400 font-medium">{selectedJob.posted_entries || 0}</span>
                      <span className="text-gray-400"> / {selectedJob.total_entries}</span>
                      {selectedJob.failed_entries > 0 && (
                        <span className="text-red-500 dark:text-red-400 text-xs ml-1">({selectedJob.failed_entries} failed)</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                  {selectedJob.status === 'draft' && (
                    <>
                      <button onClick={handleGenerate} disabled={generating}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {generating ? 'Generating...' : 'Generate Conversation'}
                      </button>
                      {selectedJob.entries?.length > 0 && selectedJob.entries[0].entry_type !== 'pending_generation' && (
                        <button onClick={handleExecute} disabled={executing}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                          {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          Launch
                        </button>
                      )}
                    </>
                  )}
                  {selectedJob.status === 'in_progress' && (
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Posting comments with staggered delays...
                    </div>
                  )}
                  <button onClick={() => loadJob(selectedJob.id)}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-white rounded-lg text-sm ml-auto">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Original Post Preview */}
              {selectedJob.original_post_text && (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Original Post</h3>
                  <p className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap line-clamp-6">{selectedJob.original_post_text}</p>
                </div>
              )}

              {/* Comment Thread */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Comment Thread ({selectedJob.entries?.length || 0})
                </h3>

                <div className="space-y-2">
                  {selectedJob.entries?.map((entry) => {
                    const isReply = !!entry.parent_entry_id;
                    const isEditing = editingEntry === entry.id;

                    return (
                      <div key={entry.id}
                        className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 transition-all ${
                          isReply ? 'ml-10 border-l-3 border-l-amber-300 dark:border-l-amber-500' : ''
                        }`}>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-sm">
                            <span className="text-xs font-bold text-white">{(entry.persona_name || '?')[0]}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900 dark:text-white text-sm">{entry.persona_name || 'Unknown'}</span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ENTRY_TYPE_COLORS[entry.entry_type]}`}>
                                {ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" /> +{entry.delay_minutes}m
                              </span>
                              {isReply && (
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                                  <Reply className="w-2.5 h-2.5" /> reply
                                </span>
                              )}
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-auto ${STATUS_BADGE[entry.status]}`}>
                                {entry.status}
                              </span>
                            </div>

                            {isEditing ? (
                              <div className="mt-2 space-y-2">
                                <textarea value={editMessage} onChange={e => setEditMessage(e.target.value)} rows={3}
                                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <div className="flex gap-2">
                                  <button onClick={() => handleSaveEntry(entry.id)}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium">
                                    <Save className="w-3 h-3" /> Save
                                  </button>
                                  <button onClick={() => setEditingEntry(null)}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg text-xs">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-gray-700 dark:text-gray-300 text-sm mt-1.5 whitespace-pre-wrap leading-relaxed">{entry.message}</p>
                            )}

                            {entry.image_url && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                                <Image className="w-3.5 h-3.5" /> Photo attached
                                <a href={entry.image_url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}

                            {entry.error_message && (
                              <p className="text-red-500 dark:text-red-400 text-xs mt-1.5 bg-red-50 dark:bg-red-500/10 rounded px-2 py-1">{entry.error_message}</p>
                            )}

                            {entry.status === 'pending' && selectedJob.status === 'draft' && !isEditing && (
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => { setEditingEntry(entry.id); setEditMessage(entry.message); }}
                                  className="text-gray-400 hover:text-amber-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                <button onClick={() => handleDeleteEntry(entry.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reactions */}
              {selectedJob.reactions?.length > 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Reactions ({selectedJob.reactions.length})
                  </h3>
                  <div className="space-y-1.5">
                    {selectedJob.reactions.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400">
                          {r.reaction_type === 'LOVE' ? <Heart className="w-3.5 h-3.5 text-red-400" /> : <ThumbsUp className="w-3.5 h-3.5 text-blue-400" />}
                        </span>
                        <span className="text-gray-900 dark:text-white text-sm">{r.persona_name}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-xs">{r.reaction_type}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-xs flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> +{r.delay_minutes}m
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-auto ${STATUS_BADGE[r.status]}`}>
                          {r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
              <div className="text-center">
                <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p className="text-gray-400 dark:text-gray-500 text-sm">Select a job or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommentFarm;
