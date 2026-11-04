// src/js/reading-collections.js
// ============================================================
// Controller for /bookmarks.html, /highlights.html, /notes.html.
//
// Two access modes:
//   OWNER   — arrives via /bookmarks.html (no path username) or
//             /bookmarks/{own-username}. Full UI: Share, Download,
//             Add, Sort, three-dot actions.
//   VISITOR — arrives via /bookmarks/{someone-else}. Read-only
//             snapshot of that collection. No mutating controls.
//
// Denial is uniform {status:'denied'} from the RPC; the client
// does not reveal whether a private collection exists.
//
// Sharing:
//   • shareCollection(kind)  → server-side visibility='public'
//   • collectionURL(kind, username) → /bookmarks/{username} etc.
//   • Per-lesson share uses annotationLink(...) when the lesson
//     has saved annotations, clean lessonURL otherwise.
// ============================================================

import {
  supabase,
  owner,
  ownerProfile,
  getCollectionByUsername,
  shareCollection,
  collectionURL,
  lessonURL,
  annotationLink,
  lessonFromPath,
  collectionFromPath,
  getLessonMeta,
  courseTitles,
  availableCourses,
  userCourses,
  myBookmarks,
  allAnnotations,
  setBookmark,
  getAnnotationLink,
  customOrder,
  saveOrder,
  clearLessonAnnotations,
  copyText,
  shareText
} from './reading-store.js';

// ─────────────────────────────────────────────────────────────
// Optional dependency: offline-export.js
// Wired defensively so the module still loads when absent.
// ─────────────────────────────────────────────────────────────
let offlineExport = null;
(async () => {
  try {
    offlineExport = await import('./offline-export.js');
  } catch (e) {
    console.warn('reading-collections: offline-export.js unavailable — Download disabled.', e);
    offlineExport = null;
  }
})();

// ─────────────────────────────────────────────────────────────
// Page wiring
// ─────────────────────────────────────────────────────────────
const KIND = document.body.dataset.collection;
if (!['bookmarks', 'highlights', 'notes'].includes(KIND)) {
  console.error('reading-collections: invalid body[data-collection]');
} else {
  main().catch(err => {
    console.error('reading-collections: fatal', err);
    showStatus('Could not load the collection.', true);
  });
}

// ─────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────
let ownerUsername = null;
let isOwner = false;
let items = [];             // [{ course_id, lesson_id, updated_at, meta }]
let allRows = [];           // owner only — annotations across all lessons
let sortMode = 'recent';    // 'recent' | 'custom'
let openMenu = null;
let activeDotTrigger = null;

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
async function main() {
  const pathInfo = collectionFromPath();
  let requestedUsername = null;

  if (pathInfo && pathInfo.kind === KIND) {
    requestedUsername = pathInfo.username;
  } else {
    requestedUsername = new URL(location.href).searchParams.get('u');
  }

  // Determine ownership & username of the collection we are loading.
  let authUid = null;
  try { authUid = await owner(); } catch { authUid = null; }

  let targetUsername = requestedUsername;

  if (!targetUsername) {
    // No username in URL → owner viewing own collection
    if (!authUid) {
      renderDenied();
      return;
    }
    const profile = await ownerProfile().catch(() => null);
    ownerUsername = profile?.username || null;
    if (ownerUsername) targetUsername = ownerUsername;
  }

  // Load data
  let data = null;
  if (targetUsername) {
    const result = await getCollectionByUsername(targetUsername, KIND).catch(() => ({ status: 'denied' }));
    if (result.status !== 'ok' || !result.data) {
      renderDenied();
      return;
    }
    data = result.data;
  } else {
    // Owner with no username → direct load fallback (no share URL)
    data = await loadOwnerFallback();
  }

  isOwner = !!data.is_owner;
  if (isOwner) {
    try {
      const profile = await ownerProfile();
      ownerUsername = profile?.username || null;
    } catch { /* keep null */ }
  }

  const raw = Array.isArray(data.items) ? data.items : [];
  items = await Promise.all(
    raw.map(async row => ({
      course_id: row.course_id,
      lesson_id: row.lesson_id,
      updated_at: row.updated_at || row.created_at || null,
      meta: await getLessonMeta(row.course_id, row.lesson_id)
    }))
  );

  if (isOwner) {
    await loadOwnerExtras();
  }

  applyVisibility();
  render();
  installActions();

  if (isOwner && !ownerUsername) {
    showStatus('Add a username to your profile to enable collection sharing.', true);
  } else {
    showStatus(`${items.length} ${items.length === 1 ? 'lesson' : 'lessons'} in ${KIND}.`);
  }
}

