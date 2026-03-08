import PDFDocument from "pdfkit";
import { differenceInHours } from "date-fns";
import type { DayTimeline } from "@/lib/coverage";
import { formatShortDate } from "@/lib/time";

type PdfInput = {
  monthLabel: string;
  dayTimelines: DayTimeline[];
};

function blockColor(segment: DayTimeline["segments"][number]) {
  if (segment.missingCount > 0) return "#dc2626";
  if (segment.volunteerAssignments.length > 0) {
    const hasProvisional = segment.volunteerAssignments.some(
      (assignment) => assignment.status === "PROVISIONAL",
    );
    return hasProvisional ? "#f97316" : "#16a34a";
  }
  if (segment.employeeBlocks.length > 0) return "#6b7280";
  return "#ef4444";
}

function blockLabel(segment: DayTimeline["segments"][number]) {
  if (segment.missingCount > 0) {
    return segment.missingCount === 1
      ? "A COUVRIR: 1 personne manquante"
      : "A COUVRIR: 2 personnes manquantes";
  }

  if (segment.volunteerAssignments.length > 0) {
    return segment.volunteerAssignments.map((assignment) => assignment.volunteerName).join(" + ");
  }

  if (segment.employeeBlocks.length > 0) {
    return "Salarié";
  }

  return "Non couvert";
}

export async function renderSchedulePdf(input: PdfInput) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 24,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).fillColor("#0f172a").text(`Planning ${input.monthLabel}`, {
      align: "left",
    });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor("#334155")
      .text("Légende: vert=confirmé orange=provisoire rouge=a couvrir gris=salarie");
    doc.moveDown(0.6);

    const timelineX = 160;
    const timelineWidth = 620;
    const rowHeight = 20;
    let y = 84;

    for (const day of input.dayTimelines) {
      if (y > 540) {
        doc.addPage();
        y = 40;
      }

      const dateLabel = formatShortDate(day.dayStart);
      doc.fillColor("#0f172a").fontSize(9).text(dateLabel, 24, y + 5, {
        width: 120,
      });

      doc
        .save()
        .rect(timelineX, y, timelineWidth, rowHeight)
        .strokeColor("#cbd5e1")
        .lineWidth(0.6)
        .stroke()
        .restore();

      for (const segment of day.segments) {
        const startHour = segment.startTime.getHours() + segment.startTime.getMinutes() / 60;
        const durationHours = Math.max(0.5, differenceInHours(segment.endTime, segment.startTime));
        const x = timelineX + (startHour / 24) * timelineWidth;
        const width = Math.max(4, (durationHours / 24) * timelineWidth);

        doc
          .save()
          .rect(x, y, width, rowHeight)
          .fillAndStroke(blockColor(segment), "#ffffff")
          .restore();

        doc
          .fillColor("#ffffff")
          .fontSize(7)
          .text(blockLabel(segment), x + 2, y + 6, {
            width: width - 4,
            ellipsis: true,
          });
      }

      y += rowHeight + 6;
    }

    doc.end();
  });
}
