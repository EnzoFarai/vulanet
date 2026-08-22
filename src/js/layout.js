// src/js/layout.js
import { supabase, isLoggedIn, getCurrentUserProfile } from './supabase.js';

let layoutLoaded = false;

const ALL_COURSES = [
    { id: 'g12-life-sciences', name: 'G12 Life Sciences', level: 1, max: 6, img: '/assets/courses/g12-life-sciences.png' },
    { id: 'pharmacology-ii', name: 'Pharmacology-II', level: 3, max: 6, img: '/assets/courses/pharmacology-ii.png' },
    { id: 'clinical-pharmacy', name: 'Clinical Pharmacy', level: 4, max: 6, img: '/assets/courses/clinical-pharmacy.png' },
    { id: 'international-law', name: 'International Law', level: 2, max: 6, img: '/assets/courses/international-law.png' },
    { id: 'java-programming', name: 'Java Programming', level: 1, max: 6, img: '/assets/courses/java-programming.png' },
    { id: 'web-design', name: 'Web Design', level: 6, max: 6, img: '/assets/courses/web-design.png' },
    { id: 'financial-accounting', name: 'Financial Accounting', level: 1, max: 6, img: '/assets/courses/financial-accounting.png' },
];

function getCourseProgress(courseId) {
    const totalLessons = 50;
    let completedLessons = 0;
    try {
        const progress = JSON.parse(localStorage.getItem(`vulanet_progress_${courseId}`) || '{}');
        for (const chapterId in progress) {
            for (const lessonId in progress[chapterId]) {
                if (progress[chapterId][lessonId]?.status === 'completed' || progress[chapterId][lessonId]?.mastered) {
                    completedLessons++;
                }
            }
        }
    } catch(e) {}
    return { completed: completedLessons, total: totalLessons };
}

window.updateHeaderStats = function(coins, hearts, streak) {
    if (coins !== undefined) {
        localStorage.setItem('coins', String(coins));
        const coinsSpan = document.querySelector('#coinsItem span');
        if (coinsSpan) coinsSpan.textContent = coins;
    }
    if (hearts !== undefined) {
        localStorage.setItem('hearts', String(hearts));
        const heartsSpan = document.querySelector('#heartsItem span');
        if (heartsSpan) heartsSpan.textContent = hearts;
        updateHeartsUI();
    }
    if (streak !== undefined) {
        localStorage.setItem('userStreakDays', String(streak));
        const streakSpan = document.getElementById('streakCount');
        if (streakSpan) streakSpan.textContent = streak;
    }
};

export async function loadLayout() {
    if (layoutLoaded) {
        console.log('Layout already loaded.');
        return;
    }

    const path = window.location.pathname;
    // Do not load header/footer on quiz page, registration, onboarding, courses
    if (path.includes('/pages/lesson.html') || path.includes('/pages/practice.html') ||
        path.includes('/registration.html') || path.includes('/registration-completion.html') ||
        path.includes('/onboarding.html') || path.includes('/courses.html')) {
        return;
    }

    try {
        const resp = await fetch('/src/components/header.html');
        if (!resp.ok) throw new Error('Header not found');
        const html = await resp.text();
        document.body.insertAdjacentHTML('afterbegin', html);
    } catch (e) {
        console.error('Failed to load header:', e);
    }

    try {
        const resp = await fetch('/src/components/footer.html');
        if (!resp.ok) throw new Error('Footer not found');
        const html = await resp.text();
        document.body.insertAdjacentHTML('beforeend', html);
    } catch (e) {
        console.error('Failed to load footer:', e);
    }

    layoutLoaded = true;
    document.body.classList.add('has-header');

    await initHeader();
    initFooter();
    highlightFooterIcon();
}

