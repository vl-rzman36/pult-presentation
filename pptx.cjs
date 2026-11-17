const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
let queue = Promise.resolve();

function importPptx(filePath, cacheRoot) {
  // Office automation must be serialized, including overlapping restore/import requests.
  const job = queue.then(() => convert(filePath, cacheRoot));
  queue = job.catch(() => {});
  return job;
}
async function convert(filePath, cacheRoot) {
  const stat = await fs.stat(filePath);
  const key = crypto.createHash('sha256').update(`${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}:v1`).digest('hex');
  await fs.mkdir(cacheRoot, { recursive: true });
  const output = path.join(cacheRoot, `${key}.pdf`);
  try { const cached = await fs.readFile(output); if (cached.subarray(0, 5).toString() === '%PDF-') return cached; } catch { }
  const script = path.join(cacheRoot, 'pptx-export.ps1');
  await fs.writeFile(script, await fs.readFile(path.join(__dirname, 'pptx-export.ps1')));
  const temporary = path.join(cacheRoot, `${crypto.randomUUID()}.pdf`);
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
      env: { ...process.env, PULT_PPTX_INPUT: path.resolve(filePath), PULT_PPTX_OUTPUT: temporary },
    });
    const bytes = await fs.readFile(temporary);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
    await fs.rename(temporary, output);
    return bytes;
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw new Error(error.killed ? 'Подготовка PPTX заняла слишком долго. Откройте файл в PowerPoint или WPS и проверьте, нет ли диалога с запросом.' : 'Не удалось подготовить PPTX. Нужен установленный PowerPoint или WPS Office. Проверьте, что презентация открывается в нём без пароля; также можно сохранить её как PDF.');
  }
}
module.exports = { importPptx };
