import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Check, ChevronDown, Download, Percent, SlidersHorizontal, Table2, X } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";

import { PlatformPage } from "@/app/platform-page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { findMainSurveySectionBySlug } from "@/data/mainSurveyDictionary";

type ViewMode = "chart" | "table";
type MetricMode = "percent" | "count";
type QuestionOption = { label: string; count: number; color: string };
type QuestionCard = {
  variable: string;
  question: string;
  base: number;
  options: QuestionOption[];
};

const SAMPLE_SIZE = 2000;
const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#6366f1"];
const FILTER_OPTIONS = {
  states: ["Lagos", "Kano", "Rivers", "Oyo", "Kaduna", "FCT", "Imo", "Edo", "Enugu"],
  genders: ["Female", "Male"],
  maritalStatuses: ["Single", "Married", "Widowed", "Divorced/Separated"],
  educationLevels: ["No formal education", "Primary", "Secondary", "Tertiary"],
  statuses: ["Reviewed and Approved", "Reviewed and Reject", "Pending Review"],
};

type SurveyQuestionFilters = {
  state: string[];
  gender: string[];
  maritalStatus: string[];
  educationLevel: string[];
  status: string[];
};

const DEFAULT_FILTERS: SurveyQuestionFilters = {
  state: [],
  gender: [],
  maritalStatus: [],
  educationLevel: [],
  status: [],
};

