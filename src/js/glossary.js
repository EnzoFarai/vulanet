// src/js/glossary.js
// Vulanet glossary renderer – uses window.glossaryData

(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        const data = window.glossaryData;
        if (!data || !data.terms || !data.courseId) {
            console.error('Glossary data missing. Set window.glossaryData with courseId and terms.');
            return;
        }

        const container = document.getElementById('glossaryContainer');
        if (!container) {
            console.error('Container #glossaryContainer not found.');
            return;
        }

        buildGlossary(container, data);
        handleUrlTerm(data.courseId);
    }

    function buildGlossary(container, data) {
        // Build header card
        const headerCard = document.createElement('div');
        headerCard.className = 'glossary-header-card';
        headerCard.innerHTML = `
            <div class="header-content">
                <h1>${data.title || 'Glossary'}</h1>
                <div class="subtitle">${data.subtitle || ''}</div>
            </div>
            <div class="header-icon">
                <img src="/assets/icons/phosphor/duotone/notebook.svg" alt="Glossary">
            </div>
        `;
        container.appendChild(headerCard);

        // Build alphabet navigation
        const alphabetNav = document.createElement('div');
        alphabetNav.className = 'glossary-alphabet-nav';
        const terms = data.terms;
        const availableLetters = getAvailableLetters(terms);
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => {
            if (availableLetters.has(letter)) {
                const a = document.createElement('a');
                a.className = 'available';
                a.href = `#letter-${letter}`;
                a.textContent = letter;
                alphabetNav.appendChild(a);
            } else {
                const span = document.createElement('span');
                span.className = 'unavailable';
                span.textContent = letter;
                alphabetNav.appendChild(span);
            }
            if (letter !== 'Z') alphabetNav.appendChild(document.createTextNode(' '));
        });
        container.appendChild(alphabetNav);

        // Build search
        const searchDiv = document.createElement('div');
        searchDiv.className = 'glossary-search';
        searchDiv.innerHTML = `
            <input type="text" id="glossarySearchInput" placeholder="Search for terms…" />
            <div class="search-icons">
                <img src="/assets/icons/phosphor/regular/x.svg" class="clear-icon" id="glossaryClearIcon" alt="Clear" />
                <img src="/assets/icons/phosphor/regular/magnifying-glass.svg" id="glossarySearchIcon" alt="Search" />
            </div>
        `;
        container.appendChild(searchDiv);

        // Build glossary items grouped by letter
        const groups = {};
        terms.forEach(termObj => {
            const firstChar = termObj.term.charAt(0).toUpperCase();
            if (!groups[firstChar]) groups[firstChar] = [];
            groups[firstChar].push(termObj);
        });

        const sortedLetters = Object.keys(groups).sort();
        const listDiv = document.createElement('div');
        listDiv.id = 'glossaryList';

        sortedLetters.forEach(letter => {
            const heading = document.createElement('h2');
            heading.className = 'glossary-letter-heading';
            heading.id = `letter-${letter}`;
            heading.textContent = letter;
            listDiv.appendChild(heading);

            const items = groups[letter].sort((a,b) => a.term.localeCompare(b.term));
            items.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'glossary-item';
                itemDiv.dataset.term = item.term;

                const btn = document.createElement('button');
                btn.className = 'accordion';
                const span = document.createElement('span');
                span.className = 'accordion-text';
                span.textContent = item.term;
                const icon = document.createElement('img');
                icon.className = 'accordion-icon';
                icon.src = '/assets/icons/phosphor/regular/eye-closed.svg';
                icon.alt = 'Toggle';
                btn.appendChild(span);
                btn.appendChild(icon);

                const panel = document.createElement('div');
                panel.className = 'panel';
                const p = document.createElement('p');
                p.textContent = item.definition;
                panel.appendChild(p);

                itemDiv.appendChild(btn);
                itemDiv.appendChild(panel);
                listDiv.appendChild(itemDiv);
            });
        });

        const noResults = document.createElement('div');
        noResults.className = 'glossary-no-results';
        noResults.id = 'glossaryNoResults';
        noResults.innerHTML = `
            <img src="/assets/icons/phosphor/regular/magnifying-glass.svg" alt="No results" />
            <div>No matching terms found. Try a different search.</div>
        `;
        listDiv.appendChild(noResults);

        container.appendChild(listDiv);

        // Attach event listeners
        attachAccordionListeners();
        attachSearchListeners(data.courseId);
        attachAlphabetNavListeners();
        attachKeyboardShortcut();

        // Auto-expand if term in URL
        const urlParams = new URLSearchParams(window.location.search);
        const termParam = urlParams.get('term');
        if (termParam) {
            setTimeout(() => {
                expandTerm(termParam, data.courseId);
            }, 300);
        }
    }

    function getAvailableLetters(terms) {
        const set = new Set();
        terms.forEach(t => {
            const first = t.term.charAt(0).toUpperCase();
            if (first >= 'A' && first <= 'Z') set.add(first);
        });
        return set;
    }

    function attachAccordionListeners() {
        const btns = document.querySelectorAll('.glossary-item .accordion');
        btns.forEach(btn => {
            btn.addEventListener('click', function(e) {
                this.classList.toggle('active');
                const panel = this.nextElementSibling;
                panel.classList.toggle('show');

                const icon = this.querySelector('.accordion-icon');
                if (this.classList.contains('active')) {
                    icon.src = '/assets/icons/phosphor/regular/eye.svg';
                } else {
                    icon.src = '/assets/icons/phosphor/regular/eye-closed.svg';
                }
            });
        });
    }

    function attachSearchListeners(courseId) {
        const input = document.getElementById('glossarySearchInput');
        const clearIcon = document.getElementById('glossaryClearIcon');
        const searchIcon = document.getElementById('glossarySearchIcon');
        const items = document.querySelectorAll('.glossary-item');
        const noResults = document.getElementById('glossaryNoResults');

        let matchItems = [];
        let currentMatchIndex = -1;

        function filterGlossary() {
            const query = input.value.trim().toLowerCase();
            const hasQuery = query.length > 0;

            if (hasQuery) {
                searchIcon.src = '/assets/icons/phosphor/regular/magnifying-glass.svg';
                clearIcon.classList.add('visible');
            } else {
                searchIcon.src = '/assets/icons/phosphor/regular/magnifying-glass.svg';
                clearIcon.classList.remove('visible');
            }

            matchItems = [];
            let anyVisible = false;

            items.forEach(item => {
                const term = item.dataset.term.toLowerCase();
                const match = hasQuery && term.includes(query);
                if (hasQuery && match) {
                    item.classList.remove('hidden');
                    matchItems.push(item);
                    anyVisible = true;
                } else if (!hasQuery) {
                    item.classList.remove('hidden');
                    anyVisible = true;
                } else {
                    item.classList.add('hidden');
                }
            });

            currentMatchIndex = -1;

            if (hasQuery && !anyVisible) {
                noResults.classList.add('show');
            } else {
                noResults.classList.remove('show');
            }
        }

        input.addEventListener('input', filterGlossary);

        clearIcon.addEventListener('click', function() {
            input.value = '';
            filterGlossary();
            input.focus();
        });

        searchIcon.addEventListener('click', function() {
            if (input.value.trim() === '') return;
            if (matchItems.length === 0) return;

            currentMatchIndex = (currentMatchIndex + 1) % matchItems.length;
            const target = matchItems[currentMatchIndex];
            const btn = target.querySelector('.accordion');
            if (btn) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btn.style.transition = 'background-color 0.3s';
                btn.style.backgroundColor = '#D6F0FA';
                setTimeout(() => {
                    btn.style.backgroundColor = '';
                }, 600);
            }
        });
    }

    function attachAlphabetNavListeners() {
        const links = document.querySelectorAll('.glossary-alphabet-nav a.available');
        links.forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = this.getAttribute('href').substring(1);
                const target = document.getElementById(targetId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    function attachKeyboardShortcut() {
        const input = document.getElementById('glossarySearchInput');
        document.addEventListener('keydown', function(e) {
            if (e.key === '/' && document.activeElement !== input) {
                e.preventDefault();
                input.focus();
            }
        });
    }

    function expandTerm(term, courseId) {
        const items = document.querySelectorAll('.glossary-item');
        let found = false;
        items.forEach(item => {
            const itemTerm = item.dataset.term;
            if (itemTerm.toLowerCase() === term.toLowerCase()) {
                const btn = item.querySelector('.accordion');
                const panel = item.querySelector('.panel');
                if (btn && panel && !btn.classList.contains('active')) {
                    btn.click();
                }
                setTimeout(() => {
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    item.style.transition = 'background-color 0.3s';
                    item.style.backgroundColor = '#E8F0FE';
                    setTimeout(() => {
                        item.style.backgroundColor = '';
                    }, 1000);
                }, 200);
                found = true;
            }
        });
        if (!found) {
            console.warn(`Term "${term}" not found in glossary.`);
        }
    }

    function handleUrlTerm(courseId) {
        const urlParams = new URLSearchParams(window.location.search);
        const term = urlParams.get('term');
        if (term) {
            const observer = new MutationObserver(function(mutations, obs) {
                const items = document.querySelectorAll('.glossary-item');
                if (items.length > 0) {
                    obs.disconnect();
                    expandTerm(term, courseId);
                }
            });
            observer.observe(document.getElementById('glossaryContainer'), { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                expandTerm(term, courseId);
            }, 2000);
        }
    }
})();
