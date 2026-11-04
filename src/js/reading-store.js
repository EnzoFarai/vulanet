// src/js/reading-store.js
// ============================================================
// Canonical reading data layer for Vulanet.
//
// Supabase is authoritative. localStorage is used only for
// UI-state caching (which courses the user has added to their
// dashboard). No user annotation data ever lives in localStorage.
//
// URL contracts (v6 §5.1):
//   Personalised lesson: /read/{course}/{lesson}.html?view={token}
//   Collections:          /bookmarks/{username}
//                         /highlights/{username}
//                         /notes/{username}
//
// Token contract (v6 §5.2):
//   22-character Base64URL, generated server-side by public._random_token().
//   This module treats tokens as opaque strings.
//
// Table access pattern (v6 §5.4):
//   reading_annotations        — SELECT / INSERT / UPDATE / DELETE (owner)
//   reading_bookmarks          — SELECT / INSERT / UPDATE / DELETE (owner)
//   reading_collection_links   — SELECT / INSERT / UPDATE / DELETE (owner)
//   reading_collection_order   — SELECT / INSERT / UPDATE / DELETE (owner)
//   reading_annotation_links   — SELECT only; writes via triggers + RPCs
// ============================================================

import { supabase, getCurrentUserId } from '/src/js/supabase.js';
import { courses } from '/src/js/course-data.js';

export { supabase };

// ─────────────────────────────────────────────────────────────
// Course registry — derived from course-data.js so there is
// one source of truth for course names and IDs.
// ─────────────────────────────────────────────────────────────
export const courseTitles = Object.fromEntries(
  Object.values(courses).map(c => [c.id, c.displayName || c.name])
);
export const availableCourses = Object.keys(courses);

// ─────────────────────────────────────────────────────────────
// Enrolled courses (UI state, not user data)
//
// The Vulanet dashboard tracks which courses the user has added
// via localStorage. These keys are the same ones used by
// practice-hub.html and the header course-switcher panel.
// ─────────────────────────────────────────────────────────────
export function userCourses() {
  let ids = [];
  try {
    const raw = localStorage.getItem('userCourses');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed;
    }
  } catch { /* malformed; fall through */ }
  const active = localStorage.getItem('selectedCourseId');
  if (active) ids.unshift(active);
  return [...new Set(ids.filter(id => availableCourses.includes(id)))];
}

// ─────────────────────────────────────────────────────────────
// Slug validation
// ─────────────────────────────────────────────────────────────
const slugOk = s => typeof s === 'string' && /^[a-z0-9-]{1,120}$/.test(s);

// ─────────────────────────────────────────────────────────────
// URL builders
// ─────────────────────────────────────────────────────────────
export const lessonURL = (course, lesson) =>
  slugOk(course) && slugOk(lesson) ? `/read/${course}/${lesson}.html` : '#';

export const safeLesson = (course, lesson) =>
  slugOk(course) && slugOk(lesson) && availableCourses.includes(course);

// v6 §5.1 — collection URLs are username-based.
export const collectionURL = (kind, username) => {
  if (!['bookmarks', 'highlights', 'notes'].includes(kind)) return '#';
  if (!username) return `/${kind}.html`;
  return `/${kind}/${encodeURIComponent(username)}`;
};

// v6 §5.1 — personalised lesson URL uses ?view=, not ?annotations=.
export const annotationLink = (course, lesson, token) => {
  const base = lessonURL(course, lesson);
  if (base === '#') return '#';
  const path = token ? `${base}?view=${encodeURIComponent(token)}` : base;
  return new URL(path, location.origin).href;
};

// ─────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────
export async function owner() {
  const uid = await getCurrentUserId();
  if (!uid) {
    throw Error('Please sign in to save and access your reading collections.');
  }
  return uid;
}

export async function ownerProfile() {
  const uid = await owner();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw Error(error.message);
  return data;
}