const SECTION_QUESTIONS: Record<string, QuestionCard[]> = {
  "respondent-profile": [
    {
      variable: "gender",
      question: "What is the respondent's gender?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Female", count: 1012, color: COLORS[0] },
        { label: "Male", count: 988, color: COLORS[1] },
      ],
    },
    {
      variable: "age_group",
      question: "Which age group does the respondent belong to?",
      base: SAMPLE_SIZE,
      options: [
        { label: "18 - 25 years", count: 438, color: COLORS[0] },
        { label: "26 - 35 years", count: 764, color: COLORS[1] },
        { label: "36 - 45 years", count: 512, color: COLORS[2] },
        { label: "46+ years", count: 286, color: COLORS[3] },
      ],
    },
    {
      variable: "education_level",
      question: "What is the highest level of education completed?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Secondary", count: 746, color: COLORS[0] },
        { label: "Tertiary", count: 612, color: COLORS[1] },
        { label: "Primary", count: 398, color: COLORS[2] },
        { label: "No formal education", count: 244, color: COLORS[3] },
      ],
    },
    {
      variable: "employment_status",
      question: "What is the respondent's current employment status?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Self-employed", count: 714, color: COLORS[0] },
        { label: "Paid employment", count: 458, color: COLORS[1] },
        { label: "Trading/business", count: 406, color: COLORS[2] },
        { label: "Unemployed/student", count: 422, color: COLORS[3] },
      ],
    },
  ],
  "remittance-sources": [
    {
      variable: "sender_country",
      question: "Which country was the most recent international remittance sent from?",
      base: SAMPLE_SIZE,
      options: [
        { label: "United Kingdom", count: 486, color: COLORS[0] },
        { label: "United States", count: 421, color: COLORS[1] },
        { label: "Canada", count: 308, color: COLORS[2] },
        { label: "UAE", count: 254, color: COLORS[3] },
        { label: "South Africa", count: 199, color: COLORS[4] },
        { label: "Other", count: 332, color: COLORS[5] },
      ],
    },
    {
      variable: "sender_relationship",
      question: "Who sent the most recent international remittance?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Sibling", count: 552, color: COLORS[0] },
        { label: "Child", count: 398, color: COLORS[1] },
        { label: "Spouse/partner", count: 334, color: COLORS[2] },
        { label: "Parent", count: 282, color: COLORS[3] },
        { label: "Friend/other relative", count: 434, color: COLORS[4] },
      ],
    },
    {
      variable: "received_from_canada",
      question: "Has the respondent received remittance from Canada in the last 12 months?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Yes", count: 578, color: COLORS[0] },
        { label: "No", count: 1422, color: COLORS[1] },
      ],
    },
  ],
  "transfer-channels": [
    {
      variable: "primary_channel",
      question: "What channel was used for the most recent remittance?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Bank transfer", count: 568, color: COLORS[0] },
        { label: "Money transfer operator", count: 512, color: COLORS[1] },
        { label: "Mobile wallet", count: 356, color: COLORS[2] },
        { label: "Cash pickup", count: 302, color: COLORS[3] },
        { label: "Informal agent", count: 178, color: COLORS[4] },
        { label: "Crypto/P2P", count: 84, color: COLORS[5] },
      ],
    },
    {
      variable: "channel_type",
      question: "Was the channel formal, digital, or informal?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Formal digital", count: 842, color: COLORS[0] },
        { label: "Formal cash-assisted", count: 604, color: COLORS[1] },
        { label: "Bank branch/account", count: 376, color: COLORS[2] },
        { label: "Informal", count: 178, color: COLORS[3] },
      ],
    },
    {
      variable: "digital_channel_user",
      question: "Did the respondent use a digital channel for receiving remittance?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Yes", count: 1186, color: COLORS[0] },
        { label: "No", count: 814, color: COLORS[1] },
      ],
    },
  ],
  "value-and-frequency": [
    {
      variable: "remittance_frequency",
      question: "How often does the respondent receive international remittance?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Monthly", count: 442, color: COLORS[0] },
        { label: "Every 2-3 months", count: 538, color: COLORS[1] },
        { label: "A few times a year", count: 646, color: COLORS[2] },
        { label: "Once a year/less", count: 374, color: COLORS[3] },
      ],
    },
    {
      variable: "amount_last_received_ngn",
      question: "How much was received in the most recent transfer?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Less than N150,000", count: 418, color: COLORS[0] },
        { label: "N150,000 - N300,000", count: 566, color: COLORS[1] },
        { label: "N300,001 - N500,000", count: 452, color: COLORS[2] },
        { label: "N500,001 - N1,000,000", count: 356, color: COLORS[3] },
        { label: "Above N1,000,000", count: 208, color: COLORS[4] },
      ],
    },
    {
      variable: "months_since_last_received",
      question: "When was the last international remittance received?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Within 1 month", count: 514, color: COLORS[0] },
        { label: "1 - 3 months", count: 692, color: COLORS[1] },
        { label: "4 - 6 months", count: 436, color: COLORS[2] },
        { label: "More than 6 months", count: 358, color: COLORS[3] },
      ],
    },
  ],
  "use-of-remittance": [
    {
      variable: "primary_use_of_remittance",
      question: "What was the remittance mainly used for?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Food and household upkeep", count: 612, color: COLORS[0] },
        { label: "Education", count: 348, color: COLORS[1] },
        { label: "Health expenses", count: 302, color: COLORS[2] },
        { label: "Business/investment", count: 286, color: COLORS[3] },
        { label: "Rent/building", count: 254, color: COLORS[4] },
        { label: "Savings/debt repayment", count: 198, color: COLORS[5] },
      ],
    },
    {
      variable: "who_decides_use",
      question: "Who mainly decides how the remittance is used?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Respondent", count: 812, color: COLORS[0] },
        { label: "Sender", count: 416, color: COLORS[1] },
        { label: "Joint decision", count: 632, color: COLORS[2] },
        { label: "Another household member", count: 140, color: COLORS[3] },
      ],
    },
    {
      variable: "recipient_control_over_funds",
      question: "How much control does the respondent have over the funds?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Full control", count: 934, color: COLORS[0] },
        { label: "Shared control", count: 706, color: COLORS[1] },
        { label: "Limited control", count: 282, color: COLORS[2] },
        { label: "No control", count: 78, color: COLORS[3] },
      ],
    },
  ],
  "trust-fees-and-experience": [
    {
      variable: "fees_perception",
      question: "How does the respondent perceive remittance fees?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Affordable", count: 536, color: COLORS[0] },
        { label: "Somewhat expensive", count: 774, color: COLORS[1] },
        { label: "Very expensive", count: 472, color: COLORS[2] },
        { label: "Do not know", count: 218, color: COLORS[3] },
      ],
    },
    {
      variable: "exchange_rate_satisfaction",
      question: "How satisfied is the respondent with the exchange rate received?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Very satisfied", count: 294, color: COLORS[0] },
        { label: "Satisfied", count: 704, color: COLORS[1] },
        { label: "Neutral", count: 462, color: COLORS[2] },
        { label: "Dissatisfied", count: 388, color: COLORS[3] },
        { label: "Very dissatisfied", count: 152, color: COLORS[4] },
      ],
    },
    {
      variable: "main_barrier_to_digital_use",
      question: "What is the main barrier to using digital remittance channels?",
      base: SAMPLE_SIZE,
      options: [
        { label: "Network/platform reliability", count: 426, color: COLORS[0] },
        { label: "High fees", count: 398, color: COLORS[1] },
        { label: "Low trust", count: 344, color: COLORS[2] },
        { label: "Low digital confidence", count: 318, color: COLORS[3] },
        { label: "Cash preference", count: 274, color: COLORS[4] },
        { label: "Agent/bank access", count: 240, color: COLORS[5] },
      ],
    },
  ],
};