async function initHeader() {
    let coins = parseInt(localStorage.getItem('coins') || '500');
    let hearts = parseInt(localStorage.getItem('hearts') || '5');
    let streak = parseInt(localStorage.getItem('userStreakDays') || '1');

    const loggedIn = await isLoggedIn();
    if (loggedIn) {
        const profile = await getCurrentUserProfile();
        if (profile && profile.profile) {
            coins = profile.profile.coins ?? coins;
            hearts = profile.profile.hearts ?? hearts;
            streak = profile.profile.current_streak ?? streak;
        }
    }

    const coinsSpan = document.querySelector('#coinsItem span');
    const heartsSpan = document.querySelector('#heartsItem span');
    const streakSpan = document.getElementById('streakCount');
    if (coinsSpan) coinsSpan.textContent = coins;
    if (heartsSpan) heartsSpan.textContent = hearts;
    if (streakSpan) streakSpan.textContent = streak;

    const activeCourseId = localStorage.getItem('selectedCourseId') || 'g12-life-sciences';
    const courseImg = document.querySelector('#activeCourseIcon img');
    if (courseImg) {
        courseImg.src = `/assets/courses/${activeCourseId}.png`;
        courseImg.alt = activeCourseId;
    }

    const path = window.location.pathname;
    const isReadingPage = path.startsWith('/read/');
    const isPracticeHub = path.includes('/practice-hub.html');
    const isCoursePage = path.endsWith('.html') && !isReadingPage && !isPracticeHub && !path.includes('/pages/');
    const isGlossaryPage = path.startsWith('/glossary/');

    if (isReadingPage || isGlossaryPage) {
        document.querySelectorAll('.stat-item').forEach(el => {
            if (el.id !== 'activeCourseItem') {
                el.classList.add('header-icon-hidden');
            }
        });
    } else if (isPracticeHub || isCoursePage) {
        document.querySelectorAll('.stat-item').forEach(el => el.classList.remove('header-icon-hidden'));
    }

    initPanels();
    initHeartsTimer();
    updateHeartsUI();
    initStreakCalendar();
    initShareOverlay();
    updateCourseProgress(activeCourseId);
}

function initPanels() {
    const coursePanel = document.getElementById('coursePanelContainer');
    const heartsPanel = document.getElementById('heartsPanelContainer');
    const shopPanel = document.getElementById('shopPanelContainer');
    const streakPanel = document.getElementById('streakCalendarContainer');
    const shareOverlay = document.getElementById('shareOverlay');

    const activeCourseIcon = document.getElementById('activeCourseIcon');
    const activeCourseLevel = document.getElementById('activeCourseLevel');
    const heartsIcon = document.querySelector('#heartsItem .icon-box');
    const coinsIcon = document.querySelector('#coinsItem .icon-box');
    const streakIcon = document.querySelector('#streakItem .icon-box');
    const streakCount = document.getElementById('streakCount');

    function closeAllPanels() {
        if (coursePanel) coursePanel.classList.remove('active');
        if (heartsPanel) heartsPanel.classList.remove('active');
        if (shopPanel) shopPanel.classList.remove('active');
        if (streakPanel) streakPanel.classList.remove('active');
        if (shareOverlay) shareOverlay.classList.remove('active');
    }

    function toggleCoursePanel(e) {
        if (e) e.stopPropagation();
        closeAllPanels();
        if (coursePanel) {
            coursePanel.classList.toggle('active');
            if (coursePanel.classList.contains('active')) {
                renderCoursesSlider();
            }
        }
    }

    function toggleHeartsPanel(e) {
        if (e) e.stopPropagation();
        closeAllPanels();
        if (heartsPanel) {
            heartsPanel.classList.toggle('active');
            if (heartsPanel.classList.contains('active')) {
                updateHeartsUI();
            }
        }
    }

    function toggleShopPanel(e) {
        if (e) e.stopPropagation();
        closeAllPanels();
        if (shopPanel) {
            shopPanel.classList.toggle('active');
            if (shopPanel.classList.contains('active')) {
                const coins = document.querySelector('#coinsItem span')?.textContent || '500';
                const shopCoinCount = document.getElementById('shopCoinCount');
                if (shopCoinCount) shopCoinCount.textContent = coins;
            }
        }
    }

    function toggleStreakPanel(e) {
        if (e) e.stopPropagation();
        closeAllPanels();
        if (streakPanel) {
            streakPanel.classList.toggle('active');
            if (streakPanel.classList.contains('active')) {
                loadStreakCalendar();
            }
        }
    }

    if (activeCourseIcon) activeCourseIcon.addEventListener('click', toggleCoursePanel);
    if (activeCourseLevel) activeCourseLevel.addEventListener('click', toggleCoursePanel);
    if (heartsIcon) heartsIcon.addEventListener('click', toggleHeartsPanel);
    if (coinsIcon) coinsIcon.addEventListener('click', toggleShopPanel);
    if (streakIcon) streakIcon.addEventListener('click', toggleStreakPanel);
    if (streakCount) streakCount.addEventListener('click', toggleStreakPanel);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.course-panel-container') && !e.target.closest('#activeCourseIcon') && !e.target.closest('#activeCourseLevel')) {
            if (coursePanel) coursePanel.classList.remove('active');
        }
        if (!e.target.closest('.hearts-panel-container') && !e.target.closest('#heartsItem')) {
            if (heartsPanel) heartsPanel.classList.remove('active');
        }
        if (!e.target.closest('.shop-panel-container') && !e.target.closest('#coinsItem')) {
            if (shopPanel) shopPanel.classList.remove('active');
        }
        if (!e.target.closest('.streak-calendar-container') && !e.target.closest('#streakItem') && !e.target.closest('#streakCount')) {
            if (streakPanel) streakPanel.classList.remove('active');
        }
        if (!e.target.closest('.share-overlay') && !e.target.closest('#streakShareButton')) {
            if (shareOverlay) shareOverlay.classList.remove('active');
        }
    });

    const streakClose = document.getElementById('streakCloseButton');
    if (streakClose) streakClose.addEventListener('click', () => { if (streakPanel) streakPanel.classList.remove('active'); });

    const streakShare = document.getElementById('streakShareButton');
    if (streakShare) {
        streakShare.addEventListener('click', (e) => {
            e.stopPropagation();
            const shareStreakNumber = document.getElementById('shareStreakNumber');
            const streakCountEl = document.getElementById('streakCount');
            if (shareStreakNumber && streakCountEl) {
                shareStreakNumber.textContent = streakCountEl.textContent;
            }
            if (shareOverlay) shareOverlay.classList.toggle('active');
        });
    }

    const shopClose = document.getElementById('shopCloseButton');
    if (shopClose) shopClose.addEventListener('click', () => { if (shopPanel) shopPanel.classList.remove('active'); });

    const refillBtn = document.getElementById('refillHeartsButton');
    if (refillBtn) refillBtn.addEventListener('click', handleRefillHearts);

    const startLessonLink = document.getElementById('startLessonLink');
    if (startLessonLink) {
        startLessonLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (streakPanel) streakPanel.classList.remove('active');
            const courseId = localStorage.getItem('selectedCourseId') || 'g12-life-sciences';
            window.location.href = `/${courseId}.html`;
        });
    }

    document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.add-course-slider');
        if (addBtn) {
            window.location.href = '/courses.html?action=add-course';
        }
    });
}

