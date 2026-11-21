#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseCspOrigins,
  buildApiDomainsWithWs,
  buildCspHeader,
  buildBackgroundStyle,
  stripCspMeta,
  injectTitle,
  injectApiBase
} from '../src/utils/csp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const EXISTING_BG_STYLE_RE = /<style>(?:body\{background-image:url\(|@media\s*\(max-width:\s*767px\)\{(?:(?!<\/style>)[\s\S])*?background-image:)[\s\S]*?<\/style>\s*/gi;

function escapeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function insertBeforeHeadClose(html, snippet) {
  if (!snippet) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  }
  return `${snippet}\n${html}`;
}

export function buildGithubPageCsp({ staticDomains = [], apiDomains = [] } = {}) {
  return buildCspHeader({ staticDomains, apiDomains })
    .split(';')
    .map(directive => directive.trim())
    .filter(directive => directive && !/^frame-ancestors\b/i.test(directive))
    .join(';');
}

export function injectCspMeta(html, cspContent) {
  const cleaned = stripCspMeta(html);
  if (!cspContent) return cleaned;
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(cspContent)}">`;
  return insertBeforeHeadClose(cleaned, metaTag);
}

export function transformGithubPageHtml(html, {
  title = '',
  apiBase = [],
  staticDomains = [],
  backgroundImage = '',
  mobileBackgroundImage = ''
} = {}) {
  let result = stripCspMeta(html);
  const apiDomains = buildApiDomainsWithWs(apiBase);
  const cspContent = buildGithubPageCsp({ staticDomains, apiDomains });

  // 1. 注入 CSP meta（过滤掉 meta 不支持的 frame-ancestors 指令）
  result = injectCspMeta(result, cspContent);

  // 2. 注入 title
  result = injectTitle(result, title);

  // 3. 注入运行时 apiBase meta 标签
  result = injectApiBase(result, apiBase);

  // 4. 注入桌面与移动端背景图样式（先清理可能已注入的同构样式，避免重复注入）
  result = result.replace(EXISTING_BG_STYLE_RE, '');
  if (backgroundImage || mobileBackgroundImage) {
    const bgStyle = buildBackgroundStyle(backgroundImage, mobileBackgroundImage);
    result = insertBeforeHeadClose(result, bgStyle);
  }

  return result;
}

export function runGithubPageBuild() {
  // Load .env file
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }

  const apiBase = parseCspOrigins([
    process.env.API_BASE || '',
    process.env.CSP_API || ''
  ].join(','));
  const staticDomains = parseCspOrigins(process.env.CSP_STATIC || '');
  const title = process.env.TITLE || '';
  const backgroundImage = process.env.BACKGROUND_IMAGE || '';
  const mobileBackgroundImage = process.env.BACKGROUND_IMAGE_MOBILE || '';

  console.log('Loaded GitHub Pages build configuration:', {
    apiOriginsCount: apiBase.length,
    staticOriginsCount: staticDomains.length,
    hasCustomTitle: Boolean(title),
    hasDesktopBackground: Boolean(backgroundImage),
    hasMobileBackground: Boolean(mobileBackgroundImage)
  });

  console.log('Cleaning dist directory...');
  if (fs.existsSync(distDir)) {
    fs.removeSync(distDir);
  }

  console.log('Building theme frontend...');
  execSync('npx vite build', {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_BASE: './',
      VITE_DISABLE_MKCERT: '1',
      VITE_SKIP_BG_INJECT: '1'
    }
  });

  // 构建时注入配置到 HTML
  const htmlFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const filePath = path.join(distDir, file);
    const rawHtml = fs.readFileSync(filePath, 'utf8');
    const html = transformGithubPageHtml(rawHtml, {
      title,
      apiBase,
      staticDomains,
      backgroundImage,
      mobileBackgroundImage
    });
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`Injected config into ${file}`);
  }

  console.log('Build complete!');
}

const isMainModule = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  runGithubPageBuild();
}
