'use client';

import type { Question } from '@/lib/types';
import { CommunityVote } from './community-vote';
import { QuestionDiscussion } from './question-discussion';

export function QuestionCommunity({
  question,
  providerId,
  examKey,
}: {
  question: Question;
  providerId: string;
  examKey: string;
}) {
  return (
    <div className="mt-6 max-w-[68ch] space-y-3">
      <CommunityVote question={question} providerId={providerId} examKey={examKey} />
      <QuestionDiscussion questionId={question.id} providerId={providerId} examKey={examKey} />
    </div>
  );
}