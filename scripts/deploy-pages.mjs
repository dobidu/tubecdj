// Publish dist/ to the gh-pages branch.
//
// Deploying from a branch rather than an Actions workflow keeps this working
// with a token that lacks the `workflow` scope. To switch to CI instead, run
// `gh auth refresh -s workflow`, commit .github/workflows/deploy.yml, and set
// the Pages build type back to "workflow".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOTE = 'https://github.com/dobidu/tubecdj.git';
const BRANCH = 'gh-pages';

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const work = mkdtempSync(join(tmpdir(), 'tubecdj-pages-'));
try {
  cpSync('dist', work, { recursive: true });
  writeFileSync(join(work, '.nojekyll'), '');   // keep files starting with _

  run('git', ['init', '-q'], work);
  run('git', ['checkout', '-q', '-b', BRANCH], work);
  run('git', ['add', '-A'], work);
  run('git', ['commit', '-q', '-m', `deploy: ${new Date().toISOString()}`], work);
  run('git', ['remote', 'add', 'origin', REMOTE], work);
  run('git', ['push', '-qf', 'origin', BRANCH], work);
  console.log(`publicado em ${BRANCH} → https://dobidu.github.io/tubecdj/`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
