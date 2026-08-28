// Built-in example plugin: live word count in the status bar.
// Plugins are plain scripts loaded into the editor page; they talk to the
// `window.eddie` API. Copy this file to ~/.eddie/plugins/ to hack on your own.
(() => {
  const item = eddie.addStatusItem("0 words");
  function update() {
    const words = eddie.getText().split(/\s+/).filter(Boolean).length;
    item.textContent = `${words} words`;
  }
  setInterval(update, 1000);
  update();
})();
