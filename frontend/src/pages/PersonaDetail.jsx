import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Zap, MapPin, Briefcase, User, BookOpen,
  MessageSquare, FileText, Image, Link2, Loader2, Trash2,
  Plus, Copy, Check, Upload, Camera, Scale, Calendar,
  Heart, AlertTriangle, Globe, Save, X, Send, Sprout,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ContentCopyCard from '../components/ContentCopyCard';
import GenerateContentModal from '../components/GenerateContentModal';
import ConfirmationModal from '../components/ConfirmationModal';
import {
  getPersona, updatePersona, deletePersona, getPersonaPosts, getPersonaComments, getPersonaImagePrompts,
  updatePost, updateComment, updateImagePrompt,
  deletePost, deleteComment, deleteImagePrompt,
  generateContent, generateHeadlines, publishPost, getPagePosts,
  getAffiliateUrls, createAffiliateUrl, deleteAffiliateUrl,
  getPersonaImages, uploadPersonaImage, deletePersonaImage,
} from '../lib/personaApi';
import { getConnections } from '../api/facebookConnections';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const TABS = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'images', label: 'Images', icon: Camera },
  { id: 'posts', label: 'Posts', icon: FileText },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'prompts', label: 'Image Prompts', icon: Image },
  { id: 'urls', label: 'Affiliate URLs', icon: Link2 },
];

const COMMENT_TYPE_ORDER = ['author_link', 'support_short', 'support_story', 'support_photo', 'reply_to_real'];
const COMMENT_TYPE_LABELS = {
  author_link: 'Type A: Author Link Drops',
  support_short: 'Type B: Short Reactions',
  support_story: 'Type C: Story Comments',
  support_photo: 'Type D: Photo Comments',
  reply_to_real: 'Type E: Reply Templates',
};

const PROMPT_TYPE_ORDER = ['profile', 'before', 'after', 'old_clothes', 'old_clothes_pants', 'old_clothes_underwear', 'comment_photo'];
const PROMPT_TYPE_LABELS = {
  profile: 'Profile Photos',
  before: 'Before Photos',
  after: 'After Photos',
  old_clothes: 'Old Clothes (Legacy)',
  old_clothes_pants: 'Old Clothes - Pants',
  old_clothes_underwear: 'Old Clothes - Underwear',
  comment_photo: 'Comment Photos',
};

const IMAGE_CATEGORIES = [
  { id: 'before', label: 'Before' },
  { id: 'after', label: 'After' },
  { id: 'before_after', label: 'Before & After' },
  { id: 'old_clothes', label: 'Old Clothes' },
  { id: 'profile', label: 'Profile' },
  { id: 'lifestyle', label: 'Lifestyle' },
];

