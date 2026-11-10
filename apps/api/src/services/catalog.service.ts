import type { FilterQuery } from 'mongoose';
import type { CatalogExamDoc, CatalogProviderDoc } from '../db/models/index.js';
import { CatalogExam, CatalogProvider } from '../db/models/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export interface SearchExamsParams {
  q?: string;
  provider?: string;
  sort?: 'popular' | 'title' | 'questions' | 'newest';
  page?: number;
  pageSize?: number;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listProviders(): Promise<CatalogProviderDoc[]> {
  return CatalogProvider.find().sort({ title: 1 }).lean<CatalogProviderDoc[]>();
}

export async function getProviderById(id: string): Promise<CatalogProviderDoc | null> {
  return CatalogProvider.findOne({ $or: [{ providerId: id }, { slug: id }] }).lean<CatalogProviderDoc>();
}

export async function searchExams(params: SearchExamsParams) {
  const page = parsePage(params.page, params.pageSize);
  const filter: FilterQuery<CatalogExamDoc> = {};

  if (params.provider) {
    filter.$or = [{ providerId: params.provider }, { providerSlug: params.provider }];
  }
  if (params.q && params.q.trim()) {
    const rx = new RegExp(escapeRegex(params.q.trim()), 'i');
    const searchOr = [{ title: rx }, { code: rx }, { providerTitle: rx }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
      delete filter.$or;
    } else {
      filter.$or = searchOr;
    }
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    popular: { questionCount: -1 },
    title: { title: 1 },
    questions: { questionCount: -1 },
    newest: { syncedAt: -1 },
  };

  const [items, total] = await Promise.all([
    CatalogExam.find(filter)
      .sort(sortMap[params.sort ?? 'popular'])
      .skip(page.skip)
      .limit(page.limit)
      .lean<CatalogExamDoc[]>(),
    CatalogExam.countDocuments(filter),
  ]);

  return paginate(items, total, page);
}

export async function getProviderExamsFromCatalog(providerId: string) {
  return CatalogExam.find({
    $or: [{ providerId }, { providerSlug: providerId }],
  })
    .sort({ title: 1 })
    .lean<CatalogExamDoc[]>();
}

export async function getCatalogExam(providerId: string, examKey: string): Promise<CatalogExamDoc | null> {
  return CatalogExam.findOne({
    $or: [
      { providerId, $or: [{ key: examKey }, { code: examKey }] },
      { providerSlug: providerId, $or: [{ key: examKey }, { code: examKey }] },
    ],
  }).lean<CatalogExamDoc>();
}

export async function catalogCounts() {
  const [providers, exams, totalQuestions] = await Promise.all([
    CatalogProvider.countDocuments(),
    CatalogExam.countDocuments(),
    CatalogExam.aggregate<{ total: number }>([
      { $group: { _id: null, total: { $sum: '$questionCount' } } },
    ]),
  ]);
  return { providers, exams, totalQuestions: totalQuestions[0]?.total ?? 0 };
}