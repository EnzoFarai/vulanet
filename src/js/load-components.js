// src/js/load-components.js
export async function loadHeaderFooter() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  if (headerPlaceholder) {
    const res = await fetch('/src/components/header.html');
    if (res.ok) headerPlaceholder.innerHTML = await res.text();
  }
  if (footerPlaceholder) {
    const res = await fetch('/src/components/footer.html');
    if (res.ok) footerPlaceholder.innerHTML = await res.text();
  }
}