function downloadCsv(title: string, rows: QuestionOption[], base: number) {
  const lines = [
    "answer,count,percent",
    ...rows.map((row) => `"${row.label.replace(/"/g, '""')}",${row.count},${((row.count / base) * 100).toFixed(1)}`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function QuestionToolbar({
  view,
  metric,
  decimals,
  onView,
  onMetric,
  onDecimals,
  onDownload,
}: {
  view: ViewMode;
  metric: MetricMode;
  decimals: number;
  onView: (view: ViewMode) => void;
  onMetric: () => void;
  onDecimals: () => void;
  onDownload: () => void;
}) {
  const cls = (active = false) => `grid h-8 w-8 place-items-center rounded-full border text-xs font-black transition ${active ? "border-blue-200 bg-blue-600 text-white" : "border-sky-100 bg-white/45 text-slate-600 hover:bg-white"}`;
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={cls(view === "chart")} onClick={() => onView("chart")} aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></button>
      <button type="button" className={cls(view === "table")} onClick={() => onView("table")} aria-label="Table view"><Table2 className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={view !== "table"} className={`${cls(view === "table")} disabled:cursor-not-allowed disabled:opacity-45`} onClick={onMetric} aria-label="Toggle percent or count">
        {metric === "percent" ? <Percent className="h-3.5 w-3.5" /> : "N"}
      </button>
      <button type="button" disabled={view !== "table"} className={`${cls(view === "table")} disabled:cursor-not-allowed disabled:opacity-45`} onClick={onDecimals} aria-label="Decimal places">
        {decimals === 0 ? "0" : decimals === 1 ? "1.0" : "2.00"}
      </button>
      <button type="button" className={cls(false)} onClick={onDownload} aria-label="Download"><Download className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function QuestionContainer({ card }: { card: QuestionCard }) {
  const [view, setView] = useState<ViewMode>("chart");
  const [metric, setMetric] = useState<MetricMode>("percent");
  const [decimals, setDecimals] = useState(0);
  const max = Math.max(...card.options.map((item) => item.count), 1);
  const formatCount = (value: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  const formatValue = (row: QuestionOption) => metric === "count" ? formatCount(row.count) : `${((row.count / card.base) * 100).toFixed(decimals)}%`;

  return (
    <section className="rounded-[1.5rem] border border-white/70 bg-white/45 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-600">{card.variable}</p>
          <h2 className="mt-1 text-base font-black leading-6 text-slate-950">{card.question}</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Base n: {card.base.toLocaleString()}</p>
        </div>
        <QuestionToolbar
          view={view}
          metric={metric}
          decimals={decimals}
          onView={setView}
          onMetric={() => setMetric((prev) => prev === "percent" ? "count" : "percent")}
          onDecimals={() => setDecimals((prev) => (prev + 1) % 3)}
          onDownload={() => downloadCsv(card.variable, card.options, card.base)}
        />
      </div>

      {view === "table" ? (
        <div className="overflow-hidden rounded-xl border border-slate-900/70">
          <table className="w-full border-collapse text-xs text-slate-900">
            <thead>
              <tr className="border-b border-slate-900/70">
                <th className="border-r border-slate-900/70 px-3 py-2 text-left">Response</th>
                <th className="px-3 py-2 text-center">{metric === "count" ? "N" : "%"}</th>
              </tr>
            </thead>
            <tbody>
              {card.options.map((row) => (
                <tr key={row.label} className="border-b border-slate-900/70 last:border-b-0">
                  <td className="border-r border-slate-900/70 px-3 py-2">{row.label}</td>
                  <td className="px-3 py-2 text-center font-semibold">{formatValue(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          {card.options.map((row) => {
            const pct = (row.count / card.base) * 100;
            return (
              <div key={row.label} className="rounded-xl border border-white/70 bg-white/50 px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-slate-900">{row.label}</span>
                  <span className="font-semibold text-slate-600">{row.count.toLocaleString()} ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full" style={{ width: `${(row.count / max) * 100}%`, backgroundColor: row.color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function applySyntheticFilters(cards: QuestionCard[], filters: SurveyQuestionFilters): QuestionCard[] {
  const selectedCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);
  if (!selectedCount) return cards;

  const factorFromList = (values: string[], allCount: number, base: number, spread: number) =>
    values.length === 0 ? 1 : Math.min(1, base + (values.length / Math.max(1, allCount)) * spread);
  const stateFactor = factorFromList(filters.state, FILTER_OPTIONS.states.length, 0.28, 0.52);
  const genderFactor = factorFromList(filters.gender, FILTER_OPTIONS.genders.length, 0.44, 0.48);
  const maritalFactor = factorFromList(filters.maritalStatus, FILTER_OPTIONS.maritalStatuses.length, 0.32, 0.48);
  const educationFactor = factorFromList(filters.educationLevel, FILTER_OPTIONS.educationLevels.length, 0.32, 0.46);
  const statusFactor = factorFromList(filters.status, FILTER_OPTIONS.statuses.length, 0.36, 0.5);
  const baseFactor = Math.max(0.08, stateFactor * genderFactor * maritalFactor * educationFactor * statusFactor);

  return cards.map((card, cardIndex) => {
    const base = Math.max(24, Math.round(card.base * baseFactor));
    const weighted = card.options.map((option, optionIndex) => {
      const variation = 0.88 + (((cardIndex + 2) * (optionIndex + 3) + selectedCount) % 7) * 0.035;
      return { option, weight: Math.max(1, option.count * variation) };
    });
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
    let remaining = base;
    const options = weighted.map((item, index) => {
      const count = index === weighted.length - 1 ? remaining : Math.max(1, Math.round((item.weight / totalWeight) * base));
      remaining -= count;
      return { ...item.option, count };
    });
    return { ...card, base, options };
  });
}

function MultiFilterSelect({ label, allLabel, value, options, onChange }: { label: string; allLabel: string; value: string[]; options: string[]; onChange: (value: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggle = (option: string) => {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  };
  const summary = value.length === 0 ? allLabel : value.length <= 2 ? value.join(", ") : `${value.length} selected`;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
        <button type="button" onClick={() => onChange([])} className="text-xs font-bold text-blue-700 hover:text-blue-900">
          {value.length ? "Clear" : allLabel}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 text-left text-sm font-semibold text-slate-950 outline-none transition hover:bg-white focus:ring-2 focus:ring-blue-500"
      >
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
          <div className="max-h-56 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => onChange([])}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50"
            >
              <span>{allLabel}</span>
              {value.length === 0 ? <Check className="h-4 w-4 text-blue-600" /> : null}
            </button>
            {options.map((option) => {
              const active = value.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggle(option)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                    active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{option}</span>
                  {active ? <Check className="h-4 w-4 text-blue-600" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <p className="text-xs font-semibold text-slate-500">
        {value.length ? `${value.length} selected` : allLabel}
      </p>
    </div>
  );
}

export function MainSurveySectionPage() {
  const { sectionSlug = "" } = useParams();
  const section = findMainSurveySectionBySlug(sectionSlug);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<SurveyQuestionFilters>(DEFAULT_FILTERS);
  const [activeFilters, setActiveFilters] = useState<SurveyQuestionFilters>(DEFAULT_FILTERS);
  const baseCards = useMemo(() => SECTION_QUESTIONS[sectionSlug] ?? [], [sectionSlug]);
  const cards = useMemo(() => applySyntheticFilters(baseCards, activeFilters), [baseCards, activeFilters]);
  const activeFilterCount = Object.values(activeFilters).reduce((sum, values) => sum + values.length, 0);

  if (!section) return <Navigate to="/main" replace />;

  return (
    <PlatformPage title={section.title} subtitle="" syncLabel={`${SAMPLE_SIZE.toLocaleString()} synthetic remittance cases`} module="main">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => { setDraftFilters(activeFilters); setFilterModalOpen(true); }} className="inline-flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.25)] hover:bg-sky-700">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>
          {activeFilterCount ? (
            <button type="button" onClick={() => { setActiveFilters(DEFAULT_FILTERS); setDraftFilters(DEFAULT_FILTERS); }} className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white">
              <X className="h-3.5 w-3.5" />
              Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>

        <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
          <DialogContent className="max-w-4xl rounded-3xl border-white/70 bg-white/95 p-0">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Filters</DialogTitle>
            </DialogHeader>
            <div className="p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <MultiFilterSelect label="State" allLabel="All States" value={draftFilters.state} options={FILTER_OPTIONS.states} onChange={(value) => setDraftFilters((prev) => ({ ...prev, state: value }))} />
                <MultiFilterSelect label="Gender" allLabel="All Genders" value={draftFilters.gender} options={FILTER_OPTIONS.genders} onChange={(value) => setDraftFilters((prev) => ({ ...prev, gender: value }))} />
                <MultiFilterSelect label="Marital Status" allLabel="All Marital Statuss" value={draftFilters.maritalStatus} options={FILTER_OPTIONS.maritalStatuses} onChange={(value) => setDraftFilters((prev) => ({ ...prev, maritalStatus: value }))} />
                <MultiFilterSelect label="Level of Education" allLabel="All Level of Educations" value={draftFilters.educationLevel} options={FILTER_OPTIONS.educationLevels} onChange={(value) => setDraftFilters((prev) => ({ ...prev, educationLevel: value }))} />
                <MultiFilterSelect label="Status" allLabel="All Statuss" value={draftFilters.status} options={FILTER_OPTIONS.statuses} onChange={(value) => setDraftFilters((prev) => ({ ...prev, status: value }))} />
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setDraftFilters(DEFAULT_FILTERS)} className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Reset</button>
                <button type="button" onClick={() => { setActiveFilters(draftFilters); setFilterModalOpen(false); }} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700">Apply</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {sectionSlug === "remittance-sources" ? (
          <div className="flex justify-center">
            <video
              src="/videoplayback.mp4"
              controls
              className="w-full max-w-4xl rounded-[1.5rem] border border-white/70 bg-black shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
            />
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {cards.map((card) => <QuestionContainer key={card.variable} card={card} />)}
        </div>
      </div>
    </PlatformPage>
  );
}