const PersonaDetail = () => {
  const { personaId } = useParams();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const { showSuccess, showError } = useToast();

  const [persona, setPersona] = useState(null);
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [affiliateUrls, setAffiliateUrls] = useState([]);
  const [images, setImages] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeletePersona, setShowDeletePersona] = useState(false);
  const [newUrl, setNewUrl] = useState({ url: '', domain: '' });

  // Publish to FB state
  const [publishingPostId, setPublishingPostId] = useState(null);
  const [showPublishModal, setShowPublishModal] = useState(null); // post id or null
  const [publishImageUrl, setPublishImageUrl] = useState('');
  const [publishConnectionId, setPublishConnectionId] = useState('');
  const [connections, setConnections] = useState([]);

  // Page posts (fetched from FB)
  const [pagePosts, setPagePosts] = useState([]);
  const [loadingPagePosts, setLoadingPagePosts] = useState(false);
  const [pagePostsConnectionId, setPagePostsConnectionId] = useState('');
  const [copiedPostId, setCopiedPostId] = useState(null);

  // FB pages, ad accounts & domains for assignment
  const [fbPages, setFbPages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [domains, setDomains] = useState([]);

  const loadData = useCallback(async () => {
    try {
      const personaData = await getPersona(authFetch, personaId);
      setPersona(personaData);

      const [postsData, commentsData, promptsData, urlsData, imagesData] = await Promise.all([
        getPersonaPosts(authFetch, personaId).catch((err) => { console.error('Posts load error:', err); return []; }),
        getPersonaComments(authFetch, personaId).catch((err) => { console.error('Comments load error:', err); return []; }),
        getPersonaImagePrompts(authFetch, personaId).catch((err) => { console.error('Prompts load error:', err); return []; }),
        getAffiliateUrls(authFetch).catch(() => []),
        getPersonaImages(authFetch, personaId).catch(() => []),
      ]);
      setPosts(postsData);
      setComments(commentsData);
      setPrompts(promptsData);
      setAffiliateUrls(urlsData);
      setImages(imagesData);
    } catch (err) {
      showError('Failed to load persona');
      console.error('Persona load error:', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch, personaId]);

  // Load FB pages and domains for assignment dropdowns
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [pagesRes, accountsRes, domainsRes, connData] = await Promise.all([
          authFetch(`${API_URL}/tracked-pages`).then(r => r.ok ? r.json() : []).catch(() => []),
          authFetch(`${API_URL}/ad-accounts`).then(r => r.ok ? r.json() : []).catch(() => []),
          authFetch(`${API_URL}/domains`).then(r => r.ok ? r.json() : []).catch(() => []),
          getConnections(authFetch).catch(() => []),
        ]);
        setFbPages(Array.isArray(pagesRes) ? pagesRes : []);
        setAdAccounts(Array.isArray(accountsRes) ? accountsRes : []);
        setDomains(Array.isArray(domainsRes) ? domainsRes : []);
        setConnections(Array.isArray(connData) ? connData : []);
      } catch { /* ignore */ }
    };
    loadOptions();
  }, [authFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = async ({ contentType, model }) => {
    setIsGenerating(true);
    setGenerateResult(null);
    try {
      const result = await generateContent(authFetch, personaId, contentType, model);
      setGenerateResult(result);
      showSuccess(`Generated content for ${persona.name}`);
      await loadData();
    } catch (err) {
      setGenerateResult({ error: err.message });
      showError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdatePersona = async (updates) => {
    try {
      const updated = await updatePersona(authFetch, personaId, updates);
      setPersona(updated);
      showSuccess('Persona updated');
    } catch (err) {
      showError('Failed to update persona');
    }
  };

  const handlePostStatusChange = async (postId, newStatus) => {
    try {
      await updatePost(authFetch, postId, { status: newStatus });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p));
      showSuccess('Post status updated');
    } catch (err) {
      showError('Failed to update post status');
    }
  };

  const handlePostTextChange = async (postId, newText) => {
    try {
      await updatePost(authFetch, postId, { body_text: newText });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, body_text: newText } : p));
      showSuccess('Post text updated');
    } catch (err) {
      showError('Failed to update post');
    }
  };

  const handlePostHeadlineChange = async (postId, newHeadline) => {
    try {
      await updatePost(authFetch, postId, { headline: newHeadline });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, headline: newHeadline } : p));
      showSuccess('Headline updated');
    } catch (err) {
      showError('Failed to update headline');
    }
  };

  const [generatingHeadlines, setGeneratingHeadlines] = useState(false);
  const handleGenerateHeadlines = async () => {
    setGeneratingHeadlines(true);
    try {
      const result = await generateHeadlines(authFetch, personaId);
      showSuccess(result.message);
      if (result.updated > 0) await loadData();
    } catch (err) {
      showError(err.message || 'Failed to generate headlines');
    } finally {
      setGeneratingHeadlines(false);
    }
  };

  const handleCommentTextChange = async (commentId, newText) => {
    try {
      await updateComment(authFetch, commentId, { body_text: newText });
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, body_text: newText } : c));
      showSuccess('Comment updated');
    } catch (err) {
      showError('Failed to update comment');
    }
  };

  const handlePromptStatusChange = async (promptId, newStatus) => {
    try {
      await updateImagePrompt(authFetch, promptId, { status: newStatus });
      setPrompts(prev => prev.map(p => p.id === promptId ? { ...p, status: newStatus } : p));
      showSuccess('Prompt status updated');
    } catch (err) {
      showError('Failed to update prompt');
    }
  };

  const handlePublishPost = async (postId) => {
    if (!publishConnectionId) {
      showError('Select a Facebook connection first');
      return;
    }
    setPublishingPostId(postId);
    try {
      const result = await publishPost(authFetch, personaId, postId, {
        connectionId: publishConnectionId,
        imageUrl: publishImageUrl || null,
      });
      showSuccess(`Published! FB Post ID: ${result.fb_post_id}`);
      setShowPublishModal(null);
      setPublishImageUrl('');
      await loadData();
    } catch (err) {
      showError(err.message);
    } finally {
      setPublishingPostId(null);
    }
  };

  const handleFetchPagePosts = async (connId) => {
    if (!connId) return;
    setLoadingPagePosts(true);
    try {
      const data = await getPagePosts(authFetch, personaId, connId);
      setPagePosts(data.posts || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoadingPagePosts(false);
    }
  };

  const copyPostId = (postId) => {
    navigator.clipboard.writeText(postId);
    setCopiedPostId(postId);
    setTimeout(() => setCopiedPostId(null), 2000);
  };

  const handleDeletePost = async (postId) => {
    try {
      await deletePost(authFetch, postId);
      setPosts(prev => prev.filter(p => p.id !== postId));
      showSuccess('Post deleted');
    } catch (err) {
      showError('Failed to delete post');
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await deleteComment(authFetch, commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      showSuccess('Comment deleted');
    } catch (err) {
      showError('Failed to delete comment');
    }
  };

  const handleDeletePrompt = async (promptId) => {
    try {
      await deleteImagePrompt(authFetch, promptId);
      setPrompts(prev => prev.filter(p => p.id !== promptId));
      showSuccess('Prompt deleted');
    } catch (err) {
      showError('Failed to delete prompt');
    }
  };

  const handleAddUrl = async () => {
    if (!newUrl.url || !newUrl.domain) {
      showError('URL and domain are required');
      return;
    }
    try {
      const created = await createAffiliateUrl(authFetch, { ...newUrl, offer: persona?.offer || 'akemi' });
      setAffiliateUrls(prev => [...prev, created]);
      setNewUrl({ url: '', domain: '' });
      showSuccess('Affiliate URL added');
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDeleteUrl = async (urlId) => {
    try {
      await deleteAffiliateUrl(authFetch, urlId);
      setAffiliateUrls(prev => prev.filter(u => u.id !== urlId));
      showSuccess('Affiliate URL deleted');
    } catch (err) {
      showError('Failed to delete URL');
    }
  };

  const handleImageUpload = async (file, category, notes) => {
    try {
      const newImage = await uploadPersonaImage(authFetch, personaId, file, category, notes);
      setImages(prev => [...prev, newImage]);
      showSuccess('Image uploaded');
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDeleteImage = async (imageId) => {
    try {
      await deletePersonaImage(authFetch, imageId);
      setImages(prev => prev.filter(i => i.id !== imageId));
      showSuccess('Image deleted');
    } catch (err) {
      showError('Failed to delete image');
    }
  };

  const handleDeletePersona = async () => {
    try {
      await deletePersona(authFetch, personaId);
      showSuccess(`Persona "${persona.name}" deleted`);
      navigate('/persona-farm');
    } catch (err) {
      showError('Failed to delete persona');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!persona) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Persona not found</p>
        <button onClick={() => navigate('/persona-farm')} className="text-amber-600 mt-2 hover:underline">Back to Persona Farm</button>
      </div>
    );
  }

  const groupedComments = COMMENT_TYPE_ORDER.reduce((acc, type) => {
    acc[type] = comments.filter(c => c.comment_type === type);
    return acc;
  }, {});

  const groupedPrompts = PROMPT_TYPE_ORDER.reduce((acc, type) => {
    acc[type] = prompts.filter(p => p.prompt_type === type);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <button onClick={() => navigate('/persona-farm')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{persona.name}</h1>
            <p className="text-xs sm:text-sm text-gray-500">
              {persona.gender === 'female' ? 'Female' : 'Male'}, {persona.age}
              {persona.posting_about && <span className="text-amber-600"> &middot; Posting about {persona.posting_about}</span>}
              {' '}&middot; {persona.location_city}, {persona.location_state}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-11 sm:ml-0 self-start">
          <button
            onClick={() => { setGenerateResult(null); setShowGenerateModal(true); }}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm flex items-center gap-2"
          >
            <Zap size={16} />
            Generate Content
          </button>
          <button
            onClick={() => setShowDeletePersona(true)}
            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete Persona"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            let count = null;
            if (tab.id === 'posts') count = posts.length;
            if (tab.id === 'comments') count = comments.length;
            if (tab.id === 'prompts') count = prompts.length;
            if (tab.id === 'images') count = images.length;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={14} className="sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                {count !== null && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          persona={persona}
          fbPages={fbPages}
          adAccounts={adAccounts}
          domains={domains}
          onUpdate={handleUpdatePersona}
          prompts={prompts}
        />
      )}

      {activeTab === 'images' && (
        <ImagesTab
          images={images}
          onUpload={handleImageUpload}
          onDelete={handleDeleteImage}
        />
      )}

      {activeTab === 'posts' && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            {posts.length > 0 && posts.some(p => !p.headline) && (
              <button
                onClick={handleGenerateHeadlines}
                disabled={generatingHeadlines}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {generatingHeadlines ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Generate Missing Headlines
              </button>
            )}
            <button
              onClick={() => { setGenerateResult(null); handleGenerate({ contentType: 'posts', model: 'sonnet' }); }}
              disabled={isGenerating}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Generate More Posts
            </button>
          </div>
          {posts.length === 0 ? (
            <EmptyState icon={FileText} title="No posts generated" description="Generate posts for this persona to get started." />
          ) : (
            posts.map(post => (
              <div key={post.id}>
                <ContentCopyCard
                  type={post.post_type}
                  headline={post.headline}
                  text={post.body_text}
                  status={post.status}
                  onStatusChange={(s) => handlePostStatusChange(post.id, s)}
                  onTextChange={(t) => handlePostTextChange(post.id, t)}
                  onHeadlineChange={(h) => handlePostHeadlineChange(post.id, h)}
                  onDelete={() => handleDeletePost(post.id)}
                />
                {/* Publish + Seed Comments buttons */}
                <div className="flex items-center gap-2 mt-2 ml-1">
                  {post.status !== 'posted' && persona?.fb_page_id ? (
                    showPublishModal === post.id ? (
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3 w-full">
                        <select
                          value={publishConnectionId}
                          onChange={e => setPublishConnectionId(e.target.value)}
                          className="text-xs border border-gray-300 rounded px-2 py-1.5"
                        >
                          <option value="">Connection...</option>
                          {connections.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <select
                          value={publishImageUrl}
                          onChange={e => setPublishImageUrl(e.target.value)}
                          className="text-xs border border-gray-300 rounded px-2 py-1.5 flex-1"
                        >
                          <option value="">No photo</option>
                          {images.filter(img => ['before_after', 'after', 'before', 'lifestyle', 'old_clothes'].includes(img.category)).map(img => (
                            <option key={img.id} value={img.url}>{img.category} — {img.filename || img.url.split('/').pop()}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handlePublishPost(post.id)}
                          disabled={publishingPostId === post.id}
                          className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {publishingPostId === post.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          Post
                        </button>
                        <button
                          onClick={() => setShowPublishModal(null)}
                          className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowPublishModal(post.id)}
                        className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1"
                      >
                        <Send size={12} />
                        Publish to FB
                      </button>
                    )
                  ) : null}
                  {post.status === 'posted' && post.fb_post_id && (
                    <>
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Check size={12} /> Published
                      </span>
                      <button
                        onClick={() => navigate(`/comment-farm?post_id=${post.fb_post_id}&persona_id=${personaId}&post_text=${encodeURIComponent(post.body_text?.substring(0, 500) || '')}`)}
                        className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1"
                      >
                        <Sprout size={12} />
                        Seed Comments
                      </button>
                    </>
                  )}
                  {!persona?.fb_page_id && post.status !== 'posted' && (
                    <span className="text-xs text-gray-400">Assign an FB page to publish</span>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Live Page Posts from Facebook */}
          {persona?.fb_page_id && (
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Globe size={16} className="text-blue-500" />
                  Live Page Posts
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    value={pagePostsConnectionId}
                    onChange={e => setPagePostsConnectionId(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="">Connection...</option>
                    {connections.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleFetchPagePosts(pagePostsConnectionId)}
                    disabled={!pagePostsConnectionId || loadingPagePosts}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {loadingPagePosts ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                    Fetch Posts
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Fetch recent posts from this persona's FB page to get post IDs for Comment Farm.
              </p>

              {pagePosts.length > 0 && (
                <div className="space-y-2">
                  {pagePosts.map(fp => (
                    <div key={fp.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 line-clamp-2">
                            {fp.message || '(no text)'}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs text-gray-400">
                              {new Date(fp.created_time).toLocaleString()}
                            </span>
                            <code className="text-xs bg-gray-200 px-1.5 py-0.5 rounded font-mono text-gray-600">
                              {fp.id}
                            </code>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => copyPostId(fp.id)}
                            className="px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors flex items-center gap-1"
                            title="Copy post ID"
                          >
                            {copiedPostId === fp.id ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                            {copiedPostId === fp.id ? 'Copied' : 'Copy ID'}
                          </button>
                          <button
                            onClick={() => navigate(`/comment-farm?post_id=${fp.id}&persona_id=${personaId}&post_text=${encodeURIComponent((fp.message || '').substring(0, 500))}`)}
                            className="px-2.5 py-1.5 text-xs bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Sprout size={12} />
                            Seed
                          </button>
                          {fp.permalink_url && (
                            <a
                              href={fp.permalink_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1"
                            >
                              <Globe size={12} />
                              View
                            </a>
                          )}
                        </div>
                      </div>
                      {fp.full_picture && (
                        <img src={fp.full_picture} alt="" className="mt-2 rounded max-h-32 object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'comments' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => { setGenerateResult(null); handleGenerate({ contentType: 'comments', model: 'sonnet' }); }}
              disabled={isGenerating}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Generate More Comments
            </button>
          </div>
          {comments.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No comments generated" description="Generate comments for this persona to get started." />
          ) : (
            COMMENT_TYPE_ORDER.map(type => {
              const items = groupedComments[type];
              if (!items || items.length === 0) return null;
              return (
                <div key={type}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">
                    {COMMENT_TYPE_LABELS[type]} ({items.length})
                  </h3>
                  <div className="space-y-3">
                    {items.map(comment => (
                      <ContentCopyCard
                        key={comment.id}
                        type={comment.comment_type}
                        text={comment.body_text}
                        status={comment.status}
                        onTextChange={(t) => handleCommentTextChange(comment.id, t)}
                        onDelete={() => handleDeleteComment(comment.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'prompts' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => { setGenerateResult(null); handleGenerate({ contentType: 'image_prompts', model: 'sonnet' }); }}
              disabled={isGenerating}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Generate More Prompts
            </button>
          </div>
          <HiggsFieldReminder />
          {prompts.length === 0 ? (
            <EmptyState icon={Image} title="No image prompts generated" description="Generate image prompts for this persona to get started." />
          ) : (
            PROMPT_TYPE_ORDER.map(type => {
              const items = groupedPrompts[type];
              if (!items || items.length === 0) return null;
              return (
                <div key={type}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">
                    {PROMPT_TYPE_LABELS[type]} ({items.length})
                  </h3>
                  <div className="space-y-3">
                    {items.map(prompt => (
                      <ContentCopyCard
                        key={prompt.id}
                        type={prompt.prompt_type}
                        text={prompt.prompt_text}
                        status={prompt.status}
                        onStatusChange={(s) => handlePromptStatusChange(prompt.id, s)}
                        onDelete={() => handleDeletePrompt(prompt.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'urls' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Affiliate URL</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="Full URL (https://...)"
                value={newUrl.url}
                onChange={(e) => setNewUrl(prev => ({ ...prev, url: e.target.value }))}
                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Domain"
                  value={newUrl.domain}
                  onChange={(e) => setNewUrl(prev => ({ ...prev, domain: e.target.value }))}
                  className="flex-1 sm:w-48 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
                <button
                  onClick={handleAddUrl}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>
          </div>

          {affiliateUrls.length === 0 ? (
            <EmptyState icon={Link2} title="No affiliate URLs" description="Add affiliate URLs to use in author link drop comments." />
          ) : (
            <>
            {/* Mobile: card view */}
            <div className="sm:hidden space-y-2">
              {affiliateUrls.map(url => (
                <div key={url.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-700 truncate">{url.url}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{url.domain}</span>
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded">{url.offer}</span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteUrl(url.id)} className="p-1 text-red-400 hover:bg-red-50 rounded transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: table view */}
            <div className="hidden sm:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">URL</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Offer</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {affiliateUrls.map(url => (
                    <tr key={url.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700 truncate max-w-xs">{url.url}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{url.domain}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{url.offer}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteUrl(url.id)} className="p-1 text-red-400 hover:bg-red-50 rounded transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {/* Delete Persona Confirmation */}
      {showDeletePersona && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowDeletePersona(false)}>
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete {persona.name}?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">This will permanently delete this persona and all their posts, comments, prompts, and images. This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeletePersona(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { setShowDeletePersona(false); handleDeletePersona(); }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete Persona
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Modal */}
      <GenerateContentModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onGenerate={handleGenerate}
        personaName={persona.name}
        isGenerating={isGenerating}
        result={generateResult}
      />
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const OverviewTab = ({ persona, fbPages, adAccounts, domains, onUpdate, prompts }) => {
  const family = persona.family_details || {};
  const [saving, setSaving] = useState(null);
  const [copiedPrompt, setCopiedPrompt] = useState(null);

  const handleAssignment = async (updates) => {
    const key = Object.keys(updates)[0];
    setSaving(key);
    await onUpdate(updates);
    setSaving(null);
  };

  const assignedPage = fbPages.find(p => p.fb_page_id === persona.fb_page_id);
  const assignedDomain = domains.find(d => d.id === persona.domain_id);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Assignments Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4 lg:col-span-2">
        <h3 className="text-lg font-semibold text-gray-900">Assignments</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">FB Page</label>
            <select
              value={persona.fb_page_id || ''}
              onChange={(e) => handleAssignment({ fb_page_id: e.target.value || null })}
              disabled={saving === 'fb_page_id'}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white disabled:opacity-50"
            >
              <option value="">-- No Page Assigned --</option>
              {fbPages.map(page => (
                <option key={page.id} value={page.fb_page_id}>
                  {page.name || page.fb_page_id}
                </option>
              ))}
            </select>
            {assignedPage && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <Check size={12} /> Assigned: {assignedPage.name}
              </p>
            )}
            {fbPages.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No FB pages found. Sync pages first.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">FB Ad Account</label>
            <select
              value={persona.fb_ad_account_id || ''}
              onChange={(e) => handleAssignment({ fb_ad_account_id: e.target.value || null })}
              disabled={saving === 'fb_ad_account_id'}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white disabled:opacity-50"
            >
              <option value="">-- No Ad Account Assigned --</option>
              {adAccounts.map(acc => (
                <option key={acc.id || acc.ad_account_id} value={acc.ad_account_id}>
                  {acc.name || acc.ad_account_id}
                </option>
              ))}
            </select>
            {persona.fb_ad_account_id && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <Check size={12} /> Assigned: {adAccounts.find(a => a.ad_account_id === persona.fb_ad_account_id)?.name || persona.fb_ad_account_id}
              </p>
            )}
            {adAccounts.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No ad accounts found. Connect FB first.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Domain</label>
            <select
              value={persona.domain_id || ''}
              onChange={(e) => handleAssignment({ domain_id: e.target.value || null })}
              disabled={saving === 'domain_id'}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white disabled:opacity-50"
            >
              <option value="">-- No Domain Assigned --</option>
              {domains.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {assignedDomain && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <Check size={12} /> Assigned: {assignedDomain.name}
              </p>
            )}
            {domains.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No domains found. Add domains first.</p>
            )}
          </div>
        </div>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Profile</h3>
        <div className="space-y-3">
          <InfoRow icon={User} label="Gender / Age" value={`${persona.gender === 'female' ? 'Female' : 'Male'}, ${persona.age}`} />
          {persona.posting_about && (
            <InfoRow icon={User} label="Posting About" value={`${persona.posting_about} (${persona.subject_gender}, ${persona.subject_age})`} />
          )}
          <InfoRow icon={MapPin} label="Location" value={`${persona.location_city}, ${persona.location_state}`} />
          <InfoRow icon={Briefcase} label="Occupation" value={persona.occupation} />
          {persona.ethnicity && <InfoRow icon={User} label="Ethnicity" value={persona.ethnicity} />}
          {persona.hair && <InfoRow icon={User} label="Hair" value={persona.hair} />}
          {persona.distinguishing_features && <InfoRow icon={User} label="Features" value={persona.distinguishing_features} />}
          {family.spouse_name && (
            <InfoRow icon={Heart} label="Spouse" value={`${family.spouse_name}${family.spouse_age ? ` (${family.spouse_age})` : ''}${family.spouse_occupation ? `, ${family.spouse_occupation}` : ''}`} />
          )}
          {family.kids && <InfoRow icon={User} label="Kids" value={family.kids} />}
          {family.grandkids && <InfoRow icon={User} label="Grandkids" value={family.grandkids} />}
          {family.marital_status && <InfoRow icon={User} label="Status" value={family.marital_status} />}
        </div>
      </div>

      {/* Weight Stats Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Weight Journey</h3>
        <div className="space-y-3">
          {persona.before_weight && persona.after_weight && (
            <div className="flex items-center gap-4">
              <div className="text-center px-4 py-2 bg-red-50 rounded-lg">
                <div className="text-xs text-red-500 font-medium">Before</div>
                <div className="text-xl font-bold text-red-700">{persona.before_weight} lbs</div>
              </div>
              <div className="text-gray-400">&rarr;</div>
              <div className="text-center px-4 py-2 bg-green-50 rounded-lg">
                <div className="text-xs text-green-500 font-medium">After</div>
                <div className="text-xl font-bold text-green-700">{persona.after_weight} lbs</div>
              </div>
              {persona.total_lost && (
                <div className="text-center px-4 py-2 bg-amber-50 rounded-lg">
                  <div className="text-xs text-amber-500 font-medium">Lost</div>
                  <div className="text-xl font-bold text-amber-700">{persona.total_lost} lbs</div>
                </div>
              )}
            </div>
          )}
          {persona.timeline_months && (
            <InfoRow icon={Calendar} label="Timeline" value={`${persona.timeline_months} months${persona.start_month ? ` (started ${persona.start_month})` : ''}`} />
          )}
        </div>
      </div>

      {/* Story Angle & Voice */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Story Angle</h3>
        {persona.story_angle && <p className="text-sm text-gray-700 italic leading-relaxed">"{persona.story_angle}"</p>}

        <h3 className="text-lg font-semibold text-gray-900 pt-2">Voice / Style</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{persona.personality_voice}</p>
      </div>

      {/* Shame Moment & Authority Figure */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        {persona.shame_moment && (
          <>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              Shame Moment
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed">{persona.shame_moment}</p>
          </>
        )}
        {persona.authority_figure && (
          <>
            <h3 className="text-lg font-semibold text-gray-900 pt-2">Authority Figure</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{persona.authority_figure}</p>
          </>
        )}
      </div>

      {/* Body Types & Backstory */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4 lg:col-span-2">
        <h3 className="text-lg font-semibold text-gray-900">Backstory</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{persona.weight_loss_backstory}</p>

        {(persona.body_type_before || persona.body_type_after) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {persona.body_type_before && (
              <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">Body Type - Before</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{persona.body_type_before}</p>
              </div>
            )}
            {persona.body_type_after && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                <h4 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-1">Body Type - After</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{persona.body_type_after}</p>
              </div>
            )}
          </div>
        )}

        {persona.body_type_description && !persona.body_type_before && !persona.body_type_after && (
          <>
            <h3 className="text-lg font-semibold text-gray-900 pt-2">Body Type (for AI images)</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{persona.body_type_description}</p>
          </>
        )}
      </div>

      {/* Higgsfield Prompts - Copy & Paste */}
      {prompts && prompts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4 lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Image size={18} className="text-amber-500" />
            Higgsfield Prompts
          </h3>
          <p className="text-xs text-gray-400">Click any prompt to copy it, then paste into Higgsfield. Remember: create a before &amp; after, no TEXT AT ALL.</p>
          <div className="space-y-3">
            {PROMPT_TYPE_ORDER.map(type => {
              const items = prompts.filter(p => p.prompt_type === type);
              if (items.length === 0) return null;
              return items.map(prompt => (
                <div key={prompt.id} className="relative">
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                    {PROMPT_TYPE_LABELS[type] || type}
                  </label>
                  <div
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(prompt.prompt_text);
                        setCopiedPrompt(prompt.id);
                        setTimeout(() => setCopiedPrompt(null), 2000);
                      } catch {
                        const ta = document.createElement('textarea');
                        ta.value = prompt.prompt_text;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        setCopiedPrompt(prompt.id);
                        setTimeout(() => setCopiedPrompt(null), 2000);
                      }
                    }}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 leading-relaxed cursor-pointer hover:bg-amber-50 hover:border-amber-300 transition-colors select-all"
                  >
                    {prompt.prompt_text}
                  </div>
                  <div className={`absolute top-7 right-2 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-all ${
                    copiedPrompt === prompt.id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-amber-100 hover:text-amber-700'
                  }`}>
                    {copiedPrompt === prompt.id ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Click to copy</>}
                  </div>
                </div>
              ));
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ImagesTab = ({ images, onUpload, onDelete }) => {
  const [uploadCategory, setUploadCategory] = useState('before_after');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  const uploadFiles = async (files) => {
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      await onUpload(file, uploadCategory, uploadNotes);
    }
    setUploading(false);
    setUploadNotes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e) => {
    uploadFiles(Array.from(e.target.files));
  };

  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length > 0) {
      e.preventDefault();
      uploadFiles(imageFiles);
    }
  }, [uploadCategory, uploadNotes]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    uploadFiles(files);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const filtered = filterCategory === 'all' ? images : images.filter(i => i.category === filterCategory);

  const grouped = IMAGE_CATEGORIES.reduce((acc, cat) => {
    const items = images.filter(i => i.category === cat.id);
    if (items.length > 0) acc.push({ ...cat, items });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div
        ref={dropZoneRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`bg-white rounded-xl shadow-sm border-2 border-dashed p-4 transition-colors ${
          dragOver ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
        }`}
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload Higgsfield Images</h3>
        <p className="text-xs text-gray-400 mb-3">Drop images here, paste from clipboard (Ctrl+V), or use the upload button</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
          >
            {IMAGE_CATEGORIES.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={uploadNotes}
            onChange={(e) => setUploadNotes(e.target.value)}
            className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Filter */}
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterCategory === 'all' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({images.length})
          </button>
          {IMAGE_CATEGORIES.map(cat => {
            const count = images.filter(i => i.category === cat.id).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.id}
                onClick={() => setFilterCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filterCategory === cat.id ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Image Grid */}
      {filtered.length === 0 ? (
        <EmptyState icon={Camera} title="No images yet" description="Upload Higgsfield-generated images to organize them by category." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(img => (
            <div key={img.id} className="group relative bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="aspect-square bg-gray-100">
                <img
                  src={img.url}
                  alt={img.notes || img.category}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-2">
                <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                  img.category === 'before' ? 'bg-red-100 text-red-700' :
                  img.category === 'after' ? 'bg-green-100 text-green-700' :
                  img.category === 'before_after' ? 'bg-purple-100 text-purple-700' :
                  img.category === 'old_clothes' ? 'bg-blue-100 text-blue-700' :
                  img.category === 'profile' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {IMAGE_CATEGORIES.find(c => c.id === img.category)?.label || img.category}
                </span>
                {img.notes && <p className="text-xs text-gray-500 mt-1 truncate">{img.notes}</p>}
              </div>
              <button
                onClick={() => setDeleteConfirm(img.id)}
                className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Image?</h3>
            <p className="text-sm text-gray-600 mb-4">This will permanently remove this image.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { onDelete(deleteConfirm); setDeleteConfirm(null); }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3">
    <Icon size={16} className="text-gray-400 mt-0.5 shrink-0" />
    <div>
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  </div>
);

const HiggsFieldReminder = () => {
  const [copied, setCopied] = useState(false);
  const text = 'Create a before & after image, NO TEXT AT ALL';
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      onClick={handleCopy}
      className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between cursor-pointer hover:bg-amber-100 transition-colors"
    >
      <span className="text-sm font-medium text-amber-800">{text}</span>
      <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${
        copied ? 'bg-green-100 text-green-700' : 'bg-amber-200 text-amber-700'
      }`}>
        {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
      </span>
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, description }) => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
      <Icon className="text-gray-400" size={24} />
    </div>
    <h3 className="text-sm font-medium text-gray-700 mb-1">{title}</h3>
    <p className="text-xs text-gray-400">{description}</p>
  </div>
);

export default PersonaDetail;
