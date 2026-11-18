/**
 * Fetch a full question paper without imposing a total cap.
 *
 * The API pages by `limit`/`offset`; this helper follows those pages until the
 * requested count is reached or the server has no more accessible questions.
 * It never reorders or deduplicates by title — identity and order stay exactly
 * as the backend returned them.
 */
export async function loadAllQuestionPages<T>(
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<{ questions: T[]; accessible: number }>,
  target: number | null | undefined,
  pageSize = 200,
): Promise<T[]> {
  const collected: T[] = [];
  let offset = 0;

  while (true) {
    const remaining = target && target > 0 ? target - collected.length : pageSize;
    if (remaining <= 0) break;
    const limit = Math.min(pageSize, remaining);

    const page = await fetchPage(offset, limit);
    collected.push(...page.questions);
    offset += page.questions.length;

    if (page.questions.length === 0) break;
    if (page.questions.length < limit) break;
    if (target && target > 0 && collected.length >= target) break;
    if (offset >= page.accessible) break;
  }

  return collected;
}