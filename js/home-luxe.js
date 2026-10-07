(function () {
  if (!document.body.classList.contains("home-luxe")) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!prefersReducedMotion) {
    const revealEls = document.querySelectorAll(".luxe-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach((el, i) => {
      el.style.setProperty("--reveal-delay", (i % 6) * 80 + "ms");
      observer.observe(el);
    });

    const hero = document.querySelector(".luxe-hero");
    if (hero) {
      hero.addEventListener("mousemove", (e) => {
        const rect = hero.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        hero.style.setProperty("--mx", x.toFixed(4));
        hero.style.setProperty("--my", y.toFixed(4));
      });
      hero.addEventListener("mouseleave", () => {
        hero.style.setProperty("--mx", "0");
        hero.style.setProperty("--my", "0");
      });
    }
  } else {
    document.querySelectorAll(".luxe-reveal").forEach((el) => el.classList.add("is-visible"));
  }
})();
