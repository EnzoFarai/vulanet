// src/js/toc-loader.js
export async function loadTOCData(courseId) {
    const url = `/data/toc/${courseId}.json`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load TOC data for ${courseId}`);
    }
    return response.json();
}

const COLOR_CLASSES = ['color-1', 'color-2', 'color-3', 'color-4', 'color-5', 'color-6', 'color-7'];

export function renderTOC(data, containerId, currentPath) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { units, startingColorIndex } = data;
    const colorOffset = (startingColorIndex || 0) % COLOR_CLASSES.length;

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
            const colorClass = COLOR_CLASSES[(chapterIndex + colorOffset) % COLOR_CLASSES.length];
            html += `
                <li>
                    <a href="#" class="chapter-toggle" data-target="${chapterId}">
                        <span class="item-left">${chapter.title}</span>
                        <img src="/assets/icons/phosphor/regular/caret-right.svg" class="chevron-right" alt="Expand">
                    </a>
                    <ul class="sub-sub-menu ${colorClass}" id="${chapterId}">
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

            html += `
                    </ul>
                </li>
            `;
        });

        html += `
                </ul>
            </li>
        `;
    });

    html += '</ul>';
    container.innerHTML = html;

    // --- Event listeners for toggling ---
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

    // --- Auto‑expand to the current lesson ---
    const activeLink = container.querySelector('.sub-sub-menu a.active');
    if (activeLink) {
        // Expand the chapter (sub-sub-menu) containing this lesson
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
        // Scroll the active link into view
        setTimeout(() => {
            activeLink.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
    }
}
