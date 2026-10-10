// A small in-process S3-compatible server (path-style /bucket/key) standing in for Cloudflare R2 in tests:
// one bucket, one accepted access key, and the store's own error codes for anything else. No signature checks.
import { createServer } from 'node:http';

export async function startFakeS3({ bucket = 'factoryos-test', accessKeyId = 'AKIDFACTORYOS' } = {}) {
  const objects = new Map();
  const xml = (res, status, code, message) => {
    res.writeHead(status, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const auth = req.headers.authorization ?? '';
    if (!auth.includes(`Credential=${accessKeyId}/`)) return xml(res, 403, 'InvalidAccessKeyId', 'The access key ID you provided does not exist in our records.');
    const [, b, ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/');
    if (b !== bucket) return xml(res, 404, 'NoSuchBucket', 'The specified bucket does not exist.');
    const key = rest.join('/');
    if (req.method === 'PUT') {
      objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
      res.writeHead(200, { ETag: '"etag"' });
      return res.end();
    }
    if (req.method === 'GET') {
      const o = objects.get(key);
      if (!o) return xml(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      res.writeHead(200, { 'Content-Type': o.type ?? 'application/octet-stream', 'Content-Length': o.body.length });
      return res.end(o.body);
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    xml(res, 405, 'MethodNotAllowed', req.method);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, bucket, accessKeyId, objects, close: () => server.close() };
}
