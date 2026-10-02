// The per-file half of the coverage rule (#91, docs/RUNNING.md, Code
// coverage): every file under src/ keeps at least 95 % of its lines covered,
// so no task can add or touch a file and leave it under-tested. The totals
// are Vitest's own thresholds in vite.config.ts.
//
// Run after `vitest run --coverage` (npm run test:coverage does both). Prints
// a Markdown summary, also appended to the GitHub Actions job summary when
// GITHUB_STEP_SUMMARY is set, and exits 1 when a file is under the line.
import { appendFileSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

export const MIN_FILE_LINES = 95;

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const metrics = ['lines', 'statements', 'functions', 'branches'];
const pct = (value) => `${value.toFixed(2)} %`;

const files = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, data]) => ({ file: relative(process.cwd(), file).split(sep).join('/'), data }));
const under = files.filter(({ data }) => data.lines.pct < MIN_FILE_LINES);

const lines = [
  '## Unit test coverage',
  '',
  `| | ${metrics.join(' | ')} |`,
  `|---|${metrics.map(() => '---:').join('|')}|`,
  `| **All files** | ${metrics.map((m) => pct(summary.total[m].pct)).join(' | ')} |`,
  '',
];
if (under.length > 0) {
  lines.push(
    `**${under.length} file(s) under ${MIN_FILE_LINES} % of lines covered:**`,
    '',
    '| File | lines |',
    '|---|---:|',
    ...under.map(({ file, data }) => `| \`${file}\` | ${pct(data.lines.pct)} |`),
  );
} else {
  lines.push(`Every one of the ${files.length} files has at least ${MIN_FILE_LINES} % of its lines covered.`);
}
const report = lines.join('\n') + '\n';

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
process.exit(under.length > 0 ? 1 : 0);
