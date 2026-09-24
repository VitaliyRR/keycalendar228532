import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, itemsOf, setCsrfToken } from './api';
import type { Organization, Paged, Session } from './types';

interface AuthState {
  session: Session | null;
  organizations: Organization[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<Session>('/auth/me');
      setCsrfToken(result.csrf_token);
      setSession(result);
      try {
        const orgResult = await api<Paged<Organization> | Organization[]>('/organizations');
        setOrganizations(itemsOf(orgResult));
      } catch (orgError) {
        // Session is valid; show organization failure independently from login.
        setOrganizations([]);
        setError(orgError instanceof Error ? orgError.message : 'Не удалось загрузить организации');
      }
    } catch (authError) {
      setCsrfToken();
      setSession(null);
      setOrganizations([]);
      if (!(authError instanceof Error && 'status' in authError && authError.status === 401)) {
        setError(authError instanceof Error ? authError.message : 'Не удалось проверить вход');
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await api<void>('/auth/logout', { method: 'POST' });
    setCsrfToken();
    setSession(null);
    setOrganizations([]);
    sessionStorage.clear();
  }, []);

  const value = useMemo(() => ({session, organizations, loading, error, refresh, logout}), [session, organizations, loading, error, refresh, logout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider required');
  return context;
}