// ─────────────────────────────────────────────────────────────
// Owner extras (annotations + custom-sort detection)
// ─────────────────────────────────────────────────────────────
async function loadOwnerExtras() {
  try {
    allRows = await allAnnotations();
  } catch (e) {
    console.warn('reading-collections: allAnnotations failed', e);
    allRows = [];
  }

  try {
    const orders = await customOrder(KIND);
    const hasCustom = Array.isArray(orders) && orders.some(o => o.sort_index !== null && o.sort_index !== undefined);
    sortMode = hasCustom ? 'custom' : 'recent';
    const sortBtn = document.getElementById('sort');
    if (sortBtn) sortBtn.textContent = sortMode === 'custom' ? 'Sort: Custom' : 'Sort: Recent';
  } catch (e) {
    console.warn('reading-collections: customOrder failed', e);
    sortMode = 'recent';
  }
}

// ─────────────────────────────────────────────────────────────
// Owner fallback — direct load when no username exists
// ─────────────────────────────────────────────────────────────
async function loadOwnerFallback() {
  const profile = await ownerProfile().catch(() => ({}));
  let items = [];

  if (KIND === 'bookmarks') {
    const rows = await myBookmarks();
    items = rows.map(b => ({
      course_id: b.course_id,
      lesson_id: b.lesson_id,
      updated_at: b.updated_at,
      sort_index: b.sort_index
    }));
  } else {
    const kindFilter = KIND === 'highlights' ? 'highlight' : 'note';
    const rows = await allAnnotations(kindFilter);
    const byLesson = new Map();
    for (const a of rows) {
      const key = `${a.course_id}|${a.lesson_id}`;
      const prev = byLesson.get(key);
      if (!prev) {
        byLesson.set(key, { course_id: a.course_id, lesson_id: a.lesson_id, updated_at: a.updated_at });
      } else if (String(a.updated_at) > String(prev.updated_at)) {
        prev.updated_at = a.updated_at;
      }
    }
    items = [...byLesson.values()];
  }

  // Apply custom order if present
  try {
    const orders = await customOrder(KIND);
    const ranks = new Map();
    for (const o of orders) {
      if (o.sort_index !== null && o.sort_index !== undefined) {
        ranks.set(`${o.course_id}|${o.lesson_id}`, Number(o.sort_index));
      }
    }
    if (ranks.size > 0) {
      items.sort((a, b) =>
        (ranks.get(`${a.course_id}|${a.lesson_id}`) ?? Infinity) -
        (ranks.get(`${b.course_id}|${b.lesson_id}`) ?? Infinity)
      );
    } else {
      items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }
  } catch {
    items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  return {
    kind: KIND,
    owner_name: profile?.display_name || profile?.username || 'You',
    is_owner: true,
    shared: false,
    items
  };
}

// ─────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const tbody = $('#rows');
const statusEl = $('#status');
const dialog = $('#dialog');
const dialogBody = $('#dialog-body');
const dialogTitle = $('#dialog-title');

function showStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', !!isError);
}

function applyVisibility() {
  const privateOnly = document.querySelectorAll('.private-only');
  const viewer = $('#viewer');
  if (isOwner) {
    privateOnly.forEach(el => el.hidden = false);
    if (viewer) viewer.hidden = true;
  } else {
    privateOnly.forEach(el => el.hidden = true);
    if (viewer) viewer.hidden = false;
  }
}