function renderCoursesSlider() {
    const slider = document.getElementById('coursesSlider');
    if (!slider) return;

    let userCourseIds = JSON.parse(localStorage.getItem('userCourses') || '[]');
    const activeId = localStorage.getItem('selectedCourseId') || 'g12-life-sciences';

    if (userCourseIds.length === 0) {
        userCourseIds = [activeId];
        localStorage.setItem('userCourses', JSON.stringify(userCourseIds));
    } else if (!userCourseIds.includes(activeId)) {
        userCourseIds.push(activeId);
        localStorage.setItem('userCourses', JSON.stringify(userCourseIds));
    }

    let html = '';
    userCourseIds.forEach(id => {
        const course = ALL_COURSES.find(c => c.id === id);
        if (course) {
            const isActive = course.id === activeId;
            html += `
                <div class="course-slider-item ${isActive ? 'active' : ''}" data-course-id="${course.id}">
                    <div class="course-slider-icon"><img src="${course.img}" alt="${course.name}" loading="lazy"></div>
                    <div class="course-slider-name">${course.name}</div>
                </div>
            `;
        }
    });

    html += `
        <div class="add-course-slider">
            <div class="add-course-slider-icon">
                <img src="/assets/icons/phosphor/regular/plus.svg" alt="Add" style="width:32px;height:32px;">
            </div>
            <div class="add-course-slider-text">Course</div>
        </div>
    `;
    slider.innerHTML = html;

    slider.querySelectorAll('.course-slider-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.courseId;
            localStorage.setItem('selectedCourseId', id);
            const courseImg = document.querySelector('#activeCourseIcon img');
            if (courseImg) {
                courseImg.src = `/assets/courses/${id}.png`;
            }
            const panel = document.getElementById('coursePanelContainer');
            if (panel) panel.classList.remove('active');

            const path = window.location.pathname;
            if (path.startsWith('/read/')) {
                window.location.href = `/read/${id}.html`;
            } else if (path.startsWith('/glossary/')) {
                window.location.href = `/glossary/${id}.html`;
            } else {
                window.location.href = `/${id}.html`;
            }
        });
    });
}

