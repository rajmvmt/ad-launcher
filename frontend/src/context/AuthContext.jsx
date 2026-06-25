import React, { createContext, useContext, useCallback } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

export const AuthProvider = ({ children }) => {
    const user = { id: 1, email: 'admin@local', is_superuser: true, is_active: true };

    const authFetch = useCallback((url, options = {}) => fetch(url, options), []);
    const hasRole = useCallback(() => true, []);
    const hasPermission = useCallback(() => true, []);
    const login = useCallback(async () => {}, []);
    const logout = useCallback(async () => {}, []);

    const value = {
        user,
        loading: false,
        error: null,
        isAuthenticated: true,
        login,
        logout,
        authFetch,
        hasRole,
        hasPermission,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
