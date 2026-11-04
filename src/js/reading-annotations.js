// src/js/reading-annotations.js
// ============================================================
// Reading-page annotation interface.
//
// Responsibilities:
//   • Text selection toolbar (Highlight | Note | Copy | Share).
//   • Six-colour highlight creation + colour swap on click.
//   • Folder-style note editor with quoted source.
//   • Asterisk markers before the first word of noted text.
//   • Dashed note underlines via CSS Custom Highlight API.
//   • ?view= personalisation: own view syncs the URL; a visitor's
//     view renders read-only.
//   • Revoked-link banner (never silently redirected).
//   • Four sharing actions: selected text, lesson, annotated view,
//     collection (collection handled by reading-collections.js).
//
// What this module does NOT do:
//   • It does not write to reading_annotation_links — the DB
//     AFTER INSERT / AFTER DELETE triggers own that lifecycle.
//   • It does not create or delete collection link rows.
//   • It does not manage bookmarks for other users.
// ============================================================

import {
  myAnnotations,
  myBookmarks,
  setBookmark,
  putAnnotation,
  updateAnnotation,
  deleteAnnotation,
  getAnnotationLink,
  reshareAnnotationLink,
  sharedLesson,
  annotationLink,
  lessonURL,
  lessonFromPath,
  owner,
  copyText,
  shareText
} from './reading-store.js';

const COLORS = {
  bee:     '#FBBC05',
  boa:     '#34A853',
  gecko:   '#1CB0F6',
  ladybug: '#EA4335',
  tiger:   '#FF6D01',
  beetle:  '#AA00FF'
};
const COLOR_NAMES = Object.keys(COLORS);
const ASTERISK_SVG = '/assets/icons/phosphor/regular/asterisk.svg';

