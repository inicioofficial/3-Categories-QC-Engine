import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Download, Loader2 } from "lucide-react";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { MainSurveyCustomTableBuilderModal } from "@/components/main-survey/MainSurveyCustomTableBuilderModal";
import { MAIN_SURVEY_PAGE_SECTIONS } from "@/data/mainSurveyDictionary";
import {
  apiFetch,
  type CustomTableResponse,
  type CustomTableSelectionPayload,
} from "@/lib/api";

// ─── Excel export helpers ─────────────────────────────────────────────────────

function sanitizeExcelText(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  // Remove invalid XML characters (for Excel compatibility)
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 32767);
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet";
}

function toExcelCellValue(value: unknown): string | number {
  if (typeof value === "number") return value;
  return sanitizeExcelText(value);
}

function exportCustomTablesToExcel(result: CustomTableResponse) {
  const mode = result.displayMode || "row_pct";
  const format = parseFormatOpts(result.formatOptions as Record<string, unknown> | undefined);

  const wb = XLSX.utils.book_new();
  const allRows: Array<Array<string | number>> = [];
  const mergesAll: XLSX.Range[] = [];

  const headerFill = { fgColor: { rgb: "E6EEF7" } };
  const subHeaderFill = { fgColor: { rgb: "F4F7FB" } };
  const borderStyle = {
    top: { style: "thin", color: { rgb: "4B5563" } },
    bottom: { style: "thin", color: { rgb: "4B5563" } },
    left: { style: "thin", color: { rgb: "4B5563" } },
    right: { style: "thin", color: { rgb: "4B5563" } },
  };

  type TableRange = {
    startRow: number;
    endRow: number;
    totalCols: number;
    titleRow: number;
    headerRow1: number;
    headerRow2: number;
    baseRow: number;
    noteRows: number[];
  };
  const tableRanges: TableRange[] = [];

  result.tables.forEach((table, tableIndex) => {
    const topBlocks = Array.isArray(table.topBlocks) ? table.topBlocks : [];
    const uniqueNotes = Array.from(new Set(topBlocks.flatMap((b) => b.notes ?? [])));
    const blockSpanTotal = topBlocks.reduce((sum, b) => sum + Math.max(1, b.columnLabels.length), 0);
    // lead col (side question label) + Total col + block cols
    const totalCols = 1 + 1 + blockSpanTotal;
    const titleRowIndex = allRows.length;

    // ── Title row ────────────────────────────────────────────────────────────
    const titleRow: Array<string | number> = [table.sideQuestion.label || `Table ${tableIndex + 1}`];
    for (let i = 1; i < totalCols; i++) titleRow.push("");
    allRows.push(titleRow);
    mergesAll.push({ s: { r: titleRowIndex, c: 0 }, e: { r: titleRowIndex, c: totalCols - 1 } });

    // ── Header row 1: break names ─────────────────────────────────────────────
    const headerRow1: Array<string | number> = [""];
    let colIndex = 1;
    headerRow1.push("Total");
    mergesAll.push({ s: { r: titleRowIndex + 1, c: colIndex }, e: { r: titleRowIndex + 2, c: colIndex } });
    colIndex += 1;

    if (topBlocks.length === 0) {
      headerRow1.push("Top Break");
    } else {
      topBlocks.forEach((block) => {
        const span = Math.max(1, block.columnLabels.length);
        headerRow1.push(block.topQuestion.label || "Top Break");
        for (let i = 1; i < span; i++) headerRow1.push("");
        if (span > 1) {
          mergesAll.push({
            s: { r: titleRowIndex + 1, c: colIndex },
            e: { r: titleRowIndex + 1, c: colIndex + span - 1 },
          });
        }
        colIndex += span;
      });
    }

    // ── Header row 2: column labels ───────────────────────────────────────────
    const headerRow2: Array<string | number> = [""];
    headerRow2.push(""); // Total col already merged above
    if (topBlocks.length === 0) {
      headerRow2.push("No data");
    } else {
      topBlocks.forEach((block) => {
        if (block.columnLabels.length === 0) {
          headerRow2.push("No data");
        } else {
          block.columnLabels.forEach((cl, ci) => {
            const letter = String(block.columnLetterLabels?.[ci] ?? "").trim();
            headerRow2.push(letter ? `${cl} (${letter})` : cl);
          });
        }
      });
    }

    allRows.push(headerRow1);
    allRows.push(headerRow2);

    // ── Base N row ────────────────────────────────────────────────────────────
    const baseRow: Array<string | number> = ["N"];
    baseRow.push(table.totalRespondents); // Total col base
    topBlocks.forEach((block) => {
      if (block.columnLabels.length === 0) { baseRow.push("-"); return; }
      block.columnBases.forEach((b) => baseRow.push(Math.round(Number(b) || 0)));
    });
    allRows.push(baseRow);

    // ── Data rows ─────────────────────────────────────────────────────────────
    table.rowLabels.forEach((rowLabel, ri) => {
      const row: Array<string | number> = [rowLabel];
      // Total column — use numeric value so numFmt applies
      if (mode === "counts") {
        row.push(cellNumeric(mode, table.rowCounts?.[ri] ?? table.rowBases[ri] ?? 0, table.rowBases[ri] ?? 0, table.totalRespondents, table.totalRespondents));
      } else {
        row.push(cellNumeric("total_pct", table.rowCounts?.[ri] ?? table.rowBases[ri] ?? 0, table.rowBases[ri] ?? 0, table.totalRespondents, table.totalRespondents));
      }
      if (topBlocks.length === 0) {
        row.push("-");
      } else {
        topBlocks.forEach((block) => {
          if (block.columnLabels.length === 0) { row.push("-"); return; }
          block.columnLabels.forEach((_, ci) => {
            const count = block.counts[ri]?.[ci] ?? 0;
            row.push(cellNumeric(mode, count, table.rowBases[ri] ?? 0, block.columnBases[ci] ?? 0, table.totalRespondents));
          });
        });
      }
      allRows.push(row);
    });

    // ── Note rows ─────────────────────────────────────────────────────────────
    const noteRows: number[] = [];
    uniqueNotes.forEach((note) => {
      const noteRowIndex = allRows.length;
      const noteRow: Array<string | number> = [`Note: ${note}`];
      for (let i = 1; i < totalCols; i++) noteRow.push("");
      allRows.push(noteRow);
      mergesAll.push({ s: { r: noteRowIndex, c: 0 }, e: { r: noteRowIndex, c: totalCols - 1 } });
      noteRows.push(noteRowIndex);
    });

    tableRanges.push({
      startRow: titleRowIndex,
      endRow: allRows.length - 1,
      totalCols,
      titleRow: titleRowIndex,
      headerRow1: titleRowIndex + 1,
      headerRow2: titleRowIndex + 2,
      baseRow: titleRowIndex + 3,
      noteRows,
    });

    // blank separator between tables
    if (tableIndex < result.tables.length - 1) {
      allRows.push([]);
      allRows.push([]);
    }
  });

  // ── Build worksheet ────────────────────────────────────────────────────────
  const sanitizedRows = allRows.map((row) => row.map((v) => toExcelCellValue(v)));
  const worksheet = XLSX.utils.aoa_to_sheet(sanitizedRows);
  const maxCols = Math.max(...tableRanges.map((r) => r.totalCols), 1);
  worksheet["!merges"] = mergesAll;
  worksheet["!cols"] = Array.from({ length: maxCols }, (_, i) => (i === 0 ? { wch: 36 } : { wch: 14 }));

  // ── Apply styles ───────────────────────────────────────────────────────────
  const applyStyle = (r: number, c: number, style: Record<string, unknown>) => {
    const cellRef = XLSX.utils.encode_cell({ r, c });
    const cell = worksheet[cellRef] as { s?: Record<string, unknown> } | undefined;
    if (!cell) return;
    cell.s = { ...(cell.s ?? {}), ...style };
  };

  const percentDecimals = format.useDecimalPlaces ? format.decimalPlaces : 0;
  const percentNumFmt = `${percentDecimals === 0 ? "0" : `0.${"0".repeat(percentDecimals)}`}${format.showPercentSign ? "\\%" : ""}`;
  const dataNumFmt = mode === "counts" ? "0" : percentNumFmt;

  tableRanges.forEach((range) => {
    // Base border + alignment for every cell in the table
    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = 0; c < range.totalCols; c++) {
        applyStyle(r, c, {
          border: borderStyle,
          alignment: { vertical: "center", wrapText: true, horizontal: c === 0 ? "left" : "center" },
        });
      }
    }

    // Title row
    for (let c = 0; c < range.totalCols; c++) {
      applyStyle(range.titleRow, c, {
        font: { bold: true, sz: 14, color: { rgb: "1E293B" } },
        alignment: { horizontal: "left", vertical: "center" },
      });
    }

    // Header row 1 (break names)
    for (let c = 0; c < range.totalCols; c++) {
      applyStyle(range.headerRow1, c, {
        font: { bold: true, color: { rgb: "1E293B" } },
        fill: headerFill,
        alignment: { horizontal: c === 0 ? "left" : "center", vertical: "center" },
      });
    }

    // Header row 2 (column labels)
    for (let c = 0; c < range.totalCols; c++) {
      applyStyle(range.headerRow2, c, {
        font: { bold: true, color: { rgb: "1E293B" } },
        fill: subHeaderFill,
        alignment: { horizontal: c === 0 ? "left" : "center", vertical: "center" },
      });
    }

    // Base N row
    for (let c = 0; c < range.totalCols; c++) {
      applyStyle(range.baseRow, c, {
        font: { bold: true, color: { rgb: "1E293B" } },
        alignment: { horizontal: c === 0 ? "left" : "center", vertical: "center" },
      });
    }
    for (let c = 1; c < range.totalCols; c++) {
      applyStyle(range.baseRow, c, { numFmt: "0" });
    }

    // Data rows + note rows
    const noteRowSet = new Set(range.noteRows);
    for (let r = range.baseRow + 1; r <= range.endRow; r++) {
      if (noteRowSet.has(r)) {
        applyStyle(r, 0, {
          font: { italic: true, color: { rgb: "7C2D12" } },
          alignment: { horizontal: "left", vertical: "center", wrapText: true },
        });
        continue;
      }
      // Lead column: bold
      applyStyle(r, 0, { font: { bold: true, color: { rgb: "1E293B" } } });
      // Data columns: number format
      for (let c = 1; c < range.totalCols; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellRef] as { v?: unknown } | undefined;
        if (!cell || typeof cell.v !== "number") continue;
        applyStyle(r, c, { numFmt: dataNumFmt });
      }
    }
  });

  const sheetName = sanitizeSheetName("Data Tables");
  XLSX.utils.book_append_sheet(wb, worksheet, sheetName);
  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `main_survey_custom_tables_${timestamp}.xlsx`);
}

