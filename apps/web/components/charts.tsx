'use client';

import type { PerformancePoint, WeakTopic } from '@/lib/types';

export function LineChart({ data, height = 180 }: { data: PerformancePoint[]; height?: number }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-content-muted">Solve some questions to see your progress.</p>;
  }
  const width = 640;
  const pad = 24;
  const max = 100;
  const points = data.map((point, index) => {
    const x = data.length === 1 ? width / 2 : pad + (index / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - (point.accuracy / max) * (height - pad * 2);
    return { x, y, point };
  });
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Accuracy over time">
        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - pad - (tick / max) * (height - pad * 2);
          return (
            <g key={tick}>
              <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="currentColor" strokeOpacity="0.08" />
              <text x={4} y={y + 4} fontSize="10" fill="currentColor" opacity="0.4">{tick}</text>
            </g>
          );
        })}
        <polyline points={area} fill="url(#lineFill)" stroke="none" />
        <polyline points={line} fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <circle key={p.point.date} cx={p.x} cy={p.y} r="3.5" fill="#22d3ee">
            <title>{`${p.point.date}: ${p.point.accuracy}% (${p.point.questions} questions)`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-content-muted">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function WeakTopicsList({ topics }: { topics: WeakTopic[] }) {
  if (topics.length === 0) {
    return <p className="py-6 text-center text-sm text-content-muted">Answer more questions to unlock weak-topic analysis.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {topics.map((topic) => (
        <li key={topic.topic}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">{topic.topic}</span>
            <span className={topic.accuracy < 60 ? 'text-rose-500' : topic.accuracy < 80 ? 'text-amber-500' : 'text-emerald-500'}>
              {topic.accuracy}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-overlay">
            <div
              className={topic.accuracy < 60 ? 'h-full bg-rose-500' : topic.accuracy < 80 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
              style={{ width: `${Math.max(2, topic.accuracy)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-content-muted">{topic.attempts} attempts · {topic.questions} questions</p>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ value, size = 96 }: { value: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${clamped}%`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="8" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#donutGradient)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="donutGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.24} fontWeight="700" fill="currentColor">
        {clamped}%
      </text>
    </svg>
  );
}