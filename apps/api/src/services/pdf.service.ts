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
const INK = '#171233';
const MUTED = '#6B6280';
const PAPER = '#FFFFFF';
const SURFACE = '#F4F1FE';
const BORDER = '#E4DFF2';
const ACCENT = '#6D3BF5';
const ACCENT_SOFT = '#EEE9FF';
const GREEN = '#0D9469';
const GREEN_SOFT = '#E8F7F1';
const GREEN_INK = '#0B6B4C';
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

function contentBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > contentBottom(doc)) doc.addPage();
}

function drawFooter(doc: PDFKit.PDFDocument, examCode: string, pageNumber: number): void {
  const y = doc.page.height - 33;
  doc
    .moveTo(PAGE_MARGIN, y - 7)
    .lineTo(doc.page.width - PAGE_MARGIN, y - 7)
    .strokeColor(BORDER)
    .lineWidth(0.6)
    .stroke();

  const savedY = doc.y;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(`ExamDump Pro · ${examCode} · Complete question bank`, PAGE_MARGIN, y, {
      lineBreak: false,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(`Page ${pageNumber}`, PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
  doc.page.margins.bottom = savedBottom;
  doc.y = savedY;
}

function drawHeader(doc: PDFKit.PDFDocument, examCode: string): void {
  const y = 29;
  const savedY = doc.y;
  const savedTop = doc.page.margins.top;
  doc.page.margins.top = 0;
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(ACCENT)
    .text(`${examCode} · QUESTION BANK`, PAGE_MARGIN, y, { characterSpacing: 0.7, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(MUTED)
    .text('EXAMDUMP PRO', PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
  doc.page.margins.top = savedTop;
  doc.y = savedY;
  doc
    .moveTo(PAGE_MARGIN, 41)
    .lineTo(doc.page.width - PAGE_MARGIN, 41)
    .strokeColor(BORDER)
    .lineWidth(0.6)
    .stroke();
}

function pageChrome(
  doc: PDFKit.PDFDocument,
  examCode: string,
  pageNumber: number,
): void {
  if (pageNumber > 1) drawHeader(doc, examCode);
  drawFooter(doc, examCode, pageNumber);
}

function roundedLabel(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: { fill: string; color: string; width?: number; size?: number },
): void {
  const width = options.width ?? doc.widthOfString(text) + 16;
  const height = (options.size ?? 7) + 9;
  doc.roundedRect(x, y, width, height, height / 2).fill(options.fill);
  doc
    .font('Helvetica-Bold')
    .fontSize(options.size ?? 7)
    .fillColor(options.color)
    .text(text, x, y + (height - (options.size ?? 7)) / 2 + 0.5, {
      width,
      align: 'center',
      lineBreak: false,
    });
}

function drawCover(
  doc: PDFKit.PDFDocument,
  input: {
    examCode: string;
    examTitle: string;
    providerTitle: string;
    questions: NormalizedQuestion[];
    votes: VoteCounts;
  },
): void {
  const { examCode, examTitle, providerTitle, questions, votes } = input;
  const answered = questions.filter((question) => question.answer.trim()).length;
  const explained = questions.filter((question) => question.explanation.trim()).length;
  const withVotes = questions.filter((question) => {
    const counts = votes.get(question.id);
    return counts ? Object.values(counts).some((value) => value > 0) : false;
  }).length;

  doc.rect(0, 0, doc.page.width, 11).fill(ACCENT);
  doc.rect(0, 11, doc.page.width, 3).fill('#E3308C');

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(ACCENT)
    .text('EXAMDUMP PRO', PAGE_MARGIN, 57, { characterSpacing: 1.6 });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('CERTIFICATION QUESTION BANK', PAGE_MARGIN, 72, { characterSpacing: 1.2 });

  doc.save();
  doc.circle(doc.page.width - 105, 176, 62).fill('#F1ECFF');
  doc.circle(doc.page.width - 65, 145, 18).fill('#EDE4FF');
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(48).fillColor(INK).text(examCode, PAGE_MARGIN, 126, {
    width: CONTENT_WIDTH - 120,
  });
  doc
    .font('Helvetica')
    .fontSize(23)
    .fillColor(INK)
    .text(examTitle, PAGE_MARGIN, doc.y + 8, { width: CONTENT_WIDTH - 120 });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(providerTitle, PAGE_MARGIN, doc.y + 7);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      `Generated ${new Date().toISOString().slice(0, 10)} · Prepared for the access holder`,
      PAGE_MARGIN,
      doc.y + 12,
    );

  const statsY = 318;
  doc.roundedRect(PAGE_MARGIN, statsY, CONTENT_WIDTH, 100, 10).fill(SURFACE);
  const columns = [
    { value: String(questions.length), label: 'QUESTIONS' },
    { value: String(answered), label: 'VERIFIED ANSWERS' },
    { value: String(explained), label: 'EXPLANATIONS' },
    { value: String(withVotes), label: 'WITH VOTES' },
  ];
  const columnWidth = CONTENT_WIDTH / columns.length;
  columns.forEach((column, index) => {
    const x = PAGE_MARGIN + index * columnWidth;
    if (index > 0) {
      doc
        .moveTo(x, statsY + 22)
        .lineTo(x, statsY + 78)
        .strokeColor(BORDER)
        .lineWidth(0.6)
        .stroke();
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(INK)
      .text(column.value, x, statsY + 24, { width: columnWidth, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(MUTED)
      .text(column.label, x, statsY + 58, {
        width: columnWidth,
        align: 'center',
        characterSpacing: 0.6,
      });
  });

  const featuresY = 454;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT).text('WHAT IS INSIDE', PAGE_MARGIN, featuresY, {
    characterSpacing: 0.8,
  });
  const features = [
    'Every question in backend Question #: N order — never identified by title.',
    'Neatly formatted options with the verified correct answer highlighted.',
    'Readable explanations in their own section wherever the dataset provides one.',
    'Community vote distribution with percentages and vote counts for every option.',
  ];
  let featureY = featuresY + 17;
  for (const feature of features) {
    doc.circle(PAGE_MARGIN + 3, featureY + 4, 2.2).fill(ACCENT);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(feature, PAGE_MARGIN + 13, featureY, { width: CONTENT_WIDTH - 13, lineGap: 1.2 });
    featureY = doc.y + 6;
  }

  doc
    .roundedRect(PAGE_MARGIN, 594, CONTENT_WIDTH, 48, 8)
    .fill('#FBF9FF')
    .strokeColor(BORDER)
    .lineWidth(0.6)
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(ACCENT)
    .text('A4 · PRINT READY', PAGE_MARGIN + 14, 607, { characterSpacing: 0.5 });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('Designed for comfortable reading on screen and on paper.', PAGE_MARGIN + 14, 620, {
      width: CONTENT_WIDTH - 28,
    });
}

function questionBadgeNumber(question: NormalizedQuestion, index: number): string {
  return String(question.number ?? index + 1);
}

function drawQuestionHeader(
  doc: PDFKit.PDFDocument,
  question: NormalizedQuestion,
  index: number,
): void {
  const y = doc.y;
  doc.roundedRect(PAGE_MARGIN, y, 42, 42, 9).fill(ACCENT);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(PAPER)
    .text(questionBadgeNumber(question, index), PAGE_MARGIN, y + 13, {
      width: 42,
      align: 'center',
      lineBreak: false,
    });

  const typeLabel =
    question.type === 'multiple' || question.answer.length > 1
      ? 'Multiple answers'
      : question.type === 'dragdrop'
        ? 'Drag & drop'
        : 'Single answer';
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(INK)
    .text(question.id.toUpperCase(), PAGE_MARGIN + 56, y + 6, {
      width: CONTENT_WIDTH - 56,
      lineBreak: false,
    });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`${typeLabel} · ${question.choices.length} options`, PAGE_MARGIN + 56, y + 23, {
      width: CONTENT_WIDTH - 56,
    });
  doc.y = y + 54;
}

function optionText(question: NormalizedQuestion, index: number): string {
  const choice = question.choices[index];
  if (!choice) return '';
  return choice.text || '[Image option]';
}

function measureOption(
  doc: PDFKit.PDFDocument,
  question: NormalizedQuestion,
  index: number,
): { height: number; width: number; correct: boolean } {
  const choice = question.choices[index]!;
  const correct = question.answer.includes(choice.key);
  const width = CONTENT_WIDTH - (correct ? 86 : 42);
  doc.font('Helvetica').fontSize(10.2);
  const textHeight = doc.heightOfString(optionText(question, index), { width, lineGap: 1.6 });
  return { height: Math.max(28, textHeight + 14), width, correct };
}

function drawOption(
  doc: PDFKit.PDFDocument,
  question: NormalizedQuestion,
  index: number,
): void {
  const choice = question.choices[index]!;
  const correct = question.answer.includes(choice.key);
  const { height, width } = measureOption(doc, question, index);
  ensureSpace(doc, height + 8);
  const y = doc.y;

  doc
    .roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, height, 7)
    .fill(correct ? GREEN_SOFT : '#FCFBFF')
    .strokeColor(correct ? '#BDE9D6' : BORDER)
    .lineWidth(correct ? 0.9 : 0.6)
    .stroke();

  doc
    .roundedRect(PAGE_MARGIN + 8, y + 7, 20, 20, 5)
    .fill(correct ? GREEN : ACCENT_SOFT);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(correct ? PAPER : ACCENT)
    .text(choice.key, PAGE_MARGIN + 8, y + 12, { width: 20, align: 'center', lineBreak: false });

  doc
    .font(correct ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(10.2)
    .fillColor(correct ? GREEN_INK : INK)
    .text(optionText(question, index), PAGE_MARGIN + 36, y + 9, { width, lineGap: 1.6 });
  if (correct) {
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(GREEN)
      .text('CORRECT', PAGE_MARGIN + CONTENT_WIDTH - 58, y + 11, {
        width: 48,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.y = y + height + 7;
}

function drawCorrectAnswer(doc: PDFKit.PDFDocument, question: NormalizedQuestion): void {
  if (!question.answer.trim()) return;
  ensureSpace(doc, 28);
  const y = doc.y + 3;
  const answerText = question.answerText?.trim();
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(GREEN)
    .text('CORRECT ANSWER', PAGE_MARGIN, y, { characterSpacing: 0.5, lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(GREEN_INK)
    .text(
      `${question.answer}${answerText && answerText !== question.answer ? ` — ${answerText}` : ''}`,
      PAGE_MARGIN + 92,
      y - 1,
      { width: CONTENT_WIDTH - 92, lineGap: 1.4 },
    );
  doc.y = Math.max(doc.y + 5, y + 20);
}

function drawExplanation(doc: PDFKit.PDFDocument, question: NormalizedQuestion): void {
  if (!question.explanation.trim()) return;
  const textWidth = CONTENT_WIDTH - 28;
  doc.font('Helvetica').fontSize(9.4);
  const textHeight = doc.heightOfString(question.explanation, { width: textWidth, lineGap: 2 });
  const available = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  if (textHeight + 46 <= available) {
    ensureSpace(doc, textHeight + 46);
    const y = doc.y + 4;
    doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, textHeight + 38, 8).fill(SURFACE);
    doc.rect(PAGE_MARGIN, y, 3, textHeight + 38).fill(ACCENT);
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(ACCENT)
      .text('EXPLANATION', PAGE_MARGIN + 15, y + 11, { characterSpacing: 0.6 });
    doc
      .font('Helvetica')
      .fontSize(9.4)
      .fillColor(INK)
      .text(question.explanation, PAGE_MARGIN + 15, y + 24, { width: textWidth, lineGap: 2 });
    doc.y = y + textHeight + 38;
  } else {
    ensureSpace(doc, 70);
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(ACCENT)
      .text('EXPLANATION', PAGE_MARGIN, doc.y + 5, { characterSpacing: 0.6 });
    doc
      .font('Helvetica')
      .fontSize(9.4)
      .fillColor(INK)
      .text(question.explanation, PAGE_MARGIN, doc.y + 5, { width: CONTENT_WIDTH, lineGap: 2 });
  }
}

function drawVotes(
  doc: PDFKit.PDFDocument,
  question: NormalizedQuestion,
  counts: Record<string, number>,
): void {
  if (question.choices.length === 0) {
    ensureSpace(doc, 30);
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(ACCENT)
      .text('COMMUNITY VOTE', PAGE_MARGIN, doc.y + 6, { characterSpacing: 0.6 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('This question format has no option-based community voting.', PAGE_MARGIN, doc.y + 5, {
        width: CONTENT_WIDTH,
      });
    return;
  }

  const total = question.choices.reduce((sum, choice) => sum + (counts[choice.key] ?? 0), 0);
  const blockHeight = 28 + question.choices.length * 18;
  ensureSpace(doc, blockHeight);
  const startY = doc.y + 6;

  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(ACCENT)
    .text('COMMUNITY VOTE', PAGE_MARGIN, startY, { characterSpacing: 0.6 });
  roundedLabel(doc, `${total} ${total === 1 ? 'vote' : 'votes'}`, PAGE_MARGIN + 105, startY - 2, {
    fill: ACCENT_SOFT,
    color: ACCENT,
    size: 6.5,
  });

  let y = startY + 18;
  question.choices.forEach((choice, index) => {
    const value = counts[choice.key] ?? 0;
    const percentage = total > 0 ? (value / total) * 100 : 0;
    const trackX = PAGE_MARGIN + 24;
    const trackWidth = CONTENT_WIDTH - 24 - 92;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(INK)
      .text(choice.key, PAGE_MARGIN, y - 1, { width: 15, lineBreak: false });
    doc.roundedRect(trackX, y, trackWidth, 8, 4).fill('#EFEBFA');
    if (value > 0) {
      doc.rect(trackX, y, Math.max((percentage / 100) * trackWidth, 1.5), 8).fill(optionColor(index));
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(INK)
      .text(`${Math.round(percentage)}%`, trackX + trackWidth + 8, y - 1, {
        width: 30,
        align: 'right',
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`${value} ${value === 1 ? 'vote' : 'votes'}`, trackX + trackWidth + 42, y - 1, {
        width: 44,
        align: 'right',
        lineBreak: false,
      });
    y += 18;
  });
  doc.y = y + 2;
}

/**
 * Minimum vertical space a question needs to start without orphaning its
 * heading: the badge row, the first few lines of the stem, and the first
 * option card. Content after that may flow to the next page, but every option
 * card, the explanation box and the vote chart are each kept whole.
 */
function estimateQuestionStart(doc: PDFKit.PDFDocument, question: NormalizedQuestion): number {
  doc.font('Helvetica').fontSize(11.2);
  const stemHeight = doc.heightOfString(question.stemText, { width: CONTENT_WIDTH, lineGap: 2.2 });
  const firstOption = question.choices.length > 0 ? measureOption(doc, question, 0).height : 0;
  // Exact space for badge row + full stem + spacing + first option card, with a
  // small safety margin, so the first option never separates from its stem.
  return 54 + stemHeight + firstOption + 24;
}

function drawContinuation(doc: PDFKit.PDFDocument, label: string): void {
  const savedY = doc.y;
  const savedTop = doc.page.margins.top;
  doc.page.margins.top = 0;
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(MUTED)
    .text(`${label} · CONTINUED`, PAGE_MARGIN, 51, { characterSpacing: 0.5, lineBreak: false });
  doc.page.margins.top = savedTop;
  doc.y = Math.max(savedY, 66);
}

/**
 * Render the complete question bank. The caller streams the returned document.
 */
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
  let continuation: string | null = null;
  doc.on('pageAdded', () => {
    pageNumber += 1;
    pageChrome(doc, examCode, pageNumber);
    if (continuation) drawContinuation(doc, continuation);
  });
  pageChrome(doc, examCode, pageNumber);

  drawCover(doc, { examCode, examTitle, providerTitle, questions, votes });
  doc.addPage();

  questions.forEach((question, index) => {
    // Orphan control: never leave a question heading alone at the bottom of a
    // page. Once the heading starts, options flow naturally, but each option
    // card, the explanation and the vote chart stay whole.
    continuation = null;
    const fullPageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    ensureSpace(doc, Math.min(estimateQuestionStart(doc, question), fullPageHeight * 0.62));

    continuation = question.id;
    drawQuestionHeader(doc, question, index);
    doc.font('Helvetica').fontSize(11.2).fillColor(INK).text(question.stemText, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      lineGap: 2.2,
    });
    if (question.stemImages.length > 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(MUTED)
        .text('This question includes an exhibit or image in the online version.', {
          width: CONTENT_WIDTH,
        });
    }
    doc.moveDown(0.55);

    question.choices.forEach((_choice, optionIndex) => drawOption(doc, question, optionIndex));
    drawCorrectAnswer(doc, question);
    drawExplanation(doc, question);
    drawVotes(doc, question, votes.get(question.id) ?? {});
    continuation = null;

    if (index < questions.length - 1 && contentBottom(doc) - doc.y > 42) {
      doc
        .moveTo(PAGE_MARGIN, doc.y + 15)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 15)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      doc.y += 28;
    }
  });

  return doc;
}
