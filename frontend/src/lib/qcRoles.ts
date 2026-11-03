export type QcRole = "PDM-QC" | "INICIO-QC";

export const QC_ROLE_OPTIONS: ReadonlyArray<{ value: QcRole; label: QcRole }> = [
  { value: "PDM-QC", label: "PDM-QC" },
  { value: "INICIO-QC", label: "INICIO-QC" },
];

export function assignmentRoleOptionsForActor(role: string | null | undefined) {
  switch (String(role || "").trim().toUpperCase()) {
    case "SUPERADMIN":
      return QC_ROLE_OPTIONS;
    case "PDM-ADMIN":
      return QC_ROLE_OPTIONS.filter((option) => option.value === "PDM-QC");
    case "INICIO-ADMIN":
      return QC_ROLE_OPTIONS.filter((option) => option.value === "INICIO-QC");
    default:
      return [];
  }
}

export function canManageQcAssignments(role: string | null | undefined) {
  return assignmentRoleOptionsForActor(role).length > 0;
}
