/**
 * Downloadable question-bank PDF.
 *
 * The PDF is generated on demand from the dataset the API already uses. It
 * never stores a copy and never uses question titles for identity; each
 * question is headed by its backend `Question #: N` id and follows dataset
 * order.
 */
import PDFDocument from 'pdfkit';
import { and, count, eq } from 'drizzle-orm';
import type { NormalizedQuestion } from '@examdump/shared';
import { getDb } from '../db/client.js';
import { questionVotes } from '../db/schema/index.js';

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const INK = '#1F1635';
const MUTED = '#6B6280';
const BORDER = '#E2DCF5';
const ACCENT = '#6D3BF5';
const GREEN = '#0D9469';
const GREEN_SOFT = '#EAF8F2';
const SURFACE = '#F7F5FF';
const WHITE = '#FFFFFF';
const OPTION_COLORS = ['#6D3BF5', '#E3308C', '#22D3EE', '#0D9469', '#B06808', '#E11D48', '#80759C'];

export type VoteCounts = Map<string, Record<string, number>>;

/** Load every vote for one exam in a single grouped query. */
export async function loadQuestionVoteCounts(
  providerId: string,
  examKey: string,
): Promise<VoteCounts> {
  const rows = await getDb()
    .select({
      questionId: questionVotes.questionId,
      choiceKey: questionVotes.choiceKey,
      value: count(),
    })
    .from(questionVotes)
    .where(and(eq(questionVotes.providerId, providerId), eq(questionVotes.examKey, examKey)))
    .groupBy(questionVotes.questionId, questionVotes.choiceKey);

  const counts: VoteCounts = new Map();
  for (const row of rows) {
    const perQuestion = counts.get(row.questionId) ?? {};
    // Stored votes are a single key ("A") or a comma-separated set ("A,C").
    const keys = row.choiceKey
      .toUpperCase()
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    for (const key of keys) {
      perQuestion[key] = (perQuestion[key] ?? 0) + Number(row.value);
    }
    counts.set(row.questionId, perQuestion);
  }
  return counts;
}

function optionColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length]!;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawPageChrome(doc: PDFKit.PDFDocument, examCode: string, pageNumber: number): void {
  const y = doc.page.height - 34;
  doc
    .moveTo(PAGE_MARGIN, y - 6)
    .lineTo(doc.page.width - PAGE_MARGIN, y - 6)
    .strokeColor(BORDER)
    .lineWidth(0.6)
    .stroke();
  const savedY = doc.y;
  const savedBottom = doc.page.margins.bottom;
  // The footer lives outside the content box. Disable the bottom margin while
  // drawing it so PDFKit does not treat the footer as overflowing content and
  // recursively add another page.
  doc.page.margins.bottom = 0;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`ExamDump Pro · ${examCode} · Page ${pageNumber}`, PAGE_MARGIN, y, {
      lineBreak: false,
    });
  doc.page.margins.bottom = savedBottom;
  doc.y = savedY;
}

