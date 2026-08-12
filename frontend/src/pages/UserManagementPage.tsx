import { useEffect, useState } from "react";
import { Plus, RefreshCw, UserCheck, UserX } from "lucide-react";

import { useAuth } from "@/app/auth";
import { PlatformPage, SELECT_CLASS, INPUT_CLASS, statusBadgeClass } from "@/app/platform-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, type UserAccount } from "@/lib/api";

const ROLES = [
  { value: "SUPERADMIN", label: "SUPERADMIN" },
  { value: "INICIO-ADMIN", label: "INICIO-ADMIN" },
  { value: "PDM-ADMIN", label: "PDM-ADMIN" },
  { value: "PDM-QC", label: "PDM-QC" },
];

const ROLE_BADGE: Record<string, string> = {
  SUPERADMIN: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  "INICIO-ADMIN": "border-sky-500/30 bg-sky-500/10 text-sky-700",
  "PDM-ADMIN": "border-indigo-500/30 bg-indigo-500/10 text-indigo-700",
  "PDM-QC": "border-amber-500/30 bg-amber-500/12 text-amber-700",
};

function roleBadgeClass(role: string) {
  return ROLE_BADGE[role] ?? "border-slate-300 bg-white/45 text-slate-700";
}

type ModalMode = "create" | "edit" | "reset" | null;

interface FormState {
  username: string;
  full_name: string;
  email: string;
  role: string;
  password: string;
  is_active: boolean;
}

const DEFAULT_FORM: FormState = {
  username: "",
  full_name: "",
  email: "",
  role: "PDM-QC",
  password: "",
  is_active: true,
};

