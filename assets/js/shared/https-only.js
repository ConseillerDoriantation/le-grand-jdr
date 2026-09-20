// GitHub Pages force déjà HTTPS côté hébergeur. Ce garde-fou couvre aussi les
// liens historiques en http sans casser le développement local.
(() => {
  const { protocol, hostname, href } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (protocol === 'http:' && !local) window.location.replace(href.replace(/^http:/, 'https:'));
})();
