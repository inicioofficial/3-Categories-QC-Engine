import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileOutput } from "lucide-react";
import * as XLSX from "xlsx";

import { PlatformPage, SELECT_CLASS, formatDate, formatToken } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ExportFileItem } from "@/lib/api";
import { cn } from "@/lib/utils";

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

type MessageState = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

const EXPORT_POLL_INTERVAL_MS = 5000;
const EXPORT_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

function createZipBlob(fileName: string, content: string) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(fileName);
  const dataBytes = encoder.encode(content);
  const checksum = crc32(dataBytes);
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const localHeader = new Uint8Array(30 + nameBytes.length);
  writeUint32(localHeader, 0, 0x04034b50);
  writeUint16(localHeader, 4, 20);
  writeUint16(localHeader, 6, 0);
  writeUint16(localHeader, 8, 0);
  writeUint16(localHeader, 10, dosTime);
  writeUint16(localHeader, 12, dosDate);
  writeUint32(localHeader, 14, checksum);
  writeUint32(localHeader, 18, dataBytes.length);
  writeUint32(localHeader, 22, dataBytes.length);
  writeUint16(localHeader, 26, nameBytes.length);
  localHeader.set(nameBytes, 30);

  const centralHeader = new Uint8Array(46 + nameBytes.length);
  writeUint32(centralHeader, 0, 0x02014b50);
  writeUint16(centralHeader, 4, 20);
  writeUint16(centralHeader, 6, 20);
  writeUint16(centralHeader, 8, 0);
  writeUint16(centralHeader, 10, 0);
  writeUint16(centralHeader, 12, dosTime);
  writeUint16(centralHeader, 14, dosDate);
  writeUint32(centralHeader, 16, checksum);
  writeUint32(centralHeader, 20, dataBytes.length);
  writeUint32(centralHeader, 24, dataBytes.length);
  writeUint16(centralHeader, 28, nameBytes.length);
  centralHeader.set(nameBytes, 46);

  const endRecord = new Uint8Array(22);
  writeUint32(endRecord, 0, 0x06054b50);
  writeUint16(endRecord, 8, 1);
  writeUint16(endRecord, 10, 1);
  writeUint32(endRecord, 12, centralHeader.length);
  writeUint32(endRecord, 16, localHeader.length + dataBytes.length);

  return new Blob([localHeader, dataBytes, centralHeader, endRecord], { type: "application/zip" });
}

const DATASET_OPTIONS = [
  { value: "listing_long", label: "Listing Data-Household level" },
  { value: "sampling_ea", label: "Listing Data-Ward level" },
];

const FORMAT_OPTIONS = [
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV (.csv)" },
  { value: "sav", label: "SPSS ZIP (.zip)" },
];

const STATUS_OPTIONS = [
  { value: "reviewed_approved", label: "Reviewed and Approved" },
  { value: "reviewed_rejected", label: "Reviewed and Rejected" },
  { value: "pending_review", label: "Pending Review" },
];

const OUTCOME_OPTIONS = [
  { value: "successful", label: "Successful" },
  { value: "terminated", label: "Terminated" },
];

