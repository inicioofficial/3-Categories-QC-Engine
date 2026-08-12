import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { apiFetch, clearApiCache, prefetchPostLoginData, type AuthUser } from "@/lib/api";
import { clearSurveyCtoSessionToken } from "@/lib/surveyctoSession";

export type WorkspaceModule = "spread" | "edible-oil" | "breakfast-cereal";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  selectedWorkspace: WorkspaceModule | null;
  selectedCategory: string;
  login: (username: string, password: string) => Promise<AuthUser>;
  selectWorkspace: (workspace: WorkspaceModule) => void;
  selectCategory: (category: string) => void;
  logout: () => void;
};

const TOKEN_KEY = "efina_platform_token";
const WORKSPACE_KEY = "efina_platform_workspace";
const CATEGORY_KEY = "three_categories_bht_category";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceModule | null>(() => {
    const value = sessionStorage.getItem(WORKSPACE_KEY);
    return value === "spread" || value === "edible-oil" || value === "breakfast-cereal" ? value : null;
  });
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return localStorage.getItem(CATEGORY_KEY) || "all";
  });

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    apiFetch<{ user: AuthUser }>("/api/auth/me", {}, token)
      .then((payload) => setUser(payload.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function login(username: string, password: string): Promise<AuthUser> {
    const payload = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    clearApiCache();
    localStorage.setItem(TOKEN_KEY, payload.token);
    setToken(payload.token);
    setUser(payload.user);
    setSelectedWorkspace(null);
    prefetchPostLoginData(payload.token);
    return payload.user;
  }

  function selectWorkspace(workspace: WorkspaceModule) {
    sessionStorage.setItem(WORKSPACE_KEY, workspace);
    setSelectedWorkspace(workspace);
  }

  function selectCategory(category: string) {
    localStorage.setItem(CATEGORY_KEY, category);
    setSelectedCategory(category);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(WORKSPACE_KEY);
    clearSurveyCtoSessionToken();
    clearApiCache();
    setToken(null);
    setUser(null);
    setSelectedWorkspace(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, selectedWorkspace, selectedCategory, login, selectWorkspace, selectCategory, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("Auth context is not available.");
  }
  return context;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading application...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function WorkspaceRoute({ children }: { workspace?: WorkspaceModule | "main"; children: ReactNode }) {
  const { user, loading, selectedWorkspace } = useAuth();

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading application...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!selectedWorkspace) {
    return <Navigate to="/workspace-select" replace />;
  }

  return <>{children}</>;
}

const ROLE_ALIASES: Record<string, string> = {
  admin: "SUPERADMIN",
  data_engineer: "PDM-ADMIN",
  qc_reviewer: "PDM-QC",
  supervisor: "PDM-ADMIN",
  client: "INICIO-ADMIN",
  "INICIO-PM": "INICIO-ADMIN",
  "PDM-PM": "PDM-ADMIN",
};

function normalizeRole(role: string | null | undefined) {
  const raw = String(role || "").trim();
  return ROLE_ALIASES[raw] ?? raw.toUpperCase();
}

export function RoleRoute({ allowedRoles, children, requireWorkspace = true }: { allowedRoles: string[]; children: ReactNode; requireWorkspace?: boolean }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading application...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const normalizedAllowedRoles = new Set(allowedRoles.map(normalizeRole));
  if (normalizedAllowedRoles.size > 0 && !normalizedAllowedRoles.has(normalizeRole(user.role))) {
    return <Navigate to="/main" replace />;
  }

  return <>{children}</>;
}
