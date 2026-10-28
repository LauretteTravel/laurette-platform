const repo = 'LauretteTravel/laurette-platform';
const headers = { 'user-agent': 'laurette', accept: 'application/vnd.github+json' };

const runs = await (await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers })).json();
const run = runs.workflow_runs[0];
console.log('run', run.id, run.name, run.conclusion, run.head_sha.slice(0, 7));

const jobs = await (await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs`, { headers })).json();
for (const job of jobs.jobs) {
  console.log(`\nJOB ${job.name} => ${job.conclusion} (${job.runner_name || ''})`);
  for (const step of job.steps) console.log(`  ${step.number}. ${step.name}: ${step.conclusion}`);
}
const logs = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run.id}/logs`, { headers });
console.log('\nlogs status', logs.status, logs.headers.get('content-type'));
