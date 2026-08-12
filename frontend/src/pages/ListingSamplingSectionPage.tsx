import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, MapPin, Play, Shuffle, X } from "lucide-react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import { PlatformPage } from "@/app/platform-page";
import { ListingQualityTabs } from "@/components/listing/ListingQualityTabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SamplingWard = {
  wardId: string;
  wardName: string;
  lga: string;
  state: string;
  listed: number;
  nonResidential: number;
  residential: number;
  remittance: number;
  status: "Ready" | "Sampled";
  center: [number, number];
};

type HouseholdPoint = {
  id: string;
  householdName: string;
  interviewer: string;
  phone: string;
  remittance: boolean;
  selected: boolean;
  lat: number;
  lng: number;
};

const LAGOS_WARDS: SamplingWard[] = [
  { wardId: "LAG-WD-014", wardName: "Surulere Central", lga: "Surulere", state: "Lagos", listed: 126, nonResidential: 42, residential: 84, remittance: 18, status: "Ready", center: [6.5007, 3.3526] },
  { wardId: "LAG-WD-022", wardName: "Yaba Mainland", lga: "Lagos Mainland", state: "Lagos", listed: 118, nonResidential: 36, residential: 82, remittance: 16, status: "Ready", center: [6.5158, 3.3852] },
  { wardId: "LAG-WD-031", wardName: "Ikeja GRA", lga: "Ikeja", state: "Lagos", listed: 134, nonResidential: 48, residential: 86, remittance: 21, status: "Ready", center: [6.5831, 3.3515] },
  { wardId: "LAG-WD-046", wardName: "Ajah Market Axis", lga: "Eti-Osa", state: "Lagos", listed: 142, nonResidential: 51, residential: 91, remittance: 14, status: "Ready", center: [6.4698, 3.5852] },
  { wardId: "LAG-WD-057", wardName: "Ikorodu North", lga: "Ikorodu", state: "Lagos", listed: 110, nonResidential: 32, residential: 78, remittance: 12, status: "Ready", center: [6.6194, 3.5105] },
];

const STATE_WARD_SEEDS = [
  { code: "KAN", state: "Kano", lga: "Tarauni", base: [12.0022, 8.592], names: ["Tarauni South", "Nassarawa Layout", "Gwale Market", "Fagge Central", "Hotoro East"] },
  { code: "RIV", state: "Rivers", lga: "Port Harcourt", base: [4.8156, 7.0498], names: ["Rumuola Axis", "Diobu Mile One", "GRA Phase II", "Elelenwo", "Trans Amadi"] },
  { code: "OYO", state: "Oyo", lga: "Ibadan North", base: [7.3775, 3.947], names: ["Bodija Estate", "Dugbe Central", "Mokola South", "Agodi Gate", "Challenge Axis"] },
  { code: "KAD", state: "Kaduna", lga: "Kaduna North", base: [10.5105, 7.4165], names: ["Kawo Central", "Barnawa Ward", "Ungwan Rimi", "Tudun Wada", "Malali East"] },
  { code: "FCT", state: "FCT", lga: "Municipal", base: [9.0765, 7.3986], names: ["Garki Central", "Wuse Zone 5", "Kubwa Phase 2", "Nyanya Market", "Gwarinpa Estate"] },
  { code: "IMO", state: "Imo", lga: "Owerri Municipal", base: [5.485, 7.035], names: ["Ikenegbu Layout", "Douglas Road", "World Bank Estate", "Aladinma", "Orji Central"] },
  { code: "EDO", state: "Edo", lga: "Oredo", base: [6.335, 5.6037], names: ["New Benin", "Ugbowo", "Sapele Road", "GRA Benin", "Ikpoba Hill"] },
  { code: "OGN", state: "Ogun", lga: "Abeokuta South", base: [7.1475, 3.3619], names: ["Ake Central", "Panseke", "Kuto Market", "Ibara Housing", "Lafenwa"] },
  { code: "ENU", state: "Enugu", lga: "Enugu North", base: [6.5244, 7.5086], names: ["Ogui New Layout", "Independence Layout", "Abakpa Nike", "Coal Camp", "GRA Enugu"] },
];

