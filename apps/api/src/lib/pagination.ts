import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@examdump/shared';

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  limit: number;
}

export function parsePage(page?: number, pageSize?: number): PageParams {
  const safePage = Math.max(1, page ?? 1);
  const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? DEFAULT_PAGE_SIZE));
  return { page: safePage, pageSize: safeSize, skip: (safePage - 1) * safeSize, limit: safeSize };
}

export interface Paginated<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function paginate<T>(items: T[], total: number, params: PageParams): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  return {
    items,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages,
      hasNext: params.page < totalPages,
      hasPrev: params.page > 1,
    },
  };
}