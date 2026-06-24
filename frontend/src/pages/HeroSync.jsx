import { useState, useEffect, useCallback } from 'react';
import {
  Image, Plus, Trash2, Loader2, Copy, Check, X, Save, Edit2,
  Code, ExternalLink, Link2, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import {
  createHeroMap, listHeroMaps, getHeroMap, updateHeroMap, deleteHeroMap,
  addEntry, deleteEntry, updateEntry, generateComposites,
} from '../lib/heroSyncApi';
import { getPersonas } from '../lib/personaApi';

const HeroSync = () => {
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();
  const { brands } = useBrands();

  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [showSnippet, setShowSnippet] = useState(false);

  // Create form
  const [newMap, setNewMap] = useState({
    name: '',
    brand_id: '',
    landing_page_url: '',
    image_selector: 'img',
    param_name: 'img',
    base_image_url: '',
    layout: 'left_base',
  });
  const [generatingComposites, setGeneratingComposites] = useState(false);

  // Add entry form
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newEntry, setNewEntry] = useState({ key: '', image_url: '', label: '' });
  const [addingEntry, setAddingEntry] = useState(false);

  // Import from personas
  const [showImport, setShowImport] = useState(false);
  const [selectedPersonaImages, setSelectedPersonaImages] = useState([]);

  const loadMaps = useCallback(async () => {
    try {
      const data = await listHeroMaps(authFetch);
      setMaps(data);
    } catch (err) { console.error(err); }
  }, [authFetch]);

  const loadMap = useCallback(async (mapId) => {
    try {
      const data = await getHeroMap(authFetch, mapId);
      setSelectedMap(data);
    } catch (err) { showError('Failed to load hero map'); }
  }, [authFetch]);

  useEffect(() => {
    const init = async () => {
      try {
        const [, personaData] = await Promise.all([
          loadMaps(),
          getPersonas(authFetch, { isActive: true }),
        ]);
        setPersonas(personaData);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    init();
  }, [authFetch]);

  const handleCreate = async () => {
    if (!newMap.name) { showError('Enter a name'); return; }
    setCreating(true);
    try {
      const map = await createHeroMap(authFetch, newMap);
      showSuccess('Hero map created');
      setShowCreateForm(false);
      setNewMap({ name: '', brand_id: '', landing_page_url: '', image_selector: 'img', param_name: 'img', base_image_url: '', layout: 'left_base' });
      await loadMaps();
      await loadMap(map.id);
    } catch (err) { showError(err.message); }
    finally { setCreating(false); }
  };

  const handleDelete = async (mapId) => {
    try {
      await deleteHeroMap(authFetch, mapId);
      showSuccess('Hero map deleted');
      if (selectedMap?.id === mapId) setSelectedMap(null);
      await loadMaps();
    } catch (err) { showError(err.message); }
  };

  const handleAddEntry = async () => {
    if (!newEntry.key || !newEntry.image_url) { showError('Key and image URL are required'); return; }
    setAddingEntry(true);
    try {
      await addEntry(authFetch, selectedMap.id, newEntry);
      setNewEntry({ key: '', image_url: '', label: '' });
      setShowAddEntry(false);
      await loadMap(selectedMap.id);
      showSuccess('Entry added');
    } catch (err) { showError(err.message); }
    finally { setAddingEntry(false); }
  };

  const handleDeleteEntry = async (entryId) => {
    try {
      await deleteEntry(authFetch, entryId);
      await loadMap(selectedMap.id);
    } catch (err) { showError(err.message); }
  };

  const copySnippet = () => {
    if (!selectedMap?.snippet) return;
    navigator.clipboard.writeText(selectedMap.snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const copyUrl = (entry) => {
    const base = selectedMap.landing_page_url || 'https://yourdomain.com/page';
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}${selectedMap.param_name}=${entry.key}`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(entry.id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Get all before/after images from personas for quick import
  const personaImages = personas.flatMap(p =>
    (p.images || [])
      .filter(img => ['before_after', 'after'].includes(img.category))
      .map(img => ({
        personaName: p.name,
        personaId: p.id,
        category: img.category,
        url: img.url,
        id: img.id,
      }))
  );

  const handleImportSelected = async () => {
    if (!selectedPersonaImages.length) return;

    // If base image is set, generate composites; otherwise import as plain entries
    if (selectedMap.base_image_url) {
      setGeneratingComposites(true);
      try {
        const keys = selectedPersonaImages.map(img =>
          img.personaName.toLowerCase().replace(/\s+/g, '_') + '_' + img.category
        );
        const labels = selectedPersonaImages.map(img =>
          `${img.personaName} (${img.category})`
        );
        const imageUrls = selectedPersonaImages.map(img => img.url);
        const result = await generateComposites(authFetch, selectedMap.id, { imageUrls, keys, labels });
        showSuccess(`Generated ${result.created?.length || 0} composite images`);
        setSelectedPersonaImages([]);
        setShowImport(false);
        await loadMap(selectedMap.id);
      } catch (err) { showError(err.message); }
      finally { setGeneratingComposites(false); }
    } else {
      setAddingEntry(true);
      try {
        for (const img of selectedPersonaImages) {
          const key = img.personaName.toLowerCase().replace(/\s+/g, '_') + '_' + img.category;
          await addEntry(authFetch, selectedMap.id, {
            key,
            image_url: img.url,
            label: `${img.personaName} (${img.category})`,
          }).catch(() => {}); // skip duplicates
        }
        setSelectedPersonaImages([]);
        setShowImport(false);
        await loadMap(selectedMap.id);
        showSuccess('Images imported');
      } catch (err) { showError(err.message); }
      finally { setAddingEntry(false); }
    }
  };

  const togglePersonaImage = (img) => {
    setSelectedPersonaImages(prev =>
      prev.find(i => i.id === img.id)
        ? prev.filter(i => i.id !== img.id)
        : [...prev, img]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Image className="w-7 h-7 text-purple-400" />
            Hero Sync
          </h1>
          <p className="text-gray-400 mt-1">
            Match landing page hero images to the ad creative users clicked
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Map
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">New Hero Map</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={newMap.name}
                onChange={e => setNewMap(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Weight Loss Advertorial"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Brand</label>
              <select
                value={newMap.brand_id}
                onChange={e => setNewMap(prev => ({ ...prev, brand_id: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="">No brand</option>
                {(brands || []).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Links this map to a brand. New personas in this brand auto-add here.
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Landing Page URL</label>
              <input
                type="text"
                value={newMap.landing_page_url}
                onChange={e => setNewMap(prev => ({ ...prev, landing_page_url: e.target.value }))}
                placeholder="https://yourdomain.com/article"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">CSS Selector (hero image)</label>
              <input
                type="text"
                value={newMap.image_selector}
                onChange={e => setNewMap(prev => ({ ...prev, image_selector: e.target.value }))}
                placeholder="img"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                CSS selector for the hero image. Default "img" targets the first image on the page.
                Use ".hero img" or "#main-image" for more specificity.
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">URL Param Name</label>
              <input
                type="text"
                value={newMap.param_name}
                onChange={e => setNewMap(prev => ({ ...prev, param_name: e.target.value }))}
                placeholder="img"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Base Image URL (e.g. doctor photo)</label>
              <input
                type="text"
                value={newMap.base_image_url}
                onChange={e => setNewMap(prev => ({ ...prev, base_image_url: e.target.value }))}
                placeholder="https://r2.dev/doctor.jpg"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                If set, importing persona images will auto-generate composites (base + before/after stitched together).
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Layout</label>
              <select
                value={newMap.layout}
                onChange={e => setNewMap(prev => ({ ...prev, layout: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="left_base">Doctor Left, Before/After Right</option>
                <option value="right_base">Before/After Left, Doctor Right</option>
                <option value="side_by_side">50/50 Side by Side</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Map
            </button>
            <button onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map List */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Maps</h2>
          {maps.length === 0 ? (
            <p className="text-gray-500 text-sm">No hero maps yet.</p>
          ) : (
            maps.map(m => (
              <button
                key={m.id}
                onClick={() => loadMap(m.id)}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedMap?.id === m.id
                    ? 'bg-purple-600/10 border-purple-500'
                    : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white text-sm">{m.name}</span>
                  <span className="text-xs text-gray-500">{m.entry_count} images</span>
                </div>
                {m.landing_page_url && (
                  <p className="text-xs text-gray-500 mt-1 truncate">{m.landing_page_url}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-600">
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Map Detail */}
        <div className="lg:col-span-2">
          {selectedMap ? (
            <div className="space-y-4">
              {/* Map header */}
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-white">{selectedMap.name}</h2>
                  <div className="flex items-center gap-2">
                    <button onClick={() => loadMap(selectedMap.id)}
                      className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">URL Param</span>
                    <p className="text-white font-mono text-xs">?{selectedMap.param_name}=...</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Selector</span>
                    <p className="text-white font-mono text-xs">{selectedMap.image_selector}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Layout</span>
                    <p className="text-white text-xs">{selectedMap.layout === 'left_base' ? 'Doctor Left' : selectedMap.layout === 'right_base' ? 'Doctor Right' : '50/50'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Images</span>
                    <p className="text-white">{selectedMap.entries?.length || 0}</p>
                  </div>
                </div>

                {/* Base image preview */}
                {selectedMap.base_image_url && (
                  <div className="mt-3 flex items-center gap-3 bg-gray-900/50 rounded-lg p-2">
                    <img src={selectedMap.base_image_url} alt="Base" className="w-14 h-14 object-cover rounded" />
                    <div>
                      <span className="text-xs text-gray-500">Base Image (doctor)</span>
                      <p className="text-xs text-gray-400 truncate max-w-xs">{selectedMap.base_image_url}</p>
                    </div>
                  </div>
                )}
                {!selectedMap.base_image_url && (
                  <p className="text-xs text-yellow-400/70 mt-2">
                    No base image set — importing personas will add images as-is without compositing.
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex gap-3 mt-4 flex-wrap">
                  <button onClick={() => setShowAddEntry(!showAddEntry)}
                    className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm">
                    <Plus className="w-4 h-4" /> Add Image
                  </button>
                  {personaImages.length > 0 && (
                    <button onClick={() => setShowImport(!showImport)}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
                      <Image className="w-4 h-4" />
                      {selectedMap.base_image_url ? 'Generate Composites from Personas' : 'Import from Personas'}
                    </button>
                  )}
                  <button onClick={() => setShowSnippet(!showSnippet)}
                    className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm ml-auto">
                    <Code className="w-4 h-4" /> {showSnippet ? 'Hide' : 'Show'} JS Snippet
                  </button>
                </div>
              </div>

              {/* JS Snippet */}
              {showSnippet && selectedMap.snippet && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-400">
                      LanderLab JS Snippet
                    </h3>
                    <button onClick={copySnippet}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs">
                      {copiedSnippet ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      {copiedSnippet ? 'Copied!' : 'Copy Snippet'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Paste this into your LanderLab page's custom JavaScript section. Update it whenever you add/remove images.
                  </p>
                  <pre className="text-xs text-green-400 bg-black/50 rounded p-3 overflow-x-auto whitespace-pre font-mono">
                    {selectedMap.snippet}
                  </pre>
                </div>
              )}

              {/* Add Entry Form */}
              {showAddEntry && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-white">Add Image Entry</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Key (URL param value)</label>
                      <input
                        type="text"
                        value={newEntry.key}
                        onChange={e => setNewEntry(prev => ({ ...prev, key: e.target.value }))}
                        placeholder="patricia_ba"
                        className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Image URL</label>
                      <input
                        type="text"
                        value={newEntry.image_url}
                        onChange={e => setNewEntry(prev => ({ ...prev, image_url: e.target.value }))}
                        placeholder="https://r2.dev/image.jpg"
                        className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
                      <input
                        type="text"
                        value={newEntry.label}
                        onChange={e => setNewEntry(prev => ({ ...prev, label: e.target.value }))}
                        placeholder="Patricia Before/After"
                        className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddEntry} disabled={addingEntry}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-sm">
                      {addingEntry ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Add
                    </button>
                    <button onClick={() => setShowAddEntry(false)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Import from Personas */}
              {showImport && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-white">
                    Import Before/After Images from Personas ({selectedPersonaImages.length} selected)
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-60 overflow-y-auto">
                    {personaImages.map(img => {
                      const selected = selectedPersonaImages.find(i => i.id === img.id);
                      return (
                        <button
                          key={img.id}
                          onClick={() => togglePersonaImage(img)}
                          className={`flex flex-col items-center gap-1 p-2 rounded border text-xs transition-colors ${
                            selected
                              ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <img src={img.url} alt="" className="w-full h-16 object-cover rounded" />
                          <span className="font-medium text-white truncate w-full text-center">{img.personaName}</span>
                          <span className="text-gray-500">{img.category}</span>
                        </button>
                      );
                    })}
                  </div>
                  {personaImages.length === 0 && (
                    <p className="text-gray-500 text-sm">No before/after images found on active personas.</p>
                  )}
                  {selectedMap.base_image_url && selectedPersonaImages.length > 0 && (
                    <p className="text-xs text-purple-400">
                      Each selected image will be composited with the base doctor image ({selectedMap.layout === 'left_base' ? 'doctor left, B/A right' : selectedMap.layout === 'right_base' ? 'B/A left, doctor right' : '50/50 split'}) and uploaded to R2.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={handleImportSelected}
                      disabled={!selectedPersonaImages.length || addingEntry || generatingComposites}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded text-sm">
                      {(addingEntry || generatingComposites) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
                      {selectedMap.base_image_url
                        ? `Generate ${selectedPersonaImages.length} Composites`
                        : `Import ${selectedPersonaImages.length} Images`}
                    </button>
                    <button onClick={() => { setShowImport(false); setSelectedPersonaImages([]); }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Entries */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">
                  Image Entries ({selectedMap.entries?.length || 0})
                </h3>

                {(!selectedMap.entries || selectedMap.entries.length === 0) ? (
                  <p className="text-gray-500 text-sm">No images yet. Add entries or import from personas.</p>
                ) : (
                  selectedMap.entries.map(entry => (
                    <div key={entry.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-4">
                      {/* Thumbnail */}
                      <img src={entry.image_url} alt="" className="w-16 h-16 object-cover rounded shrink-0" />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                            {selectedMap.param_name}={entry.key}
                          </code>
                          {entry.label && (
                            <span className="text-sm text-gray-400">{entry.label}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">{entry.image_url}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => copyUrl(entry)}
                          className="px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-1"
                          title="Copy full URL with param">
                          {copiedUrl === entry.id ? <Check className="w-3 h-3 text-green-400" /> : <Link2 className="w-3 h-3" />}
                          {copiedUrl === entry.id ? 'Copied' : 'Copy URL'}
                        </button>
                        <button onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1.5 text-gray-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* URL Reference */}
              {selectedMap.entries?.length > 0 && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Ad Destination URLs</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Use these URLs as the destination for each ad creative. The landing page hero will automatically match.
                  </p>
                  <div className="space-y-1.5">
                    {selectedMap.entries.map(entry => {
                      const base = selectedMap.landing_page_url || 'https://yourdomain.com/page';
                      const sep = base.includes('?') ? '&' : '?';
                      const url = `${base}${sep}${selectedMap.param_name}=${entry.key}`;
                      return (
                        <div key={entry.id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-28 truncate shrink-0">{entry.label || entry.key}</span>
                          <code className="text-xs text-blue-400 bg-black/30 px-2 py-1 rounded flex-1 truncate font-mono">{url}</code>
                          <button onClick={() => copyUrl(entry)}
                            className="text-gray-500 hover:text-white transition-colors shrink-0">
                            {copiedUrl === entry.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              <div className="text-center">
                <Image className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p>Select a map or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HeroSync;
