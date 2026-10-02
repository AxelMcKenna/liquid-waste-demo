/** Wait for an actual HTTP response, rather than parsing Vite's coloured console URL. */
export function waitForPreview(server, url, { timeoutMs = 15_000, intervalMs = 100, request = fetch } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let retry;
    let output = '';
    const controller = new AbortController();
    const capture = (data) => { output = (output + String(data)).slice(-4000); };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Preview exited (${code}). ${output}`));
    const timeout = setTimeout(() => finish(new Error(`Preview did not respond within ${timeoutMs} ms. ${output}`)), timeoutMs);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(retry);
      controller.abort();
      server.stdout.off('data', capture);
      server.stderr.off('data', capture);
      server.off('error', onError);
      server.off('exit', onExit);
      if (error) reject(error); else resolve();
    }
    async function probe() {
      try {
        const response = await request(url, { signal: controller.signal });
        if (response.ok) { finish(); return; }
      } catch { /* Connection refused while Vite starts is expected; retry until the deadline. */ }
      if (!settled) retry = setTimeout(probe, intervalMs);
    }
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
    server.once('error', onError);
    server.once('exit', onExit);
    if (server.exitCode != null) onExit(server.exitCode);
    else void probe();
  });
}
