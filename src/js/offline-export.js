// src/js/offline-export.js
import { lessonURL, getLessonMeta } from './reading-store.js';

const enc = new TextEncoder();

async function resourceToDataURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw Error(`Missing offline resource: ${url} (${res.status})`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlineCSS(url) {
  const res = await fetch(url);
  if (!res.ok) throw Error('Missing stylesheet: ' + url);
  let content = await res.text();
  const regex = /url\(\s*(['"]?)(?!data:|#)([^)'"\s]+)\1\s*\)/g;
  const matches = [...content.matchAll(regex)];
  const newVals = new Map();
  
  for (const m of matches) {
    if (newVals.has(m[2])) continue;
    const path = new URL(m[2], new URL(url, location.origin)).pathname;
    newVals.set(m[2], await resourceToDataURL(path));
  }
  
  return content.replace(regex, (full, q, path) => `url('${newVals.get(path) || path}')`);
}

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function applyStaticAnnotations(article, rows) {
  const marks = {bee:'#FBBC05',boa:'#34A853',gecko:'#1CB0F6',ladybug:'#EA4335',tiger:'#FF6D01',beetle:'#AA00FF'};
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const list = [];
  let node, pos = 0;
  
  while(node = walker.nextNode()) {
    list.push({node, start: pos, end: pos + node.length});
    pos += node.length;
  }
  
  let noteNumber = 0;
  const numberOf = new Map();
  for(const n of rows.filter(r => r.kind === 'note').sort((a,b) => a.start_offset - b.start_offset)) {
    numberOf.set(n.id, ++noteNumber);
  }
  
  for(const item of list) {
    const {node, start, end} = item;
    const relevant = rows.filter(r => r.start_offset < end && r.end_offset > start);
    if(!relevant.length) continue;
    
    const points = new Set([0, node.length]);
    for(const r of relevant) {
      points.add(Math.max(0, r.start_offset - start));
      points.add(Math.min(node.length, r.end_offset - start));
    }
    
    const cuts = [...points].sort((a,b) => a - b);
    const fragment = article.ownerDocument.createDocumentFragment();
    
    for(let i=0; i<cuts.length-1; i++) {
      const from = cuts[i], to = cuts[i+1];
      if(to === from) continue;
      const global = start + from;
      
      for(const n of relevant.filter(r => r.kind === 'note' && r.start_offset === global)) {
        const sup = article.ownerDocument.createElement('sup');
        sup.textContent = '✱' + numberOf.get(n.id);
        sup.style.cssText = 'color:#4285F4;font-size:10px;vertical-align:super;margin-right:3px;';
        fragment.append(sup);
      }
      
      const active = relevant.filter(r => r.start_offset <= global && r.end_offset > global);
      const span = article.ownerDocument.createElement('span');
      
      const h = active.filter(r => r.kind === 'highlight').at(-1);
      if(h) span.style.backgroundColor = marks[h.color] || marks.bee;
      
      if(active.some(r => r.kind === 'note')) {
        span.style.textDecoration = 'underline dashed #4285F4 2px';
        span.style.textUnderlineOffset = '4px';
      }
      
      span.textContent = node.textContent.slice(from, to);
      fragment.append(span);
    }
    node.replaceWith(fragment);
  }
  
  const notes = rows.filter(r => r.kind === 'note');
  if(notes.length) {
    const section = article.ownerDocument.createElement('section');
    section.style.cssText = 'border-top:2px solid #4285F4;margin:40px 0 10px;padding:20px;background:#f8fbff;break-before:page';
    const h = article.ownerDocument.createElement('h2');
    h.textContent = 'My notes';
    section.append(h);
    
    for(const r of notes) {
      const p = article.ownerDocument.createElement('p');
      const title = article.ownerDocument.createElement('strong');
      title.textContent = '✱' + numberOf.get(r.id) + ' — ' + r.quote;
      const body = article.ownerDocument.createElement('div');
      body.textContent = r.body;
      body.style.cssText = 'white-space:pre-wrap;margin:8px 0 24px';
      p.append(title, body);
      section.append(p);
    }
    article.append(section);
  }
}

export async function buildOfflineLesson(course, lesson, annotations = []) {
  const url = lessonURL(course, lesson);
  if(url === '#') throw Error('Invalid lesson address');
  
  const res = await fetch(url);
  if(!res.ok) throw Error('Lesson is not published: ' + url);
  
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('#articleContent');
  if(!article) throw Error('Reading article not found');
  
  applyStaticAnnotations(article, annotations);
  
  const images = article.querySelectorAll('img');
  for(const img of images) {
    const src = img.getAttribute('src');
    if(src) img.src = await resourceToDataURL(new URL(src, location.origin).pathname);
  }
  
  const stylesheetURLs = ['/assets/fonts/fonts.css', '/src/styles/reading.css', '/src/styles/glossary-preview.css'];
  let css = '';
  for(const path of stylesheetURLs) {
    css += `\n/* ${path} */\n` + await inlineCSS(path);
  }
  
  for(const style of doc.querySelectorAll('head style')) {
    css += '\n' + style.textContent;
  }
  
  const meta = await getLessonMeta(course, lesson);
  const content = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(meta.title)} — Offline Vulanet</title><style>${css}\nbody{margin:0;background:white;font-family:'Atkinson Hyperlegible Next',Arial,sans-serif;color:#4B4B4B}main{max-width:820px;margin:0 auto;padding:38px 20px}article{color:#4B4B4B}article img{max-width:100%;height:auto}.offline-banner{background:#4285F4;padding:14px 25px;color:white}.lesson-section a{pointer-events:none;opacity:.65}.offline-info{font:13px Arial,sans-serif;color:#64748b;padding:10px 0}</style></head><body><div class="offline-banner">Vulanet · ${escapeText(meta.course)} · Saved reading</div><main><div class="offline-info">Offline snapshot · ${new Date().toLocaleString()} · Annotations cannot sync in this copy.</div>${article.outerHTML}</main></body></html>`;
  
  return content;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export async function downloadOfflineLesson(course, lesson, annotations = []) {
  const html = await buildOfflineLesson(course, lesson, annotations);
  downloadBlob(new Blob([html], {type: 'text/html;charset=utf-8'}), `${course}-${lesson}.html`);
}

// Hand-rolled ZIP writer using STORE method (no external dependencies)
const crcTable = (() => {
  const t = new Uint32Array(256);
  for(let i=0; i<256; i++) {
    let c = i;
    for(let k=0; k<8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for(const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ 0xffffffff) >>> 0;
}

function le(n, length) {
  const b = new Uint8Array(length);
  for(let i=0; i<length; i++) b[i] = (n >>> (i * 8)) & 255;
  return b;
}

function join(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for(const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function createZIP(files) {
  let local = [], central = [], offset = 0;
  for(const [filename, content] of files) {
    const name = enc.encode(filename);
    const data = enc.encode(content);
    const crc = crc32(data);
    
    const header = join([
      le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0, 2), le(crc, 4), 
      le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), name
    ]);
    
    local.push(header, data);
    central.push(join([
      le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0, 2), le(crc, 4),
      le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), name
    ]));
    
    offset += header.length + data.length;
  }
  
  const directory = join(central);
  const trailer = join([
    le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), 
    le(directory.length, 4), le(offset, 4), le(0, 2)
  ]);
  
  return new Blob([...local, directory, trailer], {type: 'application/zip'});
}

export async function downloadOfflineCollection(kind, username, entries, annotationRows) {
  const files = [];
  const rows = [];
  
  for(const e of entries) {
    const filename = `${e.course_id}-${e.lesson_id}.html`;
    const annotations = annotationRows.filter(a => a.course_id === e.course_id && a.lesson_id === e.lesson_id);
    files.push([filename, await buildOfflineLesson(e.course_id, e.lesson_id, annotations)]);
    
    const meta = await getLessonMeta(e.course_id, e.lesson_id);
    rows.push(`<li><a href="${encodeURIComponent(filename)}">${escapeText(meta.title)} (${escapeText(e.course_id)})</a></li>`);
  }
  
  files.unshift(['index.html', `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(kind)} — Vulanet offline</title></head><body><h1>${escapeText(username)}'s ${escapeText(kind)}</h1><p>Offline snapshot, ${new Date().toLocaleString()}</p><ol>${rows.join('')}</ol></body></html>`]);
  
  const zip = createZIP(files);
  downloadBlob(zip, `${username.replace(/[^a-z0-9_-]/gi, '_')}-${kind}-${new Date().toISOString().slice(0,10)}.zip`);
}