const OTHER_STATE_WARDS: SamplingWard[] = STATE_WARD_SEEDS.flatMap((seed, stateIndex) =>
  seed.names.map((name, wardIndex) => {
    const listed = 108 + ((stateIndex * 17 + wardIndex * 9) % 48);
    const nonResidential = 28 + ((stateIndex * 11 + wardIndex * 7) % 28);
    const residential = Math.max(60, listed - nonResidential);
    const remittance = Math.max(10, Math.min(residential - 2, 10 + ((stateIndex * 5 + wardIndex * 3) % 16)));
    return {
      wardId: `${seed.code}-WD-${String(100 + stateIndex * 10 + wardIndex).padStart(3, "0")}`,
      wardName: name,
      lga: seed.lga,
      state: seed.state,
      listed,
      nonResidential,
      residential,
      remittance,
      status: "Ready",
      center: [
        seed.base[0] + (wardIndex - 2) * 0.018 + ((stateIndex % 3) - 1) * 0.006,
        seed.base[1] + (wardIndex - 2) * 0.022 + ((stateIndex % 4) - 1.5) * 0.005,
      ] as [number, number],
    };
  }),
);

const SAMPLING_WARDS: SamplingWard[] = [...LAGOS_WARDS, ...OTHER_STATE_WARDS];