type CellFormatOpts = {
  showPercentSign: boolean;
  useDecimalPlaces: boolean;
  decimalPlaces: number;
};

function parseFormatOpts(raw: Record<string, unknown> | undefined): CellFormatOpts {
  const showPercentSign = raw?.showPercentSign !== false;
  const useDecimalPlaces = raw?.useDecimalPlaces === true;
  const decimalPlaces = typeof raw?.decimalPlaces === "number" ? raw.decimalPlaces : 1;
  return { showPercentSign, useDecimalPlaces, decimalPlaces };
}

function cellDisplay(
  mode: string,
  count: number,
  rowBase: number,
  colBase: number,
  total: number,
  format?: CellFormatOpts,
): string {
  const showPct = format?.showPercentSign !== false;
  const useDec = format?.useDecimalPlaces === true;
  const places = format?.decimalPlaces ?? 1;

  function formatPct(pct: number): string {
    const s = useDec ? pct.toFixed(places) : pct.toFixed(1);
    return showPct ? `${s}%` : s;
  }

  if (mode === "counts") return String(Math.round(count));
  let v: number | null = null;
  if (mode === "row_pct" && rowBase > 0) v = (count / rowBase) * 100;
  else if (mode === "column_pct" && colBase > 0) v = (count / colBase) * 100;
  else if (mode === "total_pct" && total > 0) v = (count / total) * 100;
  if (v === null) return count ? String(Math.round(count)) : "—";
  return formatPct(v);
}

