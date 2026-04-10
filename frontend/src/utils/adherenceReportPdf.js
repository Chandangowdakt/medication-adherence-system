import { jsPDF } from 'jspdf';

/**
 * Build a simple PDF from GET /api/reports/adherence payload and trigger download.
 */
export function buildAdherencePdf(report) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const maxW = pageW - margin * 2;
  let y = 18;
  const LH = 6;

  function needSpace(h) {
    if (y + h > 285) {
      doc.addPage();
      y = 18;
    }
  }

  doc.setFontSize(16);
  doc.text('Medication Adherence Report', margin, y);
  y += LH * 2;

  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, margin, y);
  y += LH * 2;
  doc.setTextColor(0);

  doc.setFontSize(12);
  doc.text(`Name: ${report.user?.name ?? '—'}`, margin, y);
  y += LH * 1.3;
  doc.setFontSize(11);
  doc.text(`Email: ${report.user?.email ?? '—'}`, margin, y);
  y += LH * 2;

  const adh = report.adherence || {};
  doc.setFontSize(14);
  doc.text(`Adherence: ${adh.adherencePercentage ?? 0}%`, margin, y);
  y += LH * 1.5;

  doc.setFontSize(10);
  const riskLabel =
    adh.riskLevel === 'unknown' ? 'No sufficient data' : (adh.riskLevel ?? '—');
  const scorePart =
    adh.riskScore != null && adh.riskScore !== '' ? `, Score: ${adh.riskScore}/100` : '';
  const totalsLines = doc.splitTextToSize(
    `Window totals — Total: ${adh.totalDoses ?? 0}, Taken: ${adh.takenDoses ?? 0}, Missed: ${adh.missedDoses ?? 0}, Risk: ${riskLabel}${scorePart}`,
    maxW
  );
  doc.text(totalsLines, margin, y);
  y += totalsLines.length * LH * 0.95 + LH;

  if (adh.riskReason) {
    const reasonLines = doc.splitTextToSize(`Risk note: ${adh.riskReason}`, maxW);
    needSpace(reasonLines.length * LH + LH);
    doc.text(reasonLines, margin, y);
    y += reasonLines.length * LH * 0.95 + LH;
  }

  doc.setFontSize(12);
  doc.text('Medications', margin, y);
  y += LH * 1.3;
  doc.setFontSize(10);

  const meds = report.medications || [];
  if (meds.length === 0) {
    needSpace(LH);
    doc.text('No medications on file.', margin + 4, y);
    y += LH * 1.5;
  } else {
    for (const m of meds) {
      const sched =
        Array.isArray(m.schedule) && m.schedule.length ? m.schedule.join(', ') : '—';
      const line = `• ${m.name}${m.dosage ? ` (${m.dosage})` : ''} — times: ${sched}`;
      const wrapped = doc.splitTextToSize(line, maxW - 4);
      needSpace(wrapped.length * LH + 4);
      doc.text(wrapped, margin + 4, y);
      y += wrapped.length * LH + 2;
    }
  }

  const safeName = String(report.user?.name || 'user').replace(/[^a-z0-9-_]+/gi, '-');
  doc.save(`adherence-report-${safeName}.pdf`);
}
