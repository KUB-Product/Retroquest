// build.js — Vercel รันไฟล์นี้ก่อน deploy
// อ่านค่า ENV แล้วแทนที่ placeholder ใน index.html

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const SRC  = resolve('index.html');
const DIST = resolve('dist/index.html');

// สร้างโฟลเดอร์ dist
mkdirSync('dist', { recursive: true });

// อ่าน ENV (ตั้งไว้ใน Vercel Dashboard)
const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL)      console.warn('[build] ⚠ SUPABASE_URL not set');
if (!SUPABASE_ANON_KEY) console.warn('[build] ⚠ SUPABASE_ANON_KEY not set');

// แทนที่ placeholder
let html = readFileSync(SRC, 'utf8');
html = html.replace(/__SUPABASE_URL__/g,      SUPABASE_URL);
html = html.replace(/__SUPABASE_ANON_KEY__/g, SUPABASE_ANON_KEY);

writeFileSync(DIST, html, 'utf8');
console.log('[build] ✓ index.html built →', DIST);
console.log('[build]   SUPABASE_URL:',      SUPABASE_URL      ? '✓ set' : '✗ empty');
console.log('[build]   SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? '✓ set' : '✗ empty');