export function ExportsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ExportFileItem[]>([]);
  const [dataset, setDataset] = useState("listing_long");
  const [format, setFormat] = useState("xlsx");
  const [statuses, setStatuses] = useState<string[]>(["reviewed_approved"]);
  const [outcomeCodes, setOutcomeCodes] = useState<string[]>(["successful"]);
  const [exportStep, setExportStep] = useState<1 | 2 | 3 | 4>(1);
  const [message, setMessage] = useState<MessageState>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [pendingExportName, setPendingExportName] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function fetchExportItems(): Promise<ExportFileItem[]> {
    return [];
  }

  async function loadExports() {
    setLoading(true);
    try {
      const nextItems = await fetchExportItems();
      setItems(nextItems);
      return nextItems;
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to load the export catalog.",
      });
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExports();
  }, [token]);

  async function generateExport() {
    if (statuses.length === 0) {
      setMessage({ tone: "error", text: "Select at least one approval status before generating an export." });
      return;
    }
    if (outcomeCodes.length === 0) {
      setMessage({ tone: "error", text: "Select at least one outcome code before generating an export." });
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const extension = format === "sav" ? "zip" : format;
      setPendingExportName(`listing-data-household-level.${extension}`);
      setExportProgress(0);
      setExportModalOpen(true);
      for (let value = 0; value <= 100; value += 10) {
        await delay(120);
        setExportProgress(value);
      }
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Export generation failed.",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function downloadGeneratedExport() {
    const response = await fetch("/efina_household_listing_synthetic_linked.csv");
    const csvText = await response.text();
    const extension = format === "sav" ? "zip" : format;
    const fileName = `listing-data-household-level.${extension}`;
    let blob: Blob;

    if (format === "xlsx") {
      const workbook = XLSX.read(csvText, { type: "string" });
      const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    } else if (format === "sav") {
      blob = createZipBlob("listing-data-household-level.csv", csvText);
    } else {
      blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);

    setExportModalOpen(false);
    setMessage({ tone: "success", text: `${fileName} downloaded successfully.` });
  }

  const summary = useMemo(() => {
    const latestGeneratedAt = items.reduce<string | null>((latest, item) => {
      if (!latest) return item.generated_at;
      return new Date(item.generated_at).getTime() > new Date(latest).getTime() ? item.generated_at : latest;
    }, null);
    return { files: items.length, latestGeneratedAt };
  }, [items]);

  const exportSteps = ["Dataset & format", "Statuses", "Outcome codes", "Review & export"] as const;
  const selectedDatasetLabel = DATASET_OPTIONS.find((option) => option.value === dataset)?.label ?? formatToken(dataset);
  const selectedFormatLabel = FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? format.toUpperCase();
  const exportInstruction =
    exportStep === 1
      ? "Choose a dataset and format to continue."
      : exportStep === 2
        ? "Select at least one status to include."
        : exportStep === 3
          ? "Select at least one outcome code to include."
          : "Review your configuration and generate.";

  const goNextExportStep = () => {
    if (exportStep === 2 && statuses.length === 0) {
      setMessage({ tone: "error", text: "Select at least one approval status to continue." });
      return;
    }
    if (exportStep === 3 && outcomeCodes.length === 0) {
      setMessage({ tone: "error", text: "Select at least one outcome code to continue." });
      return;
    }
    setMessage(null);
    if (exportStep < 4) {
      setExportStep((current) => (current + 1) as 1 | 2 | 3 | 4);
      return;
    }
    void generateExport();
  };

  const goBackExportStep = () => {
    if (exportStep > 1) setExportStep((current) => (current - 1) as 1 | 2 | 3 | 4);
  };

  return (
    <PlatformPage
      title="Survey Downloads"
      subtitle=""
      syncLabel={summary.latestGeneratedAt ? `Latest file ${formatDate(summary.latestGeneratedAt)}` : "Export service ready"}
      module="listing"
    >
      <div className="flex justify-center">
        <div className="w-full max-w-2xl">
          <Card className="overflow-hidden rounded-3xl border-blue-100/80 bg-white/90 shadow-[0_18px_45px_rgba(37,99,235,0.1)]">
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-blue-100/80 px-6 py-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Export Control Panel</p>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Build listing delivery</h3>
                  <p className="mt-1 text-sm text-slate-500">Configure and generate a data package for download.</p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-blue-700 shrink-0">
                  <FileOutput className="h-5 w-5" />
                </div>
              </div>

              {/* Steps */}
              <div className="grid grid-cols-4 border-b border-blue-100/80 px-6 py-4 gap-3">
                {exportSteps.map((step, index) => {
                  const stepNumber = (index + 1) as 1 | 2 | 3 | 4;
                  const active = exportStep === stepNumber;
                  const complete = exportStep > stepNumber;
                  return (
                    <div key={step} className="flex items-center gap-2">
                      <span className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
                        active ? "bg-blue-600 text-white" : complete ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-400",
                      )}>
                        {complete ? "✓" : stepNumber}
                      </span>
                      <span className={cn(
                        "text-xs font-semibold leading-tight",
                        active ? "text-slate-900" : complete ? "text-emerald-700" : "text-blue-400",
                      )}>
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Step content */}
              <div className="space-y-4 px-6 py-6">
                {exportStep === 1 ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Dataset</label>
                      <div className="mt-3">
                        <select className={SELECT_CLASS} value={dataset} onChange={(e) => setDataset(e.target.value)}>
                          {DATASET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Format</label>
                      <div className="mt-3">
                        <select className={SELECT_CLASS} value={format} onChange={(e) => setFormat(e.target.value)}>
                          {FORMAT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-blue-100/80 bg-white/70 p-5 md:col-span-2">
                      <p className="text-sm leading-7 text-slate-600">
                        Choose the dataset you want to export and the file format for delivery. You can filter by status and outcome code in the next steps.
                      </p>
                    </div>
                  </div>
                ) : null}

                {exportStep === 2 ? (
                  <div className="rounded-2xl border border-blue-100/80 bg-white/70 p-5">
                    <p className="mb-4 text-sm leading-6 text-slate-600">
                      Select the approval statuses to include in the export. At least one must be selected.
                    </p>
                    <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Include statuses</label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map((option) => {
                        const active = statuses.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setStatuses((current) =>
                                active ? current.filter((s) => s !== option.value) : [...current, option.value],
                              )
                            }
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                              active
                                ? "border-blue-500/25 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white/70 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm font-semibold text-slate-600">
                      {statuses.length} status{statuses.length !== 1 ? "es" : ""} selected.
                    </p>
                  </div>
                ) : null}

                {exportStep === 3 ? (
                  <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Outcome codes</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      Select the interview outcome codes to include in the package. At least one must be selected.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {OUTCOME_OPTIONS.map((outcome) => {
                        const active = outcomeCodes.includes(outcome.value);
                        return (
                          <button
                            key={outcome.value}
                            type="button"
                            onClick={() =>
                              setOutcomeCodes((current) =>
                                active ? current.filter((value) => value !== outcome.value) : [...current, outcome.value],
                              )
                            }
                            className={cn(
                              "rounded-full border px-4 py-2 text-sm font-semibold transition-all",
                              active
                                ? "border-blue-500/25 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white/70 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
                            )}
                          >
                            {outcome.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm font-semibold text-slate-600">
                      {outcomeCodes.length} outcome code{outcomeCodes.length !== 1 ? "s" : ""} selected.
                    </p>
                  </div>
                ) : null}

                {exportStep === 4 ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Dataset & format</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-700">{selectedDatasetLabel}</span>
                          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-700">{selectedFormatLabel}</span>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Statuses</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {statuses.map((value) => (
                            <span key={value} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-700">
                              {STATUS_OPTIONS.find((o) => o.value === value)?.label ?? formatToken(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5 md:col-span-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Outcome codes</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {outcomeCodes.map((value) => (
                            <span key={value} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-700">
                              {OUTCOME_OPTIONS.find((o) => o.value === value)?.label ?? formatToken(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-emerald-800">Ready package</p>
                          <p className="mt-0.5 text-sm font-medium text-emerald-700">
                            {selectedDatasetLabel} - {format.toUpperCase()} - {statuses.length} status filter{statuses.length === 1 ? "" : "s"} - {outcomeCodes.length} outcome filter{outcomeCodes.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {/* Navigation buttons */}
                <div className="flex flex-col gap-3 border-t border-blue-100/80 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">{exportInstruction}</p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setExportStep(1)}
                      className="h-11 rounded-xl px-5 text-sm font-semibold"
                    >
                      Cancel
                    </Button>
                    {exportStep > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={goBackExportStep}
                        className="h-11 rounded-xl px-5 text-sm font-semibold"
                      >
                        Back
                      </Button>
                    ) : null}
                    <Button
                      onClick={goNextExportStep}
                      disabled={generating || (exportStep === 2 && statuses.length === 0) || (exportStep >= 3 && outcomeCodes.length === 0)}
                      className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold hover:bg-blue-700"
                    >
                      {exportStep === 4 ? <Download className="mr-2 h-4 w-4" /> : null}
                      {exportStep === 4 ? (generating ? "Generating…" : "Generate Export") : "Next"}
                    </Button>
                  </div>
                </div>

                {message ? (
                  <p className={cn(
                    "rounded-2xl border px-4 py-3 text-xs font-medium",
                    message.tone === "success"
                      ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-700"
                      : message.tone === "info"
                        ? "border-sky-500/20 bg-sky-500/8 text-sky-700"
                        : "border-rose-500/20 bg-rose-500/8 text-rose-700",
                  )}>
                    {message.text}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Export modal */}
      {exportModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <FileOutput className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-slate-950">Building export</h3>
            <p className="mt-1 text-sm text-slate-600">{pendingExportName}</p>
            <div className="mt-5 h-3 rounded-full bg-slate-100">
              <div className="h-3 rounded-full bg-blue-600 transition-all" style={{ width: `${exportProgress}%` }} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600">{exportProgress}%</p>
            {exportProgress >= 100 ? (
              <Button onClick={() => void downloadGeneratedExport()} className="mt-5 rounded-xl bg-blue-600 hover:bg-blue-700">
                Download Data
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
