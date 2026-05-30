// src/js/load-components.js
export async function loadHeaderFooter() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  
  if (headerPlaceholder) {
    try {
      const res = await fetch('/src/components/header.html');
      if (res.ok) headerPlaceholder.innerHTML = await res.text();
      else console.warn('Failed to load header');
    } catch (e) {
      console.warn('Header load error:', e);
    }
  }
  
  if (footerPlaceholder) {
    try {
      const res = await fetch('/src/components/footer.html');
      if (res.ok) footerPlaceholder.innerHTML = await res.text();
      else console.warn('Failed to load footer');
    } catch (e) {
      console.warn('Footer load error:', e);
    }
  }
}