// ─────────────────────────────────────────────────────────────
// Small helper: unwrap supabase responses, throwing on error
// ─────────────────────────────────────────────────────────────
function checked(result) {
  if (result.error) throw Error(result.error.message);
  return result.data;
}

// ─────────────────────────────────────────────────────────────
// Bookmarks
// ─────────────────────────────────────────────────────────────
export async function myBookmarks() {
  const uid = await owner();
  return checked(await supabase
    .from('reading_bookmarks')
    .select('*')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false }));
}

export async function setBookmark(course, lesson, on) {
  if (!safeLesson(course, lesson)) throw Error('Unknown lesson identifier');
  const uid = await owner();
  if (on) {
    checked(await supabase
      .from('reading_bookmarks')
      .upsert(
        { owner_id: uid, course_id: course, lesson_id: lesson },
        { onConflict: 'owner_id,course_id,lesson_id', ignoreDuplicates: true }
      ));
  } else {
    checked(await supabase
      .from('reading_bookmarks')
      .delete()
      .eq('owner_id', uid)
      .eq('course_id', course)
      .eq('lesson_id', lesson));
  }
}

// ─────────────────────────────────────────────────────────────
// Annotations (highlights and notes)
//
// DB CHECK constraint (v6 §5.10):
//   highlight: color NOT NULL AND color IN (six) AND body = ''
//   note:      color IS NULL
// ─────────────────────────────────────────────────────────────
const HIGHLIGHT_COLORS = ['bee', 'boa', 'gecko', 'ladybug', 'tiger', 'beetle'];

export async function myAnnotations(course, lesson) {
  const uid = await owner();
  return checked(await supabase
    .from('reading_annotations')
    .select('*')
    .eq('owner_id', uid)
    .eq('course_id', course)
    .eq('lesson_id', lesson)
    .order('created_at', { ascending: true }));
}

export async function allAnnotations(kind) {
  const uid = await owner();
  let q = supabase
    .from('reading_annotations')
    .select('*')
    .eq('owner_id', uid)
    .order('updated_at', { ascending: false });
  if (kind) q = q.eq('kind', kind);
  return checked(await q);
}

export async function putAnnotation(
  course, lesson, kind,
  start, end, quote,
  body = '', color = null
) {
  if (!safeLesson(course, lesson)) throw Error('Unknown lesson identifier');
  if (!['highlight', 'note'].includes(kind)) throw Error('Invalid annotation kind');
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end <= start || end - start > 10000) {
    throw Error('Invalid annotation anchor');
  }

  // Normalise to the CHECK constraint's expected shape.
  let normalizedColor = null;
  let normalizedBody = body || '';
  if (kind === 'highlight') {
    if (!HIGHLIGHT_COLORS.includes(color)) {
      throw Error('Highlight requires one of the six colours');
    }
    normalizedColor = color;
    normalizedBody = '';
  } else {
    normalizedColor = null;
  }

  const uid = await owner();
  const result = await supabase
    .from('reading_annotations')
    .insert({
      owner_id: uid,
      course_id: course,
      lesson_id: lesson,
      kind,
      start_offset: start,
      end_offset: end,
      quote,
      body: normalizedBody,
      color: normalizedColor
    })
    .select()
    .single();

  // The AFTER INSERT trigger `_reading_annotations_ensure_link` creates
  // the reading_annotation_links row server-side. The client has SELECT-only
  // access to that table and must not attempt a direct write.
  return checked(result);
}

// Only `body` and `color` are mutable. The BEFORE UPDATE trigger
// `_reading_annotations_identity_guard` rejects any other change.
export async function updateAnnotation(id, patch) {
  if (!id) throw Error('Annotation id required');
  const allowed = {};
  if (patch && patch.body !== undefined) allowed.body = String(patch.body);
  if (patch && patch.color !== undefined) {
    if (!HIGHLIGHT_COLORS.includes(patch.color)) {
      throw Error('Invalid highlight colour');
    }
    allowed.color = patch.color;
  }
  if (Object.keys(allowed).length === 0) throw Error('Nothing to update');
  const uid = await owner();
  return checked(await supabase
    .from('reading_annotations')
    .update(allowed)
    .eq('owner_id', uid)
    .eq('id', id)
    .select()
    .single());
}

