'use client';

import { useId } from 'react';
import type { PerformancePoint, WeakTopic } from '@/lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Unique, CSS-safe id for gradient references.
 *
 * `useId()` is unique but historically contains characters (`:`, «» ) that are
 * awkward or invalid inside `url(#…)`, so they are stripped. The distinguishing
 * part of the id is alphanumeric, so stripping punctuation keeps it unique.
 */
function useSafeId(): string {
  return `chart-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * Format an API `YYYY-MM-DD` date without going through `Date`.
 *
 * The series arrives as a plain calendar day. Parsing it as a date and then
 * formatting it would render differently on the server and in a browser with a
 * different timezone (the classic hydration mismatch), so the label is built
 * from the string itself.
 */
function shortDate(value: string | undefined): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !month || !day || Number.isNaN(monthIndex) || !MONTHS[monthIndex]) return value;
  return `${Number(day)} ${MONTHS[monthIndex]}`;
}

/**
 * Daily accuracy trend.
 *
 * The plot is a stretched SVG but every label is real HTML, so axis text stays
 * at a readable size on a 360 px phone instead of being scaled down with the
 * viewBox. The whole series is also exposed as a visually hidden table, which
 * is the accessible representation — the SVG itself is decorative.
 */
export function LineChart({ data, height = 180 }: { data: PerformancePoint[]; height?: number }) {
  const gradientId = useSafeId();

  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-content-muted">Solve some questions to see your progress.</p>;
  }

  const width = 640;
  const padX = 10;
  const padY = 18;
  const max = 100;
  const ticks = [100, 75, 50, 25, 0];

  const yFor = (value: number) => height - padY - (value / max) * (height - padY * 2);
  const xFor = (index: number) =>
    data.length === 1 ? width / 2 : padX + (index / (data.length - 1)) * (width - padX * 2);

  const points = data.map((point, index) => ({ x: xFor(index), y: yFor(point.accuracy), point }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${points[0]!.x},${height - padY} ${line} ${points[points.length - 1]!.x},${height - padY}`;
  const lastDate = shortDate(data[data.length - 1]?.date);

  return (
    <figure className="w-full">
      <div className="flex gap-1.5">
        {/* Y axis: real text, positioned over its own gridline. */}
        <div className="relative w-7 shrink-0" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="numeric absolute right-0 -translate-y-1/2 text-[0.625rem] leading-none text-content-muted"
              style={{ top: `${(yFor(tick) / height) * 100}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full min-w-0 flex-1"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => {
            const y = yFor(tick);
            return (
              <line
                key={tick}
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke="rgb(var(--surface-border))"
                strokeWidth="1"
                strokeDasharray={tick === 0 ? undefined : '4 6'}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <polyline points={area} fill={`url(#${gradientId})`} stroke="none" />
          <polyline
            points={line}
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth="2.25"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p) => (
            <g key={p.point.date}>
              <circle cx={p.x} cy={p.y} r="4.5" fill="rgb(var(--surface-raised))" />
              <circle cx={p.x} cy={p.y} r="2.6" fill="rgb(var(--accent))">
                <title>{`${p.point.date}: ${p.point.accuracy}% accuracy (${p.point.questions} questions, ${p.point.attempts} attempts)`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-1.5 flex justify-between pl-[2.125rem] text-[0.6875rem] text-content-muted" aria-hidden="true">
        <span>{shortDate(data[0]?.date)}</span>
        <span>{lastDate}</span>
      </div>

      <table className="sr-only">
        <caption>
          Daily accuracy{data.length > 1 ? ` from ${shortDate(data[0]?.date)} to ${lastDate}` : ` on ${lastDate}`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Accuracy</th>
            <th scope="col">Questions</th>
            <th scope="col">Attempts</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{point.accuracy}%</td>
              <td>{point.questions}</td>
              <td>{point.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Accuracy banding shared by the weak-topic list. */
function topicTone(accuracy: number): { label: string; color: string; text: string } {
  if (accuracy < 60) return { label: 'Needs work', color: 'rgb(var(--danger))', text: 'text-negative' };
  if (accuracy < 80) return { label: 'Shaky', color: 'rgb(var(--warning))', text: 'text-caution' };
  return { label: 'Solid', color: 'rgb(var(--success))', text: 'text-positive' };
}

export function WeakTopicsList({ topics }: { topics: WeakTopic[] }) {
  if (topics.length === 0) {
    return <p className="py-6 text-center text-sm text-content-muted">Answer more questions to unlock weak-topic analysis.</p>;
  }
  return (
    <ul className="flex flex-col gap-3.5">
      {topics.map((topic) => {
        const tone = topicTone(topic.accuracy);
        return (
          <li key={topic.topic} className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary">{topic.topic}</span>
              <span className={`text-xs font-medium ${tone.text}`}>{tone.label}</span>
              <span className={`numeric text-sm font-bold ${tone.text}`}>{topic.accuracy}%</span>
            </div>
            <div className="progress-track h-2" aria-hidden="true">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-smooth"
                style={{ width: `${Math.max(2, Math.min(100, topic.accuracy))}%`, backgroundColor: tone.color }}
              />
            </div>
            <p className="mt-1 text-xs text-content-muted">
              {topic.correct} of {topic.attempts} correct · {topic.questions} questions
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function Donut({ value, size = 96 }: { value: number; size?: number }) {
  const gradientId = useSafeId();
  const stroke = Math.max(6, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const offset = circumference - (clamped / 100) * circumference;
  const end = clamped >= 80 ? 'rgb(var(--success))' : clamped >= 60 ? 'rgb(var(--warning))' : 'rgb(var(--danger))';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 overflow-visible"
      role="img"
      aria-label={`${clamped}% accuracy`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(var(--surface-inset))"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-700 ease-smooth"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" />
          <stop offset="100%" stopColor={end} />
        </linearGradient>
      </defs>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.24}
        fontWeight="700"
        fill="rgb(var(--content-primary))"
      >
        {clamped}%
      </text>
    </svg>
  );
}
