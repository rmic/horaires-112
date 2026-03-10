import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { differenceInMinutes, endOfWeek, startOfWeek } from "date-fns";
import type { DayTimeline } from "@/lib/coverage";
import { formatDateTime, formatShortDate, formatWeekLabel } from "@/lib/time";

type PdfGap = {
  startTime: Date;
  endTime: Date;
  missingCount: number;
};

type PdfInput = {
  monthLabel: string;
  dayTimelines: DayTimeline[];
  gaps?: PdfGap[];
};

type Segment = DayTimeline["segments"][number];

type LaneVariant = "gap" | "employee" | "volunteer" | "provisional";

type CoverageItem = {
  key: string;
  label: string;
  variant: LaneVariant;
  preferredLane: 0 | 1 | null;
};

type LaneBlock = {
  key: string;
  startTime: Date;
  endTime: Date;
  label: string;
  variant: LaneVariant;
};

type WeekGroup = {
  key: string;
  label: string;
  timelines: DayTimeline[];
};

let cachedPdfFontPath: string | null = null;

function getPdfFontPath() {
  if (!cachedPdfFontPath) {
    cachedPdfFontPath = fileURLToPath(new URL("./fonts/NotoSans-Regular.ttf", import.meta.url));
  }

  return cachedPdfFontPath;
}

function formatDurationLabel(startTime: Date, endTime: Date) {
  const durationMinutes = Math.max(0, differenceInMinutes(endTime, startTime));
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function getVolunteerCoverageItems(segment: Segment) {
  return [...segment.volunteerAssignments]
    .filter((assignment) => assignment.lane !== "A3")
    .sort((a, b) => a.volunteerName.localeCompare(b.volunteerName))
    .map<CoverageItem>((assignment) => ({
      key: assignment.id ? `assignment:${assignment.id}` : `volunteer:${assignment.volunteerId}:${assignment.status}`,
      label: assignment.volunteerName,
      variant: assignment.status === "PROVISIONAL" ? "provisional" : "volunteer",
      preferredLane: assignment.lane === "A1" ? 0 : assignment.lane === "A2" ? 1 : null,
    }));
}

function getEmployeeCoverageItems(segment: Segment) {
  return segment.employeeBlocks.map<CoverageItem>((block) => ({
    key: `employee:${block.id}`,
    label: block.label,
    variant: "employee",
    preferredLane: null,
  }));
}

function splitSegmentsOnShiftBoundaries(dayStart: Date, segments: Segment[]) {
  const boundaries = [6, 18].map((hours) => new Date(dayStart.getTime() + hours * 60 * 60 * 1000));

  return segments.flatMap((segment) => {
    const cutPoints = [segment.startTime, segment.endTime];

    for (const boundary of boundaries) {
      if (boundary > segment.startTime && boundary < segment.endTime) {
        cutPoints.push(boundary);
      }
    }

    const sorted = [...new Set(cutPoints.map((value) => value.getTime()))]
      .sort((a, b) => a - b)
      .map((value) => new Date(value));

    return sorted.slice(0, -1).map((startTime, index) => ({
      ...segment,
      startTime,
      endTime: sorted[index + 1],
    }));
  });
}

function createGapBlock(segment: Segment, laneIndex: number): LaneBlock {
  return {
    key: `gap:${laneIndex}:${segment.startTime.toISOString()}:${segment.endTime.toISOString()}`,
    startTime: segment.startTime,
    endTime: segment.endTime,
    label: formatDurationLabel(segment.startTime, segment.endTime),
    variant: "gap",
  };
}

function buildLaneBlocks(day: DayTimeline) {
  const splitSegments = splitSegmentsOnShiftBoundaries(day.dayStart, day.segments);
  const lanes: LaneBlock[][] = [[], []];
  const previousLaneKeys: Array<string | null> = [null, null];

  for (const segment of splitSegments) {
    const explicitLaneItems: Array<CoverageItem | null> = [null, null];
    const availableItems = [...getVolunteerCoverageItems(segment), ...getEmployeeCoverageItems(segment)].filter(
      (item) => {
        if (item.preferredLane === null) {
          return true;
        }

        if (!explicitLaneItems[item.preferredLane]) {
          explicitLaneItems[item.preferredLane] = item;
          return false;
        }

        return true;
      },
    );

    const laneItems: Array<CoverageItem | null> = [null, null];

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      if (explicitLaneItems[laneIndex]) {
        laneItems[laneIndex] = explicitLaneItems[laneIndex];
        continue;
      }

      const previousLaneKey = previousLaneKeys[laneIndex];
      if (!previousLaneKey) {
        continue;
      }

      const itemIndex = availableItems.findIndex((item) => item.key === previousLaneKey);
      if (itemIndex >= 0) {
        laneItems[laneIndex] = availableItems[itemIndex];
        availableItems.splice(itemIndex, 1);
      }
    }

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      if (laneItems[laneIndex]) {
        continue;
      }

      laneItems[laneIndex] = availableItems.shift() ?? null;
    }

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      const item = laneItems[laneIndex];
      const nextBlock = item
        ? {
            key: item.key,
            startTime: segment.startTime,
            endTime: segment.endTime,
            label: item.label,
            variant: item.variant,
          }
        : createGapBlock(segment, laneIndex);

      const previousBlock = lanes[laneIndex].at(-1);
      const isShiftBoundary = nextBlock.startTime.getHours() === 6 || nextBlock.startTime.getHours() === 18;

      if (
        previousBlock &&
        previousBlock.key === nextBlock.key &&
        previousBlock.endTime.getTime() === nextBlock.startTime.getTime() &&
        !isShiftBoundary
      ) {
        previousBlock.endTime = nextBlock.endTime;

        if (previousBlock.variant === "gap") {
          previousBlock.label = formatDurationLabel(previousBlock.startTime, previousBlock.endTime);
        }
      } else {
        lanes[laneIndex].push(nextBlock);
      }

      previousLaneKeys[laneIndex] = nextBlock.key;
    }
  }

  return lanes;
}