export async function deleteAnnotation(id) {
  if (!id) throw Error('Annotation id required');
  const uid = await owner();
  checked(await supabase
    .from('reading_annotations')
    .delete()
    .eq('owner_id', uid)
    .eq('id', id));
  // The AFTER DELETE trigger `_reading_annotation_links_cleanup` removes
  // the corresponding link row when the last annotation for the lesson
  // is deleted. Clients never touch that table directly.
}

export async function clearLessonAnnotations(course, lesson, kind) {
  if (!['highlight', 'note'].includes(kind)) throw Error('Invalid annotation kind');
  const uid = await owner();
  checked(await supabase
    .from('reading_annotations')
    .delete()
    .eq('owner_id', uid)
    .eq('course_id', course)
    .eq('lesson_id', lesson)
    .eq('kind', kind));
  // Link cleanup handled by the same trigger.
}

// ─────────────────────────────────────────────────────────────
// Annotation links (personalised ?view= tokens)
//
// reading_annotation_links is SELECT-only to authenticated clients.
// Writes go through:
//   • AFTER INSERT trigger (creates the row on first annotation)
//   • AFTER DELETE trigger (removes the row on last annotation deletion)
//   • revoke_annotation_link / reshare_annotation_link RPCs
// ─────────────────────────────────────────────────────────────
export async function getAnnotationLink(course, lesson) {
  const uid = await owner();
  const row = checked(await supabase
    .from('reading_annotation_links')
    .select('token, revoked_at')
    .eq('owner_id', uid)
    .eq('course_id', course)
    .eq('lesson_id', lesson)
    .maybeSingle());
  return row || null;
}

export async function revokeAnnotationLink(course, lesson) {
  return checked(await supabase.rpc('revoke_annotation_link', {
    p_course_id: course,
    p_lesson_id: lesson
  }));
}

export async function reshareAnnotationLink(course, lesson) {
  return checked(await supabase.rpc('reshare_annotation_link', {
    p_course_id: course,
    p_lesson_id: lesson
  }));
}

// Returns one of:
//   { status: 'ok', data: { course_id, lesson_id, owner_name, annotations[] } }
//   { status: 'revoked' }
//   null — invalid token or zero annotations
export async function sharedLesson(token) {
  if (!token) return null;
  return checked(await supabase.rpc('get_shared_reading_lesson', { p_token: token }));
}

// ─────────────────────────────────────────────────────────────
// Collections (username-based, v6 §23)
//
// get_collection_by_username returns uniform { status: 'denied' }
// for every deny reason (missing user, private, revoked, wrong kind).
// Callers must NOT branch on a specific deny reason.
// ─────────────────────────────────────────────────────────────
export async function getCollectionByUsername(username, kind) {
  if (!username || !['bookmarks', 'highlights', 'notes'].includes(kind)) {
    return { status: 'denied' };
  }
  return checked(await supabase.rpc('get_collection_by_username', {
    p_username: username,
    p_kind: kind
  }));
}

// Sets visibility='public', clears revoked_at, upserts the link row.
// Caller then shares collectionURL(kind, username).
export async function shareCollection(kind) {
  if (!['bookmarks', 'highlights', 'notes'].includes(kind)) {
    throw Error('Invalid collection kind');
  }
  return checked(await supabase.rpc('share_collection', { p_kind: kind }));
}

// ─────────────────────────────────────────────────────────────
// Custom ordering
//
// Bookmarks use reading_bookmarks.sort_index directly.
// Highlights and notes use reading_collection_order.
// ─────────────────────────────────────────────────────────────
export async function customOrder(kind) {
  const uid = await owner();
  if (kind === 'bookmarks') return myBookmarks();
  return checked(await supabase
    .from('reading_collection_order')
    .select('course_id, lesson_id, sort_index')
    .eq('owner_id', uid)
    .eq('kind', kind)
    .order('sort_index', { ascending: true }));
}

