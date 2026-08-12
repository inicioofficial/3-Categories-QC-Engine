import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Wand2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  apiFetch,
  type CustomTableQuestionRef,
  type CustomTableSelectionPayload,
  type MainSurveySectionPayload,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type BreakType = "top" | "side";
type AnalysisOption = "significance" | "chi_square";
type DisplayModeId = "row_pct" | "counts" | "column_pct" | "total_pct";

export type SectionDef = { id: string; title: string };

type GroupedQuestion = {
  id: string;
  label: string;
  grouped: boolean;
  questionCodes: string[];
  codeLabels?: Record<string, string>;
};

type CustomTableFormatOptions = {
  showPercentSign: boolean;
  useDecimalPlaces: boolean;
  decimalPlaces: number;
};

const ANALYSIS_OPTIONS: Array<{ id: AnalysisOption; label: string; description: string }> = [
  {
    id: "significance",
    label: "Significance test",
    description: "Tests whether differences between column percentages are statistically significant at 95% confidence.",
  },
  {
    id: "chi_square",
    label: "Chi-square test",
    description: "Tests independence between row and column variables for categorical cross-tabulation analysis.",
  },
];

const DISPLAY_MODES: Array<{ id: DisplayModeId; title: string; description: string }> = [
  {
    id: "row_pct",
    title: "Row %",
    description: "Percentage within each side-break category",
  },
  {
    id: "counts",
    title: "Counts",
    description: "Raw respondent counts",
  },
  {
    id: "column_pct",
    title: "Column %",
    description: "Percentage within each top-break category",
  },
  {
    id: "total_pct",
    title: "Total %",
    description: "Share of all included interviews",
  },
];

const BHT_CATEGORY_OPTIONS = [
  { id: "breakfast-cereals", label: "Breakfast Cereals" },
  { id: "noodles", label: "Noodles" },
  { id: "toothpaste", label: "Toothpaste" },
  { id: "bleach", label: "Bleach" },
  { id: "wet-hair", label: "Wet Hair" },
  { id: "dry-hair", label: "Dry Hair" },
  { id: "condiment-mixes", label: "Condiment Mixes" },
  { id: "malt", label: "Malt" },
  { id: "snacks", label: "Snacks" },
  { id: "edible-oil", label: "Edible Oil" },
  { id: "toilet-cleaner", label: "Toilet Cleaner" },
] as const;
const DEFAULT_CATEGORY_SELECTION = [BHT_CATEGORY_OPTIONS[0].id];

const DECIMAL_PLACE_OPTIONS = [1, 2, 3, 4];
const DEFAULT_FORMAT_OPTIONS: CustomTableFormatOptions = {
  showPercentSign: true,
  useDecimalPlaces: false,
  decimalPlaces: 1,
};

const EMPTY_BY_BREAK: Record<BreakType, Record<string, string[]>> = {
  top: {},
  side: {},
};

const EMPTY_SECTION_BY_BREAK: Record<BreakType, string> = {
  top: "",
  side: "",
};

const BREAK_LABEL: Record<BreakType, string> = {
  top: "Top Break",
  side: "Side Break",
};

function questionRegistryKey(sectionId: string, questionId: string) {
  return `${sectionId}::${questionId}`;
}

function toggleInList(current: string[], value: string): string[] {
  if (current.includes(value)) return current.filter((item) => item !== value);
  return [...current, value];
}