function renderDenied() {
  tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><strong>Collection unavailable</strong><p>This collection is not currently accessible.</p></div></td></tr>`;
  document.querySelectorAll('.private-only').forEach(el => el.hidden = true);
  const viewer = $('#viewer');
  if (viewer) viewer.hidden = true;
  showStatus('');
}

// ─────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────
function render() {
  tbody.innerHTML = '';
  const byline = $('#byline');

  if (byline) {
    if (isOwner) {
      byline.textContent = `${ownerUsername || 'You'} · ${items.length} ${items.length === 1 ? 'lesson' : 'lessons'}`;
    } else {
      const ownerLabel = items.length ? (byline.dataset.ownerName || 'Shared collection') : 'Shared collection';
      byline.textContent = `Read-only · ${items.length} ${items.length === 1 ? 'lesson' : 'lessons'}`;
    }
  }

  if (items.length === 0) {
    const msg = isOwner
      ? `Save ${KIND === 'bookmarks' ? 'a bookmark' : KIND === 'notes' ? 'a note' : 'a highlight'} from a reading page to see it here.`
      : 'This shared collection currently has no saved lessons.';
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><strong>Nothing here yet</strong><p>${msg}</p></div></td></tr>`;
    return;
  }

  items.forEach((item, i) => tbody.appendChild(buildRow(item, i)));
}

