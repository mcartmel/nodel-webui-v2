import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchNodeUrls } from '../src/api/node-discovery';
import capture from './fixtures/java-discovery-contract.json';

describe('pinned Java discovery contract: HTTP advertisements only', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ties the capture to the pinned Java archive and checked-in generator', () => {
    const { provenance } = capture;
    expect(provenance.repository).toBe('museumsvictoria/nodel');
    expect(provenance.commit).toBe('19756071383d696682688ab436c77c0a1f80c783');
    expect(provenance.archiveSha256).toBe('f869217a18515266fdab441fb1bf8591b1baa12ef935d341878ac5ecb59b4a3d');
    for (const [path, hash] of [
      [provenance.harness, provenance.harnessSha256],
      ['scripts/generate-java-discovery-contract.mjs', provenance.generatorSha256]
    ] as const) {
      expect(createHash('sha256').update(readFileSync(resolve(path))).digest('hex')).toBe(hash);
    }
  });

  it('captures both advertisements in allNodes, but not their logical names', () => {
    expect(capture.inputs.localNodes).toEqual([]);
    expect(capture.inputs.bindingReferences).toEqual([]);
    expect(capture.inputs.advertisements).toEqual([
      { name: 'Contract HTTP Control', addresses: ['http://192.0.2.10:8085/nodes/%NODE%'], timeStamp: 1000 },
      { name: 'Contract Isolated TCP', addresses: ['tcp://192.0.2.11:8086'], timeStamp: 1000 }
    ]);
    expect(capture.inputs.requests.allNodes).toEqual({ method: 'GET', path: '/REST/allNodes', body: null });
    const { allNodes } = capture.responses;
    expect(allNodes.statusLine).toBe('HTTP/1.1 200 OK ');
    expect(allNodes.contentType).toBe('application/json; charset=utf-8');
    expect(allNodes.cors).toBe('*');
    const body: unknown = JSON.parse(allNodes.body);
    const anonymousEntry = /^org\.nodel\.discovery\.AdvertisementInfo@[0-9a-f]{1,8}$/;
    expect(body).toEqual([expect.stringMatching(anonymousEntry), expect.stringMatching(anonymousEntry)]);
  });

  it('decodes only the HTTP control from the emitted unfiltered nodeURLs response', async () => {
    const request = capture.inputs.requests.nodeURLs;
    expect(request).toEqual({
      method: 'POST', path: '/REST/nodeURLs', contentType: 'application/json', body: '{"filter":""}'
    });
    const { nodeURLs } = capture.responses;
    expect(nodeURLs.statusLine).toBe('HTTP/1.1 200 OK ');
    expect(nodeURLs.contentType).toBe('application/json; charset=utf-8');
    expect(nodeURLs.cors).toBe('*');
    expect(nodeURLs.body).toBe('[{"address":"http://192.0.2.10:8085/nodes/ContractHTTPControl","node":"Contract HTTP Control"}]');
    const fetchMock = vi.fn().mockResolvedValue(new Response(nodeURLs.body, {
      status: 200,
      headers: { 'Content-Type': nodeURLs.contentType }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchNodeUrls('')).resolves.toEqual([
      { node: 'Contract HTTP Control', address: 'http://192.0.2.10:8085/nodes/ContractHTTPControl/' }
    ]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(request.path, expect.objectContaining({
      method: request.method, body: request.body
    }));
  });
});
