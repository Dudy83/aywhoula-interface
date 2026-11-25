// Le thème est posé avant le premier affichage, pour que l'écran de démarrage prenne tout de suite la bonne
// couleur. Même règle que useResolvedTheme : le choix enregistré, sinon le thème du système. App.tsx prend
// ensuite la main. Chargé par index.html avant les styles, sans `defer` ni `async` : il passe avant le premier
// affichage. Un fichier à part et non un script dans la page : la politique de sécurité de l'appli n'autorise
// aucun script en ligne.
(function () {
  var theme;
  try {
    theme = JSON.parse(localStorage.getItem('aywhoula')).state.theme;
  } catch (e) {
    // Rien d'enregistré, ou stockage indisponible : thème du système.
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  if (theme === 'light') document.querySelector('meta[name="theme-color"]').setAttribute('content', '#eef0f2');
})();
