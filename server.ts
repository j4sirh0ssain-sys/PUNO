import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachMultiplayerServer } from './server/src/app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZIP_EXCLUDES = new Set(['node_modules', 'dist', '.git', '.aistudio']);

function buildProjectZip(zipOutPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pyScript = `
import os, zipfile
root = ${JSON.stringify(__dirname)}
out = ${JSON.stringify(zipOutPath)}
excludes = set(${JSON.stringify([...ZIP_EXCLUDES])})
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in excludes]
        for fn in filenames:
            if fn.endswith('.zip'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            zf.write(full, os.path.join('puno-project', rel))
`;
    execFile('python3', ['-c', pyScript], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  const app = express();
  const server = http.createServer(app);

  attachMultiplayerServer(app, server, { exposeRootHealth: false });

  app.get(['/api/download-project', '/puno-full-project.zip'], async (_req, res) => {
    try {
      const zipPath = '/tmp/puno-full-project.zip';
      await buildProjectZip(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="puno-full-project.zip"');
      res.sendFile(zipPath);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to package project zip.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use('/PUNO', express.static(distDir));
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found.');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`PUNO full-stack server listening on http://0.0.0.0:${port}`);
  });
}

void main();
