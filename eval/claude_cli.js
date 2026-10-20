// One Claude pass, blind: no tools, no project files, through the Claude CLI. Shared by eval/checkpoint.js and eval/week_discover.js.
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
function claude(prompt, model = 'sonnet') {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    const p = spawn('claude', ['-p', '--safe-mode', '--model', model, '--tools', '', '--output-format', 'text',
      '--system-prompt', 'Follow the instructions in the message exactly. Reply with only the JSON object it asks for.'], { cwd });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
    p.on('close', code => { clearTimeout(t); if (code) return reject({ code: 'cli', message: err.slice(0, 300) }); resolve(out) });
    p.stdin.end(prompt);
  });
}
module.exports = { claude };
