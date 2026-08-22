// src/js/glossary-preview.js
/**
 * Glossary Preview – adds hover/tap preview to glossary links in reading pages.
 * Expects window.glossaryData to be defined (course-specific glossary).
 * Attaches to elements with class 'glossary-link'.
 * Tracks discovery when 'View in Glossary' is clicked.
 */

(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        const glossaryData = window.glossaryData;
        if (!glossaryData || !glossaryData.terms) {
            console.warn('Glossary data not found for preview. Ensure window.glossaryData is set.');
            return;
        }

        const courseId = glossaryData.courseId || 'unknown';
        const termsMap = {};
        glossaryData.terms.forEach(t => {
            const term = t.term.toLowerCase();
            termsMap[term] = t;
            // Also add singular form if term ends with 's' and is longer than 1 char
            if (term.endsWith('s') && term.length > 1) {
                const singular = term.slice(0, -1);
                if (!termsMap[singular]) {
                    termsMap[singular] = t;
                }
            }
        });

        const links = document.querySelectorAll('.glossary-link');
        links.forEach(link => {
            const termAttr = link.dataset.term;
            if (!termAttr) return;
            const termKey = termAttr.toLowerCase();
            const termObj = termsMap[termKey];
            if (!termObj) {
                console.warn(`Glossary term "${termAttr}" not found in data.`);
                return;
            }
            const trigger = document.createElement('span');
            trigger.className = 'preview-trigger';
            link.parentNode.insertBefore(trigger, link);
            trigger.appendChild(link);

            const card = document.createElement('span');
            card.className = 'preview-card';
            card.innerHTML = `
                <span class="glossary-term">${termObj.term}</span>
                <span class="glossary-definition">${termObj.definition}</span>
                <a href="#" class="glossary-view-link" data-term="${encodeURIComponent(termObj.term)}">View in Glossary</a>
            `;
            trigger.appendChild(card);

            setupPreview(trigger, card, link, courseId);
        });
    }

    function setupPreview(trigger, card, link, courseId) {
        let timeoutId = null;
        let isActive = false;

        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        let overlay = document.getElementById('glossary-preview-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'glossary-preview-overlay';
            overlay.className = 'dismiss-overlay';
            document.body.appendChild(overlay);
        }

        function showPreview() {
            clearTimeout(timeoutId);
            if (!isActive) {
                isActive = true;
                trigger.classList.add('active');
                if (isTouchDevice) {
                    overlay.classList.add('show');
                }
            }
        }

        function hidePreviewDelayed() {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if (isActive) {
                    isActive = false;
                    trigger.classList.remove('active');
                    if (isTouchDevice) {
                        overlay.classList.remove('show');
                    }
                }
            }, 200);
        }

        function hidePreviewImmediate() {
            clearTimeout(timeoutId);
            if (isActive) {
                isActive = false;
                trigger.classList.remove('active');
                if (isTouchDevice) {
                    overlay.classList.remove('show');
                }
            }
        }

        function togglePreview(e) {
            e.preventDefault();
            if (isActive) {
                hidePreviewImmediate();
            } else {
                showPreview();
            }
        }

        if (!isTouchDevice) {
            trigger.addEventListener('mouseenter', showPreview);
            trigger.addEventListener('mouseleave', hidePreviewDelayed);
            card.addEventListener('mouseenter', () => clearTimeout(timeoutId));
            card.addEventListener('mouseleave', hidePreviewDelayed);
        }

        link.addEventListener('click', togglePreview);
        link.addEventListener('contextmenu', (e) => e.preventDefault());

        const viewLink = card.querySelector('.glossary-view-link');
        if (viewLink) {
            viewLink.addEventListener('click', function(e) {
                e.preventDefault();
                const term = decodeURIComponent(this.dataset.term);
                recordDiscovery(courseId, term);
                window.location.href = `/glossary/${courseId}.html?term=${encodeURIComponent(term)}`;
            });
        }

        overlay.addEventListener('click', hidePreviewImmediate);

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isActive) {
                hidePreviewImmediate();
            }
        });

        card.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        trigger.addEventListener('click', function(e) {
            if (e.target === trigger) {
                if (isActive) {
                    hidePreviewImmediate();
                } else {
                    showPreview();
                }
            }
        });
    }

    function recordDiscovery(courseId, term) {
        const key = `glossary_discovered_${courseId}`;
        let discovered = JSON.parse(localStorage.getItem(key) || '{}');
        if (!discovered[term]) {
            discovered[term] = true;
            localStorage.setItem(key, JSON.stringify(discovered));
            window.dispatchEvent(new CustomEvent('glossaryDiscover', {
                detail: { courseId, term }
            }));
            console.log(`Glossary discovery (from preview): ${courseId} → ${term}`);
        }
    }
})();
