const repo = 'LauretteTravel/laurette-platform';
const headers = { 'user-agent': 'laurette', accept: 'application/vnd.github+json' };
const runId = 40766241491;
const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`, { headers });
console.log('status', res.status);
const data = await res.json();
console.log('total_count', data.total_count);
for (const job of data.jobs || []) {
  console.log(`JOB ${job.name} => ${job.conclusion}`);
  for (const step of job.steps || []) console.log(`  ${step.number}. ${step.name}: ${step.conclusion}`);
}
if (!data.jobs?.length) console.log(JSON.stringify(data).slice(0, 500));
