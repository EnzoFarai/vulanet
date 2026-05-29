export async function loadHeaderFooter() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  if (headerPlaceholder) {
    const res = await fetch('/src/components/header.html');
    headerPlaceholder.innerHTML = await res.text();
  }
  if (footerPlaceholder) {
    const res = await fetch('/src/components/footer.html');
    footerPlaceholder.innerHTML = await res.text();
  }
}
