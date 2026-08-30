// Built-in plugin: a recommendation *producer* — dogfoods eddie.recommend.
// When the open document accumulates many lint issues, pin a passive
// recommendation to the lint counter; resolve it once the count drops.
(() => {
  const THRESHOLD = 15;
  const anchor = { type: "ui", target: "element:status-lint" };
  let active = false;

  setInterval(() => {
    const m = (document.getElementById("status-lint").textContent || "").match(/(\d+)/);
    const count = m ? parseInt(m[1], 10) : 0;
    if (count >= THRESHOLD && !active) {
      active = true;
      eddie.recommend({
        producer: "lint-advisor",
        anchor,
        severity: "passive",
        text: `${count} lint issues in this document — worth a review pass`,
        actions: [{ label: "Open lint panel", command: "lint" }],
      });
    } else if (count < THRESHOLD && active) {
      active = false;
      eddie.resolveRecommendation("lint-advisor", anchor);
    }
  }, 15000);
})();