function buildRow(item, index) {
  const tr = document.createElement('tr');

  // # column
  const numCell = document.createElement('td');
  numCell.textContent = String(index + 1);
  tr.append(numCell);

  // Title column
  const titleCell = document.createElement('td');
  const topic = document.createElement('div');
  topic.className = 'topic';

  const img = document.createElement('img');
  img.src = `/assets/courses/${item.course_id}.png`;
  img.alt = '';
  img.onerror = () => { img.style.visibility = 'hidden'; };

  const titleLink = document.createElement('a');
  titleLink.href = lessonURL(item.course_id, item.lesson_id);
  titleLink.textContent = item.meta.title || item.lesson_id;
  titleLink.className = 'topic-title';

  topic.append(img, titleLink);
  titleCell.append(topic);
  tr.append(titleCell);

  // Course
  const courseCell = document.createElement('td');
  courseCell.textContent = courseTitles[item.course_id] || item.course_id;
  tr.append(courseCell);

  // Chapter
  const chapterCell = document.createElement('td');
  chapterCell.textContent = item.meta.chapter || '—';
  tr.append(chapterCell);

  // Date
  const dateCell = document.createElement('td');
  dateCell.textContent = formatDate(item.updated_at);
  tr.append(dateCell);

  // Order (arrows only in custom mode for owner)
  const orderCell = document.createElement('td');
  if (isOwner && sortMode === 'custom') {
    const pair = document.createElement('div');
    pair.className = 'reorder';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.setAttribute('aria-label', 'Move up');
    up.addEventListener('click', () => reorder(index, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === items.length - 1;
    down.setAttribute('aria-label', 'Move down');
    down.addEventListener('click', () => reorder(index, +1));
    pair.append(up, down);
    orderCell.append(pair);
  } else {
    orderCell.textContent = '—';
  }
  tr.append(orderCell);

  // Actions
  const actionCell = document.createElement('td');
  actionCell.className = 'dotmenu';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dots';
  trigger.textContent = '⋯';
  trigger.setAttribute('aria-label', `Actions for ${item.meta.title || item.lesson_id}`);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    openRowMenu(trigger, item);
  });
  actionCell.append(trigger);
  tr.append(actionCell);

  return tr;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

// ─────────────────────────────────────────────────────────────
// Custom sort
// ─────────────────────────────────────────────────────────────
async function reorder(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  const previous = items.slice();
  [items[index], items[target]] = [items[target], items[index]];
  render();
  try {
    await saveOrder(KIND, items);
    showStatus('Custom order saved.');
  } catch (e) {
    items = previous;
    render();
    showStatus('Could not save order: ' + e.message, true);
  }
}

async function clearSortOrder(kind) {
  if (kind === 'bookmarks') {
    const uid = await owner();
    const { error } = await supabase
      .from('reading_bookmarks')
      .update({ sort_index: null })
      .eq('owner_id', uid);
    if (error) throw Error(error.message);
  } else {
    await saveOrder(kind, []); // deletes all rows for highlights/notes
  }
}

// ─────────────────────────────────────────────────────────────
// Row menu
// ─────────────────────────────────────────────────────────────
function openRowMenu(trigger, item) {
  if (openMenu) {
    const sameTrigger = activeDotTrigger === trigger;
    closeMenu();
    if (sameTrigger) return;
  }
  activeDotTrigger = trigger;

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');

  const addItem = (label, handler, opts = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('role', 'menuitem');
    btn.addEventListener('click', async () => {
      closeMenu();
      if (opts.danger && !confirm(opts.confirmText || 'Continue?')) return;
      try { await handler(); } catch (e) { showStatus(e.message, true); }
    });
    menu.append(btn);
  };

  addItem('Change order', () => {
    if (sortMode !== 'custom') {
      sortMode = 'custom';
      const sortBtn = document.getElementById('sort');
      if (sortBtn) sortBtn.textContent = 'Sort: Custom';
      render();
      showStatus('Use the ↑ / ↓ arrows in the Order column to rearrange.');
    } else {
      showStatus('Use the ↑ / ↓ arrows in the Order column to rearrange.');
    }
  });

  addItem('Go to chapter', () => {
    location.assign(`/read/${item.course_id}.html?unit=${item.meta.unitIndex}&chapter=${item.meta.chapterIndex}`);
  });

  addItem('Go to course', () => {
    location.assign(`/read/${item.course_id}.html`);
  });

  addItem('Share lesson', async () => {
    const url = isOwner ? await ownerShareURL(item.course_id, item.lesson_id) : lessonURL(item.course_id, item.lesson_id);
    await presentShare(item.meta.title || item.lesson_id, url);
  });

  if (isOwner) {
    addItem('Download lesson', async () => {
      if (!offlineExport) { showStatus('Offline export is unavailable on this build.', true); return; }
      const annotations = allRows.filter(a => a.course_id === item.course_id && a.lesson_id === item.lesson_id);
      await offlineExport.downloadOfflineLesson(item.course_id, item.lesson_id, annotations);
      showStatus('Offline lesson downloaded.');
    });

    if (KIND === 'bookmarks') {
      addItem('Remove bookmark', async () => {
        await setBookmark(item.course_id, item.lesson_id, false);
        await reload();
      }, { danger: true, confirmText: `Remove "${item.meta.title}" from Bookmarks?` });
    } else {
      const label = KIND === 'highlights' ? 'highlights' : 'notes';
      const kindParam = KIND === 'highlights' ? 'highlight' : 'note';
      addItem(`Delete all ${label} from this lesson`, async () => {
        await clearLessonAnnotations(item.course_id, item.lesson_id, kindParam);
        await reload();
      }, { danger: true, confirmText: `Delete every ${kindParam} in "${item.meta.title}"? This cannot be undone.` });
    }
  }

  trigger.setAttribute('aria-expanded', 'true');
  trigger.parentElement.append(menu);
  openMenu = menu;
  document.addEventListener('click', outsideMenuClick, { capture: true });
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  if (activeDotTrigger) activeDotTrigger.setAttribute('aria-expanded', 'false');
  openMenu = null;
  activeDotTrigger = null;
  document.removeEventListener('click', outsideMenuClick, { capture: true });
}

function outsideMenuClick(e) {
  if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.dots')) closeMenu();
}

// ─────────────────────────────────────────────────────────────
// Share helpers
// ─────────────────────────────────────────────────────────────
async function ownerShareURL(course, lesson) {
  const hasAnnotations = allRows.some(a => a.course_id === course && a.lesson_id === lesson);
  if (!hasAnnotations) return lessonURL(course, lesson);
  try {
    const link = await getAnnotationLink(course, lesson);
    if (!link || link.revoked_at) return lessonURL(course, lesson);
    return annotationLink(course, lesson, link.token);
  } catch {
    return lessonURL(course, lesson);
  }
}

async function presentShare(title, url) {
  const outcome = await shareText(title, url, '');
  if (outcome === 'shared' || outcome === 'cancelled') return;
  openModal(title);
  const wrap = document.createElement('div');
  wrap.append(Object.assign(document.createElement('p'),
    { textContent: 'This link opens the collection as it is right now.' }));

  const input = document.createElement('input');
  input.className = 'share-url';
  input.readOnly = true;
  input.value = url;
  input.setAttribute('aria-label', 'Share URL');
  wrap.append(input);

  const actions = document.createElement('div');
  actions.className = 'share-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy link';
  copyBtn.addEventListener('click', async () => {
    try { await copyText(url); closeModal(); showStatus('Copied to clipboard!'); }
    catch { showStatus('Copy failed.', true); }
  });
  actions.append(copyBtn);

  for (const [label, href] of [
    ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(url)}`],
    ['Telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}`],
    ['Email',    `mailto:?body=${encodeURIComponent(url)}`]
  ]) {
    const a = document.createElement('a');
    a.href = href; a.textContent = label;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    actions.append(a);
  }

  wrap.append(actions);
  dialogBody.append(wrap);
}

