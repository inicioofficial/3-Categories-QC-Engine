import { CheckCircle2, Filter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, Cell } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MainSurveyFilterOptionsPayload } from "@/lib/api";

export type MainSurveyMetricItem = {
  label: string;
  value: string;
  percent: number;
  tone: string;
};

export type MainSurveyDonutItem = {
  name: string;
  value: number;
  color: string;
};

const STATUS_OPTIONS = ["approved", "pending_review", "in_review", "corrected", "rejected", "submitted"] as const;
const DYNAMIC_FILTER_KEYS = ["state", "gender", "maritalStatus", "educationLevel", "status"] as const;
type DynamicFilterKey = (typeof DYNAMIC_FILTER_KEYS)[number];

function buildDynamicFields(opts: MainSurveyFilterOptionsPayload | undefined) {
  return [
    { key: "state" as DynamicFilterKey, label: "State", options: opts?.states ?? [] },
    { key: "gender" as DynamicFilterKey, label: "Gender", options: opts?.genders ?? [] },
    { key: "maritalStatus" as DynamicFilterKey, label: "Marital Status", options: opts?.maritalStatuses ?? [] },
    { key: "educationLevel" as DynamicFilterKey, label: "Level of Education", options: opts?.educationLevels ?? [] },
    { key: "status" as DynamicFilterKey, label: "Status", options: [...STATUS_OPTIONS] },
  ];
}

export function MainSurveyAnalyticsShell({
  eyebrow,
  title,
  children,
  filterOptions,
  onFilterChange,
}: {
  eyebrow?: string;
  title?: string;
  children: ReactNode;
  filterOptions?: MainSurveyFilterOptionsPayload;
  onFilterChange?: (state: string[], gender: string[], maritalStatus: string[], educationLevel: string[], status: string[]) => void;
}) {
  const [dynamicFilters, setDynamicFilters] = useState<Record<DynamicFilterKey, string[]>>({
    state: [],
    gender: [],
    maritalStatus: [],
    educationLevel: [],
    status: [],
  });

  const dynamicFields = buildDynamicFields(filterOptions);

  function handleDynamicFilterChange(key: DynamicFilterKey, values: string[]) {
    const next = { ...dynamicFilters, [key]: values };
    setDynamicFilters(next);
    onFilterChange?.(next.state, next.gender, next.maritalStatus, next.educationLevel, next.status);
  }

  function clearDynamicFilters() {
    const empty: Record<DynamicFilterKey, string[]> = { state: [], gender: [], maritalStatus: [], educationLevel: [], status: [] };
    setDynamicFilters(empty);
    onFilterChange?.([], [], [], [], []);
  }

  const activeDynamicCount = Object.values(dynamicFilters).filter((v) => v.length > 0).length;

  return (
    <div className="main-survey-stage pt-0">
      {/* Sticky header + filters bar */}
      <div className="sticky top-0 z-20 -mx-1 mb-6 rounded-b-2xl bg-white/80 px-4 pb-4 pt-3 shadow-[0_4px_24px_rgba(148,163,184,0.12)] backdrop-blur-md">
        {(eyebrow || title) && (
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 shrink-0 items-center rounded-xl border border-blue-100 bg-blue-50 px-4 text-sm font-black tracking-[-0.02em] text-blue-700 shadow-sm md:h-14">
              3 Categories QC Platform
            </div>
            <div>
              {eyebrow && (
                <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500">{eyebrow}</p>
              )}
              {title && (
                <h2 className="text-[1.6rem] font-semibold tracking-tight text-slate-950 md:text-[1.9rem]">{title}</h2>
              )}
            </div>
          </div>
        )}

        {onFilterChange && (
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <Filter className="h-3.5 w-3.5 text-sky-700" />
                Filters
              </div>
              {activeDynamicCount > 0 && (
                <button
                  type="button"
                  onClick={clearDynamicFilters}
                  className="text-[11px] font-medium text-rose-600 transition-colors hover:text-rose-700"
                >
                  Clear selection(s)
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {dynamicFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {field.label}
                  </span>
                  <MultiSelectDropdown
                    label={`All ${field.label}s`}
                    options={field.options.map((o) => ({ value: o, label: o }))}
                    selected={dynamicFilters[field.key]}
                    onChange={(values) => handleDynamicFilterChange(field.key, values)}
                    disabled={field.options.length === 0}
                  />
                </div>
              ))}
            </div>

            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              {activeDynamicCount > 0
                ? `${activeDynamicCount} active filter${activeDynamicCount === 1 ? "" : "s"} applied`
                : "No filters active — showing all respondents"}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4 px-1">
        {children}
      </div>
    </div>
  );
}

export function MainSurveyPanel({
  title,
  icon,
  children,
  actionLabel,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  actionLabel?: string;
}) {
  return (
    <Card className="glass-panel rounded-[1.8rem] border-white/70">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            {icon}
            {title}
          </div>
          {actionLabel ? (
            <span className="rounded-full border border-white/70 bg-white/42 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {actionLabel}
            </span>
          ) : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function MainSurveyMetricList({
  items,
}: {
  items: MainSurveyMetricItem[];
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-[1.15rem] border border-white/70 bg-white/42 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm text-slate-700">
            <span>{item.label}</span>
            <span className="font-medium">{item.value}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-200/85">
            <div
              className="h-2.5 rounded-full"
              style={{
                width: `${item.percent}%`,
                background: item.tone,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MainSurveyDonutPanel({
  data,
  centerLabel,
}: {
  data: MainSurveyDonutItem[];
  centerLabel: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
      <div className="h-52 rounded-[1.2rem] border border-white/70 bg-white/34 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={3}>
              {data.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Pie>
            <RechartsTooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        <div className="rounded-[1.15rem] border border-white/70 bg-white/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Center read</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{centerLabel}</p>
          <p className="mt-1 text-sm text-slate-500">Total tracked items: {total}</p>
        </div>
        {data.map((item) => {
          const percent = total ? Math.round((item.value / total) * 100) : 0;
          return (
            <div key={item.name} className="flex items-center justify-between gap-3 rounded-[1.15rem] border border-white/70 bg-white/40 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-slate-700">{item.name}</span>
              </div>
              <span className="font-medium text-slate-900">{percent}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MainSurveyMatrixTabs({
  primaryLabel,
  secondaryLabel,
  primaryContent,
  secondaryContent,
}: {
  primaryLabel: string;
  secondaryLabel: string;
  primaryContent: React.ReactNode;
  secondaryContent: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="primary" className="space-y-4">
      <div className="flex justify-center">
        <TabsList>
          <TabsTrigger value="primary">{primaryLabel}</TabsTrigger>
          <TabsTrigger value="secondary">{secondaryLabel}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="primary">{primaryContent}</TabsContent>
      <TabsContent value="secondary">{secondaryContent}</TabsContent>
    </Tabs>
  );
}
