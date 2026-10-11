// Applies the saved theme before first paint so a dark app never flashes white.
// Same key and rules as src/lib/theme.ts.
(function () {
  var dark = false;
  try {
    var t = localStorage.getItem("od-theme") || "light";
    dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch (e) {}
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
