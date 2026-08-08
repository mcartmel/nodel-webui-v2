import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAuditReport, verifyAuditReport } from './audit-policy.mjs';

export function runNpmAudit(cwd) { return new Promise((resolvePromise, reject) => { const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json', '--audit-level=high'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', code => resolvePromise({ code, stdout, stderr })); }); }
export async function verifyAudit({ projectRoot = process.cwd(), outputDir = resolve(projectRoot, 'build/dependency-evidence'), exceptionsPath = resolve(projectRoot, 'security/audit-exceptions.json'), auditResult } = {}) {
  await mkdir(outputDir, { recursive: true }); const result = auditResult ? (typeof auditResult === 'string' ? { code: 0, stdout: auditResult, stderr: '' } : { code: 0, stdout: JSON.stringify(auditResult), stderr: '' }) : await runNpmAudit(projectRoot); let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(`npm audit did not return JSON: ${result.stderr || result.stdout}`); }
  const normalized = normalizeAuditReport(report); await writeFile(resolve(outputDir, 'npm-audit.raw.json'), result.stdout); await writeFile(resolve(outputDir, 'npm-audit.normalized.json'), `${JSON.stringify(normalized, null, 2)}\n`);
  return verifyAuditReport(report, { exceptionsPath });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyAudit().then(report => console.log(JSON.stringify(report))).catch(error => { console.error(error.message); process.exitCode = 1; });
