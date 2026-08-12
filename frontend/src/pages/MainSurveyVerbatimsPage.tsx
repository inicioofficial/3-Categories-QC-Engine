import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, MessageCircle, Search } from "lucide-react";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/ui/MultiSelectDropdown";
import { apiFetch } from "@/lib/api";

type VerbatimQuestion = {
  variableName: string;
  questionLabel: string;
  section: string;
  category: string;
  categoryLabel: string;
};

type VerbatimItem = {
  id: string;
  submissionKey: string;
  caseLabel: string;
  region: string;
  interviewerId: string;
  startTime: string | null;
  category: string;
  categoryLabel: string;
  section: string;
  variableName: string;
  questionLabel: string;
  response: string;
  theme: string;
};

type VerbatimTheme = {
  theme: string;
  count: number;
  percent: number;
  samples: string[];
  breakdown?: Array<{
    categoryLabel: string;
    variableName: string;
    questionLabel: string;
    count: number;
  }>;
};

type WordCloudTerm = {
  text: string;
  count: number;
};

type VerbatimsPayload = {
  items: VerbatimItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  categories: MultiSelectOption[];
  questions: VerbatimQuestion[];
  themeSummary: VerbatimTheme[];
  wordCloud: WordCloudTerm[];
};

type VerbatimsSummaryPayload = {
  total: number;
  categories: MultiSelectOption[];
  questions: VerbatimQuestion[];
  themeSummary: VerbatimTheme[];
  wordCloud: WordCloudTerm[];
};