export function createQuestionBankPdf(input: {
  examCode: string;
  examTitle: string;
  providerTitle: string;
  questions: NormalizedQuestion[];
  votes: VoteCounts;
}): PDFKit.PDFDocument {
  const { examCode, examTitle, providerTitle, questions, votes } = input;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 58, bottom: 58, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: {
      Title: `${examCode} complete question bank`,
      Author: 'ExamDump Pro',
      Subject: `${examTitle} questions, answers, explanations and community voting`,
      Creator: 'ExamDump Pro',
    },
  });

  let pageNumber = 1;
  doc.on('pageAdded', () => {
    pageNumber += 1;
    drawPageChrome(doc, examCode, pageNumber);
  });
  drawPageChrome(doc, examCode, pageNumber);

  /* Cover */
  doc.rect(0, 0, doc.page.width, 14).fill(ACCENT);
  doc.rect(0, 14, doc.page.width, 4).fill('#E3308C');
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('EXAMDUMP PRO', PAGE_MARGIN, 64, {
    characterSpacing: 1.4,
  });

  doc.font('Helvetica-Bold').fontSize(34).fillColor(INK).text(examCode, PAGE_MARGIN, 122);
  doc.font('Helvetica').fontSize(20).fillColor(INK).text(examTitle, PAGE_MARGIN, 168, {
    width: CONTENT_WIDTH,
  });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(providerTitle, PAGE_MARGIN, doc.y + 6);

  doc
    .roundedRect(PAGE_MARGIN, 270, CONTENT_WIDTH, 150, 10)
    .fill(SURFACE);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Complete question bank', PAGE_MARGIN + 18, 288);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(
      `${questions.length} questions in backend order, with options, verified answers, explanations where available, and community vote distribution.`,
      PAGE_MARGIN + 18,
      308,
      { width: CONTENT_WIDTH - 36, lineGap: 2 },
    );
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('Question identity', PAGE_MARGIN + 18, 362);
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text('Each entry uses the backend Question #: N identifier, never the question title.', PAGE_MARGIN + 18, 377, {
      width: CONTENT_WIDTH - 36,
    });

  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Generated ${new Date().toISOString().slice(0, 10)} · For the access holder only`,
    PAGE_MARGIN,
    430,
  );

  doc.addPage();

  /* Questions */
  questions.forEach((question, index) => {
    ensureSpace(doc, 170);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(ACCENT)
      .text(question.id.toUpperCase(), PAGE_MARGIN, doc.y, { characterSpacing: 0.7 });
    doc.moveDown(0.35);

    doc.font('Helvetica').fontSize(11.5).fillColor(INK).text(question.stemText, {
      width: CONTENT_WIDTH,
      lineGap: 2.2,
    });
    if (question.stemImages.length > 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text('This question includes an exhibit or image in the online version.', {
          width: CONTENT_WIDTH,
        });
    }

    doc.moveDown(0.6);
    const answerKey = question.answer ?? '';
    question.choices.forEach((choice, choiceIndex) => {
      const correct = answerKey.includes(choice.key);
      const optionWidth = CONTENT_WIDTH - (correct ? 82 : 30);
      doc.font('Helvetica').fontSize(10.5);
      const optionHeight = doc.heightOfString(choice.text || '[Image option]', {
        width: optionWidth,
        lineGap: 1.6,
      });
      ensureSpace(doc, Math.max(26, optionHeight + 10));
      const rowY = doc.y;

      doc
        .roundedRect(PAGE_MARGIN, rowY, 18, 18, 4)
        .fill(correct ? GREEN : '#EEE9FF');
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(correct ? WHITE : ACCENT)
        .text(choice.key, PAGE_MARGIN, rowY + 5, { width: 18, align: 'center' });

      doc
        .font(correct ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10.5)
        .fillColor(correct ? '#0B6B4C' : INK)
        .text(choice.text || '[Image option]', PAGE_MARGIN + 26, rowY, {
          width: optionWidth,
          lineGap: 1.6,
        });
      const afterText = doc.y;
      if (correct) {
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(GREEN)
          .text('CORRECT', PAGE_MARGIN + CONTENT_WIDTH - 48, rowY + 1, {
            width: 48,
            align: 'right',
          });
      }
      doc.y = Math.max(afterText, rowY + 18);
      if (choiceIndex < question.choices.length - 1) doc.moveDown(0.25);
    });

    ensureSpace(doc, 34);
    doc.moveDown(0.35);
    const answerText = question.answerText?.trim();
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(GREEN)
      .text(
        `Correct answer: ${answerKey}${answerText && answerText !== answerKey ? ` — ${answerText}` : ''}`,
        { width: CONTENT_WIDTH },
      );

    if (question.explanation.trim()) {
      const textWidth = CONTENT_WIDTH - 24;
      doc.font('Helvetica').fontSize(9.5);
      const textHeight = doc.heightOfString(question.explanation, { width: textWidth, lineGap: 2 });
      const available = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
      const fitsBox = textHeight + 42 < available;
      ensureSpace(doc, Math.min(textHeight + 42, available));

      const y = doc.y + 6;
      if (fitsBox) {
        doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, textHeight + 30, 6).fill(SURFACE);
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(MUTED)
          .text('EXPLANATION', PAGE_MARGIN + 12, y + 8, { characterSpacing: 0.6 });
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(INK)
          .text(question.explanation, PAGE_MARGIN + 12, y + 21, {
            width: textWidth,
            lineGap: 2,
          });
        doc.y = y + textHeight + 30;
      } else {
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(MUTED)
          .text('EXPLANATION', PAGE_MARGIN, y, { characterSpacing: 0.6 });
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(INK)
          .text(question.explanation, PAGE_MARGIN, y + 13, { width: CONTENT_WIDTH, lineGap: 2 });
      }
    }

    const counts = votes.get(question.id) ?? {};
    const total = question.choices.reduce((sum, choice) => sum + (counts[choice.key] ?? 0), 0);
    const legendRows = Math.ceil(question.choices.length / 2);
    const voteBlockHeight = 28 + (total > 0 ? 9 + 7 + legendRows * 14 : 12);
    ensureSpace(doc, voteBlockHeight);
    doc.moveDown(0.55);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(ACCENT)
      .text(`COMMUNITY VOTE · ${total} ${total === 1 ? 'vote' : 'votes'}`, {
        characterSpacing: 0.45,
      });

    if (total > 0) {
      const barY = doc.y + 6;
      const barHeight = 9;
      doc.roundedRect(PAGE_MARGIN, barY, CONTENT_WIDTH, barHeight, 4.5).fill('#EEE9FF');
      let x = PAGE_MARGIN;
      question.choices.forEach((choice, choiceIndex) => {
        const value = counts[choice.key] ?? 0;
        if (value === 0) return;
        const width = (value / total) * CONTENT_WIDTH;
        doc.rect(x, barY, width, barHeight).fill(optionColor(choiceIndex));
        x += width;
      });
      doc.y = barY + barHeight + 7;

      const legendY = doc.y;
      const columns = 2;
      const columnWidth = CONTENT_WIDTH / columns;
      question.choices.forEach((choice, choiceIndex) => {
        const value = counts[choice.key] ?? 0;
        const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
        const column = choiceIndex % columns;
        const row = Math.floor(choiceIndex / columns);
        const lx = PAGE_MARGIN + column * columnWidth;
        const ly = legendY + row * 14;
        doc.circle(lx + 4, ly + 4, 3).fill(optionColor(choiceIndex));
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(INK)
          .text(`${choice.key}  ${percentage}%`, lx + 12, ly, { width: columnWidth - 48 });
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(MUTED)
          .text(`${value} ${value === 1 ? 'vote' : 'votes'}`, lx + columnWidth - 52, ly, {
            width: 50,
            align: 'right',
          });
      });
      doc.y = legendY + Math.ceil(question.choices.length / columns) * 14;
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('No community votes yet.');
    }

    if (index < questions.length - 1) {
      ensureSpace(doc, 20);
      doc
        .moveTo(PAGE_MARGIN, doc.y + 12)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 12)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      doc.y += 24;
    }
  });

  return doc;
}