function pct(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

function buildHouseholds(ward: SamplingWard): HouseholdPoint[] {
  const eligibleSlots = new Set(Array.from({ length: ward.remittance }, (_, index) => (index * 3 + 2) % Math.max(ward.residential, 1)));
  return Array.from({ length: ward.residential }, (_, index) => {
    const angle = ((index * 137.508) % 360) * (Math.PI / 180);
    const radius = 0.004 + ((index * 19) % 90) / 10000;
    return {
      id: `${ward.wardId}-HH-${String(index + 1).padStart(3, "0")}`,
      householdName: `Household ${String(index + 1).padStart(3, "0")}`,
      interviewer: `int_lag_${String((index % 9) + 1).padStart(2, "0")}`,
      phone: `080${(24000000 + index * 731 + ward.wardId.length * 91).toString().slice(0, 8)}`,
      remittance: eligibleSlots.has(index),
      selected: false,
      lat: ward.center[0] + Math.sin(angle) * radius + (((index * 7) % 11) - 5) / 60000,
      lng: ward.center[1] + Math.cos(angle) * radius + (((index * 5) % 13) - 6) / 60000,
    };
  });
}

function selectedEight(points: HouseholdPoint[]) {
  const eligible = points.filter((point) => point.remittance);
  const chosen = eligible
    .map((point, index) => ({ point, score: ((index * 41 + point.id.length * 17) % 97) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((entry) => entry.point.id);
  const chosenSet = new Set(chosen);
  return points.map((point) => ({ ...point, selected: chosenSet.has(point.id) }));
}

export function ListingSamplingSectionPage() {
  const [wards, setWards] = useState<SamplingWard[]>(SAMPLING_WARDS);
  const [activeWard, setActiveWard] = useState<SamplingWard | null>(null);
  const [households, setHouseholds] = useState<HouseholdPoint[]>([]);
  const [samplingProgress, setSamplingProgress] = useState<number | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const selectedCount = households.filter((point) => point.selected).length;
  const activeEligibleCount = households.filter((point) => point.remittance).length;
  const activeResidentialCount = households.length;

  function openWard(ward: SamplingWard) {
    setActiveWard(ward);
    setHouseholds(buildHouseholds(ward));
    setSamplingProgress(null);
    setSuccessOpen(false);
  }

  function runSampling() {
    if (!activeWard || samplingProgress !== null) return;
    setSamplingProgress(0);
    let progress = 0;
    const timer = window.setInterval(() => {
      progress += 5 + (progress % 2) * 2;
      if (progress >= 100) {
        window.clearInterval(timer);
        setSamplingProgress(100);
        window.setTimeout(() => setSuccessOpen(true), 250);
      } else {
        setSamplingProgress(progress);
      }
    }, 280);
  }

  function confirmSuccess() {
    if (!activeWard) return;
    setHouseholds((current) => selectedEight(current));
    setWards((current) => current.map((ward) => ward.wardId === activeWard.wardId ? { ...ward, status: "Sampled" } : ward));
    setSuccessOpen(false);
    setSamplingProgress(null);
  }

  const tableRows = useMemo(() => wards.map((ward) => ({
    ...ward,
    nonResidentialPct: pct(ward.nonResidential, ward.listed),
    residentialPct: pct(ward.residential, ward.listed),
    remittancePct: pct(ward.remittance, ward.listed),
  })), [wards]);

  return (
    <PlatformPage title="Sampling Section" subtitle="" syncLabel={`${wards.length} approved Lagos Wards`} module="listing" plainTopBar>
      <div className="space-y-5">
        <ListingQualityTabs />

        <Card className="overflow-hidden rounded-[1.65rem] border border-sky-100/80 bg-white/88 shadow-[0_22px_55px_rgba(37,99,235,0.12)]">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/80 bg-sky-50/45 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-600 text-white">
                  <Shuffle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-600">Sampling Section</p>
                  <h2 className="text-lg font-semibold text-slate-950">Approved Wards ready for Main Survey sampling</h2>
                </div>
              </div>
              <div className="rounded-full border border-white/70 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-600">
                8 samples per Ward
              </div>
            </div>

            <div className="max-h-[620px] overflow-y-auto px-4 pb-4">
              <Table className="border-separate border-spacing-y-2">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="rounded-l-2xl bg-white/95 text-slate-600">State</TableHead>
                    <TableHead className="bg-white/95 text-slate-600">Ward Name</TableHead>
                    <TableHead className="bg-white/95 text-slate-600">Ward ID</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">Listed</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">% Of Non-Residential</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">% Of Residential</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">% Of Remittance</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">Sampled from Remittance</TableHead>
                    <TableHead className="bg-white/95 text-center text-slate-600">Status</TableHead>
                    <TableHead className="w-10 rounded-r-2xl bg-white/95" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row) => (
                    <TableRow key={row.wardId} onClick={() => openWard(row)} className="cursor-pointer rounded-2xl bg-white/72 shadow-sm transition hover:bg-sky-50/80 hover:shadow-md">
                      <TableCell className="rounded-l-2xl border-y border-l border-slate-100 font-semibold text-slate-950">{row.state}</TableCell>
                      <TableCell className="border-y border-slate-100 text-slate-700">{row.wardName}</TableCell>
                      <TableCell className="border-y border-slate-100 font-mono text-xs text-slate-600">{row.wardId}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center tabular-nums text-slate-700">{row.listed}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-rose-700">{row.nonResidentialPct}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-emerald-700">{row.residentialPct}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-blue-700">{row.remittancePct}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-slate-800">{row.status === "Sampled" ? 8 : "-"}</TableCell>
                      <TableCell className="border-y border-slate-100 text-center">
                        <Badge className={cn("text-xs", row.status === "Sampled" ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700" : "border-amber-500/30 bg-amber-500/12 text-amber-700")}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="rounded-r-2xl border-y border-r border-slate-100 text-center">
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {activeWard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="relative z-0 flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-600">Lagos Ward coverage</p>
                <h3 className="text-xl font-semibold text-slate-950">{activeWard.wardName}</h3>
                <p className="mt-1 text-sm text-slate-500">{activeWard.lga} · {activeWard.wardId} · {activeEligibleCount} remittance-eligible households</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={runSampling} disabled={samplingProgress !== null || selectedCount === 8} className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                  <Play className="h-4 w-4" />
                  Run Sampling
                </button>
                <button type="button" onClick={() => setActiveWard(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_420px]">
              <div className="relative z-0 min-h-[420px]">
                <MapContainer center={activeWard.center} zoom={15} scrollWheelZoom className="h-full w-full [&_.leaflet-pane]:z-0 [&_.leaflet-control-container]:z-10">
                  <TileLayer attribution="Tiles &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                  {households.map((point) => (
                    <CircleMarker
                      key={point.id}
                      center={[point.lat, point.lng]}
                      radius={point.selected ? 7 : point.remittance ? 5 : 4}
                      pathOptions={{
                        color: point.selected ? "#7c3aed" : point.remittance ? "#c2410c" : "#b91c1c",
                        fillColor: point.selected ? "#a855f7" : point.remittance ? "#f97316" : "#ef4444",
                        fillOpacity: point.selected ? 0.95 : 0.78,
                        weight: point.selected ? 2 : 1,
                      }}
                    >
                      <Popup>
                        <div className="space-y-1 text-sm">
                          <div className="font-semibold">{point.householdName}</div>
                          <div>Remittance: {point.remittance ? "Yes" : "No"}</div>
                          <div>Interviewer: {point.interviewer}</div>
                          <div>{point.selected ? "Selected for Main Survey" : "Not selected"}</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
              <div className="min-h-0 overflow-y-auto border-l border-slate-100 bg-slate-50/70 p-4">
                <div className="mb-4 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-white p-3 text-center shadow-sm"><p className="text-[10px] font-semibold uppercase text-slate-400">Residential</p><p className="text-lg font-bold text-emerald-700">{activeResidentialCount}</p></div>
                  <div className="rounded-2xl bg-white p-3 text-center shadow-sm"><p className="text-[10px] font-semibold uppercase text-slate-400">Remittance</p><p className="text-lg font-bold text-blue-700">{activeEligibleCount}</p></div>
                  <div className="rounded-2xl bg-white p-3 text-center shadow-sm"><p className="text-[10px] font-semibold uppercase text-slate-400">Selected</p><p className="text-lg font-bold text-violet-700">{selectedCount}</p></div>
                </div>
                <div className="space-y-2">
                  {households.map((point) => (
                    <div key={point.id} className={cn("rounded-2xl border bg-white p-3 shadow-sm", point.selected ? "border-violet-300 bg-violet-50" : "border-slate-100")}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{point.householdName}</p>
                          <p className="mt-1 text-xs text-slate-500">{point.id} · {point.interviewer}</p>
                        </div>
                        <Badge className={point.remittance ? "border-blue-500/30 bg-blue-500/12 text-blue-700" : "border-slate-300 bg-slate-100 text-slate-600"}>
                          Remittance {point.remittance ? "Yes" : "No"}
                        </Badge>
                      </div>
                      {point.selected ? <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><CheckCircle2 className="h-3.5 w-3.5" />Selected for Main Survey</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {samplingProgress !== null && !successOpen ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
              <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-50 text-sky-600">
                  <Shuffle className="h-6 w-6" />
                </div>
                <p className="mt-4 text-base font-semibold text-slate-950">Automatically selecting 8 qualified households from eligible households where international remittance is Yes.</p>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${samplingProgress}%` }} />
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-600">{samplingProgress}%</p>
              </div>
            </div>
          ) : null}

          {successOpen ? (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
              <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <p className="mt-4 text-lg font-semibold text-slate-950">8 households have been randomly selected and have been pushed to respective interviewers for Main Survey stage.</p>
                <button type="button" onClick={confirmSuccess} className="mt-6 rounded-2xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-700">
                  OK
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </PlatformPage>
  );
}
