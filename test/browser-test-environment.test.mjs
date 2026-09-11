import { describe, expect, it } from 'vitest';
import { assertSupportedHost, buildDockerArgs } from '../scripts/run-browser-tests.mjs';

const baseOptions = {
  args: ['--project=chromium-light-desktop'],
  environment: {},
  executablePath: '/usr/bin/node',
  gid: 1000,
  npmVersion: '11.12.1',
  projectRoot: '/workspace',
  uid: 1000
};

describe('browser test environment wrapper', () => {
  it('accepts only the Linux x64 ELF host required by the mounted Node toolchain', () => {
    expect(() => assertSupportedHost('linux', 'x64', 'elf64-x86-64')).not.toThrow();
    expect(() => assertSupportedHost('darwin', 'x64', 'unknown')).toThrow(/Linux x64 host.*Linux x64 VM/);
    expect(() => assertSupportedHost('win32', 'x64', 'unknown')).toThrow(/Linux x64 host/);
    expect(() => assertSupportedHost('linux', 'arm64', 'unsupported-elf')).toThrow(/linux\/arm64/);
    expect(() => assertSupportedHost('linux', 'x64', 'unknown')).toThrow(/unknown/);
  });

  it('constructs a nonroot pinned invocation without host networking', () => {
    const args = buildDockerArgs(baseOptions);
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--init', '--ipc=host']);
    expect(args).toContain('linux/amd64');
    expect(args).toContain('1000:1000');
    expect(args).toContain('/usr/bin/node:/opt/nodel-node:ro');
    expect(args).not.toContain('--network=host');
    expect(args.at(-1)).toBe('--project=chromium-light-desktop');
  });

  it('preserves Playwright arguments without shell evaluation', () => {
    const argument = '--grep=dialog; touch /tmp/not-run';
    const args = buildDockerArgs({ ...baseOptions, args: [argument] });
    expect(args.at(-1)).toBe(argument);
    expect(args).not.toContain('sh');
    expect(args).not.toContain('-c');
  });

  it('enables host networking only for allowlisted deployment smoke variables', () => {
    const unrelated = buildDockerArgs({ ...baseOptions, environment: { UNRELATED_SECRET: 'hidden' } });
    expect(unrelated).not.toContain('--network=host');
    expect(unrelated.join('\n')).not.toContain('hidden');

    const deployment = buildDockerArgs({
      ...baseOptions,
      environment: {
        DEPLOYMENT_SMOKE_PREVIEW_URL: 'http://127.0.0.1:4100',
        UNRELATED_SECRET: 'hidden'
      }
    });
    expect(deployment).toContain('--network=host');
    expect(deployment).toContain('DEPLOYMENT_SMOKE_PREVIEW_URL=http://127.0.0.1:4100');
    expect(deployment.join('\n')).not.toContain('hidden');
  });
});
