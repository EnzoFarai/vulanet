// src/js/layout.js
import { supabase, isLoggedIn, getCurrentUserProfile } from './supabase.js';

/**
 * Load header and footer into the page.
 * Call this on every page except lesson/practice pages.
 */
export async function loadLayout() {
  const path = window.location.pathname;
  // Don't load on lesson or practice pages
  if (path.includes('/pages/lesson.html') || path.includes('/pages/practice.html')) {
    return;
  }

  // Load header HTML
  const headerResp = await fetch('/src/components/header.html');
  const headerHTML = await headerResp.text();
  document.body.insertAdjacentHTML('afterbegin', headerHTML);

  // Load footer HTML
  const footerResp = await fetch('/src/components/footer.html');
  const footerHTML = await footerResp.text();
  document.body.insertAdjacentHTML('beforeend', footerHTML);

  // Initialize functionality
  await initHeader();
  initFooter();
}

async function initHeader() {
  // Get user data from Supabase
  const loggedIn = await isLoggedIn();
  let userData = null;
  if (loggedIn) {
    const profile = await getCurrentUserProfile();
    if (profile) userData = profile.profile;
  }

  // Update stats (use localStorage as fallback for demo)
  const coins = userData?.coins ?? parseInt(localStorage.getItem('coins') || '500');
  const hearts = userData?.hearts ?? parseInt(localStorage.getItem('hearts') || '5');
  const streak = userData?.current_streak ?? parseInt(localStorage.getItem('userStreakDays') || '1');

  document.querySelector('#coinsItem span').textContent = coins;
  document.querySelector('#heartsItem span').textContent = hearts;
  document.querySelector('#streakCount').textContent = streak;

  // Set active course icon (default to G12 Life Sciences)
  const courseImg = document.querySelector('#activeCourseIcon img');
  const courseLevel = document.querySelector('#activeCourseLevel');
  // You can load this from user preferences later

  // Initialize panel toggles
  initPanelToggles();
}

