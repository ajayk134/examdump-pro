import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { ATTEMPT_STATUS, QUESTION_MODES, type AttemptStatus, type QuestionMode } from '@examdump/shared';

export interface AttemptAnswer {
  questionId: string;
  selected: string[];
  correct: boolean;
  timeSpentMs: number;
}

export interface AttemptDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  providerTitle: string;
  examKey: string;
  examCode: string;
  mode: QuestionMode;
  status: AttemptStatus;
  questionIds: string[];
  answers: AttemptAnswer[];
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  scorePercent: number;
  timeLimitSeconds?: number | null;
  timeSpentMs: number;
  startedAt: Date;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const attemptSchema = new Schema<AttemptDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    providerId: { type: String, required: true },
    providerTitle: { type: String, default: '' },
    examKey: { type: String, required: true },
    examCode: { type: String, required: true },
    mode: { type: String, enum: QUESTION_MODES, default: 'practice' },
    status: { type: String, enum: ATTEMPT_STATUS, default: 'in_progress', index: true },
    questionIds: { type: [String], default: [] },
    answers: {
      type: [
        new Schema<AttemptAnswer>(
          {
            questionId: { type: String, required: true },
            selected: { type: [String], default: [] },
            correct: { type: Boolean, default: false },
            timeSpentMs: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    totalQuestions: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    scorePercent: { type: Number, default: 0 },
    timeLimitSeconds: { type: Number, default: null },
    timeSpentMs: { type: Number, default: 0 },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

attemptSchema.index({ userId: 1, createdAt: -1 });
attemptSchema.index({ userId: 1, examKey: 1, createdAt: -1 });
attemptSchema.index({ userId: 1, status: 1 });

export const Attempt: Model<AttemptDoc> =
  (mongoose.models.Attempt as Model<AttemptDoc>) ?? mongoose.model<AttemptDoc>('Attempt', attemptSchema);

export interface QuestionResultDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  examKey: string;
  questionId: string;
  topic: string;
  attempts: number;
  correct: number;
  lastCorrect: boolean;
  lastAttemptAt: Date;
}

const questionResultSchema = new Schema<QuestionResultDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: String, required: true },
    examKey: { type: String, required: true },
    questionId: { type: String, required: true },
    topic: { type: String, default: 'General' },
    attempts: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    lastCorrect: { type: Boolean, default: false },
    lastAttemptAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

questionResultSchema.index({ userId: 1, examKey: 1, questionId: 1 }, { unique: true });
questionResultSchema.index({ userId: 1, topic: 1 });

export const QuestionResult: Model<QuestionResultDoc> =
  (mongoose.models.QuestionResult as Model<QuestionResultDoc>) ??
  mongoose.model<QuestionResultDoc>('QuestionResult', questionResultSchema);

export interface ExamProgressDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  examKey: string;
  examCode: string;
  questionsSeen: number;
  questionsCorrect: number;
  questionsWrong: number;
  attempts: number;
  bestScore: number;
  lastStudiedAt: Date;
}

const examProgressSchema = new Schema<ExamProgressDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: String, required: true },
    examKey: { type: String, required: true },
    examCode: { type: String, default: '' },
    questionsSeen: { type: Number, default: 0 },
    questionsCorrect: { type: Number, default: 0 },
    questionsWrong: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    lastStudiedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

examProgressSchema.index({ userId: 1, examKey: 1 }, { unique: true });
examProgressSchema.index({ userId: 1, lastStudiedAt: -1 });

export const ExamProgress: Model<ExamProgressDoc> =
  (mongoose.models.ExamProgress as Model<ExamProgressDoc>) ??
  mongoose.model<ExamProgressDoc>('ExamProgress', examProgressSchema);

export interface UserStatsDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  totalQuestions: number;
  totalCorrect: number;
  totalStudyMs: number;
  mockTests: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  updatedAt: Date;
}

const userStatsSchema = new Schema<UserStatsDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalQuestions: { type: Number, default: 0 },
    totalCorrect: { type: Number, default: 0 },
    totalStudyMs: { type: Number, default: 0 },
    mockTests: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

userStatsSchema.index({ totalCorrect: -1 });

export const UserStats: Model<UserStatsDoc> =
  (mongoose.models.UserStats as Model<UserStatsDoc>) ??
  mongoose.model<UserStatsDoc>('UserStats', userStatsSchema);

export interface BookmarkDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  examKey: string;
  questionId: string;
  createdAt: Date;
}

const bookmarkSchema = new Schema<BookmarkDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: String, required: true },
    examKey: { type: String, required: true },
    questionId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

bookmarkSchema.index({ userId: 1, examKey: 1, questionId: 1 }, { unique: true });
bookmarkSchema.index({ userId: 1, createdAt: -1 });

export const Bookmark: Model<BookmarkDoc> =
  (mongoose.models.Bookmark as Model<BookmarkDoc>) ??
  mongoose.model<BookmarkDoc>('Bookmark', bookmarkSchema);

export interface NoteDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  examKey: string;
  questionId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<NoteDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: String, required: true },
    examKey: { type: String, required: true },
    questionId: { type: String, required: true },
    body: { type: String, required: true, maxlength: 5000 },
  },
  { timestamps: true },
);

noteSchema.index({ userId: 1, examKey: 1, questionId: 1 }, { unique: true });
noteSchema.index({ userId: 1, updatedAt: -1 });

export const Note: Model<NoteDoc> =
  (mongoose.models.Note as Model<NoteDoc>) ?? mongoose.model<NoteDoc>('Note', noteSchema);

export interface DailyUsageDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  questionsViewed: number;
  mockExams: number;
  randomQuestions: number;
  aiExplanations: number;
}

const dailyUsageSchema = new Schema<DailyUsageDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    questionsViewed: { type: Number, default: 0 },
    mockExams: { type: Number, default: 0 },
    randomQuestions: { type: Number, default: 0 },
    aiExplanations: { type: Number, default: 0 },
  },
  { timestamps: true },
);

dailyUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyUsage: Model<DailyUsageDoc> =
  (mongoose.models.DailyUsage as Model<DailyUsageDoc>) ??
  mongoose.model<DailyUsageDoc>('DailyUsage', dailyUsageSchema);