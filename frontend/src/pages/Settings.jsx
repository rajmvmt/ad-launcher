import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Plus, Sparkles, Edit, Trash2, Save, X, FileText, Code, AlertTriangle, Link, Loader2, CheckCircle, Zap, Shield, Star, RefreshCw, Send, Power, PowerOff } from 'lucide-react';
import { getConnections, createConnection, updateConnection, deleteConnection, verifyConnection, setDefaultConnection } from '../api/facebookConnections';
import { getConnections as getNativeConnections, createConnection as createNativeConnection, updateConnection as updateNativeConnection, deleteConnection as deleteNativeConnection, verifyConnection as verifyNativeConnection, setDefaultConnection as setNativeDefault } from '../api/nativeConnections';
import { useToast } from '../context/ToastContext';
import { adStyles as initialStyles, AD_CATEGORIES } from '../data/adStyles';
import { PROMPT_CATEGORIES } from '../data/prompts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function Settings() {
    const { showSuccess, showError } = useToast();
    const [activeTab, setActiveTab] = useState('styles');
    const [styles, setStyles] = useState([]);
    const [prompts, setPrompts] = useState([]);
    const [editingStyle, setEditingStyle] = useState(null);
    const [editingPrompt, setEditingPrompt] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showAIModal, setShowAIModal] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [styleToDelete, setStyleToDelete] = useState(null);

    // Load prompts and styles from API
    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const [promptsRes, stylesRes] = await Promise.all([
                fetch(`${API_BASE}/prompts`),
                fetch(`${API_BASE}/ad-styles`)
            ]);

            if (promptsRes.ok) {
                const promptsData = await promptsRes.json();
                setPrompts(promptsData);
            }

            if (stylesRes.ok) {
                const stylesData = await stylesRes.json();
                setStyles(stylesData.length > 0 ? stylesData : initialStyles);
            } else {
                // If no styles in DB, use initial styles from file
                setStyles(initialStyles);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            showError('Failed to load settings');
            // Fallback to local data
            setStyles(initialStyles);
        } finally {
            setLoading(false);
        }
    };

    const tabs = [
        { id: 'styles', label: 'Ad Styles', count: styles.length },
        { id: 'prompts', label: 'Prompts', count: prompts.length },
        { id: 'facebook', label: 'Facebook', count: null },
        { id: 'native', label: 'Native Ads', count: null },
        { id: 'telegram', label: 'Telegram Bot', count: null },
        { id: 'general', label: 'General', count: null }
    ];

    const handleDeleteStyle = (styleId) => {
        setStyleToDelete(styleId);
    };

    const confirmDeleteStyle = () => {
        if (styleToDelete) {
            setStyles(styles.filter(s => s.id !== styleToDelete));
            showSuccess('Style deleted successfully');
            setStyleToDelete(null);
        }
    };

    const handleEditStyle = (style) => {
        setEditingStyle({ ...style });
    };

    const handleSaveEdit = () => {
        setStyles(styles.map(s => s.id === editingStyle.id ? editingStyle : s));
        setEditingStyle(null);
        showSuccess('Style updated successfully');
    };

    const handleAddStyle = (newStyle) => {
        const styleWithId = {
            ...newStyle,
            id: `custom-${Date.now()}`
        };
        setStyles([...styles, styleWithId]);
        setShowAddModal(false);
        showSuccess('Style added successfully');
    };

    const handleGenerateAIStyles = async (prompt, count) => {
        setGenerating(true);
        try {
            // TODO: Implement AI generation endpoint
            await new Promise(resolve => setTimeout(resolve, 2000)); // Simulated API call
            showSuccess(`Generated ${count} new styles!`);
            setShowAIModal(false);
        } catch (error) {
            showError('Failed to generate styles');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div>
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                    <SettingsIcon size={32} className="text-purple-600" />
                    Settings
                </h1>
                <p className="text-gray-600 mt-1">Manage your ad styles and application settings</p>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
                <div className="flex border-b border-gray-200">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-6 py-4 font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-purple-600 border-b-2 border-purple-600'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            {tab.label}
                            {tab.count !== null && (
                                <span className="ml-2 px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600">
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {activeTab === 'styles' && (
                        <StylesSettings
                            styles={styles}
                            editingStyle={editingStyle}
                            onEdit={handleEditStyle}
                            onDelete={handleDeleteStyle}
                            onSave={handleSaveEdit}
                            onCancelEdit={() => setEditingStyle(null)}
                            onUpdateEdit={setEditingStyle}
                            onShowAdd={() => setShowAddModal(true)}
                            onShowAI={() => setShowAIModal(true)}
                        />
                    )}
                    {activeTab === 'prompts' && (
                        <PromptsSettings
                            prompts={prompts}
                            editingPrompt={editingPrompt}
                            onEdit={setEditingPrompt}
                            onSave={() => {
                                setPrompts(prompts.map(p => p.id === editingPrompt.id ? editingPrompt : p));
                                setEditingPrompt(null);
                                showSuccess('Prompt updated successfully');
                            }}
                            onCancel={() => setEditingPrompt(null)}
                            onUpdate={(updatedPrompt) => setEditingPrompt(updatedPrompt)}
                        />
                    )}
                    {activeTab === 'facebook' && (
                        <FacebookConnectionsSettings showSuccess={showSuccess} showError={showError} />
                    )}
                    {activeTab === 'native' && (
                        <NativeConnectionsSettings showSuccess={showSuccess} showError={showError} />
                    )}
                    {activeTab === 'telegram' && (
                        <TelegramBotSettings showSuccess={showSuccess} showError={showError} />
                    )}
                    {activeTab === 'general' && (
                        <GeneralSettings />
                    )}
                </div>
            </div>

            {/* Add Style Modal */}
            {showAddModal && (
                <AddStyleModal
                    onClose={() => setShowAddModal(false)}
                    onSave={handleAddStyle}
                />
            )}

            {/* AI Generation Modal */}
            {showAIModal && (
                <AIGenerationModal
                    onClose={() => setShowAIModal(false)}
                    onGenerate={handleGenerateAIStyles}
                    generating={generating}
                />
            )}

            {/* Delete Style Confirmation Modal */}
            {styleToDelete && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 text-red-600 mb-4">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-bold">Delete Style?</h3>
                        </div>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete this ad style? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setStyleToDelete(null)}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteStyle}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StylesSettings({ styles, editingStyle, onEdit, onDelete, onSave, onCancelEdit, onUpdateEdit, onShowAdd, onShowAI }) {
    const [filterCategory, setFilterCategory] = useState('all');

    const filteredStyles = filterCategory === 'all'
        ? styles
        : styles.filter(s => s.category === filterCategory);

    return (
        <div className="space-y-6">
            {/* Actions Bar */}
            <div className="flex items-center justify-between">
                <div className="flex gap-3">
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    >
                        <option value="all">All Categories ({styles.length})</option>
                        {Object.values(AD_CATEGORIES).map(cat => (
                            <option key={cat} value={cat}>
                                {cat} ({styles.filter(s => s.category === cat).length})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onShowAI}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                        <Sparkles size={20} />
                        Generate with AI
                    </button>
                    <button
                        onClick={onShowAdd}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                    >
                        <Plus size={20} />
                        Add Style
                    </button>
                </div>
            </div>

            {/* Styles List */}
            <div className="space-y-4">
                {filteredStyles.map((style) => (
                    <div
                        key={style.id}
                        className="bg-gray-50 border border-gray-200 rounded-lg p-4"
                    >
                        {editingStyle?.id === style.id ? (
                            <EditStyleForm
                                style={editingStyle}
                                onChange={onUpdateEdit}
                                onSave={onSave}
                                onCancel={onCancelEdit}
                            />
                        ) : (
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="text-lg font-semibold text-gray-900">{style.name}</h3>
                                        <span className="px-3 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                                            {style.category}
                                        </span>
                                    </div>
                                    <p className="text-gray-600 text-sm mb-3">{style.description}</p>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        <span className="text-xs text-gray-500">Best for:</span>
                                        {style.bestFor?.map((industry, idx) => (
                                            <span key={idx} className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded">
                                                {industry}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                                        <div><strong>Mood:</strong> {style.mood}</div>
                                        <div><strong>Design:</strong> {style.design_style}</div>
                                    </div>
                                </div>
                                <div className="flex gap-2 ml-4">
                                    <button
                                        onClick={() => onEdit(style)}
                                        className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                    >
                                        <Edit size={18} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(style.id)}
                                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditStyleForm({ style, onChange, onSave, onCancel }) {
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                    type="text"
                    value={style.name}
                    onChange={(e) => onChange({ ...style, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                    value={style.description}
                    onChange={(e) => onChange({ ...style, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mood</label>
                    <input
                        type="text"
                        value={style.mood}
                        onChange={(e) => onChange({ ...style, mood: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Design Style</label>
                    <input
                        type="text"
                        value={style.design_style}
                        onChange={(e) => onChange({ ...style, design_style: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    />
                </div>
            </div>
            <div className="flex gap-3 justify-end">
                <button
                    onClick={onCancel}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                    <X size={18} />
                    Cancel
                </button>
                <button
                    onClick={onSave}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                    <Save size={18} />
                    Save Changes
                </button>
            </div>
        </div>
    );
}

function AddStyleModal({ onClose, onSave }) {
    const [newStyle, setNewStyle] = useState({
        name: '',
        category: AD_CATEGORIES.TRUST_AUTHORITY,
        description: '',
        bestFor: [],
        mood: '',
        lighting: '',
        composition: '',
        design_style: '',
        prompt: ''
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(newStyle);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900">Add New Style</h2>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                        <input
                            type="text"
                            required
                            value={newStyle.name}
                            onChange={(e) => setNewStyle({ ...newStyle, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                            placeholder="e.g., The Bold Comparison"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                        <select
                            required
                            value={newStyle.category}
                            onChange={(e) => setNewStyle({ ...newStyle, category: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                        >
                            {Object.values(AD_CATEGORIES).map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                        <textarea
                            required
                            value={newStyle.description}
                            onChange={(e) => setNewStyle({ ...newStyle, description: e.target.value })}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                            placeholder="What makes this style unique?"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Mood</label>
                            <input
                                type="text"
                                value={newStyle.mood}
                                onChange={(e) => setNewStyle({ ...newStyle, mood: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                                placeholder="e.g., Bold and energetic"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Design Style</label>
                            <input
                                type="text"
                                value={newStyle.design_style}
                                onChange={(e) => setNewStyle({ ...newStyle, design_style: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                                placeholder="e.g., Modern minimal"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Image Generation Prompt</label>
                        <textarea
                            value={newStyle.prompt}
                            onChange={(e) => setNewStyle({ ...newStyle, prompt: e.target.value })}
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                            placeholder="Detailed prompt for AI image generation..."
                        />
                    </div>
                    <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                        >
                            Add Style
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function AIGenerationModal({ onClose, onGenerate, generating }) {
    const [prompt, setPrompt] = useState('');
    const [count, setCount] = useState(5);

    const handleSubmit = (e) => {
        e.preventDefault();
        onGenerate(prompt, count);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full">
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Sparkles className="text-purple-600" />
                        Generate Styles with AI
                    </h2>
                    <p className="text-gray-600 mt-1">Describe the types of ad styles you want to create</p>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            What kind of ad styles do you need?
                        </label>
                        <textarea
                            required
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={5}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                            placeholder="Example: Create ad styles for fitness supplements targeting women aged 25-40. Focus on before/after transformations and social proof..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            How many styles to generate?
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={count}
                            onChange={(e) => setCount(parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={generating}
                            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={generating}
                            className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                        >
                            <Sparkles size={18} className={generating ? 'animate-spin' : ''} />
                            {generating ? 'Generating...' : 'Generate Styles'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function PromptsSettings({ prompts, editingPrompt, onEdit, onSave, onCancel, onUpdate }) {
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    const filteredPrompts = prompts.filter(p => {
        const matchesCategory = filterCategory === 'all' || p.category === filterCategory;
        const matchesSearch = searchTerm === '' ||
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.description.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex items-center gap-3">
                <input
                    type="text"
                    placeholder="Search prompts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    <option value="all">All Categories ({prompts.length})</option>
                    {Object.values(PROMPT_CATEGORIES).map(cat => (
                        <option key={cat} value={cat}>
                            {cat} ({prompts.filter(p => p.category === cat).length})
                        </option>
                    ))}
                </select>
            </div>

            {/* Prompts List */}
            <div className="space-y-4">
                {filteredPrompts.map((prompt) => (
                    <div
                        key={prompt.id}
                        className="bg-gray-50 border border-gray-200 rounded-lg p-6"
                    >
                        {editingPrompt?.id === prompt.id ? (
                            <EditPromptForm
                                prompt={editingPrompt}
                                onChange={onUpdate}
                                onSave={onSave}
                                onCancel={onCancel}
                            />
                        ) : (
                            <div>
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <FileText size={20} className="text-purple-600" />
                                            <h3 className="text-lg font-semibold text-gray-900">{prompt.name}</h3>
                                            <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                                {prompt.category}
                                            </span>
                                        </div>
                                        <p className="text-gray-600 text-sm mb-3">{prompt.description}</p>
                                        {prompt.variables && prompt.variables.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                <span className="text-xs text-gray-500 font-medium">Variables:</span>
                                                {prompt.variables.map((variable, idx) => (
                                                    <code key={idx} className="px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded font-mono">
                                                        {'{' + variable + '}'}
                                                    </code>
                                                ))}
                                            </div>
                                        )}
                                        {prompt.notes && (
                                            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                                                <strong>Note:</strong> {prompt.notes}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => onEdit(prompt)}
                                        className="ml-4 p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                    >
                                        <Edit size={18} />
                                    </button>
                                </div>
                                <details className="mt-4">
                                    <summary className="cursor-pointer text-sm font-medium text-purple-600 hover:text-purple-700 flex items-center gap-2">
                                        <Code size={16} />
                                        View Full Prompt Template
                                    </summary>
                                    <pre className="mt-3 p-4 bg-gray-800 text-gray-100 rounded-lg overflow-x-auto text-xs leading-relaxed">
                                        {prompt.template}
                                    </pre>
                                </details>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditPromptForm({ prompt, onChange, onSave, onCancel }) {
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                    type="text"
                    value={prompt.name}
                    onChange={(e) => onChange({ ...prompt, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                    value={prompt.description}
                    onChange={(e) => onChange({ ...prompt, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Template</label>
                <textarea
                    value={prompt.template}
                    onChange={(e) => onChange({ ...prompt, template: e.target.value })}
                    rows={15}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent font-mono text-sm"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                    value={prompt.notes}
                    onChange={(e) => onChange({ ...prompt, notes: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
            </div>
            <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                <button
                    onClick={onCancel}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                    <X size={18} />
                    Cancel
                </button>
                <button
                    onClick={onSave}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                    <Save size={18} />
                    Save Changes
                </button>
            </div>
        </div>
    );
}

function FacebookConnectionsSettings({ showSuccess, showError }) {
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingConn, setEditingConn] = useState(null);
    const [verifying, setVerifying] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [form, setForm] = useState({ name: '', access_token: '', app_id: '', app_secret: '', ad_account_id: '', notes: '' });

    useEffect(() => { loadConnections(); }, []);

    const loadConnections = async () => {
        setLoading(true);
        try {
            const data = await getConnections();
            setConnections(data);
        } catch (e) {
            showError('Failed to load Facebook connections');
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setEditingConn(null);
        setForm({ name: '', access_token: '', app_id: '', app_secret: '', ad_account_id: '', notes: '' });
        setShowModal(true);
    };

    const openEdit = (conn) => {
        setEditingConn(conn);
        setForm({ name: conn.name, access_token: '', app_id: conn.app_id || '', app_secret: '', ad_account_id: conn.ad_account_id || '', notes: conn.notes || '' });
        setShowModal(true);
    };

    const handleSave = async () => {
        try {
            if (editingConn) {
                const payload = { ...form };
                if (!payload.access_token) delete payload.access_token;
                if (!payload.app_secret) delete payload.app_secret;
                await updateConnection(editingConn.id, payload);
                showSuccess('Connection updated');
            } else {
                if (!form.name || !form.access_token) {
                    showError('Name and access token are required');
                    return;
                }
                await createConnection(form);
                showSuccess('Connection created');
            }
            setShowModal(false);
            loadConnections();
        } catch (e) {
            showError(e.message);
        }
    };

    const handleVerify = async (conn) => {
        setVerifying(conn.id);
        try {
            const result = await verifyConnection(conn.id);
            if (result.verified) {
                showSuccess(`Verified! Identity: ${result.identity?.name || 'Unknown'}, Pages: ${result.pages?.length || 0}`);
            } else {
                showError(`Verification failed: ${result.error || 'Unknown error'}`);
            }
            loadConnections();
        } catch (e) {
            showError(e.message);
        } finally {
            setVerifying(null);
        }
    };

    const handleSetDefault = async (conn) => {
        try {
            await setDefaultConnection(conn.id);
            showSuccess(`"${conn.name}" set as default`);
            loadConnections();
        } catch (e) {
            showError(e.message);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteConnection(deleteTarget.id);
            showSuccess('Connection deleted');
            setDeleteTarget(null);
            loadConnections();
        } catch (e) {
            showError(e.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Facebook Connections</h3>
                    <p className="text-sm text-gray-500">Manage Facebook API tokens for different Business Managers</p>
                </div>
                <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus size={16} /> Add Connection
                </button>
            </div>

            {connections.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <p className="text-gray-500">No connections configured. Add one to get started.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {connections.map(conn => (
                        <div key={conn.id} className={`border rounded-lg p-4 ${conn.is_default ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-semibold text-gray-900">{conn.name}</h4>
                                        {conn.is_default && (
                                            <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                                                <Star size={12} /> Default
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-sm text-gray-500 space-y-0.5">
                                        <div>Token: <code className="text-xs bg-gray-100 px-1 rounded">{conn.access_token}</code></div>
                                        {conn.app_id && <div>App ID: {conn.app_id}</div>}
                                        {conn.ad_account_id && <div>Ad Account: {conn.ad_account_id}</div>}
                                        {conn.last_verified_at && (
                                            <div className="flex items-center gap-1 text-green-600">
                                                <CheckCircle size={12} /> Verified {new Date(conn.last_verified_at).toLocaleDateString()}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleVerify(conn)}
                                        disabled={verifying === conn.id}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                        title="Verify connection"
                                    >
                                        {verifying === conn.id ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                                    </button>
                                    {!conn.is_default && (
                                        <button
                                            onClick={() => handleSetDefault(conn)}
                                            className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                                            title="Set as default"
                                        >
                                            <Star size={16} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => openEdit(conn)}
                                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"
                                        title="Edit"
                                    >
                                        <Edit size={16} />
                                    </button>
                                    <button
                                        onClick={() => setDeleteTarget(conn)}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">{editingConn ? 'Edit Connection' : 'Add Connection'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g. BM - CLG_0401" className="w-full px-3 py-2 border rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Access Token {editingConn ? '(leave blank to keep current)' : '*'}
                                </label>
                                <input type="password" value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })}
                                    placeholder={editingConn ? '••••••••' : 'System user access token'}
                                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">App ID</label>
                                    <input value={form.app_id} onChange={e => setForm({ ...form, app_id: e.target.value })}
                                        placeholder="App ID" className="w-full px-3 py-2 border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        App Secret {editingConn ? '(blank = keep)' : ''}
                                    </label>
                                    <input type="password" value={form.app_secret} onChange={e => setForm({ ...form, app_secret: e.target.value })}
                                        placeholder={editingConn ? '••••••••' : 'App secret'} className="w-full px-3 py-2 border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Default Ad Account ID (optional)</label>
                                <input value={form.ad_account_id} onChange={e => setForm({ ...form, ad_account_id: e.target.value })}
                                    placeholder="e.g. act_1159433466295855" className="w-full px-3 py-2 border rounded-lg text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                                    placeholder="Optional notes about this connection"
                                    className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                                {editingConn ? 'Save Changes' : 'Add Connection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-100 rounded-full"><Trash2 size={20} className="text-red-600" /></div>
                            <h3 className="text-lg font-semibold">Delete Connection</h3>
                        </div>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete "<strong>{deleteTarget.name}</strong>"? This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function NativeConnectionsSettings({ showSuccess, showError }) {
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [verifying, setVerifying] = useState(null);
    const [form, setForm] = useState({ platform: 'taboola', name: '', client_id: '', client_secret: '', api_token: '', account_id: '', notes: '' });

    const PLATFORMS = [
        { id: 'taboola', label: 'Taboola', authType: 'oauth' },
        { id: 'outbrain', label: 'Outbrain', authType: 'oauth' },
        { id: 'newsbreak', label: 'NewsBreak', authType: 'token' },
    ];

    useEffect(() => { loadConnections(); }, []);

    const loadConnections = async () => {
        setLoading(true);
        try { setConnections(await getNativeConnections()); } catch (e) { showError('Failed to load native connections'); }
        setLoading(false);
    };

    const handleSave = async () => {
        try {
            if (editing) {
                await updateNativeConnection(editing.id, form);
                showSuccess('Connection updated');
            } else {
                await createNativeConnection(form);
                showSuccess('Connection created');
            }
            setShowModal(false);
            setEditing(null);
            loadConnections();
        } catch (e) { showError(e.message); }
    };

    const handleDelete = async (id) => {
        try {
            await deleteNativeConnection(id);
            showSuccess('Connection deleted');
            loadConnections();
        } catch (e) { showError(e.message); }
    };

    const handleVerify = async (id) => {
        setVerifying(id);
        try {
            const result = await verifyNativeConnection(id);
            if (result.verified) showSuccess(`Verified! Platform: ${result.platform}`);
            else showError(`Verification failed: ${result.error}`);
            loadConnections();
        } catch (e) { showError(e.message); }
        setVerifying(null);
    };

    const handleSetDefault = async (id) => {
        try {
            await setNativeDefault(id);
            showSuccess('Set as default');
            loadConnections();
        } catch (e) { showError(e.message); }
    };

    const openAdd = () => {
        setEditing(null);
        setForm({ platform: 'taboola', name: '', client_id: '', client_secret: '', api_token: '', account_id: '', notes: '' });
        setShowModal(true);
    };

    const openEdit = (conn) => {
        setEditing(conn);
        setForm({ platform: conn.platform, name: conn.name, client_id: conn.client_id || '', client_secret: '', api_token: '', account_id: conn.account_id || '', notes: conn.notes || '' });
        setShowModal(true);
    };

    const currentPlatform = PLATFORMS.find(p => p.id === form.platform);
    const grouped = PLATFORMS.map(p => ({ ...p, items: connections.filter(c => c.platform === p.id) }));

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" size={24} /><span className="ml-2">Loading...</span></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Native Ad Connections</h3>
                    <p className="text-sm text-gray-500">Manage API connections for Taboola, Outbrain, and NewsBreak</p>
                </div>
                <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                    <Plus size={16} /> Add Connection
                </button>
            </div>

            {grouped.map(group => (
                <div key={group.id}>
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{group.label}</h4>
                    {group.items.length === 0 ? (
                        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-400">No {group.label} connections</div>
                    ) : (
                        <div className="space-y-3">
                            {group.items.map(conn => (
                                <div key={conn.id} className={`border rounded-lg p-4 ${conn.is_default ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="font-medium text-gray-900">{conn.name}</span>
                                            {conn.is_default && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"><Star size={10} className="inline mr-1" />Default</span>}
                                            {conn.last_verified && <span className="ml-2 text-xs text-green-600"><CheckCircle size={10} className="inline mr-1" />Verified</span>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleVerify(conn.id)} disabled={verifying === conn.id} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">
                                                {verifying === conn.id ? <Loader2 size={12} className="animate-spin" /> : <><RefreshCw size={12} className="inline mr-1" />Verify</>}
                                            </button>
                                            {!conn.is_default && <button onClick={() => handleSetDefault(conn.id)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"><Star size={12} className="inline mr-1" />Default</button>}
                                            <button onClick={() => openEdit(conn)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"><Edit size={12} /></button>
                                            <button onClick={() => handleDelete(conn.id)} className="text-xs px-3 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50"><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 space-x-4">
                                        {conn.account_id && <span>Account: {conn.account_id}</span>}
                                        {conn.client_id && <span>Client ID: {conn.client_id}</span>}
                                        {conn.api_token && <span>Token: {conn.api_token}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">{editing ? 'Edit' : 'Add'} Native Ad Connection</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm font-medium text-gray-700">Platform</label>
                                <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} disabled={!!editing} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm">
                                    {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700">Name</label>
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="My Taboola Account" />
                            </div>
                            {currentPlatform?.authType === 'oauth' ? (
                                <>
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Client ID</label>
                                        <input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Client Secret {editing && <span className="text-gray-400">(leave blank to keep)</span>}</label>
                                        <input type="password" value={form.client_secret} onChange={e => setForm({ ...form, client_secret: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <label className="text-sm font-medium text-gray-700">API Token {editing && <span className="text-gray-400">(leave blank to keep)</span>}</label>
                                    <input type="password" value={form.api_token} onChange={e => setForm({ ...form, api_token: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                                </div>
                            )}
                            <div>
                                <label className="text-sm font-medium text-gray-700">Account / Advertiser ID</label>
                                <input value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700">Notes</label>
                                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                            <button onClick={handleSave} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                                {editing ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TelegramBotSettings({ showSuccess, showError }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [statusError, setStatusError] = useState(null);
    const [token, setToken] = useState('');
    const [toggling, setToggling] = useState(false);

    // IG credentials state
    const [igUsername, setIgUsername] = useState('');
    const [igPassword, setIgPassword] = useState('');
    const [igConfigured, setIgConfigured] = useState(false);
    const [igSaving, setIgSaving] = useState(false);
    const [igTesting, setIgTesting] = useState(false);
    const [igTestResult, setIgTestResult] = useState(null);

    // LanderLab credentials state
    const [llEmail, setLlEmail] = useState('');
    const [llPassword, setLlPassword] = useState('');
    const [llConfigured, setLlConfigured] = useState(false);
    const [llSaving, setLlSaving] = useState(false);

    const BOT_URL = `${API_BASE}/telegram-bot`;

    const rawFetch = async (url, options = {}) => {
        const authToken = localStorage.getItem('accessToken');
        const headers = { ...options.headers };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        return fetch(url, { ...options, headers });
    };

    useEffect(() => { loadStatus(); loadIgCredentials(); loadLlCredentials(); }, []);

    const loadStatus = async () => {
        setLoading(true);
        setStatusError(null);
        try {
            // Step 1: No-auth health check — is the backend reachable at all?
            let healthOk = false;
            try {
                const hRes = await fetch(`${BOT_URL}/health`);
                if (hRes.ok) healthOk = true;
            } catch (_) { /* network error */ }

            if (!healthOk) {
                setStatusError(`Cannot reach backend at ${BOT_URL.replace(/\/api\/v1.*/, '')}. Is the server running?`);
                setStatus({ running: false, installed: false, configured: false, _error: true });
                setLoading(false);
                return;
            }

            // Step 2: Authenticated status check
            const res = await rawFetch(`${BOT_URL}/status`);
            if (res.status === 401) {
                // Auth issue — backend reachable but token expired/missing
                setStatusError('Session expired — please log out and log back in.');
                setStatus({ running: false, installed: true, configured: false, _error: true });
                setLoading(false);
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `Status check failed (${res.status})`);
            }
            const s = await res.json();
            setStatus(s);
        } catch (e) {
            console.error('[TelegramBot] loadStatus error:', e);
            setStatusError(e.message);
            setStatus({ running: false, installed: true, configured: false, _error: true });
        }
        setLoading(false);
    };

    const loadIgCredentials = async () => {
        try {
            const res = await rawFetch(`${BOT_URL}/ig-credentials`);
            if (res.ok) {
                const data = await res.json();
                setIgConfigured(data.configured);
                if (data.username) setIgUsername(data.username);
            }
        } catch (e) {
            console.error('[IG] Failed to load credentials:', e);
        }
    };

    const handleSaveIgCredentials = async () => {
        if (!igUsername.trim() || !igPassword.trim()) {
            showError('Both username and password are required');
            return;
        }
        setIgSaving(true);
        setIgTestResult(null);
        try {
            const res = await rawFetch(`${BOT_URL}/ig-credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: igUsername.trim(), password: igPassword.trim() }),
            });
            if (res.ok) {
                showSuccess('Instagram credentials saved');
                setIgConfigured(true);
                setIgPassword('');
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to save credentials');
            }
        } catch (e) {
            showError(e.message);
        }
        setIgSaving(false);
    };

    const loadLlCredentials = async () => {
        try {
            const res = await rawFetch(`${BOT_URL}/landerlab-credentials`);
            if (res.ok) {
                const data = await res.json();
                setLlConfigured(data.configured);
                if (data.email) setLlEmail(data.email);
            }
        } catch (e) {
            console.error('[LanderLab] Failed to load credentials:', e);
        }
    };

    const handleSaveLlCredentials = async () => {
        if (!llEmail.trim() || !llPassword.trim()) {
            showError('Both email and password are required');
            return;
        }
        setLlSaving(true);
        try {
            const res = await rawFetch(`${BOT_URL}/landerlab-credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: llEmail.trim(), password: llPassword.trim() }),
            });
            if (res.ok) {
                showSuccess('LanderLab credentials saved');
                setLlConfigured(true);
                setLlPassword('');
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to save credentials');
            }
        } catch (e) {
            showError(e.message);
        }
        setLlSaving(false);
    };

    const handleTestIgLogin = async () => {
        setIgTesting(true);
        setIgTestResult(null);
        try {
            const res = await rawFetch(`${BOT_URL}/ig-test-login`, { method: 'POST' });
            const data = await res.json();
            setIgTestResult(data);
            if (data.success) {
                showSuccess(`Instagram login successful (${data.username})`);
            } else {
                showError(data.error || 'Login test failed');
            }
        } catch (e) {
            showError(e.message);
            setIgTestResult({ success: false, error: e.message });
        }
        setIgTesting(false);
    };

    const handleStart = async () => {
        setToggling(true);
        try {
            let res;
            try {
                res = await rawFetch(`${BOT_URL}/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token || undefined }),
                });
            } catch (networkErr) {
                showError(`Cannot reach backend — is the server running?`);
                setToggling(false);
                return;
            }
            if (res.status === 401) { showError('Session expired — please log out and log back in.'); setToggling(false); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || `Start failed (${res.status})`);
                setToggling(false);
                return;
            }
            const result = await res.json();
            if (result.status === 'started' || result.status === 'already_running') {
                showSuccess('Telegram bot started');
            }
            loadStatus();
        } catch (e) {
            showError(e.message);
        }
        setToggling(false);
    };

    const handleStop = async () => {
        setToggling(true);
        try {
            let res;
            try {
                res = await rawFetch(`${BOT_URL}/stop`, { method: 'POST' });
            } catch (networkErr) {
                showError(`Cannot reach backend — is the server running?`);
                setToggling(false);
                return;
            }
            if (res.status === 401) { showError('Session expired — please log out and log back in.'); setToggling(false); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || `Stop failed (${res.status})`);
                setToggling(false);
                return;
            }
            showSuccess('Telegram bot stopped');
            loadStatus();
        } catch (e) {
            showError(e.message);
        }
        setToggling(false);
    };

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" size={24} /><span className="ml-2">Loading...</span></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Telegram Swipe Bot</h3>
                    <p className="text-sm text-gray-500">Send ad URLs to a Telegram bot and they auto-save to your Swipe File</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${status?.running ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        <span className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                        {status?.running ? 'Running' : 'Stopped'}
                    </span>
                </div>
            </div>

            {/* Bot Token */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bot Token</label>
                    <input
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder={status?.configured ? '••••••••••••••• (already configured via env)' : 'Paste bot token from @BotFather'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                        {status?.configured ? 'Token already set via TELEGRAM_BOT_TOKEN env var. Enter a new one to override.' : 'Get a token from @BotFather on Telegram.'}
                    </p>
                </div>

                {/* Start / Stop buttons */}
                <div className="flex gap-3">
                    {!status?.running ? (
                        <button onClick={handleStart} disabled={toggling || (!token && !status?.configured && !status?._error)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium">
                            {toggling ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                            Start Bot
                        </button>
                    ) : (
                        <button onClick={handleStop} disabled={toggling}
                            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium">
                            {toggling ? <Loader2 size={16} className="animate-spin" /> : <PowerOff size={16} />}
                            Stop Bot
                        </button>
                    )}
                </div>
            </div>

            {/* Instagram Credentials */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-5 space-y-4">
                <div>
                    <h4 className="text-sm font-semibold text-purple-900 mb-1 flex items-center gap-2">
                        Instagram Credentials
                    </h4>
                    <p className="text-xs text-purple-600">
                        Used to scrape IG post thumbnails & videos. Use a burner account (no 2FA). Press "Refresh Missing Thumbnails" in the Swipe File to pull media.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
                        <input
                            type="text"
                            value={igUsername}
                            onChange={e => setIgUsername(e.target.value)}
                            placeholder="burner_account_123"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            value={igPassword}
                            onChange={e => setIgPassword(e.target.value)}
                            placeholder={igConfigured ? '••••••••••• (already saved)' : 'Enter password'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSaveIgCredentials}
                        disabled={igSaving || (!igUsername.trim() || !igPassword.trim())}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                    >
                        {igSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save Credentials
                    </button>
                    <button
                        onClick={handleTestIgLogin}
                        disabled={igTesting || !igConfigured}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50 text-sm font-medium"
                    >
                        {igTesting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        Test Login
                    </button>
                    {igTestResult && (
                        <span className={`text-xs font-medium ${igTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                            {igTestResult.success ? `Logged in as ${igTestResult.username}` : igTestResult.error}
                        </span>
                    )}
                    {!igTestResult && igConfigured && (
                        <span className="text-xs text-purple-500">Credentials saved — test to verify</span>
                    )}
                </div>
            </div>

            {/* LanderLab Credentials */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 space-y-4">
                <div>
                    <h4 className="text-sm font-semibold text-amber-900 mb-1 flex items-center gap-2">
                        LanderLab Auto-Rip
                    </h4>
                    <p className="text-xs text-amber-600">
                        When a non-ad URL is sent to the bot, it auto-rips the lander into LanderLab via browser automation. Enter your LanderLab login to enable.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            value={llEmail}
                            onChange={e => setLlEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            value={llPassword}
                            onChange={e => setLlPassword(e.target.value)}
                            placeholder={llConfigured ? '••••••••••• (already saved)' : 'Enter password'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSaveLlCredentials}
                        disabled={llSaving || (!llEmail.trim() || !llPassword.trim())}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
                    >
                        {llSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save Credentials
                    </button>
                    {llConfigured && (
                        <span className="text-xs text-amber-600">Credentials saved — landers will auto-rip to LanderLab</span>
                    )}
                </div>
            </div>

            {/* Setup instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
                <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <Send size={16} /> How to Set Up
                </h4>
                <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                    <li>Open Telegram and message <strong>@BotFather</strong></li>
                    <li>Send <code className="bg-blue-100 px-1 rounded">/newbot</code> and follow the prompts</li>
                    <li>Give it a name (e.g. "MVMT Printer Swipe Bot")</li>
                    <li>Copy the bot token and paste it above</li>
                    <li>Click <strong>Start Bot</strong></li>
                    <li>Now send any ad URL to the bot and it auto-saves to your Swipe File</li>
                </ol>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                    <p className="text-xs text-blue-700">
                        <strong>Multi-user:</strong> Anyone who messages the bot can save URLs — share the bot with coworkers so they can contribute ads too.
                        The bot is only findable if someone has the exact username or you share the link directly.
                    </p>
                </div>
                {statusError && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3">
                        <p className="text-xs text-amber-800">
                            <strong>Could not check bot status:</strong> {statusError}
                        </p>
                        <button onClick={loadStatus} className="shrink-0 text-xs text-amber-700 hover:text-amber-900 underline font-medium">
                            Retry
                        </button>
                    </div>
                )}
                {!status?.installed && !status?._error && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-800">
                            <strong>Note:</strong> The <code>python-telegram-bot</code> package needs to be installed on the server.
                            Run <code>pip install python-telegram-bot==21.10</code> or it will be installed on next deploy.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function GeneralSettings() {
    return (
        <div className="space-y-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Application Settings</h3>
                <p className="text-gray-600">General settings coming soon...</p>
            </div>
        </div>
    );
}
