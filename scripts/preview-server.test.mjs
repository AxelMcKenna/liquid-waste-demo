import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForPreview } from './preview-server.mjs';

const processDouble = () => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null });
const url = 'http://localhost:4179';

describe('preview readiness without local sockets', () => {
  it('waits for a successful HTTP response even when output is coloured and split', async () => {
    const server = processDouble();
    const request = vi.fn().mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    const ready = waitForPreview(server, url, { request, intervalMs: 1 });
    server.stdout.emit('data', '\u001b[36mhttp://local');
    server.stdout.emit('data', 'host:\u001b[1m4179\u001b[22m/\u001b[39m');
    await ready;
    expect(request).toHaveBeenCalledTimes(3);
    expect(server.listenerCount('exit')).toBe(0);
  });

  it('does not accept a printed URL as evidence the server is ready', async () => {
    const server = processDouble();
    const request = vi.fn().mockResolvedValue({ ok: false });
    const ready = waitForPreview(server, url, { request, timeoutMs: 15, intervalMs: 1 });
    server.stdout.emit('data', url);
    await expect(ready).rejects.toThrow('Preview did not respond');
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('reports process failure and captured diagnostics immediately', async () => {
    const server = processDouble();
    const ready = waitForPreview(server, url, { request: () => new Promise(() => {}) });
    server.stderr.emit('data', 'Port already in use');
    server.emit('exit', 1);
    await expect(ready).rejects.toThrow('Preview exited (1). Port already in use');
    expect(server.stdout.listenerCount('data')).toBe(0);
  });

  it('bounds a hung HTTP request and aborts it', async () => {
    const server = processDouble();
    let signal;
    const request = (_url, options) => { signal = options.signal; return new Promise(() => {}); };
    await expect(waitForPreview(server, url, { request, timeoutMs: 10 })).rejects.toThrow('Preview did not respond');
    expect(signal.aborted).toBe(true);
  });
});
