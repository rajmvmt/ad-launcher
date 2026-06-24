import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Zap, Sprout, FileText, MessageSquare, Image, Loader2, ChevronLeft, Plus, Minus, Trash2, Upload, X, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import PersonaCard from '../components/PersonaCard';
import GenerateContentModal from '../components/GenerateContentModal';
import CommentFarm from './CommentFarm';
import {
  getPersonas, seedPersonas, getStats,
  generateAllContent, generatePersonaFromImages, deletePersona, updatePersona,
  getPersonaQueue, addToPersonaQueue, removeFromPersonaQueue, clearPersonaQueue,
  promoteWinner, demoteWinner,
} from '../lib/personaApi';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts } from '../lib/facebookApi';

const PersonaFarm = () => {
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();
  const { brands } = useBrands();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('personas');
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);

  // Generate persona from images state — batch queue
  const [showGenPersonaModal, setShowGenPersonaModal] = useState(false);
  const [genGender, setGenGender] = useState('');
  const [genEthnicity, setGenEthnicity] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]); // kept for single-add compat
  const [personaQueue, setPersonaQueue] = useState([]); // [{id, files:[], status:'pending'|'processing'|'done'|'error', name:'', error:''}]
  const [generatingPersonas, setGeneratingPersonas] = useState(false);
  const [deletingPersona, setDeletingPersona] = useState(null);

  // Winner promotion
  const [promoteModal, setPromoteModal] = useState(null); // persona object or null
  const [promoteNotes, setPromoteNotes] = useState('');
  const [promoteOffers, setPromoteOffers] = useState('');
  const [promoting, setPromoting] = useState(false);

  // Assignment data
  const [fbPages, setFbPages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [domainsList, setDomainsList] = useState([]);

  // Group personas by brand for the overview
  const [allPersonas, setAllPersonas] = useState([]);

  const loadData = useCallback(async () => {
    try {
      if (selectedBrand) {
        const [personaData, statsData, queueData] = await Promise.all([
          getPersonas(authFetch, { brandId: selectedBrand.id }),
          getStats(authFetch),
          getPersonaQueue(authFetch, selectedBrand.id).catch(() => []),
        ]);
        setPersonas(personaData);
        setStats(statsData);
        setPersonaQueue(queueData.map(q => ({
          ...q,
          imageUrls: q.image_urls || [],
          thumbUrl: (q.image_urls || [])[0] || '',
          originalName: '',
          name: q.result_name || '',
          error: q.error_message || '',
        })));
      } else {
        const [personaData, statsData] = await Promise.all([
          getPersonas(authFetch),
          getStats(authFetch),
        ]);
        setAllPersonas(personaData);
        setStats(statsData);
      }
    } catch (err) {
      showError('Failed to load persona data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [authFetch, selectedBrand]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Load FB pages, ad accounts, domains for quick-assign
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
    (async () => {
      try {
        // FB Pages
        const pagesRes = await authFetch(`${API_URL}/tracked-pages`);
        if (pagesRes.ok) setFbPages(await pagesRes.json());
      } catch {}
      try {
        // Ad Accounts
        const conns = await getConnections();
        const def = conns.find(c => c.is_default) || conns[0];
        if (def) {
          const accounts = await getAdAccounts(def.id);
          setAdAccounts(accounts);
        }
      } catch {}
      try {
        // Domains
        const domainsRes = await authFetch(`${API_URL}/domains`);
        if (domainsRes.ok) setDomainsList(await domainsRes.json());
      } catch {}
    })();
  }, [authFetch]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await seedPersonas(authFetch);
      showSuccess(`Seeded ${result.total_created} personas (${result.total_skipped} already existed)`);
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to seed personas');
    } finally {
      setSeeding(false);
    }
  };

  const handleGenerateAll = async ({ contentType, model }) => {
    setIsGenerating(true);
    setGenerateResult(null);
    try {
      const result = await generateAllContent(authFetch, selectedBrand?.name?.toLowerCase().replace(/ /g, '_') || 'akemi', model);
      setGenerateResult(result);
      showSuccess(`Generated content for ${result.succeeded}/${result.total_personas} personas`);
      await loadData();
    } catch (err) {
      setGenerateResult({ error: err.message });
      showError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectBrand = (brand) => {
    setSelectedBrand(brand);
    setPersonas([]);
  };

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

  const uploadToR2 = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await authFetch(`${API_URL}/uploads/`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.url;
  };

  const addToQueue = (files) => {
    files.forEach(async (f) => {
      const tempId = Math.random().toString(36).slice(2);
      const thumbUrl = URL.createObjectURL(f);
      setPersonaQueue(prev => [...prev, {
        id: tempId, imageUrls: [], thumbUrl, originalName: f.name,
        status: 'uploading', name: '', error: '',
      }]);
      try {
        const url = await uploadToR2(f);
        // Persist to backend
        const queueItem = await addToPersonaQueue(authFetch, {
          brandId: selectedBrand.id,
          imageUrls: [url],
          gender: genGender || undefined,
          ethnicity: genEthnicity || undefined,
        });
        setPersonaQueue(prev => prev.map(q =>
          q.id === tempId ? {
            ...q,
            id: queueItem.id,
            imageUrls: queueItem.image_urls || [url],
            status: 'pending',
          } : q
        ));
      } catch (err) {
        setPersonaQueue(prev => prev.map(q =>
          q.id === tempId ? { ...q, status: 'error', error: 'Upload failed — try again' } : q
        ));
      }
    });
  };

  const removeFromQueue = async (id) => {
    setPersonaQueue(prev => prev.filter(q => q.id !== id));
    try {
      await removeFromPersonaQueue(authFetch, id);
    } catch (err) {
      console.error('Failed to remove queue item from backend:', err);
    }
  };

  const handleProcessQueue = async () => {
    if (!selectedBrand) { showError('Please select a brand first'); return; }
    const toProcess = personaQueue.filter(q => (q.status === 'pending' || q.status === 'error') && q.imageUrls.length > 0);
    if (toProcess.length === 0) { showError('No personas to process'); return; }
    setGeneratingPersonas(true);

    let doneCount = 0;
    for (const item of toProcess) {
      const MAX_RETRIES = 3;
      let succeeded = false;
      for (let attempt = 1; attempt <= MAX_RETRIES && !succeeded; attempt++) {
        setPersonaQueue(prev => prev.map(q => q.id === item.id
          ? { ...q, status: 'processing', error: attempt > 1 ? `Retry ${attempt}/${MAX_RETRIES}...` : '' }
          : q));
        try {
          const result = await generatePersonaFromImages(authFetch, {
            brandId: selectedBrand.id,
            imageUrls: item.imageUrls,
            gender: genGender || undefined,
            ethnicity: genEthnicity || undefined,
            model: 'sonnet',
            queueItemId: item.id,
          });
          setPersonaQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'done', name: result.name, error: '' } : q));
          succeeded = true;
          doneCount++;
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            setPersonaQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: err.message } : q));
          } else {
            // Wait a moment before retrying
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    }

    showSuccess(`Created ${doneCount}/${toProcess.length} personas`);
    setGeneratingPersonas(false);
    await loadData();
  };

  const handleDeletePersona = async (id, name) => {
    if (!window.confirm(`Delete persona "${name}" and all their content?`)) return;
    setDeletingPersona(id);
    try {
      await deletePersona(authFetch, id);
      showSuccess(`Deleted ${name}`);
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to delete persona');
    } finally {
      setDeletingPersona(null);
    }
  };

  const handlePromoteWinner = async () => {
    if (!promoteModal) return;
    setPromoting(true);
    try {
      const offersArr = promoteOffers.split(',').map(s => s.trim()).filter(Boolean);
      await promoteWinner(authFetch, promoteModal.id, {
        notes: promoteNotes || null,
        proven_offers: offersArr.length > 0 ? offersArr : null,
      });
      showSuccess(`${promoteModal.name} promoted to winner!`);
      setPromoteModal(null);
      setPromoteNotes('');
      setPromoteOffers('');
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to promote');
    } finally {
      setPromoting(false);
    }
  };

  const handleDemoteWinner = async (persona) => {
    try {
      await demoteWinner(authFetch, persona.id);
      showSuccess(`${persona.name} removed from winners`);
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to demote');
    }
  };

  const handleQuickUpdate = async (id, updates) => {
    try {
      await updatePersona(authFetch, id, updates);
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to update persona');
    }
  };

  const handleRenamePersona = async (id, newName) => {
    try {
      await updatePersona(authFetch, id, { name: newName });
      showSuccess(`Renamed to "${newName}"`);
      await loadData();
    } catch (err) {
      showError(err.message || 'Failed to rename persona');
    }
  };

  // Count personas per brand for the overview
  const personasByBrand = {};
  const unassigned = [];
  allPersonas.forEach(p => {
    if (p.brand_id) {
      if (!personasByBrand[p.brand_id]) personasByBrand[p.brand_id] = [];
      personasByBrand[p.brand_id].push(p);
    } else {
      unassigned.push(p);
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  // ── Brand Detail View ──
  if (selectedBrand) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setSelectedBrand(null); setPersonas([]); }}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{selectedBrand.name}</h1>
              <p className="text-gray-500 mt-1">{personas.length} personas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGenPersonaModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm flex items-center gap-2"
            >
              <Upload size={16} />
              Create Persona
            </button>
            {personas.length > 0 && (
              <button
                onClick={() => { setGenerateResult(null); setShowGenerateModal(true); }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm flex items-center gap-2"
              >
                <Zap size={16} />
                Generate All Content
              </button>
            )}
          </div>
        </div>

        {/* Persona Grid */}
        {personas.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {personas.map(persona => (
              <div key={persona.id} className="relative">
                <PersonaCard
                  persona={persona}
                  onClick={() => navigate(`/persona-farm/${persona.id}`)}
                  onRename={handleRenamePersona}
                  onUpdate={handleQuickUpdate}
                  fbPages={fbPages}
                  adAccounts={adAccounts}
                  domains={domainsList}
                />
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                  {persona.is_winner ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDemoteWinner(persona); }}
                      className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-500 transition-all shadow-sm border border-amber-200"
                      title="Remove from winners"
                    >
                      <Trophy size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPromoteModal(persona); setPromoteNotes(''); setPromoteOffers(persona.offer || ''); }}
                      className="p-1.5 rounded-lg bg-white/90 hover:bg-amber-50 text-gray-400 hover:text-amber-500 transition-all shadow-sm border border-gray-200"
                      title="Promote to winner"
                    >
                      <Trophy size={14} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeletePersona(persona.id, persona.name); }}
                    disabled={deletingPersona === persona.id}
                    className="p-1.5 rounded-lg bg-white/90 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all shadow-sm border border-gray-200"
                    title="Delete persona"
                  >
                    {deletingPersona === persona.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="text-amber-600" size={32} />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No personas for {selectedBrand.name}</h3>
            <p className="text-gray-500 mb-6">Generate AI personas for this brand to get started.</p>
            <button
              onClick={() => setShowGenPersonaModal(true)}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm"
            >
              Create Persona
            </button>
          </div>
        )}

        {/* Batch Create Personas Modal */}
        {showGenPersonaModal && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || []);
              const imageFiles = items
                .filter(item => item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter(Boolean);
              if (imageFiles.length > 0 && personaQueue.length + imageFiles.length <= 20) {
                addToQueue(imageFiles);
              }
            }}
          >
            <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Create Personas (Batch)</h2>
              <p className="text-sm text-gray-500 mb-5">Add up to 20 personas. Each image = 1 persona. Drop multiple images at once or add one by one.</p>

              {/* Drop zone for batch adding */}
              {personaQueue.length < 20 && (
                <div className="mb-5">
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-amber-400 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('persona-batch-input').click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-amber-500', 'bg-amber-50'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('border-amber-500', 'bg-amber-50'); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('border-amber-500', 'bg-amber-50');
                      const newFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                      const limit = 20 - personaQueue.length;
                      addToQueue(newFiles.slice(0, limit));
                    }}
                  >
                    <Upload size={28} className="mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Drop/click/paste images — each image becomes a persona</p>
                    <p className="text-xs text-gray-400 mt-1">{personaQueue.length}/20 personas queued</p>
                  </div>
                  <input
                    id="persona-batch-input"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const newFiles = Array.from(e.target.files);
                      const limit = 20 - personaQueue.length;
                      addToQueue(newFiles.slice(0, limit));
                      e.target.value = '';
                    }}
                  />
                </div>
              )}

              {/* Queue list */}
              {personaQueue.length > 0 && (
                <div className="space-y-2 mb-5 max-h-[400px] overflow-y-auto">
                  {personaQueue.map((item, idx) => (
                    <div key={item.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
                      item.status === 'done' ? 'border-green-200 bg-green-50' :
                      item.status === 'error' ? 'border-red-200 bg-red-50' :
                      item.status === 'processing' ? 'border-amber-200 bg-amber-50' :
                      'border-gray-200 bg-gray-50'
                    }`}>
                      <span className="text-sm font-medium text-gray-500 w-6">{idx + 1}</span>
                      <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                        <img src={item.thumbUrl || item.imageUrls[0]} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.status === 'uploading' && (
                          <span className="text-sm text-blue-600 flex items-center gap-1">
                            <Loader2 size={14} className="animate-spin" /> Uploading image...
                          </span>
                        )}
                        {item.status === 'pending' && <span className="text-sm text-gray-600">{item.originalName}</span>}
                        {item.status === 'processing' && (
                          <span className="text-sm text-amber-700 flex items-center gap-1">
                            <Loader2 size={14} className="animate-spin" /> Creating persona...
                          </span>
                        )}
                        {item.status === 'done' && <span className="text-sm text-green-700 font-medium">{item.name}</span>}
                        {item.status === 'error' && <span className="text-sm text-red-600">{item.error}</span>}
                      </div>
                      {item.imageUrls.length > 1 && (
                        <span className="text-xs text-gray-400">+{item.imageUrls.length - 1} more</span>
                      )}
                      {(item.status === 'pending' || item.status === 'uploading') && !generatingPersonas && (
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Gender + Ethnicity (applies to all) */}
              <div className="flex flex-wrap gap-6 mb-5">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Gender (all)</label>
                  <div className="flex items-center gap-2">
                    {[
                      { value: '', label: 'Auto' },
                      { value: 'female', label: 'Female' },
                      { value: 'male', label: 'Male' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setGenGender(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          genGender === opt.value ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Ethnicity (all)</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { value: '', label: 'Auto' },
                      { value: 'white', label: 'White' },
                      { value: 'black', label: 'Black' },
                      { value: 'latina', label: 'Latina/o' },
                      { value: 'asian', label: 'Asian' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setGenEthnicity(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          genEthnicity === opt.value ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-500">
                  {personaQueue.filter(q => q.status === 'done').length > 0 && (
                    <span className="text-green-600 font-medium">
                      {personaQueue.filter(q => q.status === 'done').length} created
                    </span>
                  )}
                  {personaQueue.filter(q => q.status === 'error').length > 0 && (
                    <span className="text-red-600 font-medium ml-3">
                      {personaQueue.filter(q => q.status === 'error').length} failed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {personaQueue.some(q => q.status === 'done') && (
                    <button
                      onClick={async () => {
                        try {
                          await clearPersonaQueue(authFetch, selectedBrand.id);
                          setPersonaQueue(prev => prev.filter(q => q.status !== 'done'));
                        } catch (err) {
                          showError('Failed to clear completed items');
                        }
                      }}
                      className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-medium"
                      disabled={generatingPersonas}
                    >
                      Clear Completed
                    </button>
                  )}
                  <button
                    onClick={() => { setShowGenPersonaModal(false); }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                    disabled={generatingPersonas}
                  >
                    {personaQueue.every(q => q.status === 'done' || q.status === 'error') && personaQueue.length > 0 ? 'Close' : 'Cancel'}
                  </button>
                  {personaQueue.some(q => q.status === 'pending' || q.status === 'error') && (
                    <button
                      onClick={handleProcessQueue}
                      disabled={generatingPersonas}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      {generatingPersonas ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Zap size={16} />
                          {personaQueue.some(q => q.status === 'error')
                            ? `Retry ${personaQueue.filter(q => q.status === 'error').length} Failed`
                            : `Create ${personaQueue.filter(q => q.status === 'pending').length} Personas`
                          }
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generate All Content Modal */}
        <GenerateContentModal
          isOpen={showGenerateModal}
          onClose={() => setShowGenerateModal(false)}
          onGenerate={handleGenerateAll}
          personaName="All Active Personas"
          isGenerating={isGenerating}
          result={generateResult}
        />

        {/* Promote to Winner Modal */}
        {promoteModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPromoteModal(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Trophy size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Promote to Winner</h3>
                  <p className="text-sm text-gray-500">{promoteModal.name}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={promoteNotes}
                    onChange={(e) => setPromoteNotes(e.target.value)}
                    placeholder="What makes this persona a winner? (e.g. 4x ROAS on patch offer)"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proven Offers</label>
                  <input
                    value={promoteOffers}
                    onChange={(e) => setPromoteOffers(e.target.value)}
                    placeholder="Comma-separated: akemi, patch, slim"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setPromoteModal(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePromoteWinner}
                  disabled={promoting}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {promoting ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
                  Promote
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Brand Overview ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Persona Farm</h1>
          <p className="text-gray-500 mt-1">{activeTab === 'personas' ? 'Select a brand to manage its personas' : 'Deploy comments from personas'}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'personas', label: 'Personas', icon: Users },
          { key: 'comments', label: 'Comment Farm', icon: MessageSquare },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'comments' ? (
        <CommentFarm />
      ) : (
      <>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <Users size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.active_personas}</p>
                <p className="text-xs text-gray-500">Active Personas</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <FileText size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total_posts}</p>
                <p className="text-xs text-gray-500">Posts ({stats.posted_posts} posted)</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                <MessageSquare size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total_comments}</p>
                <p className="text-xs text-gray-500">Comments</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <Image size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total_prompts}</p>
                <p className="text-xs text-gray-500">Image Prompts ({stats.approved_prompts} approved)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Brand Grid */}
      {brands.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {brands.map(brand => {
            const brandPersonas = personasByBrand[brand.id] || [];
            return (
              <div
                key={brand.id}
                onClick={() => handleSelectBrand(brand)}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  {brand.logo_url ? (
                    <img src={brand.logo_url} alt={brand.name} className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold text-white"
                      style={{ backgroundColor: brand.primary_color || '#f59e0b' }}
                    >
                      {brand.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">
                      {brand.name}
                    </h3>
                    <p className="text-sm text-gray-500">{brandPersonas.length} personas</p>
                  </div>
                </div>
                {brandPersonas.length > 0 && (
                  <div className="flex -space-x-2">
                    {brandPersonas.slice(0, 5).map((p, i) => (
                      <div
                        key={p.id}
                        className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600"
                        title={p.name}
                      >
                        {p.name.split(' ').map(n => n[0]).join('')}
                      </div>
                    ))}
                    {brandPersonas.length > 5 && (
                      <div className="w-8 h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-500">
                        +{brandPersonas.length - 5}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No brands yet</h3>
          <p className="text-gray-500">Create brands first, then generate personas for each brand.</p>
        </div>
      )}

      {/* Unassigned personas */}
      {unassigned.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Unassigned Personas ({unassigned.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {unassigned.map(persona => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onClick={() => navigate(`/persona-farm/${persona.id}`)}
                onRename={handleRenamePersona}
                onUpdate={handleQuickUpdate}
                fbPages={fbPages}
                adAccounts={adAccounts}
                domains={domainsList}
              />
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {/* Promote to Winner Modal */}
      {promoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPromoteModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Trophy size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Promote to Winner</h3>
                <p className="text-sm text-gray-500">{promoteModal.name}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={promoteNotes}
                  onChange={(e) => setPromoteNotes(e.target.value)}
                  placeholder="What makes this persona a winner? (e.g. 4x ROAS on patch offer)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proven Offers</label>
                <input
                  value={promoteOffers}
                  onChange={(e) => setPromoteOffers(e.target.value)}
                  placeholder="Comma-separated: akemi, patch, slim"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPromoteModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handlePromoteWinner}
                disabled={promoting}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
              >
                {promoting ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
                Promote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonaFarm;