function updateCourseProgress(courseId) {
    const progress = getCourseProgress(courseId);
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

    const level = Math.floor(pct / 16.67) + 1;
    const currentLevelEl = document.getElementById('currentLevel');
    const nextLevelEl = document.getElementById('nextLevel');
    const progressBar = document.getElementById('progressBar');
    const courseStatus = document.getElementById('courseStatus');

    if (currentLevelEl) currentLevelEl.textContent = `Level ${Math.min(level, 6)}`;
    if (nextLevelEl) nextLevelEl.textContent = `Level ${Math.min(level + 1, 6)}`;
    if (progressBar) progressBar.style.width = `${Math.min(pct, 100)}%`;
    if (courseStatus) {
        const course = ALL_COURSES.find(c => c.id === courseId);
        courseStatus.textContent = `You are on Level ${Math.min(level, 6)} of ${course?.name || 'this course'}`;
    }
}

function updateHeartsUI() {
    const heartsSpan = document.querySelector('#heartsItem span');
    if (!heartsSpan) return;
    const hearts = parseInt(heartsSpan.textContent) || 0;
    const missing = 5 - hearts;

    const heartIcons = document.querySelectorAll('.hearts-display .heart-icon');
    heartIcons.forEach((img, index) => {
        if (index < hearts) {
            img.src = '/assets/icons/phosphor/fill/heart.svg';
            img.className = 'heart-icon full';
        } else if (index === hearts && missing > 0) {
            img.src = '/assets/icons/phosphor/duotone/heart.svg';
            img.className = 'heart-icon next';
        } else {
            img.src = '/assets/icons/phosphor/regular/heart.svg';
            img.className = 'heart-icon empty';
        }
    });

    const refillBtn = document.getElementById('refillHeartsButton');
    const timer = document.querySelector('.timer');
    const practiceBtn = document.querySelector('.practice-button');
    const refillPrice = document.getElementById('refillPrice');

    if (hearts >= 5) {
        if (refillBtn) refillBtn.classList.add('hidden');
        if (timer) timer.classList.add('hidden');
        if (practiceBtn) practiceBtn.classList.add('hidden');
    } else {
        if (refillBtn) refillBtn.classList.remove('hidden');
        if (timer) timer.classList.remove('hidden');
        if (practiceBtn) practiceBtn.classList.remove('hidden');
        let price = 0;
        if (missing === 1) price = 90;
        else if (missing === 2) price = 170;
        else if (missing === 3) price = 240;
        else if (missing === 4) price = 300;
        else if (missing === 5) price = 350;
        if (refillPrice) refillPrice.textContent = price;
    }
}

function handleRefillHearts() {
    const coinsSpan = document.querySelector('#coinsItem span');
    const heartsSpan = document.querySelector('#heartsItem span');
    if (!coinsSpan || !heartsSpan) return;

    const currentCoins = parseInt(coinsSpan.textContent) || 0;
    const currentHearts = parseInt(heartsSpan.textContent) || 0;
    const missing = 5 - currentHearts;

    if (missing <= 0) {
        alert('Hearts are already full!');
        return;
    }

    let price = 0;
    if (missing === 1) price = 90;
    else if (missing === 2) price = 170;
    else if (missing === 3) price = 240;
    else if (missing === 4) price = 300;
    else if (missing === 5) price = 350;

    if (currentCoins < price) {
        alert(`Not enough coins! You need ${price} coins to refill ${missing} heart${missing > 1 ? 's' : ''}.`);
        return;
    }

    const newCoins = currentCoins - price;
    coinsSpan.textContent = newCoins;
    heartsSpan.textContent = 5;
    localStorage.setItem('coins', String(newCoins));
    localStorage.setItem('hearts', '5');

    updateHeartsUI();
    const panel = document.getElementById('heartsPanelContainer');
    if (panel) panel.classList.remove('active');
    alert('Hearts refilled!');
}

function initHeartsTimer() {
    const timerEl = document.getElementById('heartTimer');
    if (timerEl) timerEl.textContent = '30m';
}

let streakNav = 0;

function initStreakCalendar() {}