(async function main() {
  const info = lessonFromPath();
  const root = document.getElementById('articleContent');
  if (!info || !root) return;   // not a reading page — nothing to do

  const { course, lesson } = info;

  ensureStylesheet();

  // ── DOM: toolbar ─────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'vr-selection-toolbar';
  toolbar.innerHTML = `
    <button data-action="highlight" type="button">
      <img src="/assets/icons/phosphor/fill/highlighter.svg" alt="">Highlight
    </button>
    <button data-action="note" type="button">
      <img src="/assets/icons/phosphor/regular/note-pencil.svg" alt="">Note
    </button>
    <button data-action="copy" type="button">
      <img src="/assets/icons/phosphor/regular/copy.svg" alt="">Copy
    </button>
    <button data-action="share" type="button">
      <img src="/assets/icons/phosphor/regular/share.svg" alt="">Share
    </button>
    <div class="vr-colors" role="group" aria-label="Highlight colour">
      ${COLOR_NAMES.map(n =>
        `<button data-color="${n}" type="button" title="${n}" aria-label="${n}" style="background:${COLORS[n]}"></button>`
      ).join('')}
    </div>
  `;
  document.body.append(toolbar);
  const colorsEl = toolbar.querySelector('.vr-colors');

  // ── DOM: folder editor ───────────────────────────────────
  const folder = document.createElement('div');
  folder.className = 'vr-folder';
  folder.innerHTML = `
    <blockquote id="vr-quote" aria-label="Quoted source"></blockquote>
    <button type="button" id="vr-expand" hidden>Show entire quote</button>
    <textarea id="vr-note-body" placeholder="Write your note…" aria-label="Note content"></textarea>
    <div class="vr-actions">
      <span class="vr-counter" id="vr-counter"></span>
      <button type="button" id="vr-prev" aria-label="Previous overlapping note" hidden>◀</button>
      <button type="button" id="vr-next" aria-label="Next overlapping note" hidden>▶</button>
      <button type="button" id="vr-undo">Undo</button>
      <button type="button" id="vr-delete">Delete</button>
      <button type="button" id="vr-close">Close</button>
      <button type="button" class="primary" id="vr-save">Save</button>
    </div>
  `;
  document.body.append(folder);

  // ── DOM: colour-swap picker (click on existing highlight) ─
  const swap = document.createElement('div');
  swap.className = 'vr-swap-picker';
  swap.innerHTML = `
    <div class="vr-swap-swatches" role="group" aria-label="Change highlight colour">
      ${COLOR_NAMES.map(n =>
        `<button data-swap-color="${n}" type="button" title="${n}" aria-label="${n}" style="background:${COLORS[n]}"></button>`
      ).join('')}
    </div>
    <button type="button" class="vr-swap-remove">Remove highlight</button>
  `;
  document.body.append(swap);

  // ── DOM: page-level share button ─────────────────────────
  const pageShareBtn = document.createElement('button');
  pageShareBtn.type = 'button';
  pageShareBtn.className = 'vr-lesson-share';
  pageShareBtn.textContent = 'Share this reading page';
  root.after(pageShareBtn);

  // ── state ────────────────────────────────────────────────
  let rows = [];                 // all annotations for this (course, lesson)
  let owned = false;             // viewer is the annotation owner
  let readonly = false;          // viewer is a visitor of someone else's ?view=
  let ownerLabel = '';           // display name of the shared owner (visitor mode)
  let currentOffsets = null;     // { start, end, quote }
  let activeNote = null;         // the note row currently being edited
  let overlaps = [];
  let overlapIndex = 0;
  let activeSwapId = null;       // highlight id currently in swap mode
  let latestColor = localStorage.getItem('vr_recent_color') || 'bee';
  if (!COLOR_NAMES.includes(latestColor)) latestColor = 'bee';

  const toast = makeToast();

  // ─────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────
  await initialize();
  render();
  await syncURL();
  installListeners();

  // ─────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────
  async function initialize() {
    const url = new URL(location.href);
    const viewToken = url.searchParams.get('view');

    // Try to establish owner identity (independent of ?view=)
    let ownToken = null;
    try {
      await owner();
      owned = true;
      try {
        const link = await getAnnotationLink(course, lesson);
        ownToken = link && link.token;
      } catch { /* link does not exist yet */ }
    } catch {
      owned = false;
    }

    // Branch A — a ?view= is present
    if (viewToken) {
      // Case A1 — visitor or non-owning viewer
      if (!owned || viewToken !== ownToken) {
        let shared = null;
        try { shared = await sharedLesson(viewToken); }
        catch (e) { console.error('sharedLesson failed', e); }

        if (shared && shared.status === 'revoked') {
          showRevokedBanner();
          return;
        }
        if (!shared || shared.status !== 'ok' || !shared.data) {
          // Invalid token or zero annotations — redirect to clean page
          redirectToClean();
          return;
        }
        if (shared.data.course_id !== course || shared.data.lesson_id !== lesson) {
          redirectToClean();
          return;
        }
        readonly = true;
        ownerLabel = shared.data.owner_name || 'Vulanet reader';
        rows = Array.isArray(shared.data.annotations) ? shared.data.annotations : [];
        showViewerBanner(ownerLabel);
        return;
      }
      // Case A2 — the owner opened their own ?view= URL: fall through
      // to normal owner mode. The token is validated by syncURL()
      // after rows load.
    }

    // Branch B — owner mode (no ?view= or own ?view=)
    if (owned) {
      try { rows = await myAnnotations(course, lesson); }
      catch (e) { toast('Could not load your annotations: ' + e.message); }
      await reflectBookmarkState();
      return;
    }

    // Branch C — anonymous, no ?view=
    // Reading pages render clean. Bookmark remains disabled until sign-in.
  }

  // ─────────────────────────────────────────────────────────
  // URL sync — keep ?view= in step with owner state
  // ─────────────────────────────────────────────────────────
  async function syncURL() {
    if (!owned || readonly) return;

    const current = new URL(location.href);
    const urlToken = current.searchParams.get('view');

    // No annotations → ensure no ?view=
    if (rows.length === 0) {
      if (urlToken) {
        current.searchParams.delete('view');
        history.replaceState(null, '', current.pathname + current.search + current.hash);
      }
      return;
    }

    // Annotations exist → link row exists (created by trigger). Sync the token.
    let link = null;
    try { link = await getAnnotationLink(course, lesson); }
    catch { return; }

    if (!link || !link.token) return;      // trigger has not yet created the row (transient)
    if (link.revoked_at) return;           // revocation is a deliberate state; do not put a dead token in the URL

    if (urlToken !== link.token) {
      current.searchParams.set('view', link.token);
      history.replaceState(null, '', current.pathname + current.search + current.hash);
    }
  }

  function redirectToClean() {
    const clean = lessonURL(course, lesson);
    if (clean && clean !== '#') location.replace(clean);
  }

  // ─────────────────────────────────────────────────────────
  // Banners
  // ─────────────────────────────────────────────────────────
  function showRevokedBanner() {
    const banner = document.createElement('div');
    banner.className = 'vr-viewer vr-viewer-revoked';
    banner.innerHTML = `
      <span>This annotated view has been revoked by its owner.</span>
      <a href="${lessonURL(course, lesson)}">Read the original lesson</a>
    `;
    root.before(banner);
    readonly = true;
  }

  function showViewerBanner(ownerName) {
    const banner = document.createElement('div');
    banner.className = 'vr-viewer';
    banner.textContent = `Read-only annotations shared by ${ownerName}`;
    root.before(banner);
  }

  // ─────────────────────────────────────────────────────────
  // Rendering — CSS Custom Highlight API + asterisk markers
  // ─────────────────────────────────────────────────────────
  function render() {
    // Remove existing asterisks before we recompute offsets
    root.querySelectorAll('.vr-note-asterisk').forEach(m => m.remove());

    const apiReady = 'highlights' in CSS && typeof Highlight === 'function';
    if (!apiReady) {
      toast('This browser does not support visual text highlights. Notes are still saved.');
      return;
    }

    // Highlights — one CSS Highlight per colour
    for (const color of COLOR_NAMES) {
      const ranges = rows
        .filter(r => r.kind === 'highlight' && r.color === color)
        .map(r => offsetRange(r.start_offset, r.end_offset))
        .filter(Boolean);
      if (ranges.length === 0) CSS.highlights.delete('vr-' + color);
      else CSS.highlights.set('vr-' + color, new Highlight(...ranges));
    }

    // Notes — dashed underline via ::highlight(vr-notes)
    const noteRanges = rows
      .filter(r => r.kind === 'note')
      .map(r => offsetRange(r.start_offset, r.end_offset))
      .filter(Boolean);
    if (noteRanges.length === 0) CSS.highlights.delete('vr-notes');
    else CSS.highlights.set('vr-notes', new Highlight(...noteRanges));

    // Asterisks — insert before the first character of each note.
    // Right-to-left so previously inserted markers do not disturb
    // later position calculations (they contribute 0 text length,
    // but this also keeps the DOM tangle-order stable for readers).
    const noteRows = rows
      .filter(r => r.kind === 'note')
      .sort((a, b) => (b.start_offset - a.start_offset) || (b.created_at || '').localeCompare(a.created_at || ''));

    for (const note of noteRows) {
      const r = offsetRange(note.start_offset, note.start_offset);
      if (!r) continue;
      const marker = document.createElement('i');
      marker.className = 'ph ph-asterisk note-asterisk vr-note-asterisk';
      marker.dataset.noteId = note.id;
      marker.setAttribute('role', 'button');
      marker.setAttribute('tabindex', '0');
      marker.setAttribute('aria-label', 'Open note');
      const icon = document.createElement('img');
      icon.src = ASTERISK_SVG;
      icon.alt = '';
      marker.append(icon);
      r.insertNode(marker);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Offset ↔ Range helpers
  // ─────────────────────────────────────────────────────────
  function textNodes() {
    const walker = document.createTreeWalker(
      root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.parentElement && node.parentElement.closest('.vr-note-asterisk')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const list = [];
    let n;
    while ((n = walker.nextNode())) list.push(n);
    return list;
  }

  function offsetRange(start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
    const nodes = textNodes();
    let pos = 0;
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;

    for (const node of nodes) {
      const nodeEnd = pos + node.length;
      if (startNode === null && start <= nodeEnd) {
        startNode = node; startOffset = Math.min(start - pos, node.length);
      }
      if (endNode === null && end <= nodeEnd) {
        endNode = node; endOffset = Math.min(end - pos, node.length);
      }
      if (startNode && endNode) break;
      pos = nodeEnd;
    }
    if (!startNode || !endNode) return null;
    if (startOffset < 0) startOffset = 0;
    if (endOffset < 0) endOffset = 0;

    try {
      const r = document.createRange();
      r.setStart(startNode, startOffset);
      r.setEnd(endNode, endOffset);
      return r;
    } catch { return null; }
  }

  function selectionOffsets() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

    const raw = range.toString();
    if (!raw.trim()) return null;

    // Locate start and end in the flat text offset space.
    const nodes = textNodes();
    let pos = 0, start = -1, end = -1;
    for (const node of nodes) {
      if (start === -1 && node === range.startContainer) start = pos + range.startOffset;
      if (end === -1 && node === range.endContainer) end = pos + range.endOffset;
      if (start !== -1 && end !== -1) break;
      pos += node.length;
    }
    if (start === -1 || end === -1 || end <= start) return null;

    return expandToWordBoundaries(start, end);
  }

  function expandToWordBoundaries(start, end) {
    const nodes = textNodes();
    const flat = nodes.map(n => n.data).join('');
    const isWord = c => c !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(c);

    let s = start;
    let e = end;
    while (s > 0 && isWord(flat[s - 1])) s--;
    while (e < flat.length && isWord(flat[e])) e++;
    const quote = flat.slice(s, e);
    if (!quote) return null;
    return { start: s, end: e, quote };
  }

  function pointToOffset(x, y) {
    let r = null;
    if (document.caretRangeFromPoint) {
      r = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) {
        r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
      }
    }
    if (!r || !root.contains(r.startContainer)) return null;

    const nodes = textNodes();
    let pos = 0;
    for (const node of nodes) {
      if (node === r.startContainer) return pos + r.startOffset;
      pos += node.length;
    }
    return null;
  }

  function highlightsAtOffset(offset) {
    return rows.filter(a =>
      a.kind === 'highlight' && a.start_offset <= offset && a.end_offset > offset
    );
  }

  // ─────────────────────────────────────────────────────────
  // Selection toolbar
  // ─────────────────────────────────────────────────────────
  function showToolbarAt(range) {
    const rect = range.getBoundingClientRect();
    toolbar.style.left = `${Math.max(10, Math.min(window.scrollX + rect.left, window.scrollX + innerWidth - 320))}px`;
    toolbar.style.top  = `${window.scrollY + rect.bottom + 12}px`;
    toolbar.classList.add('visible');

    // Read-only visitors keep Copy / Share
    toolbar.querySelector('[data-action="highlight"]').hidden = readonly;
    toolbar.querySelector('[data-action="note"]').hidden = readonly;
  }

  function hideToolbar() {
    toolbar.classList.remove('visible');
    colorsEl.classList.remove('open');
  }

  function hideSwapPicker() {
    swap.classList.remove('open');
    activeSwapId = null;
  }

  // ─────────────────────────────────────────────────────────
  // Note folder
  // ─────────────────────────────────────────────────────────
  function openNotePanel(noteRow, { isNew = false } = {}) {
    activeNote = noteRow;

    const overlapping = isNew
      ? [noteRow]
      : rows.filter(r =>
          r.kind === 'note' &&
          r.id &&
          r.start_offset < noteRow.end_offset &&
          r.end_offset > noteRow.start_offset
        );
    overlaps = overlapping.length ? overlapping : [noteRow];
    overlapIndex = Math.max(0, overlaps.findIndex(r => (isNew ? false : r.id === noteRow.id)));

    folder.querySelector('#vr-quote').textContent = noteRow.quote || '';
    folder.querySelector('#vr-quote').classList.remove('expanded');
    folder.querySelector('#vr-expand').hidden = (noteRow.quote || '').length < 140;
    folder.querySelector('#vr-note-body').value = noteRow.body || '';
    folder.querySelector('#vr-note-body').disabled = readonly;

    const saveBtn   = folder.querySelector('#vr-save');
    const deleteBtn = folder.querySelector('#vr-delete');
    const undoBtn   = folder.querySelector('#vr-undo');
    saveBtn.hidden   = readonly;
    deleteBtn.hidden = readonly || isNew;
    undoBtn.hidden   = readonly || isNew;

    folder.querySelector('#vr-counter').textContent = overlaps.length > 1
      ? `Note ${overlapIndex + 1} of ${overlaps.length}`
      : '';
    folder.querySelector('#vr-prev').hidden = overlaps.length < 2;
    folder.querySelector('#vr-next').hidden = overlaps.length < 2;

    const r = offsetRange(noteRow.start_offset, noteRow.end_offset);
    const rect = r ? r.getBoundingClientRect() : null;
    folder.style.left = `${Math.max(10, Math.min((rect ? rect.left : 15), innerWidth - 360))}px`;
    folder.style.top  = `${Math.max(60, Math.min((rect ? rect.bottom : 90) + 12, innerHeight - 240))}px`;
    folder.classList.add('open');
  }

  function closeNotePanel() {
    folder.classList.remove('open');
    activeNote = null;
    overlaps = [];
    overlapIndex = 0;
  }

  // ─────────────────────────────────────────────────────────
  // Share helpers
  // ─────────────────────────────────────────────────────────
  async function doShare(title, url, passage) {
    const outcome = await shareText(title, url, passage || '');
    if (outcome === 'shared' || outcome === 'cancelled') return;
    showFallbackShare(title, url, passage || '');
  }

  function showFallbackShare(title, url, passage) {
    const modal = document.createElement('div');
    modal.className = 'vr-share-menu open';
    const card = document.createElement('div');

    const h = document.createElement('h3');
    h.textContent = 'Share';
    card.append(h);

    if (passage) {
      const p = document.createElement('p');
      p.textContent = passage;
      card.append(p);
    }

    const body = `${passage} ${url}`.trim();
    for (const [label, href] of [
      ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(body)}`],
      ['Telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(passage)}`],
      ['Email',    `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`]
    ]) {
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      card.append(a);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy link';
    copy.onclick = async () => {
      try { await copyText(url); toast('Copied to clipboard!'); modal.remove(); }
      catch { toast('Copy failed. Please try again.'); }
    };

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cancel';
    close.onclick = () => modal.remove();

    card.append(copy, close);
    modal.append(card);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.append(modal);
  }

  // ─────────────────────────────────────────────────────────
  // Bookmark state
  // ─────────────────────────────────────────────────────────
  async function reflectBookmarkState() {
    const btn = document.querySelector('#bookmarkBtn');
    if (!btn || !owned) return;
    try {
      const marks = await myBookmarks();
      const has = marks.some(b => b.course_id === course && b.lesson_id === lesson);
      btn.classList.toggle('bookmarked', has);
      const img = btn.querySelector('img');
      if (img) img.src = `/assets/icons/phosphor/${has ? 'fill' : 'regular'}/bookmarks.svg`;
    } catch { /* ignore */ }
  }

  // ─────────────────────────────────────────────────────────
  // Event wiring
  // ─────────────────────────────────────────────────────────
  function installListeners() {
    // ── Selection change ─────────────────────────────────────
    document.addEventListener('selectionchange', () => {
      requestAnimationFrame(() => {
        if (readonly && !getSelection()?.isCollapsed) {
          // Visitors can still copy / share selected text
        }
        const offsets = selectionOffsets();
        if (!offsets) {
          if (!colorsEl.matches(':hover') && !toolbar.matches(':hover')) hideToolbar();
          return;
        }
        const sel = getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        currentOffsets = offsets;
        showToolbarAt(range);
      });
    });

    // ── Toolbar buttons ──────────────────────────────────────
    toolbar.addEventListener('pointerdown', e => e.preventDefault());

    toolbar.addEventListener('click', async e => {
      const colorBtn = e.target.closest('[data-color]');
      if (colorBtn) {
        if (readonly || !currentOffsets) return;
        const color = colorBtn.dataset.color;
        latestColor = color;
        try { localStorage.setItem('vr_recent_color', color); } catch { /* ignore */ }
        try {
          const saved = await putAnnotation(
            course, lesson, 'highlight',
            currentOffsets.start, currentOffsets.end, currentOffsets.quote,
            '', color
          );
          rows.push(saved);
          render();
          await syncURL();
          toast('Highlight saved!');
        } catch (err) {
          toast('Could not save highlight: ' + err.message);
        }
        hideToolbar();
        getSelection()?.removeAllRanges();
        currentOffsets = null;
        return;
      }

      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      if (action === 'highlight') {
        colorsEl.classList.toggle('open');
        return;
      }
      if (!currentOffsets) return;

      if (action === 'note') {
        openNotePanel({
          start_offset: currentOffsets.start,
          end_offset: currentOffsets.end,
          quote: currentOffsets.quote,
          body: '',
          kind: 'note',
          color: null
        }, { isNew: true });
        hideToolbar();
        getSelection()?.removeAllRanges();
        currentOffsets = null;
        return;
      }
      if (action === 'copy') {
        try { await copyText(currentOffsets.quote); toast('Copied to clipboard!'); }
        catch { toast('Copy failed. Please try again.'); }
        hideToolbar();
        getSelection()?.removeAllRanges();
        currentOffsets = null;
        return;
      }
      if (action === 'share') {
        const passage = currentOffsets.quote;
        hideToolbar();
        await doShare('Selected from ' + document.title, location.href, passage);
        getSelection()?.removeAllRanges();
        currentOffsets = null;
        return;
      }
    });

    // ── Folder actions ───────────────────────────────────────
    folder.querySelector('#vr-expand').addEventListener('click', () => {
      const q = folder.querySelector('#vr-quote');
      q.classList.toggle('expanded');
      folder.querySelector('#vr-expand').textContent =
        q.classList.contains('expanded') ? 'Collapse quote' : 'Show entire quote';
    });

    folder.querySelector('#vr-close').addEventListener('click', closeNotePanel);

    folder.querySelector('#vr-prev').addEventListener('click', () => {
      if (overlaps.length < 2) return;
      overlapIndex = (overlapIndex - 1 + overlaps.length) % overlaps.length;
      openNotePanel(overlaps[overlapIndex]);
    });
    folder.querySelector('#vr-next').addEventListener('click', () => {
      if (overlaps.length < 2) return;
      overlapIndex = (overlapIndex + 1) % overlaps.length;
      openNotePanel(overlaps[overlapIndex]);
    });

    folder.querySelector('#vr-undo').addEventListener('click', () => {
      if (activeNote) folder.querySelector('#vr-note-body').value = activeNote.body || '';
    });

    folder.querySelector('#vr-save').addEventListener('click', async () => {
      if (!activeNote) return;
      const body = folder.querySelector('#vr-note-body').value.trim();
      if (!body) { toast('Write a note before saving.'); return; }
      try {
        if (activeNote.id) {
          const updated = await updateAnnotation(activeNote.id, { body });
          rows = rows.map(r => r.id === updated.id ? updated : r);
        } else {
          const saved = await putAnnotation(
            course, lesson, 'note',
            activeNote.start_offset, activeNote.end_offset,
            activeNote.quote, body, null
          );
          rows.push(saved);
        }
        closeNotePanel();
        render();
        await syncURL();
        toast('Note saved!');
      } catch (e) {
        toast('Could not save note: ' + e.message);
      }
    });

    folder.querySelector('#vr-delete').addEventListener('click', async () => {
      if (!activeNote || !activeNote.id) return;
      if (!confirm('Delete this note?')) return;
      try {
        await deleteAnnotation(activeNote.id);
        rows = rows.filter(r => r.id !== activeNote.id);
        closeNotePanel();
        render();
        await syncURL();
        toast('Note deleted.');
      } catch (e) {
        toast('Delete failed: ' + e.message);
      }
    });

    // ── Click handling: asterisks, highlight swap ────────────
    root.addEventListener('click', async e => {
      // Asterisk marker
      const marker = e.target.closest('.vr-note-asterisk');
      if (marker) {
        e.preventDefault();
        const noteRow = rows.find(r => String(r.id) === marker.dataset.noteId);
        if (noteRow) openNotePanel(noteRow);
        return;
      }

      // Highlight click (no active selection) → swap picker
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;

      const offset = pointToOffset(e.clientX, e.clientY);
      if (offset === null) return;
      const hits = highlightsAtOffset(offset);
      if (hits.length === 0) return;

      // Latest wins
      const target = hits
        .slice()
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
      activeSwapId = target.id;
      swap.querySelectorAll('[data-swap-color]').forEach(b => {
        b.classList.toggle('active', b.dataset.swapColor === target.color);
      });
      swap.style.left = `${Math.max(10, Math.min(e.pageX - 60, innerWidth - 240))}px`;
      swap.style.top  = `${e.pageY + 12}px`;
      swap.classList.add('open');
      if (readonly) {
        swap.querySelector('.vr-swap-remove').hidden = true;
        swap.querySelectorAll('[data-swap-color]').forEach(b => b.disabled = true);
      } else {
        swap.querySelector('.vr-swap-remove').hidden = false;
        swap.querySelectorAll('[data-swap-color]').forEach(b => b.disabled = false);
      }
    });

    // Keyboard open for asterisk
    root.addEventListener('keydown', e => {
      if (e.target.matches('.vr-note-asterisk') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.target.click();
      }
    });

    // ── Swap picker actions ──────────────────────────────────
    swap.addEventListener('click', async e => {
      const colorBtn = e.target.closest('[data-swap-color]');
      if (colorBtn && activeSwapId) {
        const color = colorBtn.dataset.swapColor;
        try {
          const updated = await updateAnnotation(activeSwapId, { color });
          rows = rows.map(r => r.id === updated.id ? updated : r);
          render();
          toast('Highlight colour changed.');
        } catch (err) {
          toast('Could not change colour: ' + err.message);
        }
        hideSwapPicker();
        return;
      }
      if (e.target.closest('.vr-swap-remove') && activeSwapId) {
        if (!confirm('Remove this highlight?')) return;
        try {
          await deleteAnnotation(activeSwapId);
          rows = rows.filter(r => r.id !== activeSwapId);
          render();
          await syncURL();
          toast('Highlight removed.');
        } catch (err) {
          toast('Could not remove highlight: ' + err.message);
        }
        hideSwapPicker();
      }
    });

    // Close swap on outside click
    document.addEventListener('click', e => {
      if (!swap.classList.contains('open')) return;
      if (e.target.closest('.vr-swap-picker')) return;
      if (e.target.closest('.vr-note-asterisk')) return;
      hideSwapPicker();
    });

    // ── Bookmark button ──────────────────────────────────────
    const bookmarkBtn = document.querySelector('#bookmarkBtn');
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener('click', async () => {
        if (!owned) {
          toast('Sign in to bookmark lessons.');
          return;
        }
        const next = !bookmarkBtn.classList.contains('bookmarked');
        try {
          await setBookmark(course, lesson, next);
          bookmarkBtn.classList.toggle('bookmarked', next);
          const img = bookmarkBtn.querySelector('img');
          if (img) img.src = `/assets/icons/phosphor/${next ? 'fill' : 'regular'}/bookmarks.svg`;
          toast(next ? 'Bookmarked!' : 'Bookmark removed.');
        } catch (e) {
          toast(e.message);
        }
      });
    }

    // ── Page-level share button ──────────────────────────────
    pageShareBtn.addEventListener('click', async () => {
      const url = new URL(location.href);
      const viewToken = url.searchParams.get('view');

      // Visitor of someone else's shared view → share that
      if (viewToken && !owned) {
        await doShare(document.title, url.href);
        return;
      }

      // Anonymous, no ?view= → clean lesson
      if (!owned) {
        await doShare(document.title, lessonURL(course, lesson));
        return;
      }

      // Owner → prefer annotated URL when it is active
      try {
        const link = await getAnnotationLink(course, lesson);
        if (link && link.revoked_at) {
          await doShare(document.title, lessonURL(course, lesson));
          return;
        }
        if (link && link.token && rows.length > 0) {
          await doShare(document.title, annotationLink(course, lesson, link.token));
          return;
        }
      } catch { /* fall through to clean */ }
      await doShare(document.title, lessonURL(course, lesson));
    });

    // ── Escape closes transient UI ───────────────────────────
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        hideToolbar();
        hideSwapPicker();
        closeNotePanel();
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────
  function ensureStylesheet() {
    if (document.querySelector('link[href="/src/styles/reading-annotations.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/src/styles/reading-annotations.css';
    document.head.append(link);
  }

  function makeToast() {
    return function toast(message) {
      const el = document.createElement('div');
      el.className = 'vr-toast';
      el.textContent = message;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.append(el);
      setTimeout(() => el.remove(), 2800);
    };
  }

  // Expose `reshareAnnotationLink` for a future "reshare" UI. In v6 the
  // function exists and is proven; the corresponding button is out of scope
  // per the plan's stated deferral.
  void reshareAnnotationLink;
})();
