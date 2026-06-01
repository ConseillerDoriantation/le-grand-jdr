(function () {
  var t = localStorage.getItem('jdr-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