function loadStreakCalendar() {
    // (unchanged – uses real streak data)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + streakNav;
    const dt = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = dt.getDay();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const monthDisplay = document.getElementById('monthDisplay');
    if (monthDisplay) {
        monthDisplay.innerText = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    const weeksContainer = document.getElementById('calendarWeeks');
    if (!weeksContainer) return;
    weeksContainer.innerHTML = '';

    let history = {};
    try {
        const raw = localStorage.getItem('streakHistory');
        if (raw) history = JSON.parse(raw);
    } catch(e) {}

    let dayCount = 1 - firstDay;
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    const totalWeeks = totalCells / 7;

    for (let week = 0; week < totalWeeks; week++) {
        const weekDiv = document.createElement('div');
        weekDiv.className = 'week';

        let isFullStreak = true;
        let hasRevival = false;
        const weekDays = [];
        for (let d = 0; d < 7; d++) {
            const dayNumber = dayCount + d;
            if (dayNumber < 1 || dayNumber > daysInMonth) continue;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
            const status = history[dateStr] || 'missed';
            weekDays.push({ dayNumber, status });
            if (status === 'revival') hasRevival = true;
            if (status !== 'completed' && status !== 'revival') isFullStreak = false;
        }

        if (isFullStreak && !hasRevival && weekDays.length === 7) {
            weekDiv.classList.add('streak');
        }

        for (let i = 0; i < 7; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'day';

            const dayNumber = dayCount + i;
            if (dayNumber < 1) {
                const prevDay = prevMonthDays + dayNumber;
                dayDiv.textContent = prevDay;
                dayDiv.classList.add('inactive');
            } else if (dayNumber > daysInMonth) {
                const nextDay = dayNumber - daysInMonth;
                dayDiv.textContent = nextDay;
                dayDiv.classList.add('inactive');
            } else {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
                const status = history[dateStr] || 'missed';
                const today = new Date();
                const isToday = (today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNumber && streakNav === 0);

                if (status === 'revival') {
                    const icon = document.createElement('img');
                    icon.src = '/assets/icons/phosphor/fill/first-aid.svg';
                    icon.className = 'icon';
                    icon.style.width = '24px';
                    icon.style.height = '24px';
                    icon.style.filter = 'brightness(0) saturate(100%) invert(16%) sepia(100%) saturate(7410%) hue-rotate(355deg) brightness(93%) contrast(108%)';
                    const number = document.createElement('span');
                    number.className = 'number';
                    number.textContent = dayNumber;
                    dayDiv.classList.add('first-aid');
                    dayDiv.appendChild(icon);
                    dayDiv.appendChild(number);
                } else if (status === 'completed') {
                    if (isFullStreak && !hasRevival) {
                        dayDiv.classList.add('streak-day');
                    } else {
                        dayDiv.classList.add('yellow');
                    }
                    dayDiv.textContent = dayNumber;
                } else if (isToday && status !== 'completed') {
                    dayDiv.classList.add('grey-circle');
                    dayDiv.textContent = dayNumber;
                } else {
                    dayDiv.textContent = dayNumber;
                }
            }

            weekDiv.appendChild(dayDiv);
        }
        weeksContainer.appendChild(weekDiv);
        dayCount += 7;
    }
}

document.addEventListener('click', (e) => {
    const prevBtn = e.target.closest('#prevBtn');
    const nextBtn = e.target.closest('#nextBtn');
    if (prevBtn) { streakNav--; loadStreakCalendar(); }
    else if (nextBtn) { streakNav++; loadStreakCalendar(); }
});

function initShareOverlay() {
    const saveImageBtn = document.getElementById('saveImage');
    if (saveImageBtn) {
        saveImageBtn.addEventListener('click', async () => {
            const card = document.getElementById('streakCard');
            if (!card) return;
            try {
                const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js')).default;
                html2canvas(card, { scale: 2, backgroundColor: null, useCORS: true }).then(canvas => {
                    const link = document.createElement('a');
                    const date = new Date().toISOString().slice(0, 10);
                    const streak = document.getElementById('streakCount')?.textContent || '1';
                    link.download = `${date}_vulanet-${streak}-day-streak.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    const overlay = document.getElementById('shareOverlay');
                    if (overlay) overlay.classList.remove('active');
                });
            } catch (e) {
                console.error('Error saving image:', e);
                alert('Could not save image.');
            }
        });
    }

    const moreOptionsBtn = document.getElementById('moreOptions');
    if (moreOptionsBtn) {
        moreOptionsBtn.addEventListener('click', async () => {
            const streak = document.getElementById('streakCount')?.textContent || '1';
            const shareText = `I'm on a ${streak} day learning streak! Learn a course with me for free! Vulanet is the fun and successful way to learning. #Vulanet`;
            if (navigator.share) {
                try { await navigator.share({ title: 'My Vulanet Streak', text: shareText, url: 'https://vulanet.com/streak' }); } catch(e) {}
            } else {
                try { await navigator.clipboard.writeText(shareText); alert('Copied to clipboard!'); } catch(e) { alert('Please copy this text manually:\n' + shareText); }
            }
            const overlay = document.getElementById('shareOverlay');
            if (overlay) overlay.classList.remove('active');
        });
    }

    function shareTo(platform) {
        const streak = document.getElementById('streakCount')?.textContent || '1';
        const shareText = `I'm on a ${streak} day learning streak! Learn a course with me for free! Vulanet is the fun and successful way to learning. #Vulanet`;
        const url = 'https://vulanet.com/streak';
        let shareUrl = '';
        if (platform === 'facebook') shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(shareText)}`;
        else if (platform === 'x') shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
        else if (platform === 'whatsapp') shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        else if (platform === 'sms') {
            if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                window.location.href = `sms:?body=${encodeURIComponent(shareText)}`;
                return;
            } else {
                navigator.clipboard.writeText(shareText).then(() => alert('Copied to clipboard!'));
                return;
            }
        }
        if (shareUrl) window.open(shareUrl, '_blank');
        const overlay = document.getElementById('shareOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    const fbBtn = document.getElementById('shareFacebook');
    const xBtn = document.getElementById('shareX');
    const waBtn = document.getElementById('shareWhatsApp');
    const smsBtn = document.getElementById('shareSms');
    if (fbBtn) fbBtn.addEventListener('click', () => shareTo('facebook'));
    if (xBtn) xBtn.addEventListener('click', () => shareTo('x'));
    if (waBtn) waBtn.addEventListener('click', () => shareTo('whatsapp'));
    if (smsBtn) smsBtn.addEventListener('click', () => shareTo('sms'));
}

function initFooter() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const view = item.dataset.view;
            updateHeaderVisibility(view);
            if (view === 'home') {
                const courseId = localStorage.getItem('selectedCourseId') || 'g12-life-sciences';
                window.location.href = `/${courseId}.html`;
            } else if (view === 'book') {
                window.location.href = '/practice-hub.html';
            } else if (view === 'ranking') {
                alert('Ranking page coming soon!');
            } else if (view === 'treasure') {
                alert('Treasure page coming soon!');
            } else if (view === 'user') {
                alert('Profile page coming soon!');
            } else if (view === 'bell') {
                alert('Notifications coming soon!');
            }
        });
    });
}

function highlightFooterIcon() {
    const path = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(el => el.classList.remove('active'));

    let view = 'home';
    if (path.includes('/practice-hub.html') || path.startsWith('/read/') || path.startsWith('/glossary/')) {
        view = 'book';
    } else if (path.includes('/ranking')) {
        view = 'ranking';
    } else if (path.includes('/treasure')) {
        view = 'treasure';
    } else if (path.includes('/profile')) {
        view = 'user';
    } else if (path.includes('/notifications')) {
        view = 'bell';
    }

    navItems.forEach(el => {
        if (el.dataset.view === view) {
            el.classList.add('active');
        }
    });
}

function updateHeaderVisibility(view) {
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(el => el.classList.remove('header-icon-hidden'));

    if (['ranking', 'treasure', 'bell'].includes(view)) {
        const activeCourse = document.getElementById('activeCourseItem');
        const streak = document.getElementById('streakItem');
        const coins = document.getElementById('coinsItem');
        const hearts = document.getElementById('heartsItem');
        if (activeCourse) activeCourse.classList.add('header-icon-hidden');
        if (streak) streak.classList.add('header-icon-hidden');
        if (coins) coins.classList.add('header-icon-hidden');
        if (hearts) hearts.classList.add('header-icon-hidden');
    } else if (view === 'user') {
        const activeCourse = document.getElementById('activeCourseItem');
        if (activeCourse) activeCourse.classList.add('header-icon-hidden');
    }
}
