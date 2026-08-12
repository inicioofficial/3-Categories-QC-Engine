import { ArrowLeft, ImageIcon } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { PlatformPage } from "@/app/platform-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ListingPhotoValidationImagesPageProps = {
  module?: "listing" | "main";
};

export function ListingPhotoValidationImagesPage({ module = "listing" }: ListingPhotoValidationImagesPageProps) {
  const navigate = useNavigate();
  const { submissionKey } = useParams();
  const isMainModule = module === "main";

  return (
    <PlatformPage
      title={isMainModule ? "Accompaniment Images" : "Incidence & HH Photo Images"}
      subtitle={isMainModule ? "SurveyCTO accompaniment media preview" : "SurveyCTO media preview for the selected listing case"}
      syncLabel={submissionKey ? decodeURIComponent(submissionKey) : "Photo set"}
      module={module}
      plainTopBar
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(isMainModule ? "/main/accompaniment" : "/listing/picture-check")}
            className="rounded-xl border-sky-100 bg-white/80 text-slate-800 hover:bg-sky-50"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {isMainModule ? "Back to Accompaniment" : "Back to Incidence & HH Photo"}
          </Button>
        </div>

        <Card className="overflow-hidden rounded-[1.65rem] border border-sky-100/80 bg-white/88 shadow-[0_22px_55px_rgba(37,99,235,0.12)]">
          <CardContent className="p-5">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-600 text-white">
                <ImageIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">SurveyCTO image pull</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  {isMainModule ? "Accompaniment Images" : "Incidence & HH Photo Images"}
                </h2>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 20 }, (_, index) => (
                <figure key={index} className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
                  <img
                    src={`/images/image${index + 1}.png`}
                    alt={`Validation ${index + 1}`}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <figcaption className="px-3 py-2 text-xs font-semibold text-slate-600">Image {index + 1}</figcaption>
                </figure>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}
