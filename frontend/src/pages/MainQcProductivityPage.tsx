import { QcProductivityView } from "@/components/qc/QcProductivityView";

export function MainQcProductivityPage() {
  return (
    <QcProductivityView
      module="main"
      title="In-Office QC Performance"
      summaryEndpoint="/api/main-survey/qc-productivity"
      byDateEndpoint="/api/main-survey/qc-productivity-by-date"
      storageKeyPrefix="main-qc-productivity"
      exportPrefix="main"
    />
  );
}
