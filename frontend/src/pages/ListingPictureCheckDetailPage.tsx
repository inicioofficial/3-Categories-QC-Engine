import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  KeyRound,
  MapPin,
  RefreshCw,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { withSurveyCtoSession } from "@/lib/surveyctoSession";
import { cn } from "@/lib/utils";

interface PhotoRow {
  listing_row_id: string;
  building_no: number | null;
  photo_ref: string | null;
  photo_url: string | null;
  gps_lat: number | null;
  gps_long: number | null;
  case_id?: string | null;
  submission_key?: string | null;
  case_label?: string | null;
  start_time?: string | null;
  submitted_at?: string | null;
  accompanied_value?: string | null;
}

interface CheckRecord {
  check_id: string;
  submission_key: string;
  ea_id: string | null;
  ea_name: string | null;
  state_name: string | null;
  building_only_pct: number | null;
  building_only_count: number | null;
  total_rows: number | null;
  status: string;
  assigned_to_user_id: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  accompanied_value?: string | null;
  submitted_at?: string | null;
}

interface EaInfo {
  ea_id: string | null;
  ea_name: string | null;
  state_name: string | null;
  building_only_pct: number | null;
  accompanied_value?: string | null;
  submitted_at?: string | null;
}

interface PictureCheckDetail {
  check: CheckRecord | null;
  photos: PhotoRow[];
  ea_info: EaInfo | null;
}


const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/12 text-amber-700",
  checked: "border-sky-500/30 bg-sky-500/12 text-sky-700",
  approved: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700",
  rejected: "border-rose-500/30 bg-rose-500/12 text-rose-700",
};

function accompanimentActorLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("supervisor") || normalized === "2" || normalized === "2.0") return "Supervisor";
  if (normalized.includes("qc") || normalized === "1" || normalized === "1.0") return "QC";
  return null;
}

type ListingPictureCheckDetailPageProps = {
  module?: "listing" | "main";
};

function formatPhotoTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ListingPictureCheckDetailPage({ module = "listing" }: ListingPictureCheckDetailPageProps) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { submissionKey } = useParams<{ submissionKey: string }>();
  const location = useLocation();
  const queueKeys: string[] = (location.state as { queueKeys?: string[] } | null)?.queueKeys ?? [];

  const [detail, setDetail] = useState<PictureCheckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoRow | null>(null);
  const [savingChecked, setSavingChecked] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [surveyctoServer, setSurveyctServer] = useState<string>("edvoimpacts");
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [credsBannerDismissed, setCredsBannerDismissed] = useState(false);
  const decodedKey = submissionKey ? decodeURIComponent(submissionKey) : "";
  const isMainModule = module === "main";

  async function loadDetail() {
    if (!decodedKey) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setLightboxPhoto(null);
    setCheckMessage(null);
    setImgErrors({});
    try {
      const data = await apiFetch<PictureCheckDetail>(
        isMainModule
          ? `/api/main-survey/accompaniment/${encodeURIComponent(decodedKey)}/detail`
          : `/api/listing/picture-check/${encodeURIComponent(decodedKey)}/detail`,
        {},
        token,
      );
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load picture check.");
    } finally {
      setLoading(false);
    }
  }

  // Fetch SurveyCTO server name for the credential sign-in link
  useEffect(() => {
    apiFetch<{ surveycto_server: string }>("/api/listing/surveycto-config-meta", {}, token)
      .then((cfg) => { if (cfg?.surveycto_server) setSurveyctServer(cfg.surveycto_server); })
      .catch(() => {/* use default */});
    void loadDetail();
  }, [submissionKey, token]);

  const currentIdx = decodedKey ? queueKeys.indexOf(decodedKey) : -1;
  const prevKey = currentIdx > 0 ? queueKeys[currentIdx - 1] : null;
  const nextKey = currentIdx >= 0 && currentIdx < queueKeys.length - 1 ? queueKeys[currentIdx + 1] : null;

  function navigateTo(key: string) {
    navigate(`${isMainModule ? "/main/accompaniment" : "/listing/picture-check"}/${encodeURIComponent(key)}/detail`, {
      state: { queueKeys },
    });
  }

  async function handleMarkChecked() {
    if (!isMainModule || !check?.check_id || !token || savingChecked) return;
    setSavingChecked(true);
    setCheckMessage(null);
    try {
      await apiFetch(
        `/api/main-survey/accompaniment/${encodeURIComponent(check.check_id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "checked", reviewerNote: null }),
        },
        token,
      );
      setDetail((current) =>
        current?.check
          ? { ...current, check: { ...current.check, status: "checked" } }
          : current,
      );
      setCheckMessage("Marked checked.");
    } catch (err) {
      setCheckMessage(err instanceof Error ? err.message : "Failed to mark checked.");
    } finally {
      setSavingChecked(false);
    }
  }

  const check = detail?.check;
  const photos = detail?.photos ?? [];
  const hasPhotoUrls = photos.some((p) => !!p.photo_url);
  const anyImgError = Object.values(imgErrors).some(Boolean);
  const showCredBanner = hasPhotoUrls && anyImgError && !credsBannerDismissed;
  const surveyctoSignInUrl = `https://${surveyctoServer}.surveycto.com`;

  // Always prefer live source data (ea_info), fall back to check record fields
  const displayState = detail?.ea_info?.state_name ?? check?.state_name ?? "—";
  const displayEaName = detail?.ea_info?.ea_name ?? check?.ea_name ?? "—";
  const displayPct = detail?.ea_info?.building_only_pct ?? check?.building_only_pct ?? null;
  const accompaniedValue = detail?.ea_info?.accompanied_value ?? check?.accompanied_value ?? null;
  const fallbackPhotoActorLabel = isMainModule ? accompanimentActorLabel(accompaniedValue) : null;

  return (
    <PlatformPage
      title={isMainModule ? "Accompaniment Images" : "Picture Check"}
      subtitle={isMainModule ? "QC/Supervisor accompaniment and photo evidence" : displayEaName !== "—" ? displayEaName : decodedKey}
      syncLabel={check ? (isMainModule ? `${photos.length} photo evidence file(s)` : `${displayPct ?? "?"}% non-residential · ${photos.length} photo(s)`) : "Loading…"}
      module={module}
      plainTopBar
      topBarActions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(isMainModule ? "/main/accompaniment" : "/listing/picture-check")}
            className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {isMainModule ? "Accompaniment Images" : "Picture Check Page"}
          </button>
          {queueKeys.length > 0 && (
            <>
              <button
                type="button"
                disabled={!prevKey}
                onClick={() => prevKey && navigateTo(prevKey)}
                className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="text-xs text-slate-400">
                {currentIdx >= 0 ? `${currentIdx + 1} / ${queueKeys.length}` : "—"}
              </span>
              <button
                type="button"
                disabled={!nextKey}
                onClick={() => nextKey && navigateTo(nextKey)}
                className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {loading && (
          <div className="py-10 text-center text-sm text-slate-500">Loading pictures…</div>
        )}
        {error && (
          <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!loading && !error && detail && (
          <>
            {/* Ward Metadata */}
            <Card className="glass-panel rounded-2xl border-white/70">
              <CardContent className="p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{isMainModule ? "Region" : "State"}</p>
                    <p className="mt-1 font-semibold text-slate-900">{displayState}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{isMainModule ? "Case" : "Ward Name"}</p>
                    <p className="mt-1 font-semibold text-slate-900">{displayEaName}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{isMainModule ? "Accompanied?" : "Non-Residential"}</p>
                    <p className="mt-1 font-semibold text-rose-700">
                      {isMainModule ? accompaniedValue ?? "-" : displayPct != null ? `${displayPct}%` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Status</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {check?.status ? (
                        <Badge className={cn("text-xs", STATUS_BADGE[check.status] ?? "")}>
                          {check.status}
                        </Badge>
                      ) : (
                        <span className="text-sm text-slate-400">unassigned</span>
                      )}
                      {isMainModule && check?.check_id && check.status !== "checked" ? (
                        <button
                          type="button"
                          disabled={savingChecked}
                          onClick={() => void handleMarkChecked()}
                          className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-45"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {savingChecked ? "Saving" : "Checked"}
                        </button>
                      ) : null}
                    </div>
                    {checkMessage ? <p className="mt-1 text-xs text-slate-500">{checkMessage}</p> : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* SurveyCTO Credential Banner */}
            {showCredBanner && (
              <div className="flex items-start gap-3 rounded-[1.4rem] border border-amber-300/60 bg-amber-50/80 px-5 py-4">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800">SurveyCTO credentials required</p>
                  <p className="mt-1 text-xs text-amber-700">
                    Photos are served directly from SurveyCTO and require your SurveyCTO login.
                    Click <strong>Sign in to SurveyCTO</strong> below to open a new tab — log in there,
                    then come back and click <strong>Retry photos</strong>.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={surveyctoSignInUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[1rem] bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Sign in to SurveyCTO
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setImgErrors({});
                        setCredsBannerDismissed(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[1rem] border border-amber-400/50 bg-white/60 px-4 py-2 text-xs font-semibold text-amber-800 hover:bg-white/90"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry photos
                    </button>
                    <button
                      type="button"
                      onClick={() => setCredsBannerDismissed(true)}
                      className="text-xs text-amber-600 underline underline-offset-2 hover:text-amber-800"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Photo Grid */}
            {photos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/70 bg-white/32 p-8 text-center">
                <Camera className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="font-medium text-slate-600">{isMainModule ? "No QC/Supervisor photo evidence found for this case." : "No building photos found for this Ward."}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {isMainModule ? "The Take_pictures field may be empty for this case." : "Building photos may not have been captured or the field is empty."}
                </p>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {isMainModule ? "Accompaniment Images" : "Building Photos"} ({photos.length})
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {photos.map((photo) => {
                    const photoActorLabel = isMainModule
                      ? accompanimentActorLabel(photo.accompanied_value) ?? fallbackPhotoActorLabel
                      : null;

                    return (
                      <div
                        key={photo.listing_row_id}
                        className="overflow-hidden rounded-[1.4rem] border border-white/70 bg-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
                      >
                        <div className="flex items-center justify-between border-b border-white/60 px-3 py-2">
                          <span className="text-xs font-semibold text-slate-700">
                            {isMainModule
                              ? `Photo evidence ${photo.building_no ?? "—"}${photoActorLabel ? ` - ${photoActorLabel}` : ""}`
                              : `Building ${photo.building_no ?? "—"}`}
                          </span>
                          {photo.gps_lat != null && photo.gps_long != null && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                              <MapPin className="h-3 w-3" />
                              {photo.gps_lat.toFixed(4)}, {photo.gps_long.toFixed(4)}
                            </span>
                          )}
                        </div>
                        <div className="p-3">
                          {photo.photo_url && !imgErrors[photo.listing_row_id] ? (
                            <img
                              src={withSurveyCtoSession(photo.photo_url)}
                              alt={`${isMainModule ? "Photo evidence" : "Building"} ${photo.building_no ?? ""}`}
                              className="w-full cursor-zoom-in rounded-[0.8rem] object-cover transition-opacity hover:opacity-90"
                              style={{ maxHeight: "200px" }}
                              onClick={() => setLightboxPhoto(photo)}
                              onError={() =>
                                setImgErrors((prev) => ({ ...prev, [photo.listing_row_id]: true }))
                              }
                            />
                          ) : photo.photo_url && imgErrors[photo.listing_row_id] ? (
                            <div className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-[0.8rem] bg-amber-50/70 px-3 py-4 text-center">
                              <KeyRound className="h-5 w-5 text-amber-500" />
                              <p className="text-[11px] text-amber-700 font-medium">Sign in to SurveyCTO to view</p>
                              <a
                                href={withSurveyCtoSession(photo.photo_url)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline underline-offset-2"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Open directly
                              </a>
                            </div>
                          ) : (
                            <div className="flex min-h-[80px] items-center justify-center rounded-[0.8rem] bg-slate-100/60">
                              <p className="text-xs text-slate-400">No photo captured</p>
                            </div>
                          )}
                          {isMainModule && (
                            <div className="mt-3 space-y-1 rounded-[0.8rem] bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
                              <p className="break-all">
                                <span className="font-semibold text-slate-900">KEY:</span>{" "}
                                {photo.submission_key ?? photo.case_id ?? "-"}
                              </p>
                              <p>
                                <span className="font-semibold text-slate-900">Case:</span>{" "}
                                {photo.case_label ?? "-"}
                              </p>
                              <p>
                                <span className="font-semibold text-slate-900">Start time:</span>{" "}
                                {formatPhotoTime(photo.start_time ?? photo.submitted_at)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxPhoto(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={withSurveyCtoSession(lightboxPhoto.photo_url ?? "")}
              alt={`${isMainModule ? "Photo evidence" : "Building"} ${lightboxPhoto.building_no ?? ""}`}
              className="max-h-[85vh] max-w-[90vw] rounded-[1rem] object-contain shadow-2xl"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            {lightboxPhoto.photo_url && (
              <a
                href={withSurveyCtoSession(lightboxPhoto.photo_url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-xs font-semibold text-white hover:bg-white/30"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in SurveyCTO
              </a>
            )}
            <div className="flex items-center gap-3 text-sm text-white/80">
              <span>
                {isMainModule
                  ? `Photo evidence ${lightboxPhoto.building_no ?? "—"}${
                      (accompanimentActorLabel(lightboxPhoto.accompanied_value) ?? fallbackPhotoActorLabel)
                        ? ` - ${accompanimentActorLabel(lightboxPhoto.accompanied_value) ?? fallbackPhotoActorLabel}`
                        : ""
                    }`
                  : `Building ${lightboxPhoto.building_no ?? "—"}`}
              </span>
              {lightboxPhoto.gps_lat != null && lightboxPhoto.gps_long != null && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {lightboxPhoto.gps_lat.toFixed(4)}, {lightboxPhoto.gps_long.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </PlatformPage>
  );
}