// ─────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────
function openModal(title) {
  dialogTitle.textContent = title;
  dialogBody.replaceChildren();
  dialog.classList.add('open');
  const close = $('#close-dialog');
  if (close) close.focus();
}

function closeModal() {
  dialog.classList.remove('open');
  dialogBody.replaceChildren();
}

// ─────────────────────────────────────────────────────────────
// Reload helper
// ─────────────────────────────────────────────────────────────
async function reload() {
  // Simple, guaranteed-fresh reload preserves state via cache-busting
  location.reload();
}

// ─────────────────────────────────────────────────────────────
// Page-level actions
// ─────────────────────────────────────────────────────────────
function installActions() {
  // Close dialog
  const closeBtn = $('#close-dialog');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dialog) dialog.addEventListener('click', e => { if (e.target === dialog) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeMenu(); }
  });

  // Share collection
  const shareBtn = $('#share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (!isOwner) return;
      if (!ownerUsername) {
        showStatus('Add a username to your profile to share a collection.', true);
        return;
      }
      try {
        await shareCollection(KIND);
        const url = new URL(collectionURL(KIND, ownerUsername), location.origin).href;
        await presentShare(`My ${KIND}`, url);
      } catch (e) {
        showStatus('Could not enable sharing: ' + e.message, true);
      }
    });
  }

  // Download collection
  const downloadBtn = $('#download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      if (!isOwner) return;
      if (!offlineExport) {
        showStatus('Offline export is unavailable on this build.', true);
        return;
      }
      downloadBtn.disabled = true;
      showStatus('Preparing offline HTML pages…');
      try {
        await offlineExport.downloadOfflineCollection(KIND, ownerUsername || 'collection', items, allRows);
        showStatus('Offline ZIP downloaded.');
      } catch (e) {
        showStatus('Download failed: ' + e.message, true);
      } finally {
        downloadBtn.disabled = false;
      }
    });
  }

  // Sort toggle
  const sortBtn = $('#sort');
  if (sortBtn) {
    sortBtn.addEventListener('click', async () => {
      if (!isOwner) return;
      if (sortMode === 'custom') {
        try {
          await clearSortOrder(KIND);
          sortMode = 'recent';
          sortBtn.textContent = 'Sort: Recent';
          await reload();
        } catch (e) {
          showStatus('Could not clear custom order: ' + e.message, true);
        }
      } else {
        try {
          await saveOrder(KIND, items);
          sortMode = 'custom';
          sortBtn.textContent = 'Sort: Custom';
          render();
          showStatus('Use the ↑ / ↓ arrows in the Order column to rearrange.');
        } catch (e) {
          showStatus('Could not switch to custom order: ' + e.message, true);
        }
      }
    });
  }

  // Add (bookmarks: shows Add buttons; highlights/notes: opens reading page)
  const addBtn = $('#add');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!isOwner) return;
      openAddModal();
    });
  }

  // Bookmark the newly opened collection page in history is handled by
  // the URL path — nothing else to install.
}

