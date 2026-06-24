import React, { useState, useMemo } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Users, Video, Wand2, Settings, LogOut, Image, ShoppingBag, Target, ChevronLeft, ChevronRight, ChevronDown, UserCog, Type, BookOpen, BarChart3, Globe, Megaphone, Bookmark, Menu, X, Moon, Sun, Banknote, Sparkles, FileText, Shield, FileCode, MessageSquare, DollarSign, Search, Brain, Zap, Trophy, PlusCircle, Film } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import PublishQueueWidget from './PublishQueueWidget';
import AdAlertWidget from './AdAlertWidget';

export default function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout, hasRole } = useAuth();
    const { showSuccess } = useToast();
    const { isDark, toggleDark } = useTheme();
    const [expandedMenus, setExpandedMenus] = useState({ Brands: false });
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const taglines = useMemo(() => [
        'Print Money on Demand',
        'Your Ads. Automated.',
        'Scale or Die Trying',
        'Feed the Machine',
        'Ads That Print Cash',
        'Launch. Scale. Repeat.',
        'Built Different.',
        'Let It Cook',
    ], []);
    const [taglineIndex] = useState(() => Math.floor(Math.random() * 8));

    const handleLogout = async () => {
        await logout();
        showSuccess('Logged out successfully');
        navigate('/login');
    };

    const menuItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        {
            icon: ShoppingBag,
            label: 'Brands',
            subItems: [
                { label: 'Brands', path: '/brands' },
                { label: 'Products', path: '/products' },
                { label: 'Customer Profiles', path: '/profiles' }
            ]
        },
        { icon: Trophy, label: 'Winners', path: '/winners' },
        { icon: BarChart3, label: 'FB Campaigns', path: '/reporting' },
        { icon: PlusCircle, label: 'Create Campaign', path: '/create-campaign' },
        { icon: Zap, label: 'Optimizer', path: '/optimizer' },
        { icon: Search, label: 'Google Ads', path: '/google-ads' },
        { icon: FileText, label: 'FB Pages', path: '/fb-pages' },
        { icon: Globe, label: 'Domains', path: '/domains' },
        { icon: Wand2, label: 'Build Creatives', path: '/build-creatives' },
        { icon: BookOpen, label: 'Prompts & Docs', path: '/prompts' },
    ];

    const toggleMenu = (label) => {
        setExpandedMenus(prev => ({
            ...prev,
            [label]: !prev[label]
        }));
    };

    return (
        <div className="flex h-screen bg-[#FFFAF0] dark:bg-gray-950">
            {/* Mobile top bar */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border-b border-amber-200 dark:border-gray-700 shadow-sm">
                <div className="flex items-center gap-3">
                    <button onClick={() => setIsMobileMenuOpen(true)} className="p-1">
                        <Menu size={24} className="text-amber-600" />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center overflow-hidden border border-amber-200 dark:border-amber-700">
                            <img src="/breadwinner_logo.png" alt="Ad Launcher" className="w-full h-full object-cover" />
                        </div>
                        <h1 className="text-lg font-bold text-amber-900 dark:text-amber-100">Ad Launcher</h1>
                    </div>
                </div>
                <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                    {isDark ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-gray-500" />}
                </button>
            </div>

            {/* Mobile backdrop */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-white dark:bg-gray-900 border-r border-amber-200 dark:border-gray-700 flex flex-col shadow-sm transition-all duration-300 ease-in-out relative ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 w-64' : 'hidden'} md:relative md:flex`}>
                {/* Mobile close button */}
                <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 md:hidden z-10"
                >
                    <X size={20} />
                </button>

                {/* Desktop toggle button */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="absolute -right-3 top-9 bg-white dark:bg-gray-800 border border-amber-200 dark:border-gray-600 rounded-full p-1 shadow-sm hover:bg-amber-50 dark:hover:bg-gray-700 text-amber-600 z-10 hidden md:block"
                >
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>

                <div className={`p-6 border-b border-amber-100 dark:border-gray-700 ${isCollapsed ? 'px-4' : ''}`}>
                    <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center overflow-hidden border border-amber-200 dark:border-amber-700 flex-shrink-0">
                            <img src="/breadwinner_logo.png" alt="Ad Launcher" className="w-full h-full object-cover" />
                        </div>
                        {!isCollapsed && (
                            <div className="overflow-hidden whitespace-nowrap">
                                <h1 className="text-xl font-bold text-amber-900 dark:text-amber-100">Ad Launcher</h1>
                                <p className="text-xs text-amber-600 dark:text-amber-400 transition-all duration-500">{taglines[taglineIndex]}</p>
                            </div>
                        )}
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto overflow-x-hidden">
                    {menuItems.map((item) => {
                        const Icon = item.icon;

                        // Handle items with submenus
                        if (item.subItems) {
                            const isExpanded = expandedMenus[item.label];
                            const isActive = item.subItems.some(sub => location.pathname === sub.path);

                            return (
                                <div key={item.label} className="space-y-1">
                                    <button
                                        onClick={() => {
                                            if (!isCollapsed) toggleMenu(item.label);
                                            if (item.subItems?.[0]?.path) {
                                                navigate(item.subItems[0].path);
                                            }
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${isActive
                                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100 font-medium'
                                            : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-800 hover:text-amber-800 dark:hover:text-amber-300'
                                            } ${isCollapsed ? 'justify-center px-2' : ''}`}
                                        title={isCollapsed ? item.label : ''}
                                    >
                                        <Icon size={20} className={`transition-colors flex-shrink-0 ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400'}`} />
                                        {!isCollapsed && (
                                            <>
                                                <span className="flex-1 text-left whitespace-nowrap overflow-hidden">{item.label}</span>
                                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                            </>
                                        )}
                                    </button>

                                    {!isCollapsed && isExpanded && (
                                        <div className="pl-11 space-y-1">
                                            {item.subItems.map(subItem => {
                                                const isSubActive = location.pathname === subItem.path;
                                                return (
                                                    <Link
                                                        key={subItem.path}
                                                        to={subItem.path}
                                                        onClick={() => setIsMobileMenuOpen(false)}
                                                        className={`block px-3 py-2 rounded-lg text-sm transition-colors ${isSubActive
                                                            ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 font-medium'
                                                            : 'text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-gray-800'
                                                            }`}
                                                    >
                                                        {subItem.label}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        // Regular menu items
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${isActive
                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 font-medium shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-800 hover:text-amber-800 dark:hover:text-amber-300'
                                    } ${isCollapsed ? 'justify-center px-2' : ''}`}
                                title={isCollapsed ? item.label : ''}
                            >
                                <Icon size={20} className={`transition-colors flex-shrink-0 ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400'}`} />
                                {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-amber-100 dark:border-gray-700">
                    {/* Dark Mode Toggle */}
                    <button
                        onClick={toggleDark}
                        className={`flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-colors group text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-800 hover:text-amber-800 dark:hover:text-amber-300 ${isCollapsed ? 'justify-center px-2' : ''}`}
                        title={isCollapsed ? (isDark ? 'Light Mode' : 'Dark Mode') : ''}
                    >
                        {isDark
                            ? <Sun size={20} className="flex-shrink-0 text-amber-400" />
                            : <Moon size={20} className="flex-shrink-0 text-gray-400 group-hover:text-amber-600" />
                        }
                        {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
                    </button>

                    {/* User Management - Admin Only */}
                    {hasRole('admin') && (
                        <Link
                            to="/users"
                            className={`flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-colors group ${
                                location.pathname === '/users'
                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 font-medium shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-800 hover:text-amber-800 dark:hover:text-amber-300'
                            } ${isCollapsed ? 'justify-center px-2' : ''}`}
                            title={isCollapsed ? 'User Management' : ''}
                        >
                            <UserCog size={20} className={`flex-shrink-0 ${
                                location.pathname === '/users'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400'
                            }`} />
                            {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">User Management</span>}
                        </Link>
                    )}
                    <Link
                        to="/settings"
                        className={`flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-colors group ${
                            location.pathname === '/settings'
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 font-medium shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-800 hover:text-amber-800 dark:hover:text-amber-300'
                        } ${isCollapsed ? 'justify-center px-2' : ''}`}
                        title={isCollapsed ? 'Settings' : ''}
                    >
                        <Settings size={20} className={`flex-shrink-0 ${
                            location.pathname === '/settings'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400'
                        }`} />
                        {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">Settings</span>}
                    </Link>

                    {/* User Info */}
                    {!isCollapsed && user && (
                        <div className="px-4 py-3 mt-2 bg-amber-50 dark:bg-gray-800 rounded-xl">
                            <div className="text-sm font-medium text-amber-900 dark:text-amber-100 truncate">
                                {user.name || user.email}
                            </div>
                            <div className="text-xs text-amber-600 dark:text-amber-400 truncate">{user.email}</div>
                        </div>
                    )}

                    <button
                        onClick={handleLogout}
                        className={`flex items-center gap-3 px-4 py-3 w-full text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors mt-1 ${isCollapsed ? 'justify-center px-2' : ''}`}
                        title={isCollapsed ? 'Logout' : ''}
                    >
                        <LogOut size={20} className="flex-shrink-0" />
                        {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">Logout</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto pt-14 md:pt-0 dark:bg-gray-950">
                <div className="p-3 sm:p-6">
                    <Outlet />
                </div>
            </main>

            {/* Background widgets */}
            <PublishQueueWidget />
            <AdAlertWidget />
        </div>
    );
}