export function UserManagementPage() {
  const { token, user } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [resetPassword, setResetPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEditingSuperadmin = modal === "edit" && (selectedUser?.roles ?? []).includes("SUPERADMIN");
  const isSuperadmin = user?.role === "SUPERADMIN";
  const manageableRoleValues = isSuperadmin ? ROLES.map((role) => role.value) : ["PDM-ADMIN", "PDM-QC"];

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await apiFetch<{ users: UserAccount[] }>("/api/admin/users", {}, token);
      setUsers(data.users);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, [token]);


  const visibleUsers = isSuperadmin ? users : users.filter((entry) => entry.roles.some((role) => manageableRoleValues.includes(role)));
  const availableRoles = ROLES.filter((role) => manageableRoleValues.includes(role.value));


  function openCreate() {
    setForm({ ...DEFAULT_FORM, role: availableRoles[0]?.value ?? "PDM-QC" });
    setError("");
    setModal("create");
  }

  function openEdit(u: UserAccount) {
    if (!u.roles.some((role) => manageableRoleValues.includes(role))) {
      setError("You do not have permission to edit this user.");
      return;
    }
    setSelectedUser(u);
    setForm({
      username: u.username,
      full_name: u.full_name,
      email: u.email ?? "",
      role: u.roles[0] ?? "PDM-QC",
      password: "",
      is_active: u.is_active,
    });
    setError("");
    setModal("edit");
  }

  function openReset(u: UserAccount) {
    if (!u.roles.some((role) => manageableRoleValues.includes(role))) {
      setError("You do not have permission to reset this user's password.");
      return;
    }
    setSelectedUser(u);
    setResetPassword("");
    setError("");
    setModal("reset");
  }

  function closeModal() {
    setModal(null);
    setSelectedUser(null);
    setError("");
  }

  async function handleCreate() {
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          password: form.password,
        }),
      }, token);
      closeModal();
      void loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!selectedUser) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/admin/users/${selectedUser.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          is_active: form.is_active,
        }),
      }, token);
      closeModal();
      void loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedUser) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/admin/users/${selectedUser.user_id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: resetPassword }),
      }, token);
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reset password.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u: UserAccount) {
    if (u.roles.includes("SUPERADMIN")) {
      setError("SUPERADMIN accounts cannot be deleted.");
      return;
    }
    if (!u.roles.some((role) => manageableRoleValues.includes(role))) {
      setError("You do not have permission to delete this user.");
      return;
    }
    const confirmed = window.confirm(`Delete user account "${u.username}"? This cannot be undone.`);
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/admin/users/${u.user_id}`, { method: "DELETE" }, token);
      if (selectedUser?.user_id === u.user_id) {
        closeModal();
      }
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PlatformPage
      title="User Management"
      subtitle="Create and manage platform user accounts"
      syncLabel=""
      module="main"
      hideTopBar={false}
      plainTopBar
      topBarActions={
        <Button onClick={openCreate} className="rounded-[1.15rem] bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-1.5 h-4 w-4" />
          Add User
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="glass-card overflow-hidden rounded-2xl border-0 shadow-none">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/20">
                  <TableHead className="pl-6 text-slate-600">Username</TableHead>
                  <TableHead className="text-slate-600">Full Name</TableHead>
                  <TableHead className="text-slate-600">Email</TableHead>
                  <TableHead className="text-slate-600">Role</TableHead>
                  <TableHead className="text-slate-600">Status</TableHead>
                  <TableHead className="pr-6 text-right text-slate-600">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-400">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : visibleUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-400">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleUsers.map((u) => {
                    const isSuperadminAccount = u.roles.includes("SUPERADMIN");
                    const canManageThisUser = isSuperadmin || (!isSuperadminAccount && u.roles.some((role) => manageableRoleValues.includes(role)));
                    return (
                    <TableRow key={u.user_id} className="border-b border-white/10 hover:bg-white/20">
                      <TableCell className="pl-6 font-mono text-sm font-medium text-slate-800">
                        {u.username}
                      </TableCell>
                      <TableCell className="text-slate-700">{u.full_name}</TableCell>
                      <TableCell className="text-slate-500">{u.email || "—"}</TableCell>
                      <TableCell>
                        {u.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className={`rounded-full text-xs ${roleBadgeClass(r)}`}
                          >
                            {r.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell>
                        {u.is_active ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-700">
                            <UserCheck className="h-3.5 w-3.5" />
                            Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <UserX className="h-3.5 w-3.5" />
                            Inactive
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canManageThisUser ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(u)}
                                className="rounded-lg border border-white/50 bg-white/30 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white/50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => openReset(u)}
                                className="rounded-lg border border-amber-300/40 bg-amber-50/40 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50/70"
                              >
                                Reset PW
                              </button>
                            </>
                          ) : null}
                          {!isSuperadminAccount && canManageThisUser ? (
                            <button
                              type="button"
                              onClick={() => void handleDelete(u)}
                              className="rounded-lg border border-rose-300/40 bg-rose-50/40 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50/70"
                            >
                              Delete
                            </button>
                          ) : (
                            <span className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-1 text-xs font-medium text-slate-400" title="SUPERADMIN accounts cannot be deleted.">
                              {isSuperadminAccount ? "Protected" : "Restricted"}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Modal overlay */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md rounded-2xl border border-white/60 p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">
              {modal === "create" ? "Add New User" : modal === "edit" ? "Edit User" : "Reset Password"}
            </h2>

            {error && (
              <div className="mb-4 rounded-[1rem] border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            {modal === "reset" ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Set a new password for <strong>{selectedUser?.username}</strong>.
                </p>
                <Input
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {modal === "create" && (
                  <Input
                    placeholder="Username"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className={INPUT_CLASS}
                  />
                )}
                <Input
                  placeholder="Full name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className={INPUT_CLASS}
                />
                <Input
                  type="email"
                  placeholder="Email address (optional)"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={INPUT_CLASS}
                />
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={SELECT_CLASS}
                >
                  {availableRoles.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {modal === "edit" && (
                  <label
                    className={`flex items-center gap-2 text-sm ${isEditingSuperadmin ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-700"}`}
                    title={isEditingSuperadmin ? "SUPERADMIN accounts cannot be disabled." : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={!form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: !e.target.checked })}
                      disabled={isEditingSuperadmin}
                      className="h-4 w-4 rounded"
                    />
                    Account disabled {isEditingSuperadmin ? "(locked for SUPERADMIN account)" : ""}
                  </label>
                )}
                {modal === "create" && (
                  <Input
                    type="password"
                    placeholder="Password (min 8 chars)"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={INPUT_CLASS}
                  />
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[1rem] border border-white/50 bg-white/30 px-4 py-2 text-sm text-slate-700 hover:bg-white/50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={modal === "create" ? handleCreate : modal === "edit" ? handleEdit : handleReset}
                className="rounded-[1rem] bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : modal === "reset" ? "Reset Password" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PlatformPage>
  );
}
