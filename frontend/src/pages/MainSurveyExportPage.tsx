import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileOutput } from "lucide-react";
import * as XLSX from "xlsx";

import { EmptyState, PlatformPage, SELECT_CLASS, formatDate, formatToken } from "@/app/platform-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ExportFileItem } from "@/lib/api";
import { cn } from "@/lib/utils";

const FORMAT_OPTIONS = [
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV (.csv)" },
  { value: "sav", label: "SPSS ZIP (.zip)" },
];

type MessageState = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
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

function isExportReady(item: ExportFileItem) {
  return item.download_ready !== false && item.job_status !== "running" && item.job_status !== "failed" && item.job_status !== "cancelled";
}

const STATUS_OPTIONS = [
  { value: "reviewed_approved", label: "Reviewed and Approved" },
  { value: "reviewed_rejected", label: "Reviewed and Rejected" },
  { value: "pending_review", label: "Pending Review" },
];

export function MainSurveyExportPage() {
  const [items, setItems] = useState<ExportFileItem[]>([]);
  const [format, setFormat] = useState("xlsx");
  const [statuses, setStatuses] = useState<string[]>(["reviewed_approved"]);
  const [finalOutcomeCodes, setFinalOutcomeCodes] = useState<string[]>(["Successful"]);
  const finalOutcomeOptions = ["Successful", "Terminated"];
  const [message, setMessage] = useState<MessageState>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [pendingExportName, setPendingExportName] = useState("");

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
  }, []);

  async function generateExport() {
    if (statuses.length === 0) {
      setMessage({ tone: "error", text: "Select at least one approval status before generating an export." });
      return;
    }
    if (finalOutcomeCodes.length === 0) {
      setMessage({ tone: "error", text: "Select at least one outcome code before generating an export." });
      return;
    }
    setGenerating(true);
    setMessage(null);
    setExportProgress(0);
    setPendingExportName(`Main survey wide ${format.toUpperCase()} package`);
    setExportModalOpen(true);
    for (const value of [12, 28, 44, 61, 76, 88, 100]) {
      await delay(170);
      setExportProgress(value);
    }
    setGenerating(false);
  }

  async function downloadGeneratedExport() {
    const response = await fetch("/efina_remittance_synthetic_data_with_link_id.csv");
    const csvText = await response.text();
    const extension = format === "sav" ? "zip" : format;
    const fileName = `main-survey-data.${extension}`;
    let blob: Blob;

    if (format === "xlsx") {
      const workbook = XLSX.read(csvText, { type: "string" });
      const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    } else if (format === "sav") {
      blob = createZipBlob("main-survey-data.csv", csvText);
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
    const readyItems = items.filter(isExportReady);
    const latestGeneratedAt = readyItems.reduce<string | null>((latest, item) => {
      if (!latest) return item.generated_at;
      return new Date(item.generated_at).getTime() > new Date(latest).getTime() ? item.generated_at : latest;
    }, null);
    return { files: readyItems.length, latestGeneratedAt };
  }, [items]);

  return (
    <PlatformPage
      title="Survey Downloads"
      subtitle=""
      syncLabel={summary.latestGeneratedAt ? `Latest file ${formatDate(summary.latestGeneratedAt)}` : "Export service ready"}
      module="main"
    >
      <div className="flex justify-center">
        <div className="w-full max-w-2xl">
          <Card className="overflow-hidden rounded-3xl border-blue-100/80 bg-white/90 shadow-[0_18px_45px_rgba(37,99,235,0.1)]">
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-blue-100/80 px-6 py-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Export Control Panel</p>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Build main survey delivery</h3>
                  <p className="mt-1 text-sm text-slate-500">Configure and generate a data package for download.</p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-blue-700 shrink-0">
                  <FileOutput className="h-5 w-5" />
                </div>
              </div>

              {/* Steps indicator */}
              <div className="grid grid-cols-4 border-b border-blue-100/80 px-6 py-4 gap-3">
                {["Dataset & format", "Statuses", "Outcome codes", "Review & export"].map((step, index) => (
                  <div key={step} className="flex items-center gap-2">
                    <span className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
                      index === 3
                        ? "bg-blue-600 text-white"
                        : "bg-emerald-50 text-emerald-700",
                    )}>
                      {index === 3 ? "4" : "✓"}
                    </span>
                    <span className={cn(
                      "text-xs font-semibold leading-tight",
                      index === 3 ? "text-slate-900" : "text-emerald-700",
                    )}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>

              {/* Form body */}
              <div className="space-y-4 px-6 py-6">
                {/* Dataset & format */}
                <div className="rounded-2xl border border-blue-100/80 bg-blue-50/35 p-5">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Dataset & format</label>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700">Wide</span>
                    <select className={SELECT_CLASS} value={format} onChange={(e) => setFormat(e.target.value)}>
                      {FORMAT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Statuses */}
                <div className="rounded-2xl border border-blue-100/80 bg-white/70 p-5">
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
                </div>

                {/* Outcome codes */}
                {finalOutcomeOptions.length > 0 ? (
                  <div className="rounded-2xl border border-blue-100/80 bg-white/70 p-5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Final outcome code</label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {finalOutcomeOptions.map((value) => {
                        const active = finalOutcomeCodes.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setFinalOutcomeCodes((current) =>
                                active ? current.filter((s) => s !== value) : [...current, value],
                              )
                            }
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                              active
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                                : "border-white/70 bg-white/40 text-slate-600 hover:border-emerald-500/20 hover:bg-emerald-500/8 hover:text-slate-900",
                            )}
                          >
                            {formatToken(value)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Ready summary */}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-800">Ready package</p>
                      <p className="mt-0.5 text-sm font-medium text-emerald-700">
                        Wide {format.toUpperCase()} · {statuses.length} status filter{statuses.length === 1 ? "" : "s"}
                        {finalOutcomeCodes.length ? ` · ${finalOutcomeCodes.length} outcome filter${finalOutcomeCodes.length === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3 border-t border-blue-100/80 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">Review your configuration and generate.</p>
                  <Button
                    onClick={() => void generateExport()}
                    disabled={generating || statuses.length === 0 || finalOutcomeCodes.length === 0}
                    className="h-11 rounded-xl bg-blue-600 px-6 text-sm font-semibold hover:bg-blue-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {generating ? "Generating…" : "Generate Export"}
                  </Button>
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
