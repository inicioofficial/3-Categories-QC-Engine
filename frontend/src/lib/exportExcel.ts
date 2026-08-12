import * as XLSX from "xlsx";

type ExportColumn<T> = {
  header: string;
  value: (row: T) => unknown;
  width?: number;
};

function sanitizeExcelText(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 32767);
}

export function exportRowsToExcel<T>({
  rows,
  columns,
  filename,
  sheetName,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  sheetName: string;
}) {
  const aoa: Array<Array<string | number>> = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => sanitizeExcelText(column.value(row)))),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!cols"] = columns.map((column, columnIndex) => {
    const longest = aoa.reduce((max, currentRow) => {
      const cellValue = currentRow[columnIndex];
      return Math.max(max, String(cellValue ?? "").length);
    }, String(column.header).length);
    return { wch: Math.max(column.width ?? 12, Math.min(longest + 2, 40)) };
  });

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: columnIndex });
    if (worksheet[cellRef]) {
      worksheet[cellRef].s = {
        font: { bold: true, color: { rgb: "1F2937" } },
        fill: { fgColor: { rgb: "E5EEF9" } },
        border: {
          top: { style: "thin", color: { rgb: "CBD5E1" } },
          bottom: { style: "thin", color: { rgb: "CBD5E1" } },
          left: { style: "thin", color: { rgb: "CBD5E1" } },
          right: { style: "thin", color: { rgb: "CBD5E1" } },
        },
      };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet1");
  XLSX.writeFile(workbook, filename);
}