const PAGE_SIZE = 50;
const WORD_COLORS = [
  "text-blue-700",
  "text-sky-600",
  "text-cyan-700",
  "text-teal-700",
  "text-emerald-700",
  "text-lime-700",
  "text-amber-700",
  "text-orange-700",
  "text-rose-700",
  "text-fuchsia-700",
  "text-violet-700",
  "text-indigo-700",
  "text-slate-900",
];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function wordCloudStyle(term: WordCloudTerm, index: number, maxWordCount: number) {
  const seed = hashString(`${term.text}-${index}`);
  const size = 15 + Math.round((term.count / maxWordCount) * 34);
  return {
    fontSize: `${size}px`,
    order: seed % 997,
    transform: `translateY(${((seed >>> 8) % 15) - 7}px) rotate(${((seed >>> 16) % 19) - 9}deg)`,
    marginLeft: `${(seed >>> 4) % 18}px`,
    marginRight: `${(seed >>> 11) % 18}px`,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function exportRows(rows: VerbatimItem[]) {
  const header = [
    "case_label",
    "submission_key",
    "region",
    "interviewer",
    "start_time",
    "category",
    "section",
    "variable_name",
    "question",
    "theme",
    "response",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.caseLabel,
        row.submissionKey,
        row.region,
        row.interviewerId,
        row.startTime ?? "",
        row.categoryLabel,
        row.section,
        row.variableName,
        row.questionLabel,
        row.theme,
        row.response,
      ]
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bht-verbatims-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function MainSurveyVerbatimsPage() {
  const { token } = useAuth();
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [questionFilters, setQuestionFilters] = useState<string[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPayload, setRowsPayload] = useState<VerbatimsPayload | null>(null);
  const [summaryPayload, setSummaryPayload] = useState<VerbatimsSummaryPayload | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (categoryFilters.length) params.set("categories", categoryFilters.join(","));
    if (questionFilters.length) params.set("questions", questionFilters.join(","));
    if (search) params.set("search", search);

    setSummaryLoading(true);
    setError(null);
    apiFetch<VerbatimsSummaryPayload>(`/api/main-survey/verbatims/summary?${params.toString()}`, {}, token, 45_000)
      .then((data) => {
        if (!cancelled) setSummaryPayload(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load verbatim summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryFilters, questionFilters, search, token]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    if (categoryFilters.length) params.set("categories", categoryFilters.join(","));
    if (questionFilters.length) params.set("questions", questionFilters.join(","));
    if (search) params.set("search", search);

    setRowsLoading(true);
    setError(null);
    apiFetch<VerbatimsPayload>(`/api/main-survey/verbatims?${params.toString()}`, {}, token, 45_000)
      .then((data) => {
        if (!cancelled) setRowsPayload(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load verbatim responses.");
      })
      .finally(() => {
        if (!cancelled) setRowsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryFilters, page, questionFilters, search, token]);

  const categoryOptions = summaryPayload?.categories ?? rowsPayload?.categories ?? [];
  const questionOptions = useMemo(() => {
    const selectedCategories = new Set(categoryFilters);
    return (summaryPayload?.questions ?? rowsPayload?.questions ?? [])
      .filter((question) => selectedCategories.size === 0 || selectedCategories.has(question.category))
      .map((question) => ({
        value: question.variableName,
        label: `${question.categoryLabel}: ${question.variableName}`,
      }));
  }, [categoryFilters, rowsPayload?.questions, summaryPayload?.questions]);

  const totalCount = summaryPayload?.total ?? rowsPayload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleRows = rowsPayload?.items ?? [];
  const wordCloud = summaryPayload?.wordCloud ?? [];
  const maxWordCount = Math.max(...wordCloud.map((term) => term.count), 1);

  function applySearch() {
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function resetFilters() {
    setCategoryFilters([]);
    setQuestionFilters([]);
    setSearchDraft("");
    setSearch("");
    setPage(1);
  }

  return (
    <PlatformPage
      title="Verbatims"
      subtitle="Category open-ended responses from the BHT tracker"
      syncLabel={`${totalCount.toLocaleString()} open-ended responses`}
      module="main"
    >
      <div className="space-y-5">
        <section className="rounded-[1.5rem] border border-white/70 bg-white/55 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1.4fr_auto_auto]">
            <MultiSelectDropdown
              label="categories"
              options={categoryOptions}
              selected={categoryFilters}
              onChange={(values) => {
                setCategoryFilters(values);
                setQuestionFilters([]);
                setPage(1);
              }}
            />
            <MultiSelectDropdown
              label="questions"
              options={questionOptions}
              selected={questionFilters}
              onChange={(values) => {
                setQuestionFilters(values);
                setPage(1);
              }}
            />
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applySearch();
                }}
                placeholder="Search responses, KEY, interviewer, question"
                className="h-11 w-full rounded-[1rem] border border-slate-200/80 bg-white/90 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <button type="button" onClick={applySearch} className="h-11 rounded-[1rem] bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700">
              Apply
            </button>
            <button type="button" onClick={resetFilters} className="h-11 rounded-[1rem] bg-white px-5 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Reset
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.5rem] border border-white/70 bg-white/55 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Theme summary</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">Rule-based response themes</h2>
              </div>
              {summaryLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
            </div>
            <div className="mt-5 space-y-3">
              {(summaryPayload?.themeSummary ?? []).slice(0, 8).map((theme) => (
                <div key={theme.theme} className="rounded-xl border border-white/70 bg-white/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-900">
                    <span>{theme.theme}</span>
                    <span>{theme.count.toLocaleString()} ({theme.percent}%)</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(theme.percent, 100)}%` }} />
                  </div>
                  {theme.samples[0] && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">"{theme.samples[0]}"</p>}
                  {theme.theme === "Other" && Boolean(theme.breakdown?.length) && (
                    <div className="mt-3 rounded-lg bg-slate-50/80 p-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Top sources inside Other</p>
                      <div className="mt-2 space-y-1.5">
                        {theme.breakdown?.slice(0, 5).map((item) => (
                          <div key={`${item.variableName}-${item.categoryLabel}`} className="flex items-start justify-between gap-2 text-xs text-slate-600">
                            <span className="min-w-0">
                              <span className="font-black text-slate-800">{item.variableName}</span>
                              <span className="text-slate-400"> | </span>
                              <span className="line-clamp-1">{item.questionLabel}</span>
                            </span>
                            <span className="shrink-0 font-black text-slate-900">{item.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!summaryLoading && !summaryPayload?.themeSummary?.length && <p className="py-8 text-center text-sm font-semibold text-slate-500">No verbatim themes found for the current filters.</p>}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/70 bg-white/55 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Word cloud</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">Most repeated words</h2>
              </div>
              <button
                type="button"
                onClick={() => exportRows(visibleRows)}
                disabled={!visibleRows.length}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Export page
              </button>
            </div>
            <div className="mt-4 flex min-h-[360px] flex-wrap items-center justify-center gap-x-3 gap-y-5 overflow-hidden rounded-[1.25rem] border border-white/70 bg-white/60 px-8 py-10">
              {wordCloud.slice(0, 45).map((term, index) => (
                <button
                  key={term.text}
                  type="button"
                  onClick={() => {
                    setSearchDraft(term.text);
                    setSearch(term.text);
                    setPage(1);
                  }}
                  className={`relative inline-flex max-w-full whitespace-nowrap font-black leading-none transition hover:z-10 hover:scale-110 hover:text-slate-950 ${WORD_COLORS[index % WORD_COLORS.length]}`}
                  style={wordCloudStyle(term, index, maxWordCount)}
                  title={`${term.text}: ${term.count.toLocaleString()} mentions`}
                >
                  {term.text}
                </button>
              ))}
              {!summaryLoading && !wordCloud.length && <p className="grid min-h-[300px] place-items-center text-sm font-semibold text-slate-500">No word cloud terms available.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-white/70 bg-white/55 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Responses</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Open-ended verbatims</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={rowsLoading || page <= 1}
                className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Back
              </button>
              <span className="text-sm font-black text-slate-600">Page {page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={rowsLoading || !rowsPayload?.hasMore}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          {rowsLoading && !rowsPayload ? (
            <div className="grid min-h-[260px] place-items-center text-sm font-semibold text-slate-500">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading verbatims...</span>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleRows.map((row) => (
                <article key={row.id} className="rounded-[1.25rem] border border-white/70 bg-white/70 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-black text-white">{row.caseLabel}</span>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700">{row.categoryLabel}</span>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-black text-slate-600">{row.theme}</span>
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{row.variableName}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white">
                      <MessageCircle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black leading-6 text-slate-950">{row.questionLabel}</p>
                      <p className="mt-2 text-sm font-semibold leading-7 text-slate-700">"{row.response}"</p>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {row.region} | {row.interviewerId || "No interviewer"} | Start: {formatDateTime(row.startTime)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!rowsLoading && !visibleRows.length && (
            <p className="py-10 text-center text-sm font-semibold text-slate-500">No open-ended responses match the current filters.</p>
          )}
        </section>
      </div>
    </PlatformPage>
  );
}