/** Returns a raw number (for Excel numFmt) or "—" string when undefined. */
function cellNumeric(
  mode: string,
  count: number,
  rowBase: number,
  colBase: number,
  total: number,
): number | string {
  if (mode === "counts") return Math.round(count);
  if (mode === "row_pct" && rowBase > 0) return (count / rowBase) * 100;
  if (mode === "column_pct" && colBase > 0) return (count / colBase) * 100;
  if (mode === "total_pct" && total > 0) return (count / total) * 100;
  return count ? Math.round(count) : "—";
}

const SECTION_DEFS = MAIN_SURVEY_PAGE_SECTIONS.map((s) => ({ id: s.slug, title: s.title }));

function labelsFor(question: CustomTableSelectionPayload["topQuestions"][number], fallbackCount: number) {
  const labels = Object.values(question.codeLabels ?? {}).filter(Boolean);
  if (labels.length > 0) return labels.slice(0, 8);
  return Array.from({ length: fallbackCount }, (_, index) => `${question.label} ${index + 1}`);
}

function buildSyntheticCustomTableResult(body: CustomTableSelectionPayload): CustomTableResponse {
  const totalRespondents = 2000;
  const topQuestions = body.topQuestions.length ? body.topQuestions : [];
  const sideQuestions = body.sideQuestions.length ? body.sideQuestions : [];
  const filterPressure = Object.values(body.filters ?? {}).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
  const includeSignificance = body.analysisOptions.includes("significance");
  const includeChiSquare = body.analysisOptions.includes("chi_square");

  return {
    category: "main",
    displayMode: body.displayMode,
    analysisOptions: body.analysisOptions,
    formatOptions: body.formatOptions,
    totalRespondents,
    generatedAt: new Date().toLocaleString(),
    tables: sideQuestions.map((sideQuestion, tableIndex) => {
      const rowLabels = labelsFor(sideQuestion, 5);
      const rowWeights = rowLabels.map((_, index) => 0.7 + (((tableIndex + 3) * (index + 5)) % 9) / 10);
      const rowWeightTotal = rowWeights.reduce((sum, value) => sum + value, 0) || 1;
      const rowCounts = rowWeights.map((weight) => Math.max(18, Math.round((weight / rowWeightTotal) * totalRespondents)));
      const rowBaseTotal = rowCounts.reduce((sum, value) => sum + value, 0) || totalRespondents;
      const rowBases = rowCounts.map((value) => Math.max(12, Math.round(value * (totalRespondents / rowBaseTotal))));

      return {
        id: `synthetic-table-${tableIndex + 1}`,
        sideQuestion,
        rowLabels,
        rowBases,
        rowCounts: rowBases,
        totalRespondents,
        topBlocks: topQuestions.map((topQuestion, blockIndex) => {
          const columnLabels = labelsFor(topQuestion, 4);
          const columnWeights = columnLabels.map((_, colIndex) => 0.8 + (((blockIndex + 2) * (colIndex + 4) + filterPressure) % 7) / 10);
          const columnWeightTotal = columnWeights.reduce((sum, value) => sum + value, 0) || 1;
          const columnBases = columnWeights.map((weight) => Math.max(10, Math.round((weight / columnWeightTotal) * totalRespondents)));
          const counts = rowLabels.map((_, rowIndex) => {
            const rowTotal = rowBases[rowIndex] || 1;
            const raw = columnLabels.map((__, colIndex) => 0.5 + (((rowIndex + 2) * (colIndex + 3) * (blockIndex + 1)) % 11) / 10);
            const rawTotal = raw.reduce((sum, value) => sum + value, 0) || 1;
            return raw.map((value, colIndex) => {
              const cap = Math.max(1, Math.min(rowTotal, columnBases[colIndex] || rowTotal));
              return Math.max(0, Math.round((value / rawTotal) * cap));
            });
          });
          return {
            id: `synthetic-block-${tableIndex + 1}-${blockIndex + 1}`,
            topQuestion,
            columnLabels,
            columnLetterLabels: columnLabels.map((_, index) => String.fromCharCode(65 + index)),
            columnBases,
            counts,
            significanceLetters: includeSignificance
              ? counts.map((row) => row.map((value, colIndex) => value > ((columnBases[colIndex] || 1) * 0.35) ? "A" : ""))
              : counts.map((row) => row.map(() => "")),
            pairRespondents: totalRespondents,
            chiSquare: includeChiSquare
              ? { statistic: 8.4 + blockIndex + tableIndex, degreesOfFreedom: Math.max(1, (rowLabels.length - 1) * (columnLabels.length - 1)) }
              : null,
            notes: includeSignificance ? ["Synthetic significance markers are illustrative for demo tables."] : [],
          };
        }),
      };
    }),
  };
}