function cleanLabel(text: string): string {
  return text
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const REMITTANCE_BUILDER_QUESTIONS: Record<string, GroupedQuestion[]> = {
  "respondent-profile": [
    { id: "gender", label: "What is the respondent's gender?", grouped: false, questionCodes: ["gender"], codeLabels: { Female: "Female", Male: "Male" } },
    { id: "age_group", label: "Which age group does the respondent belong to?", grouped: false, questionCodes: ["age_group"], codeLabels: { "18 - 25 years": "18 - 25 years", "26 - 35 years": "26 - 35 years", "36 - 45 years": "36 - 45 years", "46+ years": "46+ years" } },
    { id: "education_level", label: "What is the highest level of education completed?", grouped: false, questionCodes: ["education_level"], codeLabels: { Secondary: "Secondary", Tertiary: "Tertiary", Primary: "Primary", "No formal education": "No formal education" } },
    { id: "employment_status", label: "What is the respondent's current employment status?", grouped: false, questionCodes: ["employment_status"], codeLabels: { "Self-employed": "Self-employed", "Paid employment": "Paid employment", "Trading/business": "Trading/business", "Unemployed/student": "Unemployed/student" } },
  ],
  "remittance-sources": [
    { id: "sender_country", label: "Which country was the most recent international remittance sent from?", grouped: false, questionCodes: ["sender_country"], codeLabels: { "United Kingdom": "United Kingdom", "United States": "United States", Canada: "Canada", UAE: "UAE", "South Africa": "South Africa", Other: "Other" } },
    { id: "sender_relationship", label: "Who sent the most recent international remittance?", grouped: false, questionCodes: ["sender_relationship"], codeLabels: { Sibling: "Sibling", Child: "Child", "Spouse/partner": "Spouse/partner", Parent: "Parent", "Friend/other relative": "Friend/other relative" } },
    { id: "received_from_canada", label: "Has the respondent received remittance from Canada in the last 12 months?", grouped: false, questionCodes: ["received_from_canada"], codeLabels: { Yes: "Yes", No: "No" } },
  ],
  "transfer-channels": [
    { id: "primary_channel", label: "What channel was used for the most recent remittance?", grouped: false, questionCodes: ["primary_channel"], codeLabels: { "Bank transfer": "Bank transfer", "Money transfer operator": "Money transfer operator", "Mobile wallet": "Mobile wallet", "Cash pickup": "Cash pickup", "Informal agent": "Informal agent", "Crypto/P2P": "Crypto/P2P" } },
    { id: "channel_type", label: "Was the channel formal, digital, or informal?", grouped: false, questionCodes: ["channel_type"], codeLabels: { "Formal digital": "Formal digital", "Formal cash-assisted": "Formal cash-assisted", "Bank branch/account": "Bank branch/account", Informal: "Informal" } },
    { id: "digital_channel_user", label: "Did the respondent use a digital channel for receiving remittance?", grouped: false, questionCodes: ["digital_channel_user"], codeLabels: { Yes: "Yes", No: "No" } },
  ],
  "value-and-frequency": [
    { id: "remittance_frequency", label: "How often does the respondent receive international remittance?", grouped: false, questionCodes: ["remittance_frequency"], codeLabels: { Monthly: "Monthly", "Every 2-3 months": "Every 2-3 months", "A few times a year": "A few times a year", "Once a year/less": "Once a year/less" } },
    { id: "amount_last_received_ngn", label: "How much was received in the most recent transfer?", grouped: false, questionCodes: ["amount_last_received_ngn"], codeLabels: { "Less than N150,000": "Less than N150,000", "N150,000 - N300,000": "N150,000 - N300,000", "N300,001 - N500,000": "N300,001 - N500,000", "N500,001 - N1,000,000": "N500,001 - N1,000,000", "Above N1,000,000": "Above N1,000,000" } },
    { id: "months_since_last_received", label: "When was the last international remittance received?", grouped: false, questionCodes: ["months_since_last_received"], codeLabels: { "Within 1 month": "Within 1 month", "1 - 3 months": "1 - 3 months", "4 - 6 months": "4 - 6 months", "More than 6 months": "More than 6 months" } },
  ],
  "use-of-remittance": [
    { id: "primary_use_of_remittance", label: "What was the remittance mainly used for?", grouped: false, questionCodes: ["primary_use_of_remittance"], codeLabels: { "Food and household upkeep": "Food and household upkeep", Education: "Education", "Health expenses": "Health expenses", "Business/investment": "Business/investment", "Rent/building": "Rent/building", "Savings/debt repayment": "Savings/debt repayment" } },
    { id: "who_decides_use", label: "Who mainly decides how the remittance is used?", grouped: false, questionCodes: ["who_decides_use"], codeLabels: { Respondent: "Respondent", Sender: "Sender", "Joint decision": "Joint decision", "Another household member": "Another household member" } },
    { id: "recipient_control_over_funds", label: "How much control does the respondent have over the funds?", grouped: false, questionCodes: ["recipient_control_over_funds"], codeLabels: { "Full control": "Full control", "Shared control": "Shared control", "Limited control": "Limited control", "No control": "No control" } },
  ],
  "trust-fees-and-experience": [
    { id: "fees_perception", label: "How does the respondent perceive remittance fees?", grouped: false, questionCodes: ["fees_perception"], codeLabels: { Affordable: "Affordable", "Somewhat expensive": "Somewhat expensive", "Very expensive": "Very expensive", "Do not know": "Do not know" } },
    { id: "exchange_rate_satisfaction", label: "How satisfied is the respondent with the exchange rate received?", grouped: false, questionCodes: ["exchange_rate_satisfaction"], codeLabels: { "Very satisfied": "Very satisfied", Satisfied: "Satisfied", Neutral: "Neutral", Dissatisfied: "Dissatisfied", "Very dissatisfied": "Very dissatisfied" } },
    { id: "main_barrier_to_digital_use", label: "What is the main barrier to using digital remittance channels?", grouped: false, questionCodes: ["main_barrier_to_digital_use"], codeLabels: { "Network/platform reliability": "Network/platform reliability", "High fees": "High fees", "Low trust": "Low trust", "Low digital confidence": "Low digital confidence", "Cash preference": "Cash preference", "Agent/bank access": "Agent/bank access" } },
  ],
};

function cardsToGroupedQuestions(cards: MainSurveySectionPayload["questionCards"]): GroupedQuestion[] {
  const out: GroupedQuestion[] = [];
  for (const c of cards ?? []) {
    const parentLabel = cleanLabel((c.label ?? "").trim() || c.variable);
    if (c.isMultiSelect) {
      const rows = c.tableRows ?? [];
      const questionCodes = rows.length > 0 ? rows.map((r) => r.code) : [c.variable];
      out.push({
        id: c.variable,
        label: parentLabel,
        grouped: true,
        questionCodes,
        codeLabels: Object.fromEntries(rows.map((r) => [r.code, cleanLabel((r.label ?? "").trim() || r.code)])),
      });
      continue;
    }
    out.push({
      id: c.variable,
      label: parentLabel,
      grouped: false,
      questionCodes: [c.variable],
    });
  }
  return out;
}

function groupedToQuestionRef(sectionId: string, sectionTitle: string, g: GroupedQuestion): CustomTableQuestionRef {
  return {
    id: `${sectionId}:${g.id}`,
    label: g.label,
    sectionId,
    sectionTitle,
    questionCodes: g.questionCodes,
    codeLabels: g.codeLabels,
  };
}

async function fetchSectionQuestions(
  sectionId: string,
  token: string,
  signal: AbortSignal,
): Promise<GroupedQuestion[]> {
  if (REMITTANCE_BUILDER_QUESTIONS[sectionId]) {
    return REMITTANCE_BUILDER_QUESTIONS[sectionId];
  }

  const candidates = Array.from(new Set([
    sectionId,
    sectionId.replace(/^sec[-_]/i, ""),
    sectionId.replace(/^sec[-_]/i, "").replace(/_/g, "-"),
  ])).filter(Boolean);

  const paths = Array.from(new Set([
    ...candidates.map((id) => `/api/main-survey/custom-table/sections/${id}`),
    ...candidates.map((id) => `/api/main-survey/sections/${id}`),
    ...candidates.map((id) => `/api/main-survey/${id}`),
  ]));

  let lastError: Error | null = null;
  for (const path of paths) {
    try {
      const data = await apiFetch<MainSurveySectionPayload>(
        path,
        { method: "GET", signal },
        token,
        45000,
      );
      return cardsToGroupedQuestions(data.questionCards);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unable to load section questions.");
      const msg = (lastError.message || "").toLowerCase();
      const isNotFound = msg.includes("404") || msg.includes("not found");
      if (!isNotFound) {
        throw lastError;
      }
    }
  }
  throw lastError ?? new Error("Unable to load section questions.");
}

type Props = {
  sections: SectionDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  initialSelection?: CustomTableSelectionPayload | null;
  generating?: boolean;
  filters: Record<string, string[]>;
  months: string[];
  onGenerate: (payload: CustomTableSelectionPayload) => void | Promise<void>;
};

export function MainSurveyCustomTableBuilderModal({
  open,
  onOpenChange,
  token,
  initialSelection,
  onGenerate,
  generating = false,
  filters,
  months,
}: Props) {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [activeBreak, setActiveBreak] = useState<BreakType>("top");
  const [activeSectionByBreak, setActiveSectionByBreak] = useState<Record<BreakType, string>>(EMPTY_SECTION_BY_BREAK);
  const [selectedQuestionIdsByBreak, setSelectedQuestionIdsByBreak] =
    useState<Record<BreakType, Record<string, string[]>>>(EMPTY_BY_BREAK);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisOption[]>([]);
  const [selectedDisplayModeId, setSelectedDisplayModeId] = useState<DisplayModeId>("row_pct");
  const [showPercentSign, setShowPercentSign] = useState<boolean>(DEFAULT_FORMAT_OPTIONS.showPercentSign);
  const [useDecimalPlaces, setUseDecimalPlaces] = useState<boolean>(DEFAULT_FORMAT_OPTIONS.useDecimalPlaces);
  const [decimalPlaces, setDecimalPlaces] = useState<number>(DEFAULT_FORMAT_OPTIONS.decimalPlaces);
  const [questionsBySection, setQuestionsBySection] = useState<Record<string, GroupedQuestion[]>>({});
  const [loadingSectionIds, setLoadingSectionIds] = useState<string[]>([]);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [builderError, setBuilderError] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([...DEFAULT_CATEGORY_SELECTION]);

  const selectedQuestionIdsByBreakRef = useRef<Record<BreakType, Record<string, string[]>>>(EMPTY_BY_BREAK);
  const selectedAnalysisRef = useRef<AnalysisOption[]>([]);
  const selectedDisplayModeIdRef = useRef<DisplayModeId>("row_pct");
  const showPercentSignRef = useRef<boolean>(DEFAULT_FORMAT_OPTIONS.showPercentSign);
  const useDecimalPlacesRef = useRef<boolean>(DEFAULT_FORMAT_OPTIONS.useDecimalPlaces);
  const decimalPlacesRef = useRef<number>(DEFAULT_FORMAT_OPTIONS.decimalPlaces);
  const questionRegistryRef = useRef(new Map<string, GroupedQuestion>());
  const questionRequestCacheRef = useRef<Record<string, Promise<GroupedQuestion[]>>>({});
  const activeSectionIdRef = useRef("");

  const effectiveSections = useMemo<SectionDef[]>(() => {
    const selected = selectedCategories.length ? selectedCategories : [...DEFAULT_CATEGORY_SELECTION];
    return [
      { id: "omnibus", title: "Omnibus" },
      ...BHT_CATEGORY_OPTIONS
        .filter((category) => selected.includes(category.id))
        .map((category) => ({ id: category.id, title: category.label })),
    ];
  }, [selectedCategories]);
  const firstSectionId = effectiveSections[0]?.id || "";
  const sectionIdSet = useMemo(() => new Set(effectiveSections.map((s) => s.id)), [effectiveSections]);

  useEffect(() => {
    if (!open) return;
    const nextSelectionByBreak: Record<BreakType, Record<string, string[]>> = { top: {}, side: {} };
    const normalizeQuestionId = (rawId: string) => {
      const tail = rawId.split(":").pop() ?? rawId;
      return tail.split("::")[0] || tail;
    };

    for (const question of initialSelection?.topQuestions ?? []) {
      const normalizedId = (question.id.split(":").pop() ?? question.id).split("::")[0];
      nextSelectionByBreak.top[question.sectionId] = [
        ...(nextSelectionByBreak.top[question.sectionId] ?? []),
        normalizeQuestionId(question.id),
      ];
    }

    for (const question of initialSelection?.sideQuestions ?? []) {
      const normalizedId = (question.id.split(":").pop() ?? question.id).split("::")[0];
      nextSelectionByBreak.side[question.sectionId] = [
        ...(nextSelectionByBreak.side[question.sectionId] ?? []),
        normalizeQuestionId(question.id),
      ];
    }

    const nextActiveSections: Record<BreakType, string> = {
      top: Object.keys(nextSelectionByBreak.top)[0] ?? firstSectionId,
      side: Object.keys(nextSelectionByBreak.side)[0] ?? firstSectionId,
    };
    const nextAnalysis = (initialSelection?.analysisOptions ?? []).filter((value): value is AnalysisOption =>
      ANALYSIS_OPTIONS.some((option) => option.id === value),
    );
    const nextDisplayMode =
      DISPLAY_MODES.find((mode) => mode.id === initialSelection?.displayMode)?.id ?? "row_pct";
    const nextFormatOptions = {
      showPercentSign:
        typeof initialSelection?.formatOptions?.showPercentSign === "boolean"
          ? Boolean(initialSelection.formatOptions.showPercentSign)
          : DEFAULT_FORMAT_OPTIONS.showPercentSign,
      useDecimalPlaces:
        typeof initialSelection?.formatOptions?.useDecimalPlaces === "boolean"
          ? Boolean(initialSelection.formatOptions.useDecimalPlaces)
          : DEFAULT_FORMAT_OPTIONS.useDecimalPlaces,
      decimalPlaces: DECIMAL_PLACE_OPTIONS.includes(Number(initialSelection?.formatOptions?.decimalPlaces))
        ? Number(initialSelection?.formatOptions?.decimalPlaces)
        : DEFAULT_FORMAT_OPTIONS.decimalPlaces,
    };

    setActiveStep(1);
    setActiveBreak("top");
    setSelectedCategories((initialSelection?.filters?.categories?.length ? initialSelection.filters.categories : [...DEFAULT_CATEGORY_SELECTION]));
    questionRegistryRef.current = new Map();
    selectedQuestionIdsByBreakRef.current = nextSelectionByBreak;
    selectedAnalysisRef.current = nextAnalysis;
    selectedDisplayModeIdRef.current = nextDisplayMode;
    showPercentSignRef.current = nextFormatOptions.showPercentSign;
    useDecimalPlacesRef.current = nextFormatOptions.useDecimalPlaces;
    decimalPlacesRef.current = nextFormatOptions.decimalPlaces;
    setActiveSectionByBreak(nextActiveSections);
    setSelectedQuestionIdsByBreak(nextSelectionByBreak);
    setSelectedAnalysis(nextAnalysis);
    setSelectedDisplayModeId(nextDisplayMode);
    setShowPercentSign(nextFormatOptions.showPercentSign);
    setUseDecimalPlaces(nextFormatOptions.useDecimalPlaces);
    setDecimalPlaces(nextFormatOptions.decimalPlaces);
  }, [open, firstSectionId, initialSelection]);

  useEffect(() => {
    if (!firstSectionId) {
      setActiveSectionByBreak(EMPTY_SECTION_BY_BREAK);
      return;
    }
    setActiveSectionByBreak((prev) => ({
      top: prev.top && sectionIdSet.has(prev.top) ? prev.top : firstSectionId,
      side: prev.side && sectionIdSet.has(prev.side) ? prev.side : firstSectionId,
    }));
  }, [firstSectionId, sectionIdSet]);

  useEffect(() => {
    const keepValidSections = (current: Record<BreakType, Record<string, string[]>>) => {
      const next: Record<BreakType, Record<string, string[]>> = { top: {}, side: {} };
      (["top", "side"] as BreakType[]).forEach((breakId) => {
        Object.entries(current[breakId] || {}).forEach(([sectionId, ids]) => {
          if (sectionIdSet.has(sectionId)) {
            next[breakId][sectionId] = ids;
          }
        });
      });
      return next;
    };
    setSelectedQuestionIdsByBreak((prev) => {
      const next = keepValidSections(prev);
      selectedQuestionIdsByBreakRef.current = next;
      return next;
    });
  }, [sectionIdSet]);

  useEffect(() => {
    setQuestionsBySection({});
    setLoadingSectionIds([]);
    setSectionErrors({});
    setBuilderError("");
    questionRegistryRef.current = new Map();
    questionRequestCacheRef.current = {};
  }, [effectiveSections]);

  useEffect(() => {
    selectedQuestionIdsByBreakRef.current = selectedQuestionIdsByBreak;
  }, [selectedQuestionIdsByBreak]);

  useEffect(() => {
    selectedAnalysisRef.current = selectedAnalysis;
  }, [selectedAnalysis]);

  useEffect(() => {
    selectedDisplayModeIdRef.current = selectedDisplayModeId;
  }, [selectedDisplayModeId]);

  useEffect(() => {
    showPercentSignRef.current = showPercentSign;
  }, [showPercentSign]);

  useEffect(() => {
    useDecimalPlacesRef.current = useDecimalPlaces;
  }, [useDecimalPlaces]);

  useEffect(() => {
    decimalPlacesRef.current = decimalPlaces;
  }, [decimalPlaces]);

  const activeSectionId = activeSectionByBreak[activeBreak] || firstSectionId;
  const activeSectionQuestions = questionsBySection[activeSectionId] || [];
  const activeSectionSelectedQuestionIds = selectedQuestionIdsByBreak[activeBreak][activeSectionId] || [];
  const activeSectionQuestionIds = activeSectionQuestions.map((q) => q.id);
  const activeSectionSelectedQuestionIdSet = new Set(activeSectionSelectedQuestionIds);
  const activeSectionSelectedLoadedCount = activeSectionQuestions.reduce(
    (count, q) => count + (activeSectionSelectedQuestionIdSet.has(q.id) ? 1 : 0),
    0,
  );
  const allActiveSectionQuestionsSelected =
    activeSectionQuestionIds.length > 0 && activeSectionSelectedLoadedCount === activeSectionQuestionIds.length;
  const someActiveSectionQuestionsSelected = activeSectionSelectedLoadedCount > 0 && !allActiveSectionQuestionsSelected;
  const activeSectionLoading = loadingSectionIds.includes(activeSectionId);
  const activeSectionError = sectionErrors[activeSectionId] || "";
  const usesPercentageFormatting = selectedDisplayModeId !== "counts";

  useEffect(() => {
    activeSectionIdRef.current = activeSectionId;
  }, [activeSectionId]);

  useEffect(() => {
    setBuilderError("");
  }, [activeSectionId]);

  const selectedQuestionLabelBySectionAndId = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(questionsBySection).forEach(([sectionId, sectionQuestions]) => {
      sectionQuestions.forEach((item) => map.set(questionRegistryKey(sectionId, item.id), item.label));
    });
    return map;
  }, [questionsBySection]);

  const totalSelectedQuestions = useMemo(() => {
    return (["top", "side"] as BreakType[]).reduce((sum, breakId) => {
      const breakSelections = selectedQuestionIdsByBreak[breakId] || {};
      return (
        sum +
        Object.values(breakSelections).reduce((count, ids) => count + (Array.isArray(ids) ? ids.length : 0), 0)
      );
    }, 0);
  }, [selectedQuestionIdsByBreak]);

  const selectedQuestionCountByBreak = useMemo(() => {
    return (["top", "side"] as BreakType[]).reduce(
      (acc, breakId) => {
        const breakSelections = selectedQuestionIdsByBreak[breakId] || {};
        acc[breakId] = Object.values(breakSelections).reduce((count, ids) => count + (Array.isArray(ids) ? ids.length : 0), 0);
        return acc;
      },
      { top: 0, side: 0 } as Record<BreakType, number>,
    );
  }, [selectedQuestionIdsByBreak]);

  const canGenerate =
    Boolean(token) &&
    selectedCategories.length > 0 &&
    selectedQuestionCountByBreak.top > 0 &&
    selectedQuestionCountByBreak.side > 0 &&
    !generating;

  const selectedSummaryByBreak = useMemo(() => {
    return (["top", "side"] as BreakType[]).map((breakId) => {
      const items = Object.entries(selectedQuestionIdsByBreak[breakId])
        .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
        .map(([sectionId, ids]) => {
          const section = effectiveSections.find((entry) => entry.id === sectionId);
          const labels = ids.map((id) => selectedQuestionLabelBySectionAndId.get(questionRegistryKey(sectionId, id)) || id);
          return {
            sectionId,
            sectionTitle: section?.title || sectionId,
            labels,
          };
        });
      return { breakId, items };
    });
  }, [effectiveSections, selectedQuestionIdsByBreak, selectedQuestionLabelBySectionAndId]);

  const loadSectionQuestions = useCallback(
    (sectionId: string) => {
      if (!open || !token || !sectionId) return;
      if (questionsBySection[sectionId]) return;
      if (loadingSectionIds.includes(sectionId)) return;

      setLoadingSectionIds((prev) => (prev.includes(sectionId) ? prev : [...prev, sectionId]));
      setSectionErrors((prev) => {
        if (!prev[sectionId]) return prev;
        const next = { ...prev };
        delete next[sectionId];
        return next;
      });

      const request =
        questionRequestCacheRef.current[sectionId] ??
        fetchSectionQuestions(sectionId, token, new AbortController().signal);

      questionRequestCacheRef.current[sectionId] = request;

      void request
        .then((groupedQuestions) => {
          const nextRegistry = new Map(questionRegistryRef.current);
          groupedQuestions.forEach((question) => {
            nextRegistry.set(questionRegistryKey(sectionId, question.id), question);
          });
          questionRegistryRef.current = nextRegistry;
          setQuestionsBySection((prev) => ({ ...prev, [sectionId]: groupedQuestions }));
        })
        .catch((error: Error) => {
          const message = error.message || "Unable to load section questions.";
          setSectionErrors((prev) => ({ ...prev, [sectionId]: message }));
        })
        .finally(() => {
          setLoadingSectionIds((prev) => prev.filter((id) => id !== sectionId));
          delete questionRequestCacheRef.current[sectionId];
        });
    },
    [loadingSectionIds, open, questionsBySection, token],
  );

  useEffect(() => {
    if (!open || !token || !activeSectionId) return;
    loadSectionQuestions(activeSectionId);
  }, [activeSectionId, loadSectionQuestions, open, token]);

  useEffect(() => {
    if (!open || !token) return;
    const selectedSectionIds = Array.from(
      new Set(
        (["top", "side"] as BreakType[]).flatMap((breakId) => Object.keys(selectedQuestionIdsByBreak[breakId] || {})),
      ),
    );
    selectedSectionIds.forEach((sectionId) => loadSectionQuestions(sectionId));
  }, [loadSectionQuestions, open, selectedQuestionIdsByBreak, token]);

  const handleSectionSelect = (sectionId: string, breakType: BreakType = activeBreak) => {
    setActiveSectionByBreak((prev) => ({
      ...prev,
      [breakType]: sectionId,
    }));
  };

  const handleQuestionToggle = (
    questionId: string,
    breakType: BreakType = activeBreak,
    sectionId: string = activeSectionId,
  ) => {
    const current = selectedQuestionIdsByBreakRef.current;
    const byBreak = current[breakType] || {};
    const existing = byBreak[sectionId] || [];
    const next = {
      ...current,
      [breakType]: {
        ...byBreak,
        [sectionId]: toggleInList(existing, questionId),
      },
    };
    selectedQuestionIdsByBreakRef.current = next;
    setSelectedQuestionIdsByBreak(next);
  };

  const handleQuestionSelectAll = (
    breakType: BreakType = activeBreak,
    sectionId: string = activeSectionId,
    questionIds: string[] = activeSectionQuestionIds,
    allSelected: boolean = allActiveSectionQuestionsSelected,
  ) => {
    if (!sectionId) return;
    const current = selectedQuestionIdsByBreakRef.current;
    const byBreak = current[breakType] || {};
    const next = {
      ...current,
      [breakType]: {
        ...byBreak,
        [sectionId]: allSelected ? [] : questionIds,
      },
    };
    selectedQuestionIdsByBreakRef.current = next;
    setSelectedQuestionIdsByBreak(next);
  };

  const handleAnalysisToggle = (optionId: AnalysisOption) => {
    const next = toggleInList(selectedAnalysisRef.current, optionId) as AnalysisOption[];
    selectedAnalysisRef.current = next;
    setSelectedAnalysis(next);
  };

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories((prev) => {
      const next = toggleInList(prev, categoryId);
      return next.length ? next : [...DEFAULT_CATEGORY_SELECTION];
    });
  };

  const handleGenerate = async () => {
    if (!canGenerate || !token) return;
    const selectedIdsSnapshot = selectedQuestionIdsByBreakRef.current;
    const selectedAnalysisSnapshot = selectedAnalysisRef.current;
    const selectedDisplayModeSnapshot = selectedDisplayModeIdRef.current;
    const formatOptionsSnapshot: CustomTableFormatOptions = {
      showPercentSign: Boolean(showPercentSignRef.current),
      useDecimalPlaces: Boolean(useDecimalPlacesRef.current),
      decimalPlaces: DECIMAL_PLACE_OPTIONS.includes(Number(decimalPlacesRef.current))
        ? Number(decimalPlacesRef.current)
        : DEFAULT_FORMAT_OPTIONS.decimalPlaces,
    };

    const topQuestions: CustomTableQuestionRef[] = [];
    const sideQuestions: CustomTableQuestionRef[] = [];
    const unresolved: string[] = [];

    (["top", "side"] as BreakType[]).forEach((breakId) => {
      const bySection = selectedIdsSnapshot[breakId] || {};
      const bucket = breakId === "top" ? topQuestions : sideQuestions;
      Object.entries(bySection).forEach(([sectionId, ids]) => {
        const sectionTitle = effectiveSections.find((e) => e.id === sectionId)?.title || sectionId;
        ids.forEach((id) => {
          const question = questionRegistryRef.current.get(questionRegistryKey(sectionId, id));
          if (!question) {
            unresolved.push(`${sectionTitle}: ${id}`);
            return;
          }
          bucket.push(groupedToQuestionRef(sectionId, sectionTitle, question));
        });
      });
    });

    if (unresolved.length > 0) {
      setBuilderError("Some selected questions are still loading. Please wait and try again.");
      return;
    }

    const mergedFilters: Record<string, string[]> = {
      ...filters,
      categories: [...selectedCategories],
    };

    const body: CustomTableSelectionPayload = {
      slug: "main",
      topQuestions,
      sideQuestions,
      displayMode: selectedDisplayModeSnapshot,
      analysisOptions: selectedAnalysisSnapshot,
      formatOptions: formatOptionsSnapshot as Record<string, unknown>,
      filters: mergedFilters,
      months,
    };

    setBuilderError("");
    try {
      const maybePromise = onGenerate(body);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        void (maybePromise as Promise<unknown>).catch((error) => {
          const message = error instanceof Error ? error.message : "Unable to generate custom table.";
          setBuilderError(message);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate custom table.";
      setBuilderError(message);
    }
  };

  const categoryLabelById = useMemo(
    () => new Map<string, string>(BHT_CATEGORY_OPTIONS.map((category) => [category.id, category.label])),
    [],
  );
  const activeStepBreak: BreakType = activeStep === 2 ? "side" : "top";
  const selectedDisplayMode = DISPLAY_MODES.find((mode) => mode.id === selectedDisplayModeId);
  const currentInstruction =
    activeStep === 1
      ? "Select top break column questions."
      : activeStep === 2
        ? "Select side break row questions."
        : activeStep === 3
          ? "Optionally add statistical tests."
          : activeStep === 4
            ? "Choose your display mode."
            : "Review and generate your table.";

  const goToStep = (step: 1 | 2 | 3 | 4 | 5) => {
    setActiveStep(step);
    if (step === 1) setActiveBreak("top");
    if (step === 2) setActiveBreak("side");
  };

  const handleNextStep = () => {
    if (activeStep < 5) {
      goToStep((activeStep + 1) as 1 | 2 | 3 | 4 | 5);
      return;
    }
    handleGenerate();
  };

  const handleBackStep = () => {
    if (activeStep > 1) {
      goToStep((activeStep - 1) as 1 | 2 | 3 | 4 | 5);
    }
  };

  const stepItems: Array<{ id: 1 | 2 | 3 | 4 | 5; label: string }> = [
    { id: 1, label: "Top break" },
    { id: 2, label: "Side break" },
    { id: 3, label: "Statistical tests" },
    { id: 4, label: "Display mode" },
    { id: 5, label: "Summary" },
  ];

  const renderQuestionStep = (breakType: BreakType) => {
    const sectionId = activeSectionByBreak[breakType] || firstSectionId;
    const sectionQuestions = questionsBySection[sectionId ?? ""] ?? [];
    const sectionQuestionIds = sectionQuestions.map((question) => question.id);
    const sectionLoading = sectionId ? loadingSectionIds.includes(sectionId) : false;
    const sectionError = sectionId ? sectionErrors[sectionId] : "";
    const selectedIds = selectedQuestionIdsByBreak[breakType][sectionId ?? ""] ?? [];
    const allSelected =
      sectionQuestions.length > 0 && sectionQuestions.every((question) => selectedIds.includes(question.id));
    const someSelected =
      sectionQuestions.some((question) => selectedIds.includes(question.id)) && !allSelected;

    return (
      <div className="space-y-5">
        <p className="text-sm font-medium leading-relaxed text-[#6a79a4]">
          Select questions that will form the{" "}
          <span className="font-bold">{breakType === "top" ? "columns" : "rows"}</span> of your table.
        </p>

        <div className="grid min-h-[380px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#d9e2f6] bg-[#f5f7fd]">
            <div className="border-b border-[#d9e2f6] bg-[#edf2ff] px-6 py-5">
              <h3 className="text-base font-medium text-[#14265f]">Sections</h3>
              <p className="text-sm text-[#6a79a4]">Pick one to browse</p>
            </div>
            <div className="max-h-[318px] space-y-1 overflow-y-auto p-3">
              {effectiveSections.length === 0 ? (
                <p className="px-3 py-4 text-sm text-[#6a79a4]">No sections available.</p>
              ) : (
                effectiveSections.map((section) => {
                  const checked = sectionId === section.id;
                  return (
                    <button
                      key={`${breakType}-${section.id}`}
                      type="button"
                      onClick={() => {
                        setActiveBreak(breakType);
                        handleSectionSelect(section.id, breakType);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                        checked ? "bg-[#4657ca] text-white" : "text-[#32558d] hover:bg-white",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs",
                          checked ? "border-[#4657ca] text-white" : "border-[#bfd0f0] bg-white",
                        )}
                      >
                          {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="font-medium">{section.title}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff]">
            <div className="flex items-start justify-between gap-4 border-b border-[#d9e2f6] bg-[#edf2ff] px-6 py-5">
              <div>
                <h3 className="text-base font-medium text-[#14265f]">{BREAK_LABEL[breakType]} questions</h3>
                <p className="text-sm text-[#6a79a4]">Multi-select</p>
              </div>
              <label
                className={cn(
                  "flex items-center gap-2 text-sm",
                  sectionLoading || sectionQuestions.length === 0
                    ? "cursor-not-allowed text-[#9ca9c9]"
                    : "cursor-pointer text-[#4657ca]",
                )}
              >
                <Checkbox
                  aria-label={`Select all ${BREAK_LABEL[breakType].toLowerCase()} questions`}
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  disabled={sectionLoading || sectionQuestions.length === 0}
                  onCheckedChange={() => {
                    setActiveBreak(breakType);
                    handleQuestionSelectAll(breakType, sectionId, sectionQuestionIds, allSelected);
                  }}
                  className="h-4 w-4 rounded-none"
                />
                <span>All</span>
              </label>
            </div>

            {(sectionError || builderError) && (
              <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-base text-rose-700">
                {sectionError || builderError}
              </div>
            )}

            <div className="max-h-[320px] space-y-3 overflow-y-auto px-5 py-4">
              {sectionLoading ? (
                <div className="flex items-center gap-3 text-sm text-[#6a79a4]">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading questions...
                </div>
              ) : sectionId && sectionQuestions.length === 0 ? (
                <p className="text-sm text-[#6a79a4]">No questions found for this section.</p>
              ) : (
                sectionQuestions.map((question, index) => {
                  const checked = selectedIds.includes(question.id);
                  return (
                    <label
                      key={`${breakType}-${sectionId}-${question.id}`}
                      className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-[#32558d]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setActiveBreak(breakType);
                          handleQuestionToggle(question.id, breakType, sectionId);
                        }}
                        className="mt-0.5 h-5 w-5 rounded-md border-[#bfd0f0]"
                      />
                      <span>
                        <span className="mr-2">{index + 1}.</span>
                        {question.label}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderMainStep = () => {
    if (activeStep === 1 || activeStep === 2) {
      return renderQuestionStep(activeStepBreak);
    }

    if (activeStep === 3) {
      return (
        <div className="space-y-7">
          <p className="text-sm font-medium leading-relaxed text-[#6a79a4]">
            Optionally add statistical tests to be applied across all applicable table cells.
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            {ANALYSIS_OPTIONS.map((option) => {
              const checked = selectedAnalysis.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleAnalysisToggle(option.id)}
                  className={cn(
                    "min-h-[160px] rounded-2xl border bg-white p-5 text-left transition",
                    checked ? "border-[#4657ca] bg-[#eef3ff]" : "border-[#d9e2f6] hover:border-[#b9c8ef]",
                  )}
                >
                  <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#eef3ff]">
                    <Checkbox checked={checked} onCheckedChange={() => handleAnalysisToggle(option.id)} />
                  </span>
                  <h3 className="text-base font-medium text-[#14265f]">{option.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6a79a4]">{option.description}</p>
                </button>
              );
            })}
          </div>
          <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] px-5 py-4 text-sm text-[#6a79a4]">
            <Checkbox
              checked={selectedAnalysis.length === 0}
              onCheckedChange={() => selectedAnalysis.forEach((option) => handleAnalysisToggle(option))}
            />
            <span>Statistical tests are optional - skip this step to generate without any tests applied.</span>
          </label>
        </div>
      );
    }

    if (activeStep === 4) {
      return (
        <div className="space-y-7">
          <p className="text-sm font-medium leading-relaxed text-[#6a79a4]">
            Choose how values are displayed in each table cell.
          </p>
          <div className="grid gap-5 xl:grid-cols-4">
            {DISPLAY_MODES.map((mode) => {
              const active = selectedDisplayModeId === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    selectedDisplayModeIdRef.current = mode.id;
                    setSelectedDisplayModeId(mode.id);
                  }}
                  className={cn(
                    "min-h-[140px] rounded-2xl border p-5 text-center transition",
                    active ? "border-[#4657ca] bg-[#eef3ff]" : "border-[#d9e2f6] bg-white hover:border-[#b9c8ef]",
                  )}
                >
                  <Checkbox checked={active} onCheckedChange={() => undefined} className="mx-auto mb-5" />
                  <h3 className="text-base font-medium text-[#14265f]">{mode.title}</h3>
                  <p className="mt-2 text-sm leading-snug text-[#6a79a4]">{mode.description}</p>
                </button>
              );
            })}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_318px]">
            <label
              className={cn(
                "flex min-h-[105px] cursor-pointer items-center gap-4 rounded-2xl border p-5",
                showPercentSign && usesPercentageFormatting
                  ? "border-[#4657ca] bg-[#eef3ff]"
                  : "border-[#d9e2f6] bg-white",
                !usesPercentageFormatting && "cursor-not-allowed opacity-55",
              )}
            >
              <Checkbox
                checked={showPercentSign}
                disabled={!usesPercentageFormatting}
                onCheckedChange={(c) => {
                  const next = c === true;
                  showPercentSignRef.current = next;
                  setShowPercentSign(next);
                }}
              />
              <div>
                <h3 className="text-base font-medium text-[#14265f]">Show % sign</h3>
                <p className="text-sm text-[#6a79a4]">Percentage modes only</p>
              </div>
            </label>
            <label
              className={cn(
                "flex min-h-[105px] cursor-pointer items-center gap-4 rounded-2xl border p-5",
                useDecimalPlaces && usesPercentageFormatting
                  ? "border-[#4657ca] bg-[#eef3ff]"
                  : "border-[#d9e2f6] bg-white",
                !usesPercentageFormatting && "cursor-not-allowed opacity-55",
              )}
            >
              <Checkbox
                checked={useDecimalPlaces}
                disabled={!usesPercentageFormatting}
                onCheckedChange={(c) => {
                  const next = c === true;
                  useDecimalPlacesRef.current = next;
                  setUseDecimalPlaces(next);
                }}
              />
              <div>
                <h3 className="text-base font-medium text-[#14265f]">Decimal places</h3>
                <p className="text-sm text-[#6a79a4]">Custom precision</p>
              </div>
            </label>
            <div className="rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] p-6">
              <label className="block">
                <span className="mb-2 block text-sm text-[#6a79a4]">Places</span>
                <select
                  value={decimalPlaces}
                  disabled={!usesPercentageFormatting || !useDecimalPlaces}
                  onChange={(e) => {
                    const next = Number(e.target.value || DEFAULT_FORMAT_OPTIONS.decimalPlaces);
                    decimalPlacesRef.current = next;
                    setDecimalPlaces(next);
                  }}
                  className="h-14 w-24 rounded-xl border border-[#262626] bg-[#2f2f2f] px-6 text-2xl font-bold text-white outline-none disabled:opacity-45"
                >
                  {DECIMAL_PLACE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-7">
        <p className="text-sm font-medium leading-relaxed text-[#6a79a4]">
          Review your configuration before generating the table.
        </p>
        <div className="grid gap-5 lg:grid-cols-2">
          {selectedSummaryByBreak.map((summary) => (
            <section key={summary.breakId} className="min-h-[112px] rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] p-5">
              <h3 className="text-sm font-medium uppercase tracking-wide text-[#8799c4]">
                {BREAK_LABEL[summary.breakId]} {summary.breakId === "top" ? "(columns)" : "(rows)"}
              </h3>
              {summary.items.length === 0 ? (
                <p className="mt-4 text-sm italic text-[#a8b4d2]">None selected</p>
              ) : (
                <div className="mt-4 space-y-3 text-sm text-[#32558d]">
                  {summary.items.map((item) => (
                    <div key={`${summary.breakId}-${item.sectionId}`}>
                      <p className="font-semibold text-[#14265f]">{item.sectionTitle}</p>
                      <p>{item.labels.join(", ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          <section className="min-h-[112px] rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-[#8799c4]">Statistical tests</h3>
            <p className="mt-4 text-sm italic text-[#a8b4d2]">
              {selectedAnalysis.length === 0
                ? "None selected"
                : ANALYSIS_OPTIONS.filter((option) => selectedAnalysis.includes(option.id))
                    .map((option) => option.label)
                    .join(", ")}
            </p>
          </section>
          <section className="min-h-[112px] rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-[#8799c4]">Display mode</h3>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#bfd0f0] bg-[#eef3ff] px-4 py-1 text-sm text-[#0b4c87]">
                {selectedDisplayMode?.title ?? "Row %"}
              </span>
              {showPercentSign && usesPercentageFormatting ? (
                <span className="rounded-full border border-[#bfd0f0] bg-[#eef3ff] px-4 py-1 text-sm text-[#0b4c87]">
                  Show % sign
                </span>
              ) : null}
            </div>
          </section>
          <section className="min-h-[112px] rounded-2xl border border-[#d9e2f6] bg-[#f7f9ff] p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-[#8799c4]">Categories</h3>
            <p className="mt-4 text-sm text-[#32558d]">
              {selectedCategories.map((id) => categoryLabelById.get(id) || id).join(", ")}
            </p>
          </section>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(94vh,860px)] max-w-[min(1180px,96vw)] flex-col overflow-hidden rounded-[24px] border border-[#d8e0f0] bg-white p-0 shadow-2xl">
        <DialogTitle className="sr-only">Custom table builder</DialogTitle>
        <DialogDescription className="sr-only">Configure columns, rows, tests and display options.</DialogDescription>
        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-md:grid-cols-1">
          <aside className="relative overflow-y-auto bg-[#4657ca] text-white">
            <div className="px-7 py-6 text-sm font-semibold uppercase tracking-wide text-white/55">
              Table Builder
            </div>
            <nav className="space-y-3 max-md:flex max-md:overflow-x-auto max-md:px-4 max-md:pb-4">
              {stepItems.map((step, index) => {
                const active = activeStep === step.id;
                const complete = activeStep > step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => goToStep(step.id)}
                    className={cn(
                      "relative flex h-16 w-full items-center gap-3 px-7 text-left transition max-md:min-w-44 max-md:rounded-2xl",
                      active ? "rounded-r-[24px] bg-white text-[#4657ca]" : "text-white/65 hover:text-white",
                    )}
                  >
                    {index < stepItems.length - 1 ? (
                      <span
                        className={cn(
                          "absolute left-[46px] top-[50px] h-[32px] w-1 rounded-full max-md:hidden",
                          active || complete ? "bg-white/70" : "bg-white/22",
                        )}
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold",
                        active
                          ? "border-[5px] border-white bg-[#4657ca] text-white shadow-[0_0_0_7px_white]"
                          : complete
                            ? "bg-white/90 text-[#4657ca]"
                            : "bg-white/18 text-white/80",
                      )}
                    >
                      {complete ? <Check className="h-4 w-4" /> : step.id}
                    </span>
                    <span className="relative z-10 text-base font-medium">{step.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
            <header className="flex items-start justify-between gap-4 border-b border-[#dfe5f0] px-7 py-5 max-sm:flex-col">
              <div>
                <h2 className="text-xl font-medium leading-tight text-[#14265f]">Custom table builder</h2>
                <p className="mt-1 text-xs text-[#6a79a4]">Configure columns, rows, tests and display options.</p>
              </div>
              <div className="rounded-full border-2 border-[#bfd0f0] bg-[#edf3ff] px-4 py-1 text-sm text-[#4657ca]">
                {totalSelectedQuestions} selected
              </div>
            </header>

            <section className="max-h-32 overflow-y-auto border-b border-[#dfe5f0] px-7 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
              <span className="mr-3 text-sm text-[#6a79a4]">Categories:</span>
              {BHT_CATEGORY_OPTIONS.map((category) => {
                const active = selectedCategories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => handleCategoryToggle(category.id)}
                    className={cn(
                      "rounded-full border-2 px-4 py-1 text-xs font-medium capitalize transition",
                      active
                        ? "border-[#4657ca] bg-[#4657ca] text-white"
                        : "border-[#bfd0f0] bg-white text-[#6a79a4] hover:border-[#4657ca]",
                    )}
                  >
                    {category.label}
                  </button>
                );
              })}
              </div>
            </section>

            <div className="min-h-0 overflow-y-auto px-7 py-5 text-[0.92rem]">{renderMainStep()}</div>

            <footer className="flex items-center justify-between gap-4 border-t border-[#dfe5f0] px-7 py-4 max-lg:flex-col max-lg:items-stretch">
              <p className="min-w-0 text-sm text-[#8aa0ca]">{currentInstruction}</p>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-10 min-w-[96px] rounded-xl border border-[#dfe5f0] bg-white px-5 text-sm font-semibold text-[#8aa0ca] transition hover:border-[#bfd0f0] hover:text-[#4657ca]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBackStep}
                  disabled={activeStep === 1}
                  className="h-10 min-w-[96px] rounded-xl border border-[#dfe5f0] bg-white px-5 text-sm font-semibold text-[#8aa0ca] transition hover:border-[#bfd0f0] hover:text-[#4657ca] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={(activeStep === 5 && !canGenerate) || generating}
                  className={cn(
                    "inline-flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-xl border px-5 text-sm font-semibold transition",
                    activeStep === 5
                      ? "border-[#4657ca] bg-[#4657ca] text-white hover:bg-[#3446b7]"
                      : "border-[#4657ca] bg-[#4657ca] text-white hover:bg-[#3446b7]",
                    ((activeStep === 5 && !canGenerate) || generating) && "cursor-not-allowed opacity-55",
                  )}
                >
                  {generating ? <Loader2 className="h-6 w-6 animate-spin" /> : activeStep === 5 ? <Wand2 className="h-6 w-6" /> : null}
                  {activeStep === 5 ? (generating ? "Running..." : "Run Analysis") : "Next"}
                </button>
              </div>
            </footer>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