// ─────────────────────────────────────────────────────────────
// Add modal — course browser
// ─────────────────────────────────────────────────────────────
async function openAddModal() {
  openModal(KIND === 'bookmarks' ? 'Add Topics' : KIND === 'highlights' ? 'Add Highlights' : 'Add Notes');

  const hint = document.createElement('p');
  hint.textContent = KIND === 'bookmarks'
    ? 'Select a reading lesson to bookmark.'
    : `Open a reading lesson to add ${KIND === 'highlights' ? 'highlights' : 'notes'}. The lesson appears here once you save at least one.`;
  dialogBody.append(hint);

  let courses = userCourses();
  if (courses.length === 0) courses = availableCourses.slice();

  if (courses.length === 0) {
    dialogBody.append(Object.assign(document.createElement('p'),
      { textContent: 'No courses are available to browse.' }));
    return;
  }

  const bookmarkedLessons = new Set(items.map(it => `${it.course_id}|${it.lesson_id}`));

  for (const courseId of courses) {
    const courseWrap = document.createElement('div');
    courseWrap.className = 'course';

    const courseBtn = document.createElement('button');
    courseBtn.type = 'button';
    courseBtn.textContent = courseTitles[courseId] || courseId;
    courseWrap.append(courseBtn);

    let loaded = false;
    let tocBody = null;

    courseBtn.addEventListener('click', async () => {
      if (loaded && tocBody) {
        tocBody.hidden = !tocBody.hidden;
        return;
      }
      loaded = true;
      tocBody = document.createElement('div');
      tocBody.className = 'course-toc';
      courseWrap.append(tocBody);

      try {
        const resp = await fetch(`/data/toc/${courseId}.json`);
        if (!resp.ok) throw Error('Could not load course contents.');
        const toc = await resp.json();

        for (const unit of toc.units || []) {
          const unitEl = document.createElement('details');
          unitEl.className = 'unit';
          unitEl.append(Object.assign(document.createElement('summary'), { textContent: unit.title || 'Unit' }));

          for (const chapter of unit.chapters || []) {
            const chapEl = document.createElement('details');
            chapEl.className = 'chapter';
            chapEl.append(Object.assign(document.createElement('summary'), { textContent: chapter.title || 'Chapter' }));

            for (const lesson of chapter.lessons || []) {
              const parsed = parseLessonLink(lesson.link);
              if (!parsed) continue;
              const row = document.createElement('div');
              row.className = 'lesson-row';

              const a = document.createElement('a');
              a.href = lessonURL(parsed.course, parsed.lesson);
              a.textContent = `${lesson.number ? lesson.number + '. ' : ''}${lesson.title || parsed.lesson}`;
              row.append(a);

              if (KIND === 'bookmarks') {
                const already = bookmarkedLessons.has(`${parsed.course}|${parsed.lesson}`);
                const addBtnInner = document.createElement('button');
                addBtnInner.type = 'button';
                addBtnInner.textContent = already ? 'Added' : 'Add';
                addBtnInner.disabled = already;
                addBtnInner.addEventListener('click', async () => {
                  try {
                    await setBookmark(parsed.course, parsed.lesson, true);
                    addBtnInner.textContent = 'Added';
                    addBtnInner.disabled = true;
                    bookmarkedLessons.add(`${parsed.course}|${parsed.lesson}`);
                    showStatus(`Bookmarked "${lesson.title}".`);
                  } catch (e) {
                    showStatus('Could not bookmark: ' + e.message, true);
                  }
                });
                row.append(addBtnInner);
              } else {
                const openTag = document.createElement('a');
                openTag.href = lessonURL(parsed.course, parsed.lesson);
                openTag.textContent = 'Open →';
                openTag.style.fontSize = '12px';
                openTag.style.color = 'var(--accent)';
                row.append(openTag);
              }

              chapEl.append(row);
            }

            unitEl.append(chapEl);
          }

          tocBody.append(unitEl);
        }
      } catch (e) {
        tocBody.append(Object.assign(document.createElement('p'), { textContent: e.message }));
      }
    });

    dialogBody.append(courseWrap);
  }
}

function parseLessonLink(link) {
  if (typeof link !== 'string') return null;
  const m = link.match(/^\/read\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/);
  return m ? { course: m[1], lesson: m[2] } : null;
}
