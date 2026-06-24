import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Star, MapPin, Briefcase, FileText, MessageSquare, Image, Loader2, ChevronDown, ChevronLeft, Pencil, MinusCircle, Rocket, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getWinners, demoteWinner, updateWinnerNotes } from '../lib/personaApi';

const Winners = () => {
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();

  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOffer, setSelectedOffer] = useState(null); // null = show offer cards
  const [editingNotes, setEditingNotes] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [editOffers, setEditOffers] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [demotingId, setDemotingId] = useState(null);
  const [showDemoteConfirm, setShowDemoteConfirm] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);

  const fetchWinners = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWinners(authFetch);
      setWinners(data);
    } catch (err) {
      showError('Failed to load winners');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { fetchWinners(); }, [fetchWinners]);

  // Group winners by offer
  const offerGroups = {};
  winners.forEach(w => {
    (w.winner_proven_offers || ['uncategorized']).forEach(offer => {
      if (!offerGroups[offer]) offerGroups[offer] = [];
      if (!offerGroups[offer].find(p => p.id === w.id)) {
        offerGroups[offer].push(w);
      }
    });
  });
  const offerNames = Object.keys(offerGroups).sort();

  const filteredWinners = selectedOffer
    ? (offerGroups[selectedOffer] || [])
    : winners;

  const handleDemote = async (personaId) => {
    setDemotingId(personaId);
    try {
      await demoteWinner(authFetch, personaId);
      setWinners(prev => prev.filter(w => w.id !== personaId));
      showSuccess('Persona demoted from winners');
    } catch (err) {
      showError('Failed to demote persona');
    } finally {
      setDemotingId(null);
      setShowDemoteConfirm(null);
    }
  };

  const handleSaveNotes = async (personaId) => {
    setSavingNotes(true);
    try {
      const offersArr = editOffers.split(',').map(s => s.trim()).filter(Boolean);
      const updated = await updateWinnerNotes(authFetch, personaId, {
        notes: editNotes,
        proven_offers: offersArr.length > 0 ? offersArr : null,
      });
      setWinners(prev => prev.map(w => w.id === personaId ? { ...w, ...updated } : w));
      setEditingNotes(null);
      showSuccess('Notes updated');
    } catch (err) {
      showError('Failed to update notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const startEditNotes = (persona) => {
    setEditingNotes(persona.id);
    setEditNotes(persona.winner_notes || '');
    setEditOffers((persona.winner_proven_offers || []).join(', '));
  };

  const genderColor = (g) => g === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700';

  // Offer card colors
  const offerColors = [
    'from-amber-500 to-orange-500',
    'from-emerald-500 to-teal-500',
    'from-violet-500 to-purple-500',
    'from-rose-500 to-pink-500',
    'from-blue-500 to-indigo-500',
    'from-cyan-500 to-sky-500',
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            {selectedOffer && (
              <button
                onClick={() => setSelectedOffer(null)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <div className="p-2 bg-amber-100 rounded-xl">
              <Trophy size={28} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {selectedOffer ? selectedOffer : 'Winning Personas'}
              </h1>
              <p className="text-sm text-gray-500">
                {selectedOffer
                  ? `${filteredWinners.length} winner${filteredWinners.length !== 1 ? 's' : ''} proven on ${selectedOffer}`
                  : `${winners.length} proven winner${winners.length !== 1 ? 's' : ''} across ${offerNames.length} offer${offerNames.length !== 1 ? 's' : ''}`
                }
              </p>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-amber-500" size={32} />
          </div>
        )}

        {/* Empty state */}
        {!loading && winners.length === 0 && (
          <div className="text-center py-20">
            <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No winning personas yet</h3>
            <p className="text-sm text-gray-500 mb-4">
              Promote your best-performing personas from the Persona Farm to see them here.
            </p>
            <button
              onClick={() => navigate('/persona-farm')}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              Go to Persona Farm
            </button>
          </div>
        )}

        {/* ── Offer Cards (landing view) ── */}
        {!loading && winners.length > 0 && !selectedOffer && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {offerNames.map((offer, i) => {
              const group = offerGroups[offer];
              const thumbnails = group.slice(0, 3).map(w => w.thumbnail_url).filter(Boolean);
              return (
                <button
                  key={offer}
                  onClick={() => setSelectedOffer(offer)}
                  className="text-left bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all group"
                >
                  {/* Gradient header */}
                  <div className={`h-3 bg-gradient-to-r ${offerColors[i % offerColors.length]}`} />
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xl font-bold text-gray-900 capitalize">{offer}</h2>
                      <span className="text-sm font-medium text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                        {group.length} winner{group.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Thumbnail stack */}
                    <div className="flex items-center mb-4">
                      <div className="flex -space-x-3">
                        {thumbnails.map((url, j) => (
                          <img
                            key={j}
                            src={url}
                            alt=""
                            className="w-10 h-10 rounded-full border-2 border-white object-cover"
                          />
                        ))}
                        {group.length > 3 && (
                          <div className="w-10 h-10 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500">
                            +{group.length - 3}
                          </div>
                        )}
                        {thumbnails.length === 0 && (
                          <div className="w-10 h-10 rounded-full border-2 border-white bg-amber-100 flex items-center justify-center">
                            <Users size={16} className="text-amber-500" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Names preview */}
                    <p className="text-sm text-gray-500">
                      {group.slice(0, 3).map(w => w.name).join(', ')}
                      {group.length > 3 ? ` +${group.length - 3} more` : ''}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Winner cards for selected offer ── */}
        {!loading && winners.length > 0 && selectedOffer && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredWinners.map(persona => (
              <div
                key={persona.id}
                className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/persona-farm/${persona.id}`)}
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {persona.thumbnail_url ? (
                      <img
                        src={persona.thumbnail_url}
                        alt={persona.name}
                        className="w-16 h-16 rounded-full object-cover border-2 border-amber-300 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center border-2 border-amber-300 shrink-0">
                        <Star size={24} className="text-amber-500" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">{persona.name}</h3>
                        <Trophy size={16} className="text-amber-500 shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${genderColor(persona.gender)}`}>
                          {persona.gender === 'female' ? 'Female' : 'Male'}, {persona.age}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-sm text-gray-500">
                        <MapPin size={13} className="text-gray-400" />
                        <span>{persona.location_city}, {persona.location_state}</span>
                      </div>
                      {persona.occupation && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-gray-500">
                          <Briefcase size={13} className="text-gray-400" />
                          <span>{persona.occupation}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {persona.personality_voice && (
                    <p className="mt-3 text-sm text-gray-600 italic line-clamp-2">
                      "{persona.personality_voice.slice(0, 120)}{persona.personality_voice.length > 120 ? '...' : ''}"
                    </p>
                  )}

                  {persona.winner_proven_offers && persona.winner_proven_offers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {persona.winner_proven_offers.map(offer => (
                        <span key={offer} className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          {offer}
                        </span>
                      ))}
                    </div>
                  )}

                  {editingNotes === persona.id ? (
                    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes about this winner..."
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                        rows={3}
                      />
                      <input
                        value={editOffers}
                        onChange={(e) => setEditOffers(e.target.value)}
                        placeholder="Proven offers (comma-separated)"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveNotes(persona.id)} disabled={savingNotes}
                          className="px-3 py-1 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
                          {savingNotes ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingNotes(null)}
                          className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : persona.winner_notes ? (
                    <div className="mt-3 p-2.5 bg-amber-50 rounded-lg">
                      <p className="text-sm text-gray-700">{persona.winner_notes}</p>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><FileText size={12} /> {persona.post_count} posts</span>
                    <span className="flex items-center gap-1"><MessageSquare size={12} /> {persona.comment_count} comments</span>
                    <span className="flex items-center gap-1"><Image size={12} /> {persona.prompt_count} prompts</span>
                  </div>

                  {persona.winner_promoted_at && (
                    <p className="mt-2 text-xs text-gray-400">
                      Promoted {new Date(persona.winner_promoted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button
                        onClick={() => setExpandedCard(expandedCard === persona.id ? null : persona.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                      >
                        <Rocket size={13} /> Deploy <ChevronDown size={12} />
                      </button>
                      {expandedCard === persona.id && (
                        <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 z-10 py-1">
                          <button onClick={() => { setExpandedCard(null); navigate(`/persona-farm?persona=${persona.id}&action=assign-page`); }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50">Assign to Page</button>
                          <button onClick={() => { setExpandedCard(null); navigate(`/persona-farm?persona=${persona.id}&action=generate`); }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50">Generate Content</button>
                          <button onClick={() => { setExpandedCard(null); navigate(`/comment-farm?persona=${persona.id}`); }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50">Start Comment Farm Job</button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => startEditNotes(persona)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                      <Pencil size={12} /> Notes
                    </button>
                  </div>
                  {showDemoteConfirm === persona.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600">Remove?</span>
                      <button onClick={() => handleDemote(persona.id)} disabled={demotingId === persona.id}
                        className="px-2 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50">
                        {demotingId === persona.id ? '...' : 'Yes'}
                      </button>
                      <button onClick={() => setShowDemoteConfirm(null)}
                        className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowDemoteConfirm(persona.id)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors" title="Remove from winners">
                      <MinusCircle size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Winners;
