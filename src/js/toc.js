// src/js/toc.js
export async function initTOC() {
  const menuBtn = document.getElementById('menuBtn');
  if (!menuBtn) return; // Not on a reading page

  const pathParts = window.location.pathname.split('/');
  let courseId = pathParts[2];
  if (courseId && courseId.endsWith('.html')) {
    courseId = courseId.replace('.html', '');
  }

  if (!courseId) return;

  // Inject sidebar HTML
  const overlay = document.createElement('div');
  overlay.className = 'toc-overlay';
  overlay.id = 'tocOverlay';
  overlay.innerHTML = `
    <div class="toc-sidebar">
      <div class="toc-header">
        <div class="toc-course-icon" id="tocCourseIcon">
          <img src="/assets/courses/${courseId}.png" alt="Course" id="tocCourseImg" onerror="this.style.display='none'">
          <span id="tocCourseName">Loading...</span>
        </div>
        <button class="toc-close-btn" id="tocCloseBtn">
          <img src="/assets/icons/phosphor/regular/x.svg" alt="Close">
        </button>
      </div>
      <div id="tocTreeContainer"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('tocCloseBtn');
  
  function openSidebar() {
    overlay.style.display = 'block';
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }
  
  function closeSidebar() {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 350);
    document.body.style.overflow = '';
  }

  menuBtn.addEventListener('click', openSidebar);
  closeBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSidebar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeSidebar();
  });

  document.getElementById('tocCourseIcon').addEventListener('click', () => {
    const headerCourseIcon = document.querySelector('#activeCourseIcon');
    if (headerCourseIcon) headerCourseIcon.click();
    closeSidebar();
  });

  try {
    const resp = await fetch(`/data/toc/${courseId}.json`);
    if (!resp.ok) throw new Error('Failed to load TOC');
    const tocData = await resp.json();
    
    document.getElementById('tocCourseName').textContent = courseId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    renderTOC(tocData, 'tocTreeContainer', window.location.pathname);
  } catch (e) {
    console.warn('TOC Load Error:', e);
    document.getElementById('tocTreeContainer').innerHTML = '<p style="padding:20px;color:#666;">Could not load course contents.</p>';
  }
}

function renderTOC(data, containerId, currentPath) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const COLOR_HEXES = ["#4285F4", "#1CB0F6", "#AA00FF", "#EA4335", "#FF6D01", "#FBBC05", "#34A853"];
  const COLOR_RGBA = ["66,133,244", "28,176,246", "170,0,255", "234,67,53", "255,109,1", "251,188,5", "52,168,83"];
  
  const { units, startingColorIndex = 0 } = data;
  let html = '<ul class="menu">';

  units.forEach((unit, unitIndex) => {
    const unitId = `unit-${unitIndex}`;
    html += `
      <li>
        <a href="#" class="parent-toggle" data-target="${unitId}">
          <span class="item-left"><span class="unit-label">${unit.title}</span></span>
          <img src="/assets/icons/phosphor/regular/caret-right.svg" class="chevron-right" alt="Expand">
        </a>
        <ul class="sub-menu" id="${unitId}">
    `;

    unit.chapters.forEach((chapter, chapterIndex) => {
      const chapterId = `${unitId}-chapter-${chapterIndex}`;
      
      const colorIdx = (chapterIndex + startingColorIndex) % COLOR_HEXES.length;
      const colorHex = COLOR_HEXES[colorIdx];
      const colorRgba = COLOR_RGBA[colorIdx];
      
      const styleAttr = `style="--chapter-color: ${colorHex}; --chapter-glow: rgba(${colorRgba}, 0.08); --chapter-tint: rgba(${colorRgba}, 0.12);"`;

      html += `
        <li>
          <a href="#" class="chapter-toggle" data-target="${chapterId}" ${styleAttr}>
            <span class="item-left">${chapter.title}</span>
            <img src="/assets/icons/phosphor/regular/caret-right.svg" class="chevron-right" alt="Expand">
          </a>
          <ul class="sub-sub-menu" id="${chapterId}">
      `;

      chapter.lessons.forEach((lesson) => {
        const isActive = lesson.link === currentPath;
        html += `
          <li>
            <a href="${lesson.link}" class="${isActive ? 'active' : ''}">
              <span class="item-left">
                <span class="lesson-number">${lesson.number}</span>
                ${lesson.title}
              </span>
            </a>
          </li>
        `;
      });

      html += `</ul></li>`;
    });

    html += `</ul></li>`;
  });

  html += '</ul>';
  container.innerHTML = html;

  container.querySelectorAll('.parent-toggle').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.dataset.target;
      const subMenu = document.getElementById(targetId);
      if (subMenu) {
        subMenu.classList.toggle('open');
        const chevron = this.querySelector('.chevron-right');
        if (chevron) chevron.classList.toggle('open');
      }
    });
  });

  container.querySelectorAll('.chapter-toggle').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const targetId = this.dataset.target;
      const subSubMenu = document.getElementById(targetId);
      if (subSubMenu) {
        subSubMenu.classList.toggle('open');
        const chevron = this.querySelector('.chevron-right');
        if (chevron) chevron.classList.toggle('open');
      }
    });
  });

  const activeLink = container.querySelector('.sub-sub-menu a.active');
  if (activeLink) {
    const subSubMenu = activeLink.closest('.sub-sub-menu');
    if (subSubMenu) {
      subSubMenu.classList.add('open');
      const chapterToggle = subSubMenu.closest('li').querySelector('.chapter-toggle .chevron-right');
      if (chapterToggle) chapterToggle.classList.add('open');
      const subMenu = subSubMenu.closest('.sub-menu');
      if (subMenu) {
        subMenu.classList.add('open');
        const parentToggle = subMenu.closest('li').querySelector('.parent-toggle .chevron-right');
        if (parentToggle) parentToggle.classList.add('open');
      }
    }
    setTimeout(() => {
      activeLink.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }
}
