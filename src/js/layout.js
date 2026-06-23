// src/js/layout.js
import { supabase, isLoggedIn, getCurrentUserProfile } from './supabase.js';

/**
 * Load header and footer components into the page.
 * Call this on every page except lesson/practice pages.
 */
export async function loadLayout() {
  // Check if we are on a page that should NOT have header/footer
  const path = window.location.pathname;
  if (path.includes('/pages/lesson.html') || path.includes('/pages/practice.html')) {
    return; // Do not load header/footer on lesson or practice pages
  }

  // Load header HTML
  const headerResponse = await fetch('/src/components/header.html');
  const headerHTML = await headerResponse.text();
  document.body.insertAdjacentHTML('afterbegin', headerHTML);

  // Load footer HTML
  const footerResponse = await fetch('/src/components/footer.html');
  const footerHTML = await footerResponse.text();
  document.body.insertAdjacentHTML('beforeend', footerHTML);

  // Now initialize header/footer functionality
  await initHeader();
  await initFooter();
}

async function initHeader() {
  // Get user data from Supabase
  const loggedIn = await isLoggedIn();
  let userData = null;
  if (loggedIn) {
    const profile = await getCurrentUserProfile();
    if (profile) {
      userData = profile.profile;
    }
  }

  // If not logged in, show default (or hide certain elements)
  const header = document.querySelector('header');
  if (!loggedIn) {
    // You could show a "Sign in" link instead of user stats
    const stats = header.querySelector('.user-stats');
    if (stats) {
      stats.innerHTML = `<a href="/registration.html" class="btn btn-sm btn-gecko-solid">Sign In</a>`;
    }
  } else {
    // Update header with real user data
    // For now, we'll use localStorage as fallback (for demo)
    // But ideally these values come from Supabase
    const coins = userData?.coins ?? parseInt(localStorage.getItem('coins') || '500');
    const hearts = userData?.hearts ?? parseInt(localStorage.getItem('hearts') || '5');
    const streak = userData?.current_streak ?? parseInt(localStorage.getItem('userStreakDays') || '1');

    // Update DOM elements
    const coinsSpan = document.querySelector('#coinsItem span');
    if (coinsSpan) coinsSpan.textContent = coins;
    const heartsSpan = document.querySelector('#heartsItem span');
    if (heartsSpan) heartsSpan.textContent = hearts;
    const streakSpan = document.querySelector('#streakCount');
    if (streakSpan) streakSpan.textContent = streak;
  }

  // Initialize panel toggles (course switcher, hearts, shop, streak)
  initHeaderPanels();
}

function initHeaderPanels() {
  // These are the same functions from header-with-footer.html
  // We'll attach event listeners to the icons.
  const activeCourseIcon = document.getElementById('activeCourseIcon');
  const activeCourseLevel = document.getElementById('activeCourseLevel');
  const heartsIcon = document.querySelector('#heartsItem .icon-box');
  const coinsIcon = document.querySelector('#coinsItem .icon-box');
  const streakIcon = document.querySelector('#streakItem .icon-box');
  const streakCount = document.getElementById('streakCount');
  const coursePanel = document.getElementById('coursePanelContainer');
  const heartsPanel = document.getElementById('heartsPanelContainer');
  const shopPanel = document.getElementById('shopPanelContainer');
  const streakCalendar = document.getElementById('streakCalendarContainer');

  // Define toggle functions (simplified – you can reuse your existing logic)
  function toggleCoursePanel() {
    coursePanel.classList.toggle('active');
    heartsPanel.classList.remove('active');
    shopPanel.classList.remove('active');
    streakCalendar.classList.remove('active');
  }
  function toggleHeartsPanel() {
    heartsPanel.classList.toggle('active');
    coursePanel.classList.remove('active');
    shopPanel.classList.remove('active');
    streakCalendar.classList.remove('active');
  }
  function toggleShopPanel() {
    shopPanel.classList.toggle('active');
    coursePanel.classList.remove('active');
    heartsPanel.classList.remove('active');
    streakCalendar.classList.remove('active');
    // Update shop coin count
    const coins = document.querySelector('#coinsItem span')?.textContent || '500';
    document.getElementById('shopCoinCount').textContent = coins;
  }
  function toggleStreakCalendar() {
    streakCalendar.classList.toggle('active');
    coursePanel.classList.remove('active');
    heartsPanel.classList.remove('active');
    shopPanel.classList.remove('active');
    // Load calendar
    if (window.loadStreakCalendar) window.loadStreakCalendar();
  }

  if (activeCourseIcon) activeCourseIcon.addEventListener('click', toggleCoursePanel);
  if (activeCourseLevel) activeCourseLevel.addEventListener('click', toggleCoursePanel);
  if (heartsIcon) heartsIcon.addEventListener('click', toggleHeartsPanel);
  if (coinsIcon) coinsIcon.addEventListener('click', toggleShopPanel);
  if (streakIcon) streakIcon.addEventListener('click', toggleStreakCalendar);
  if (streakCount) streakCount.addEventListener('click', toggleStreakCalendar);

  // Close panels on outside click (similar to your existing code)
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
      streakCalendar.classList.remove('active');
    }
  });
}

async function initFooter() {
  // Attach navigation click handlers
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      // Here you could navigate or update content
    });
  });
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', loadLayout);
