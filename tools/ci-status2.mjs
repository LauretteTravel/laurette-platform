const repo = 'LauretteTravel/laurette-platform';
const headers = { 'user-agent': 'laurette', accept: 'application/vnd.github+json' };
const runs = await (await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=6`, { headers })).json();
for (const r of runs.workflow_runs) {
  console.log(`${r.id}\t${r.name}\t${r.status}\t${r.conclusion}\t${r.head_sha.slice(0, 7)}\t${r.created_at}`);
}
console.log('--- workflows ---');
const wf = await (await fetch(`https://api.github.com/repos/${repo}/actions/workflows`, { headers })).json();
for (const w of wf.workflows || []) console.log(`${w.id}\t${w.name}\t${w.state}\t${w.path}`);
