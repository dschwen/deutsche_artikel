// Keep this entry point a classic script: HTML Preview strips module types.
// The preview host cannot supply an app origin for modules or a service worker.
if (location.hostname === "htmlpreview.github.io") {
  location.replace("https://dschwen.github.io/deutsche_artikel/");
} else {
  for (const path of ["js/app.js", "js/pwa.js"]) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = new URL(path, document.baseURI).href;
    document.body.appendChild(script);
  }
}
