import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types';
import { authApi } from '../services/api/authApi';
import { apiClient } from '../services/api/apiClient';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, pass: string) => Promise<void>;
  register: (username: string, pass: string, name?: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  updateDailyGoal: (ml: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(apiClient.getToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = async () => {
    try {
      if (!apiClient.getToken()) {
        setUser(null);
        return;
      }
      const data = await authApi.getProfile();
      setUser(data.user);
    } catch {
      logout();
    }
  };

  useEffect(() => {
    apiClient.setOnUnauthorized(() => {
      logout();
    });

    if (token) {
      refreshProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, pass: string) => {
    setIsLoading(true);
    try {
      const res = await authApi.login(username, pass);
      setToken(res.token);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string, pass: string, name?: string) => {
    setIsLoading(true);
    try {
      const res = await authApi.register(username, pass, name);
      setToken(res.token);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setToken(null);
    setUser(null);
  };

  const updateDailyGoal = async (ml: number) => {
    const res = await authApi.updateDailyGoal(ml);
    setUser(res.user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        login,
        register,
        logout,
        refreshProfile,
        updateDailyGoal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
