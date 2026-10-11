// Fades `.reveal` blocks in the first time they scroll into view, and marks
// `[data-live]` scenes so their loops only run on screen.
export function initReveal() {
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          reveal.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el));

  const live = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('is-live', e.isIntersecting);
  });
  document.querySelectorAll('[data-live]').forEach((el) => live.observe(el));
}
