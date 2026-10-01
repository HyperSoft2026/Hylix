#!/usr/bin/env node
/**
 * ============================================================================
 * Hylix Engine & Editor — Standalone Repository Relay Server (server.js)
 * Organization : HyperSoft
 * Application  : com.hypersoft.hylix
 * Public Host  : 51.75.118.169:20040
 * Repository   : https://github.com/HyperSoft2026/Hylix
 * ============================================================================
 *
 * Architecture Pipeline:
 *   User (Browser)
 *     -> Internet
 *     -> Hylix Relay Server (51.75.118.169:20040, running ONLY /server.js)
 *     -> GitHub Repository (https://github.com/HyperSoft2026/Hylix)
 *     -> Hylix Relay Server (RAM-only TypeScript/JSX Transpilation & Stream)
 *     -> User (Browser)
 *
 * Guarantees:
 * - Universal Node.js script (runs standalone at /server.js without package.json
 *   AND inside ESM repositories with "type": "module").
 * - Zero external npm dependencies required on the server (100% Node.js built-ins).
 * - Zero local repository files stored on the server disk (only /server.js exists at /).
 * - All source files, assets, and docs are fetched on-demand from GitHub into RAM.
 */

(async () => {
  const http = await import('node:http');
  const https = await import('node:https');
  const path = await import('node:path');
  const vm = await import('node:vm');

  const GITHUB_OWNER = process.env.HYLIX_GITHUB_OWNER || 'HyperSoft2026';
  const GITHUB_REPO = process.env.HYLIX_GITHUB_REPO || 'Hylix';
  const GITHUB_BRANCH = process.env.HYLIX_GITHUB_BRANCH || 'main';
  const PUBLIC_HOST = process.env.HYLIX_PUBLIC_HOST || '51.75.118.169';
  const LISTEN_PORT = Number(
    process.env.SERVER_PORT || process.env.PORT || process.env.HYLIX_PUBLIC_PORT || 20040
  );
  const LISTEN_HOST = '0.0.0.0';

  const RAW_GITHUB_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
  const API_GITHUB_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

  // Short-lived in-memory cache (RAM only, never touches disk)
  const CACHE_TTL_MS = Number(process.env.HYLIX_CACHE_TTL_MS || 30_000);
  const memoryCache = new Map();

  let tsCompiler = null;
  let tsCompilerLoadingPromise = null;

  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.ts': 'application/javascript; charset=utf-8',
    '.tsx': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.xml': 'application/xml; charset=utf-8',
    '.kts': 'text/plain; charset=utf-8',
    '.kt': 'text/plain; charset=utf-8',
    '.pro': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };

  /**
   * Performs an HTTPS GET request and returns { statusCode, headers, buffer }.
   */
  function fetchHttpsBuffer(targetUrl, extraHeaders = {}, redirectDepth = 0) {
    return new Promise((resolve, reject) => {
      if (redirectDepth > 5) {
        reject(new Error('Too many HTTP redirects'));
        return;
      }

      const req = https.get(
        targetUrl,
        {
          headers: {
            'User-Agent':
              'Hylix-Editor-Relay-Server/1.0.0 (HyperSoft; +https://github.com/HyperSoft2026/Hylix)',
            Accept: '*/*',
            ...extraHeaders,
          },
          timeout: 15000,
        },
        (res) => {
          const status = res.statusCode || 500;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            fetchHttpsBuffer(nextUrl, extraHeaders, redirectDepth + 1).then(resolve, reject);
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              statusCode: status,
              headers: res.headers,
              buffer: Buffer.concat(chunks),
            });
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`HTTPS request timed out: ${targetUrl}`));
      });
    });
  }

  /**
   * Loads the official TypeScript compiler in RAM from CDN (zero disk writes)
   * so that .ts and .tsx files fetched from GitHub are compiled to browser ES modules.
   */
  async function ensureTypeScriptCompilerInMemory() {
    if (tsCompiler) return tsCompiler;
    if (tsCompilerLoadingPromise) return tsCompilerLoadingPromise;

    const cdnUrls = [
      'https://cdn.jsdelivr.net/npm/typescript@5.7.2/lib/typescript.js',
      'https://unpkg.com/typescript@5.7.2/lib/typescript.js',
    ];

    tsCompilerLoadingPromise = (async () => {
      for (const url of cdnUrls) {
        try {
          const response = await fetchHttpsBuffer(url);
          if (response.statusCode === 200 && response.buffer.length > 100000) {
            const scriptText = response.buffer.toString('utf8');
            const sandbox = {
              module: { exports: {} },
              exports: {},
              process: { env: {} },
              console,
              Buffer,
              setTimeout,
              clearTimeout,
            };
            sandbox.global = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(scriptText, sandbox, { filename: 'typescript-ram.js' });
            const loadedTs = sandbox.ts || sandbox.module.exports || sandbox.exports;
            if (loadedTs && typeof loadedTs.transpileModule === 'function') {
              tsCompiler = loadedTs;
              console.log(`[Hylix Relay] Loaded TypeScript ${loadedTs.version} compiler into RAM.`);
              return tsCompiler;
            }
          }
        } catch (err) {
          console.warn(`[Hylix Relay] Warning loading TS compiler from ${url}:`, err.message);
        }
      }
      throw new Error('Unable to load TypeScript compiler into RAM from CDN.');
    })();

    try {
      return await tsCompilerLoadingPromise;
    } catch (err) {
      tsCompilerLoadingPromise = null;
      throw err;
    }
  }

  /**
   * Fetches a file from the GitHub repository with short-lived RAM caching.
   */
  async function fetchRepoFileFromGitHub(repoRelativePath) {
    const cleanPath = repoRelativePath.replace(/^\/+/, '');
    if (!cleanPath || cleanPath.includes('..') || cleanPath.includes('\0')) {
      return null;
    }

    const now = Date.now();
    const cached = memoryCache.get(cleanPath);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached;
    }

    const targetUrl = `${RAW_GITHUB_BASE}/${cleanPath}`;
    const response = await fetchHttpsBuffer(targetUrl);

    if (response.statusCode === 200) {
      const entry = {
        repoPath: cleanPath,
        buffer: response.buffer,
        timestamp: now,
      };
      memoryCache.set(cleanPath, entry);
      return entry;
    }

    return null;
  }

  /**
   * Resolves a requested path (including extensionless TypeScript module imports
   * such as `/src/App` or `/src/core/engineIdentity`) against the GitHub repository.
   */
  async function resolveRepositoryFile(requestPathname) {
    const normalized = path.posix.normalize(requestPathname).replace(/^\/+/, '');
    if (!normalized || normalized === '.') {
      return fetchRepoFileFromGitHub('index.html');
    }

    const candidates = [normalized];
    const ext = path.posix.extname(normalized);
    if (!ext) {
      candidates.push(
        `${normalized}.ts`,
        `${normalized}.tsx`,
        `${normalized}/index.ts`,
        `${normalized}/index.tsx`
      );
    }

    for (const candidate of candidates) {
      const found = await fetchRepoFileFromGitHub(candidate);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * Rewrites CSS imports in JS modules to `?module=css` so browsers can import CSS
   * via standard ES module `<script type="module">` without Vite bundler plugins.
   */
  function rewriteCssImportsForBrowser(jsCode, currentModuleDir) {
    return jsCode.replace(
      /(import\s+['"])([^'"]+\.css)(['"])/g,
      (_match, prefix, cssPath, suffix) => {
        const resolved = cssPath.startsWith('.')
          ? path.posix.join('/', currentModuleDir, cssPath)
          : cssPath;
        return `${prefix}${resolved}?module=css${suffix}`;
      }
    );
  }

  /**
   * Transforms index.html fetched from GitHub so that it runs directly in the browser
   * via ES Modules + Import Map + Tailwind CDN while fetching all modules from this server.
   */
  function transformIndexHtmlForRelay(rawHtml) {
    const relayHeadInjection = `
    <!-- Hylix Repository Relay Runtime (51.75.118.169:${LISTEN_PORT} <-> GitHub ${GITHUB_OWNER}/${GITHUB_REPO}) -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18.3.1",
          "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
          "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
          "react-dom": "https://esm.sh/react-dom@18.3.1",
          "react-dom/client": "https://esm.sh/react-dom@18.3.1/client"
        }
      }
    </script>
`;

    if (rawHtml.includes('</head>')) {
      return rawHtml.replace('</head>', `${relayHeadInjection}\n  </head>`);
    }
    return relayHeadInjection + rawHtml;
  }

  /**
   * Main HTTP Request Handler:
   * User -> Internet -> Server (51.75.118.169:20040) -> GitHub Repository -> Server -> User
   */
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(parsedUrl.pathname);

      // Common security & CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('X-Hylix-Relay-Server', `${PUBLIC_HOST}:${LISTEN_PORT}`);
      res.setHeader(
        'X-Hylix-Source-Repository',
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
      );

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 1. Relay Gateway Status Endpoint
      if (pathname === '/api/gateway/status') {
        const payload = JSON.stringify(
          {
            status: 'ONLINE',
            application: 'Hylix Engine & Editor Relay Server',
            organization: 'HyperSoft',
            applicationId: 'com.hypersoft.hylix',
            publicEndpoint: `http://${PUBLIC_HOST}:${LISTEN_PORT}`,
            listenPort: LISTEN_PORT,
            serverMode: 'STANDALONE_SERVER_JS_ONLY',
            serverFilePath: '/server.js',
            flow: 'User -> Internet -> Server -> GitHub Repository -> Server -> User',
            repository: {
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              branch: GITHUB_BRANCH,
              url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
              rawBaseUrl: RAW_GITHUB_BASE,
            },
            ramCacheEntries: memoryCache.size,
            cacheTtlMs: CACHE_TTL_MS,
            timestampIso: new Date().toISOString(),
          },
          null,
          2
        );
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(payload);
        return;
      }

      // 2. Relay Cache Refresh Endpoint (forces immediate re-fetch from GitHub)
      if (pathname === '/api/gateway/refresh') {
        const clearedEntries = memoryCache.size;
        memoryCache.clear();
        const payload = JSON.stringify(
          {
            refreshed: true,
            clearedEntries,
            repository: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
            branch: GITHUB_BRANCH,
            timestampIso: new Date().toISOString(),
          },
          null,
          2
        );
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(payload);
        return;
      }

      // 3. Live Repository Tree Endpoint (queries GitHub API directly)
      if (pathname === '/api/repo/tree') {
        const treeUrl = `${API_GITHUB_BASE}/git/trees/${GITHUB_BRANCH}?recursive=1`;
        const ghRes = await fetchHttpsBuffer(treeUrl, {
          Accept: 'application/vnd.github+json',
        });
        res.writeHead(ghRes.statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(ghRes.buffer);
        return;
      }

      // 4. Resolve requested file from GitHub Repository (HyperSoft2026/Hylix)
      const repoFile = await resolveRepositoryFile(pathname === '/' ? 'index.html' : pathname);
      if (!repoFile) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify(
            {
              error: 'FILE_NOT_FOUND_IN_GITHUB_REPOSITORY',
              requestedPath: pathname,
              repository: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
              branch: GITHUB_BRANCH,
            },
            null,
            2
          )
        );
        return;
      }

      const ext = path.posix.extname(repoFile.repoPath).toLowerCase();

      // 5. Handle index.html (inject ImportMap + Tailwind browser support)
      if (repoFile.repoPath === 'index.html') {
        const rawHtml = repoFile.buffer.toString('utf8');
        const transformedHtml = transformIndexHtmlForRelay(rawHtml);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(transformedHtml);
        return;
      }

      // 6. Handle CSS imported as an ES Module (?module=css) or standard CSS
      if (ext === '.css') {
        const rawCss = repoFile.buffer
          .toString('utf8')
          .replace(/@import\s+["']tailwindcss["'];?/g, '/* tailwindcss handled via relay CDN */');

        if (parsedUrl.searchParams.get('module') === 'css') {
          const jsCssInjector = [
            `const cssText = ${JSON.stringify(rawCss)};`,
            `if (typeof document !== 'undefined') {`,
            `  const styleEl = document.createElement('style');`,
            `  styleEl.setAttribute('data-hylix-repo-css', ${JSON.stringify(repoFile.repoPath)});`,
            `  styleEl.textContent = cssText;`,
            `  document.head.appendChild(styleEl);`,
            `}`,
            `export default cssText;`,
          ].join('\n');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(jsCssInjector);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(rawCss);
        return;
      }

      // 7. Handle TypeScript & TSX source files (.ts / .tsx) -> Transpile in RAM
      if (ext === '.ts' || ext === '.tsx') {
        const ts = await ensureTypeScriptCompilerInMemory();
        const sourceText = repoFile.buffer.toString('utf8');
        const moduleDir = path.posix.dirname(repoFile.repoPath);

        const transpiled = ts.transpileModule(sourceText, {
          fileName: repoFile.repoPath,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            isolatedModules: true,
            esModuleInterop: true,
          },
        });

        const browserReadyJs = rewriteCssImportsForBrowser(transpiled.outputText, moduleDir);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Hylix-Transpiled-From': repoFile.repoPath,
        });
        res.end(browserReadyJs);
        return;
      }

      // 8. Serve all other repository files (images, JSON, Markdown, Kotlin, Gradle, etc.) directly
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      res.end(repoFile.buffer);
    } catch (err) {
      console.error('[Hylix Relay Error]:', err);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify(
          {
            error: 'REPOSITORY_RELAY_ERROR',
            message: err instanceof Error ? err.message : String(err),
            repository: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
          },
          null,
          2
        )
      );
    }
  });

  // Pre-warm TypeScript compiler in RAM on startup
  ensureTypeScriptCompilerInMemory().catch((err) => {
    console.warn('[Hylix Relay] Deferred TS compiler initialization:', err.message);
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log('======================================================================');
    console.log(' Hylix Engine & Editor — Standalone GitHub Repository Relay Server');
    console.log(' Organization  : HyperSoft (com.hypersoft.hylix)');
    console.log(` Public URL    : http://${PUBLIC_HOST}:${LISTEN_PORT}`);
    console.log(` Listening On  : http://${LISTEN_HOST}:${LISTEN_PORT}`);
    console.log(` Repository    : https://github.com/${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH})`);
    console.log(' Disk Footprint: /server.js ONLY (100% RAM-streamed from GitHub)');
    console.log('======================================================================');
  });
})();
