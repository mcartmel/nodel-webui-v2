import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const severities = new Set(['low', 'moderate', 'high', 'critical']);
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ascii = value => typeof value === 'string' && /^[\x20-\x7e]{1,240}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const error = message => { throw new Error(message); };

function advisoryId(v) { return typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v) ? v : null; }
export function normalizeAuditReport(report) {
  if (!record(report) || report.auditReportVersion !== 2 || !record(report.vulnerabilities)) error('npm audit output must be auditReportVersion 2');
  const findings = [];
  for (const [packageName, item] of Object.entries(report.vulnerabilities)) {
    if (!record(item) || !severities.has(item.severity)) error(`Malformed npm audit vulnerability: ${packageName}`);
    for (const via of item.via ?? []) {
      if (!record(via)) continue;
      const id = advisoryId(via.source ?? via.id);
      if (!id) error(`Malformed npm audit advisory for ${packageName}`);
      findings.push({ advisory: id, package: packageName, severity: item.severity, title: typeof via.title === 'string' ? via.title : '', url: typeof via.url === 'string' ? via.url : '' });
    }
  }
  return findings.sort((a, b) => a.package.localeCompare(b.package) || a.advisory.localeCompare(b.advisory) || a.severity.localeCompare(b.severity));
}

export async function loadAuditExceptions(path = resolve(process.cwd(), 'security/audit-exceptions.json'), now = new Date()) {
  let value; try { value = JSON.parse(await readFile(path, 'utf8')); } catch { error('audit-exceptions.json is not valid JSON'); }
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.exceptions)) error('audit-exceptions.json schema is invalid');
  const seen = new Set(); const valid = [];
  for (const exception of value.exceptions) {
    if (!record(exception) || Object.keys(exception).sort().join('\0') !== ['advisory', 'expires', 'owner', 'package', 'reason', 'severity'].join('\0')
      || !ascii(exception.package) || !ascii(exception.reason) || !ascii(exception.owner) || !advisoryId(exception.advisory)
      || !severities.has(exception.severity) || !utc.test(exception.expires) || Number.isNaN(Date.parse(exception.expires))) error('Malformed audit exception');
    const key = `${exception.package}\0${exception.advisory}`;
    if (seen.has(key)) error(`Duplicate audit exception: ${key}`); seen.add(key);
    if (Date.parse(exception.expires) <= now.getTime()) error(`Expired audit exception: ${key}`);
    valid.push(exception);
  }
  return valid;
}

export async function verifyAuditReport(report, { exceptionsPath, now = new Date() } = {}) {
  const findings = normalizeAuditReport(report); const exceptions = await loadAuditExceptions(exceptionsPath, now);
  const matched = new Set(); const blocking = []; const lower = [];
  for (const finding of findings) {
    const exception = exceptions.find(candidate => candidate.package === finding.package && candidate.advisory === finding.advisory && candidate.severity === finding.severity);
    if (exception) matched.add(`${exception.package}\0${exception.advisory}`);
    else if (finding.severity === 'high' || finding.severity === 'critical') blocking.push(finding); else lower.push(finding);
  }
  const unmatched = exceptions.filter(exception => !matched.has(`${exception.package}\0${exception.advisory}`));
  if (unmatched.length) error(`Unmatched audit exception: ${unmatched.map(item => `${item.package}/${item.advisory}`).join(', ')}`);
  if (blocking.length) error(`Unmatched high/critical npm audit findings: ${blocking.map(item => `${item.package}/${item.advisory} (${item.severity})`).join(', ')}`);
  return { findings, lower, exceptions, matched: [...matched].sort() };
}