export function MainSurveyCustomTablesPage() {
  const { token, user } = useAuth();
  const canExportTables = Boolean(user);
  const [builderOpen, setBuilderOpen] = useState(true);
  const [result, setResult] = useState<CustomTableResponse | null>(null);
  const [builderSelection, setBuilderSelection] = useState<CustomTableSelectionPayload | null>(null);

  // Auto-open the builder modal every time the page is mounted
  useEffect(() => {
    setBuilderOpen(true);
  }, []);

  const customTableMutation = useMutation({
    mutationFn: (body: CustomTableSelectionPayload) =>
      apiFetch<CustomTableResponse>(
        "/api/main-survey/custom-table",
        { method: "POST", body: JSON.stringify(body) },
        token,
        120_000,
      ),
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const emptyFilters = useMemo(() => ({ states: [], genders: [], ageGroups: [], secClasses: [], months: [] }), []);

  const openBuilder = () => setBuilderOpen(true);
  const isGenerating = customTableMutation.isPending;

  return (
    <PlatformPage
      title="Main Survey — Custom tables"
      subtitle="Cross-tabulate workbook variables"
      syncLabel={result ? `Generated ${result.generatedAt}` : "Configure breaks in the builder to generate a table"}
      module="main"
      hideTopBar={false}
      plainTopBar
    >
      <div className="space-y-6">
        <MainSurveyCustomTableBuilderModal
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          token={token}
          initialSelection={builderSelection}
          generating={customTableMutation.isPending}
          filters={emptyFilters}
          months={[]}
          sections={SECTION_DEFS}
          onGenerate={(body) => {
            setBuilderSelection(body);
            setBuilderOpen(false);
            customTableMutation.reset();
            customTableMutation.mutate(body);
          }}
        />

        {!result && !builderOpen && !isGenerating && (
          <div className="rounded-2xl border border-white/70 bg-white/36 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <p className="text-sm font-semibold text-slate-700">No table generated yet</p>
            <p className="mt-1 text-xs text-slate-500">
              The builder opens automatically when you visit this page.
            </p>
            <button
              type="button"
              className="mt-4 rounded-[1rem] bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => setBuilderOpen(true)}
            >
              Open builder
            </button>
          </div>
        )}

        {isGenerating ? (
          <div className="rounded-2xl border border-white/70 bg-white/36 p-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
              <div>
                <p className="text-base font-semibold text-slate-800">Generating custom tables…</p>
                <p className="mt-1 text-sm text-slate-500">Please wait while your table is being prepared and displayed.</p>
              </div>
            </div>
          </div>
        ) : null}

        {customTableMutation.isError ? (
          <p className="text-sm text-red-600">
            {customTableMutation.error instanceof Error ? customTableMutation.error.message : "Unable to build table."}
          </p>
        ) : null}

        {result ? <CustomTableResults result={result} onModify={openBuilder} canExportTables={canExportTables} /> : null}
      </div>
    </PlatformPage>
  );
}


const STICKY_LEAD_HEADER = "sticky left-0 z-30 border-r border-black/70 bg-[#d9e2eb] shadow-[10px_0_14px_rgba(217,226,235,0.98)]";
const STICKY_LEAD_CELL = "sticky left-0 z-10 border-r border-black/70 bg-[#cfdae3] shadow-[10px_0_14px_rgba(207,218,227,0.98)]";

function displayModeLabel(mode: string) {
  if (mode === "row_pct") return "ROW %";
  if (mode === "total_pct") return "TOTAL %";
  if (mode === "column_pct") return "COLUMN %";
  return "COUNTS";
}

function totalCellValue(
  mode: string,
  count: number,
  total: number,
  format?: CellFormatOpts,
): string {
  if (mode === "counts") {
    return cellDisplay(mode, count, count, total, total, format);
  }
  return cellDisplay("total_pct", count, count, total, total, format);
}

function CustomTableResults({ result, onModify, canExportTables }: { result: CustomTableResponse; onModify: () => void; canExportTables: boolean }) {
  const mode = result.displayMode || "row_pct";
  const format = parseFormatOpts(result.formatOptions as Record<string, unknown> | undefined);
  const topBlocks = result.tables.flatMap((t) => t.topBlocks);
  const significanceEnabled = (result.analysisOptions ?? []).includes("significance");
  const chiSquareEnabled = (result.analysisOptions ?? []).includes("chi_square");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Base: <strong>{result.totalRespondents}</strong> respondents
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onModify}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/70 bg-white/44 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white/60"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Modify Builder
          </button>
          {canExportTables ? (
            <button
              type="button"
              onClick={() => exportCustomTablesToExcel(result)}
              className="inline-flex items-center gap-2 rounded-[1rem] bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </button>
          ) : null}
        </div>
      </div>

      {result.tables.map((table) => {
        const blocks = Array.isArray(table.topBlocks) ? table.topBlocks : [];
        const topBreakSummary = blocks.map((b) => b.topQuestion.label).filter(Boolean).join(" + ");
        const uniqueNotes = Array.from(new Set(blocks.flatMap((b) => b.notes ?? [])));
        const chiBlocks = chiSquareEnabled ? blocks.filter((b) => b.chiSquare) : [];
        const hasSig = significanceEnabled && blocks.some((b) =>
          (b.significanceLetters ?? []).some((row) => row.some((v) => String(v ?? "").trim().length > 0)),
        );

        return (
          <article
            key={table.id}
            className="relative overflow-hidden rounded-[2rem] border border-blue-100/80 bg-white/82 shadow-[0_24px_70px_rgba(37,99,235,0.12)] backdrop-blur-xl"
          >
            {/* Header */}
            <div className="border-b border-blue-100/80 bg-gradient-to-r from-blue-50/90 via-white/75 to-emerald-50/75 px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[1.45rem] font-black leading-tight text-slate-950">
                    {table.sideQuestion.label}
                  </h3>
                  <p className="mt-2 text-base text-slate-600">
                    Top break:{" "}
                    <span className="font-medium text-slate-700">{topBreakSummary || "None selected"}</span>
                  </p>
                  {chiBlocks.map((b) => (
                    <p key={`${table.id}-${b.id}-chi`} className="mt-1 text-sm text-slate-600">
                      Chi-square ({b.topQuestion.label}): {Number(b.chiSquare?.statistic ?? 0).toFixed(3)} (df=
                      {b.chiSquare?.degreesOfFreedom})
                    </p>
                  ))}
                </div>
                <div className="rounded-full border border-blue-200 bg-white/80 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-blue-700">
                  {displayModeLabel(mode)}
                </div>
              </div>

              {hasSig ? (
                <p className="mt-3 text-xs font-semibold text-emerald-700">
                  Green letters show the columns this cell is significantly higher than at 95% confidence.
                </p>
              ) : null}

              {uniqueNotes.length > 0 ? (
                <div className="mt-3 rounded-2xl border border-amber-300/55 bg-amber-100/70 p-3 text-xs text-amber-900">
                  {uniqueNotes.map((n, i) => (
                    <p key={`${table.id}-note-${i}`}>{n}</p>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Table */}
            {blocks.length === 0 ? (
              <div className="px-6 py-5 text-sm text-slate-700">No top break data available.</div>
            ) : (
              <div className="px-6 py-5">
                <div className="overflow-x-auto rounded-[1.4rem] border border-blue-100 bg-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      {/* Row 1: Variable | Total | top-block group headers */}
                      <tr className="bg-blue-600 text-white">
                        <th
                          rowSpan={2}
                          className={`${STICKY_LEAD_HEADER} bg-blue-600 px-4 py-3 text-left font-black text-white`}
                        >
                          Variable
                        </th>
                        <th
                          rowSpan={2}
                          className="border-l border-blue-500/60 px-3 py-3 text-center text-xs font-black uppercase tracking-wide text-white"
                        >
                          Total
                        </th>
                        {blocks.map((block) => (
                          <th
                            key={`${table.id}-${block.id}-group`}
                            colSpan={Math.max(1, block.columnLabels.length)}
                            className="border-l border-blue-500/60 px-3 py-3 text-center text-xs font-black uppercase tracking-wide text-white"
                          >
                            {block.topQuestion.label}
                          </th>
                        ))}
                      </tr>
                      {/* Row 2: individual column labels */}
                      <tr className="bg-blue-50/95">
                        {blocks.flatMap((block) =>
                          block.columnLabels.length > 0
                            ? block.columnLabels.map((cl, ci) => (
                                <th
                                  key={`${table.id}-${block.id}-col-${ci}`}
                                  className="border-b border-l border-blue-100 px-3 py-3 text-center text-xs font-black text-blue-800"
                                >
                                  <div className="flex min-w-[80px] max-w-[120px] flex-col items-center gap-1 whitespace-normal break-words leading-snug">
                                    <span>{cl}</span>
                                    {block.columnLetterLabels[ci] ? (
                                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                                        {block.columnLetterLabels[ci]}
                                      </span>
                                    ) : null}
                                  </div>
                                </th>
                              ))
                            : [
                                <th
                                  key={`${table.id}-${block.id}-col-empty`}
                                  className="border-b border-l border-blue-100 px-3 py-3 text-center text-xs font-semibold text-slate-500"
                                >
                                  No data
                                </th>,
                              ],
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {/* N (base) row */}
                      <tr className="bg-slate-50/95">
                        <td className={`${STICKY_LEAD_CELL} bg-slate-50/95 px-4 py-3 font-black text-slate-950`}>N</td>
                        <td className="border-l border-blue-100 px-3 py-3 text-center font-black text-slate-950">
                          {Number(table.totalRespondents || 0).toLocaleString()}
                        </td>
                        {blocks.flatMap((block) =>
                          block.columnLabels.length > 0
                            ? block.columnBases.map((base, ci) => (
                                <td
                                  key={`${table.id}-${block.id}-base-${ci}`}
                                  className="border-l border-blue-100 px-3 py-3 text-center font-black text-slate-950"
                                >
                                  {Number(base || 0).toLocaleString()}
                                </td>
                              ))
                            : [
                                <td
                                  key={`${table.id}-${block.id}-base-empty`}
                                  className="border-l border-blue-100 px-3 py-3 text-center font-bold text-slate-500"
                                >
                                  -
                                </td>,
                              ],
                        )}
                      </tr>

                      {/* Data rows */}
                      {table.rowLabels.map((rl, ri) => (
                        <tr key={`${table.id}-row-${ri}`} className="odd:bg-white even:bg-blue-50/35">
                          <td className={`${STICKY_LEAD_CELL} px-4 py-3 font-semibold text-slate-900`}>{rl}</td>
                          <td className="border-l border-blue-100 px-3 py-3 text-center font-semibold text-slate-800">
                            {totalCellValue(mode, table.rowCounts?.[ri] ?? table.rowBases[ri] ?? 0, table.totalRespondents, format)}
                          </td>
                          {blocks.flatMap((block) =>
                            block.columnLabels.length > 0
                              ? block.columnLabels.map((_, ci) => {
                                  const count = block.counts[ri]?.[ci] ?? 0;
                                  const shown = cellDisplay(
                                    mode,
                                    count,
                                    table.rowBases[ri] ?? 0,
                                    block.columnBases[ci] ?? 0,
                                    table.totalRespondents,
                                    format,
                                  );
                                      const sig = significanceEnabled ? String(block.significanceLetters[ri]?.[ci] ?? "").trim() : "";
                                  return (
                                    <td
                                      key={`${table.id}-${block.id}-cell-${ri}-${ci}`}
                                      className="border-l border-blue-100 px-3 py-3 text-center text-slate-800"
                                    >
                                      <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                                        <span>{shown}</span>
                                        {sig ? (
                                          <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                                            {sig}
                                          </span>
                                        ) : null}
                                      </div>
                                    </td>
                                  );
                                })
                              : [
                                  <td
                                    key={`${table.id}-${block.id}-cell-empty-${ri}`}
                                    className="border-l border-blue-100 px-3 py-3 text-center text-slate-500"
                                  >
                                    -
                                  </td>,
                                ],
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