export async function saveOrder(kind, entries) {
  if (!Array.isArray(entries)) throw Error('entries must be an array');
  const uid = await owner();

  if (kind === 'bookmarks') {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      checked(await supabase
        .from('reading_bookmarks')
        .update({ sort_index: i })
        .eq('owner_id', uid)
        .eq('course_id', e.course_id)
        .eq('lesson_id', e.lesson_id));
    }
    return;
  }

  // highlights / notes: delete removed, upsert current
  const existing = checked(await supabase
    .from('reading_collection_order')
    .select('course_id, lesson_id')
    .eq('owner_id', uid)
    .eq('kind', kind));
  const desired = new Set(entries.map(e => `${e.course_id}|${e.lesson_id}`));
  for (const e of existing) {
    if (!desired.has(`${e.course_id}|${e.lesson_id}`)) {
      checked(await supabase
        .from('reading_collection_order')
        .delete()
        .eq('owner_id', uid)
        .eq('kind', kind)
        .eq('course_id', e.course_id)
        .eq('lesson_id', e.lesson_id));
    }
  }
  if (entries.length > 0) {
    const records = entries.map((e, i) => ({
      owner_id: uid,
      kind,
      course_id: e.course_id,
      lesson_id: e.lesson_id,
      sort_index: i
    }));
    checked(await supabase
      .from('reading_collection_order')
      .upsert(records, { onConflict: 'owner_id,kind,course_id,lesson_id' }));
  }
}

// ─────────────────────────────────────────────────────────────
// Lesson metadata (from /data/toc/{course}.json)
//
// Returns a stable shape regardless of whether the TOC is found,
// so callers can render without null checks.
// ─────────────────────────────────────────────────────────────
export async function getLessonMeta(course, lesson) {
  try {
    const r = await fetch(`/data/toc/${course}.json`);
    if (!r.ok) throw Error('Missing course TOC');
    const toc = await r.json();
    for (const [ui, u] of toc.units.entries()) {
      for (const [ci, c] of u.chapters.entries()) {
        for (const l of c.lessons) {
          if (l.link === lessonURL(course, lesson)) {
            return {
              course,
              title: l.title,
              unit: u.title,
              chapter: c.title,
              unitIndex: ui,
              chapterIndex: ci,
              number: l.number
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('getLessonMeta:', e);
  }
  return {
    course,
    title: lesson.replace(/-/g, ' '),
    unit: '',
    chapter: '',
    unitIndex: 0,
    chapterIndex: 0,
    number: 0
  };
}

// ─────────────────────────────────────────────────────────────
// URL parsing
// ─────────────────────────────────────────────────────────────
export function lessonFromPath(path = location.pathname) {
  const m = path.match(/^\/read\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/);
  return m ? { course: m[1], lesson: m[2] } : null;
}

export function collectionFromPath(path = location.pathname) {
  const m = path.match(/^\/(bookmarks|highlights|notes)\/([^/?#]+)\/?$/);
  if (!m) return null;
  let username = m[2];
  try { username = decodeURIComponent(username); } catch { /* leave raw */ }
  return { kind: m[1], username };
}

// ─────────────────────────────────────────────────────────────
// Sharing helpers
//
// shareText returns 'shared' | 'cancelled' | 'fallback'.
// Callers must NOT treat 'cancelled' as 'fallback' — a user
// dismissing the native sheet must exit silently.
// ─────────────────────────────────────────────────────────────
export async function shareText(title, url, passage = '') {
  if (navigator.share) {
    try {
      const data = { title, url };
      if (passage) data.text = passage;
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // Other errors — fall through to 'fallback' so the UI can
      // offer alternatives rather than silently failing.
    }
  }
  return 'fallback';
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); }
  catch { ok = false; }
  ta.remove();
  if (!ok) throw Error('Copy failed');
  return true;
}
