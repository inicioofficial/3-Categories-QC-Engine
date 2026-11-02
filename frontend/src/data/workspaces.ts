import type { WorkspaceModule } from "@/app/auth";

export type SurveyWorkspace = {
  slug: WorkspaceModule;
  label: string;
  shortLabel: string;
  formId: string;
  schema: string;
  description: string;
  accent: string;
};

export const SURVEY_WORKSPACES: SurveyWorkspace[] = [
  {
    slug: "spread",
    label: "Spread Category",
    shortLabel: "Spread",
    formId: "BHT_3_Categories_Margarine_Wave_2",
    schema: "spread",
    description: "Margarine and spreads Wave 2 quality-control workspace.",
    accent: "from-amber-400 to-orange-500",
  },
  {
    slug: "edible-oil",
    label: "Edible Oil Category",
    shortLabel: "Edible Oil",
    formId: "BHT_3_Category_Survey_Edible_oil_Wave_2",
    schema: "edible_oil",
    description: "Edible oil Wave 2 quality-control workspace.",
    accent: "from-emerald-400 to-teal-600",
  },
  {
    slug: "breakfast-cereal",
    label: "Breakfast Cereal Category",
    shortLabel: "Breakfast Cereal",
    formId: "BHT_3_Category_Survey_Breakfast_wave_2",
    schema: "breakfast_cereal",
    description: "Breakfast cereal Wave 2 quality-control workspace.",
    accent: "from-sky-400 to-blue-600",
  },
];

export function getSurveyWorkspace(slug: string | null | undefined) {
  return SURVEY_WORKSPACES.find((workspace) => workspace.slug === slug) ?? null;
}
