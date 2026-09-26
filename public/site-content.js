fetch("/api/site-content", { cache: "no-store" })
  .then((response) => (response.ok ? response.json() : Promise.reject()))
  .then((content) => {
    for (const [selector, value] of [
      [".hero-partner-line", content.heroAnnouncement],
      [".partner-copy .section-kicker", content.partnerKicker],
      ["#partners-title", content.partnerHeading],
      [".partner-copy p", content.partnerBody],
    ]) {
      const element = document.querySelector(selector);
      if (element && value) element.textContent = value;
    }
    for (const [action, source] of [["buy", content.buyImage], ["spo", content.spoImage], ["drep", content.drepImage]]) {
      const image = document.querySelector(`.action-card[data-action="${action}"] > img`);
      if (image && source) image.src = source;
    }
  }).catch(() => {});