function initPanelToggles() {
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
    coursePanel.classList.remove('active');
    heartsPanel.classList.remove('active');
    shopPanel.classList.remove('active');
    streakPanel.classList.remove('active');
    shareOverlay.classList.remove('active');
  }

  function toggleCoursePanel(e) {
    e.stopPropagation();
    closeAllPanels();
    coursePanel.classList.toggle('active');
  }

  function toggleHeartsPanel(e) {
    e.stopPropagation();
    closeAllPanels();
    heartsPanel.classList.toggle('active');
  }

  function toggleShopPanel(e) {
    e.stopPropagation();
    closeAllPanels();
    shopPanel.classList.toggle('active');
    // Update shop coin count
    const coins = document.querySelector('#coinsItem span').textContent;
    document.getElementById('shopCoinCount').textContent = coins;
  }

  function toggleStreakPanel(e) {
    e.stopPropagation();
    closeAllPanels();
    streakPanel.classList.toggle('active');
    // Load calendar
    if (window.loadStreakCalendar) window.loadStreakCalendar();
  }

  if (activeCourseIcon) activeCourseIcon.addEventListener('click', toggleCoursePanel);
  if (activeCourseLevel) activeCourseLevel.addEventListener('click', toggleCoursePanel);
  if (heartsIcon) heartsIcon.addEventListener('click', toggleHeartsPanel);
  if (coinsIcon) coinsIcon.addEventListener('click', toggleShopPanel);
  if (streakIcon) streakIcon.addEventListener('click', toggleStreakPanel);
  if (streakCount) streakCount.addEventListener('click', toggleStreakPanel);

  // Close panels on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.course-panel-container') && !e.target.closest('#activeCourseIcon') && !e.target.closest('#activeCourseLevel')) {
      coursePanel.classList.remove('active');
    }
    if (!e.target.closest('.hearts-panel-container') && !e.target.closest('#heartsItem')) {
      heartsPanel.classList.remove('active');
    }
    if (!e.target.closest('.shop-panel-container') && !e.target.closest('#coinsItem')) {
      shopPanel.classList.remove('active');
    }
    if (!e.target.closest('.streak-calendar-container') && !e.target.closest('#streakItem') && !e.target.closest('#streakCount')) {
      streakPanel.classList.remove('active');
    }
    if (!e.target.closest('.share-overlay') && !e.target.closest('#streakShareButton')) {
      shareOverlay.classList.remove('active');
    }
  });

  // Streak close button
  document.getElementById('streakCloseButton')?.addEventListener('click', () => {
    streakPanel.classList.remove('active');
  });

  // Streak share button
  document.getElementById('streakShareButton')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const shareOverlay = document.getElementById('shareOverlay');
    const shareStreakNumber = document.getElementById('shareStreakNumber');
    shareStreakNumber.textContent = document.getElementById('streakCount').textContent;
    shareOverlay.classList.toggle('active');
  });

  // Shop close button
  document.getElementById('shopCloseButton')?.addEventListener('click', () => {
    shopPanel.classList.remove('active');
  });

  // Refill hearts
  document.getElementById('refillHeartsButton')?.addEventListener('click', () => {
    const currentCoins = parseInt(document.querySelector('#coinsItem span').textContent);
    const currentHearts = parseInt(document.querySelector('#heartsItem span').textContent);
    const missing = 5 - currentHearts;
    if (missing <= 0) { alert('Hearts are already full!'); return; }
    let price = 0;
    if (missing === 1) price = 90;
    else if (missing === 2) price = 170;
    else if (missing === 3) price = 240;
    else if (missing === 4) price = 300;
    else if (missing === 5) price = 350;
    if (currentCoins < price) {
      alert(`Not enough coins! You need ${price} coins to refill ${missing} heart${missing>1?'s':''}.`);
      return;
    }
    // Deduct coins and refill hearts
    const newCoins = currentCoins - price;
    document.querySelector('#coinsItem span').textContent = newCoins;
    document.querySelector('#heartsItem span').textContent = 5;
    // Update hearts display in panel
    const heartIcons = document.querySelectorAll('.hearts-display .heart-icon');
    heartIcons.forEach(icon => {
      icon.src = '/assets/icons/phosphor/fill/heart.svg';
      icon.classList.remove('empty', 'next');
    });
    heartsPanel.classList.remove('active');
    alert('Hearts refilled!');
  });

  // Start lesson link in streak panel
  document.getElementById('startLessonLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    streakPanel.classList.remove('active');
    // Redirect to the first incomplete lesson of the active course
    // For now, go to a placeholder
    const courseId = 'g12-life-sciences'; // Get from active course
    window.location.href = `/pages/lesson.html?course=${courseId}&lesson=introduction-to-nucleic-acids`;
  });

  // Share overlay: save image
  document.getElementById('saveImage')?.addEventListener('click', async () => {
    const card = document.getElementById('streakCard');
    if (!card) return;
    await document.fonts.ready;
    const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js')).default;
    html2canvas(card, { scale: 2, backgroundColor: null, useCORS: true }).then(canvas => {
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0,10);
      const streak = document.getElementById('streakCount').textContent;
      link.download = `${date}_vulanet-${streak}-day-streak.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      document.getElementById('shareOverlay').classList.remove('active');
    }).catch(err => {
      console.error('Error saving image:', err);
      alert('Could not save image. Please try again.');
    });
  });

  // Share overlay: more options (native share)
  document.getElementById('moreOptions')?.addEventListener('click', async () => {
    const shareText = `I'm on a ${document.getElementById('streakCount').textContent} day learning streak! Learn a course with me for free! Vulanet is the fun and successful way to learning. #Vulanet`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My Vulanet Streak', text: shareText, url: 'https://vulanet.com/streak' });
      } catch(e) {}
    } else {
      navigator.clipboard.writeText(shareText).then(() => alert('Copied to clipboard!'));
    }
    document.getElementById('shareOverlay').classList.remove('active');
  });

  // Share to specific platforms
  function shareTo(platform) {
    const shareText = `I'm on a ${document.getElementById('streakCount').textContent} day learning streak! Learn a course with me for free! Vulanet is the fun and successful way to learning. #Vulanet`;
    const url = 'https://vulanet.com/streak';
    let shareUrl = '';
    if (platform === 'facebook') {
      shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(shareText)}`;
    } else if (platform === 'x') {
      shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    } else if (platform === 'whatsapp') {
      shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    } else if (platform === 'sms') {
      if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        window.location.href = `sms:?body=${encodeURIComponent(shareText)}`;
        return;
      } else {
        navigator.clipboard.writeText(shareText).then(() => alert('Copied to clipboard!'));
        return;
      }
    }
    if (shareUrl) window.open(shareUrl, '_blank');
    document.getElementById('shareOverlay').classList.remove('active');
  }

  document.getElementById('shareFacebook')?.addEventListener('click', () => shareTo('facebook'));
  document.getElementById('shareX')?.addEventListener('click', () => shareTo('x'));
  document.getElementById('shareWhatsApp')?.addEventListener('click', () => shareTo('whatsapp'));
  document.getElementById('shareSms')?.addEventListener('click', () => shareTo('sms'));

  // Streak calendar navigation
  let nav = 0;
  const year = 2026;
  // Simulated streak data (placeholder)
  const streakData = { 0: { streakWeeks: [0,1], firstAidDay: 15, yellowDays: [12,14,16,17,18,19,20], greyCircleDay: 21 } };
  
  window.loadStreakCalendar = function() {
    const dt = new Date(year, 0 + nav, 1);
    const month = dt.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const prevMonthDays = new Date(year, month, 0).getDate();
    document.getElementById('monthDisplay').innerText = dt.toLocaleDateString('en-us', { month: 'long', year: 'numeric' });
    const weeksContainer = document.getElementById('calendarWeeks');
    weeksContainer.innerHTML = '';
    let dayCount = 1 - firstDayOfMonth;
    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
    const totalWeeks = totalCells / 7;
    for (let week = 0; week < totalWeeks; week++) {
      const weekDiv = document.createElement('div');
      weekDiv.className = 'week';
      const monthData = streakData[nav] || {};
      if (monthData.streakWeeks && monthData.streakWeeks.includes(week)) {
        weekDiv.classList.add('streak');
      }
      for (let i = 0; i < 7; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day';
        if (dayCount < 1) {
          dayDiv.textContent = prevMonthDays + dayCount;
          dayDiv.classList.add('inactive');
        } else if (dayCount > daysInMonth) {
          dayDiv.textContent = dayCount - daysInMonth;
          dayDiv.classList.add('inactive');
        } else {
          const dayClass = getDayClass(dayCount, monthData);
          if (dayClass === 'first-aid') {
            dayDiv.innerHTML = `<i class="ph-fill ph-first-aid icon"></i><span class="number">${dayCount}</span>`;
            dayDiv.classList.add('first-aid');
          } else {
            dayDiv.textContent = dayCount;
            if (dayClass) dayDiv.classList.add(dayClass);
          }
        }
        weekDiv.appendChild(dayDiv);
        dayCount++;
      }
      weeksContainer.appendChild(weekDiv);
    }
  };

  function getDayClass(day, monthData) {
    if (monthData.firstAidDay === day) return 'first-aid';
    if (monthData.yellowDays && monthData.yellowDays.includes(day)) return 'yellow';
    if (monthData.greyCircleDay === day) return 'grey-circle';
    const today = new Date();
    if (day === today.getDate() && nav === 0) return 'current';
    return '';
  }

  document.getElementById('prevBtn')?.addEventListener('click', () => { nav--; window.loadStreakCalendar(); });
  document.getElementById('nextBtn')?.addEventListener('click', () => { nav++; window.loadStreakCalendar(); });

  // Initialize calendar if visible
  if (document.getElementById('streakCalendarContainer') && document.getElementById('streakCalendarContainer').classList.contains('active')) {
    window.loadStreakCalendar();
  }
}

function initFooter() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      // Here you can navigate or update content
      const view = item.dataset.view;
      // Update header visibility based on view
      updateHeaderVisibility(view);
    });
  });
}

function updateHeaderVisibility(view) {
  document.querySelectorAll('.stat-item').forEach(el => el.classList.remove('header-icon-hidden'));
  if (['ranking', 'treasure', 'bell'].includes(view)) {
    document.getElementById('activeCourseItem').classList.add('header-icon-hidden');
    document.getElementById('streakItem').classList.add('header-icon-hidden');
    document.getElementById('coinsItem').classList.add('header-icon-hidden');
    document.getElementById('heartsItem').classList.add('header-icon-hidden');
  } else if (view === 'user') {
    document.getElementById('activeCourseItem').classList.add('header-icon-hidden');
  }
}

// Auto-load on DOMContentLoaded
document.addEventListener('DOMContentLoaded', loadLayout);