function blockColors(variant: LaneVariant) {
  if (variant === "gap") {
    return { fill: "#dc2626", stroke: "#991b1b", text: "#ffffff" };
  }

  if (variant === "employee") {
    return { fill: "#64748b", stroke: "#475569", text: "#ffffff" };
  }

  if (variant === "provisional") {
    return { fill: "#f97316", stroke: "#c2410c", text: "#ffffff" };
  }

  return { fill: "#16a34a", stroke: "#166534", text: "#ffffff" };
}

function groupByWeek(dayTimelines: DayTimeline[]): WeekGroup[] {
  const groups = new Map<string, DayTimeline[]>();

  for (const timeline of dayTimelines) {
    const weekStart = startOfWeek(timeline.dayStart, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(timeline.dayStart, { weekStartsOn: 1 });
    const key = `${weekStart.toISOString()}|${weekEnd.toISOString()}`;
    const list = groups.get(key) ?? [];
    list.push(timeline);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([key, timelines]) => {
    const [start, end] = key.split("|");
    return {
      key,
      label: formatWeekLabel(new Date(start), new Date(end)),
      timelines,
    };
  });
}

function drawWeekPage(doc: PDFKit.PDFDocument, params: { monthLabel: string; week: WeekGroup }) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const topY = doc.page.margins.top;
  const dateColWidth = 112;
  const timelineWidth = pageWidth - dateColWidth;
  const laneHeight = 16;
  const dayRowHeight = 40;
  const hourWidth = timelineWidth / 24;

  doc.fontSize(18).fillColor("#0f172a").text(`Planning ${params.monthLabel}`, leftX, topY);
  doc.fontSize(11).fillColor("#475569").text(params.week.label, leftX, topY + 24);

  const legendItems = [
    { label: "Confirmé", fill: "#16a34a" },
    { label: "Provisoire", fill: "#f97316" },
    { label: "À couvrir", fill: "#dc2626" },
    { label: "Salarié", fill: "#64748b" },
  ];

  let legendX = leftX;
  for (const item of legendItems) {
    doc.save().roundedRect(legendX, topY + 44, 10, 10, 2).fill(item.fill).restore();
    doc.fontSize(9).fillColor("#334155").text(item.label, legendX + 14, topY + 43, { width: 72 });
    legendX += 88;
  }

  const headerY = topY + 70;
  doc.save().roundedRect(leftX, headerY, pageWidth, 28, 6).fill("#f1f5f9").restore();
  doc
    .fontSize(10)
    .fillColor("#475569")
    .font(getPdfFontPath())
    .text("Jour", leftX + 10, headerY + 9, { width: dateColWidth - 20 });

  for (let hour = 0; hour < 24; hour += 1) {
    doc.text(String(hour), leftX + dateColWidth + hour * hourWidth, headerY + 9, {
      width: hourWidth,
      align: "center",
    });
  }

  let y = headerY + 36;

  for (const day of params.week.timelines) {
    const lanes = buildLaneBlocks(day);

    doc.save().roundedRect(leftX, y, pageWidth, dayRowHeight, 6).fill("#ffffff").stroke("#e2e8f0").restore();

    doc
      .fontSize(10)
      .fillColor("#0f172a")
      .text(formatShortDate(day.dayStart), leftX + 10, y + 4, { width: dateColWidth - 20 });

    const laneLabelY = [y + 18, y + 18 + laneHeight];
    ["A1", "A2"].forEach((label, index) => {
      doc
        .fontSize(8)
        .fillColor("#64748b")
        .text(label, leftX + 10, laneLabelY[index] + 3, { width: 24 });
    });

    for (let hour = 0; hour <= 24; hour += 1) {
      const x = leftX + dateColWidth + hour * hourWidth;
      doc
        .save()
        .moveTo(x, y)
        .lineTo(x, y + dayRowHeight)
        .lineWidth(hour % 6 === 0 ? 0.9 : 0.4)
        .strokeColor(hour % 6 === 0 ? "#cbd5e1" : "#e2e8f0")
        .stroke()
        .restore();
    }

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      const laneY = y + 16 + laneIndex * laneHeight;

      for (const block of lanes[laneIndex]) {
        const startHour =
          block.startTime.getHours() + block.startTime.getMinutes() / 60 + block.startTime.getSeconds() / 3600;
        const endHour =
          block.endTime.getHours() + block.endTime.getMinutes() / 60 + block.endTime.getSeconds() / 3600;
        const width = Math.max(6, (endHour - startHour) * hourWidth - 2);
        const x = leftX + dateColWidth + startHour * hourWidth + 1;
        const colors = blockColors(block.variant);

        doc
          .save()
          .roundedRect(x, laneY + 1, width, laneHeight - 2, 4)
          .fillAndStroke(colors.fill, colors.stroke)
          .restore();

        doc.fontSize(7).fillColor(colors.text).text(block.label, x + 4, laneY + 4, {
          width: width - 8,
          ellipsis: true,
        });
      }
    }

    y += dayRowHeight + 6;
  }
}

