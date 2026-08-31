// Built-in plugin: doc-anchored producer. Checks relative markdown links on
// save; a broken one gets a recommendation pinned to the link text itself
// (the gutter ✦ / highlight), which resolves when the link is fixed.
(() => {
  const flagged = new Map(); // quote -> anchor we posted

  async function check() {
    if (eddie.getLanguage() !== "markdown" || !eddie.getPath()) return;
    const path = eddie.getPath();
    const text = eddie.getText();
    const dir = path.replace(/\/[^/]*$/, "");
    const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    const broken = new Map();
    let m;
    while ((m = re.exec(text))) {
      const href = m[2];
      if (/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href)) continue; // relative paths only
      const target = `${dir}/${decodeURI(href.split("#")[0])}`;
      try {
        const res = await eddie.api("GET", `/api/file?path=${encodeURIComponent(target)}`);
        if (res.exists) continue;
      } catch {
        continue; // directories etc. — don't flag what we can't check
      }
      broken.set(m[0], {
        type: "doc",
        path,
        quote: m[0],
        prefix: text.slice(Math.max(0, m.index - 16), m.index),
        suffix: text.slice(m.index + m[0].length, m.index + m[0].length + 16),
        offset: m.index,
      });
    }
    for (const [quote, anchor] of broken) {
      eddie.recommend({
        producer: "link-checker",
        anchor,
        severity: "notice",
        text: `broken link: target of ${quote} does not exist`,
      });
      flagged.set(quote, anchor);
    }
    for (const [quote, anchor] of [...flagged]) {
      if (!broken.has(quote)) {
        eddie.resolveRecommendation("link-checker", anchor);
        flagged.delete(quote);
      }
    }
  }

  eddie.onSave((text) => {
    setTimeout(check, 400); // after the save lands; never blocks saving
    return undefined;
  });
  setTimeout(check, 2500); // once on load
})();
