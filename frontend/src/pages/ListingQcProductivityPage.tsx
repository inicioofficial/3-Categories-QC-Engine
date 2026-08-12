import { QcProductivityView } from "@/components/qc/QcProductivityView";

export function ListingQcProductivityPage() {
  return (
    <QcProductivityView
      module="listing"
      title="In-Office QC Performance"
      summaryEndpoint="/api/listing/qc-productivity"
      byDateEndpoint="/api/listing/qc-productivity-by-date"
      storageKeyPrefix="listing-qc-productivity"
      exportPrefix="listing"
      queueMessage={(queue) =>
        queue === "all"
          ? "Listing QC workload is currently driven by picture-check assignments."
          : `Listing QC currently has no ${queue} queue.`
      }
    />
  );
}