function drawGapPages(doc: PDFKit.PDFDocument, gaps: PdfGap[]) {
  if (gaps.length === 0) {
    return;
  }

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  let y = doc.page.margins.top;

  doc.fontSize(18).fillColor("#0f172a").text("Créneaux à couvrir", leftX, y);
  y += 30;

  for (const gap of gaps) {
    if (y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.fontSize(18).fillColor("#0f172a").text("Créneaux à couvrir", leftX, y);
      y += 30;
    }

    doc.save().roundedRect(leftX, y, pageWidth, 34, 6).fill("#fef2f2").stroke("#fca5a5").restore();
    doc
      .fontSize(10)
      .fillColor("#991b1b")
      .text(
        `${formatDateTime(gap.startTime)} - ${formatDateTime(gap.endTime)} : ${
          gap.missingCount === 1 ? "1 personne manquante" : "2 personnes manquantes"
        }`,
        leftX + 10,
        y + 11,
        { width: pageWidth - 20 },
      );
    y += 42;
  }
}

export async function renderSchedulePdf(input: PdfInput) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 24,
      font: getPdfFontPath(),
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const weekGroups = groupByWeek(input.dayTimelines);

    weekGroups.forEach((week, index) => {
      if (index > 0) {
        doc.addPage();
      }
      drawWeekPage(doc, {
        monthLabel: input.monthLabel,
        week,
      });
    });

    if ((input.gaps ?? []).length > 0) {
      doc.addPage();
      drawGapPages(doc, input.gaps ?? []);
    }

    doc.end();
  });
}
