/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import axios from 'axios';

interface AuthContextType {
  token: string | null;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  const login = useCallback(async (password: string) => {
    const res = await axios.post('/api/auth/login', { password }, { timeout: 30000 });
    const t = res.data.token;
    setToken(t);
    localStorage.setItem('token', t);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) {
        await axios.post('/api/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
      }
    } finally {
      setToken(null);
      localStorage.removeItem('token');
    }
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
