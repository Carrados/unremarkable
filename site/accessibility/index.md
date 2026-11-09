# Accessibility statement

Canonical page: https://unremarkable.me/accessibility/

> **Design fiction.** Unremarkable is written as if it were a business. It isn't taking work yet. What that means: https://unremarkable.me/as-if/

Menu:

- [Accessibility statement](https://unremarkable.me/accessibility/) (this page)
- [Home](https://unremarkable.me/)
- [How it works](https://unremarkable.me/how-it-works/)
- [Prices](https://unremarkable.me/prices/)
- [Start](https://unremarkable.me/start/)

An accessibility statement is where most sites admit what they couldn't manage. Ours is built to [Zero Information Casualty version 1.7](https://zeroinformationcasualty.org/), so that nobody, whether reading directly, using assistive technology or sending an agent, loses access to anything published here.

## How it is built

- Every page is plain, static HTML. No content depends on JavaScript, and the site uses none.
- Each page has one main heading, headings in order, landmark regions and a skip link to the main content.
- Text sizes are relative, so the site respects your browser's text size and zoom.
- All text meets WCAG AAA contrast, at least 7:1, in both the light scheme and the dark scheme, which follows your system setting. If your system asks for more contrast, secondary text and dividing lines change to the full text colour. Measured on 8 November 2026: body text 16.2:1 and 16.8:1, secondary text 9.4:1 and 9.9:1, the berry accent 9.0:1 and 9.7:1.
- Nothing moves, so there is nothing to switch off for reduced motion.

## Standards and testing

The site aims to meet WCAG 2.2 at level AA as a baseline, alongside Zero Information Casualty v1.7, and is tested with a screen reader as it changes.

This is a statement of how the site is built and what it aims for, not a claim of certified conformance. No independent audit has been carried out.

This statement was last reviewed on 9 November 2026.

## Found and fixed

- **7 November 2026: numbers read twice.** The list of work was numbered by the stylesheet, so VoiceOver read each number as well as the item's place in the list. It is now a real numbered list, and the numbers you can see are hidden from screen readers.
- **7 November 2026: a link to the page you were on.** On the home page, the name at the top linked to the home page and repeated the heading below it. It was removed.
- **9 November 2026: an email box nobody could fill in.** The fix form showed the owner's address in a read-only email field, straight after saying it doesn't ask who you are. It is now a sentence saying where reports go. Found in a review by another AI, Codex.
- **9 November 2026: one way of reading.** The fix form let you choose only one way of reading the page, though many people use a screen reader with braille, or a magnifier with the keyboard. You can now choose all that apply. Found in the same review.
- **9 November 2026: a link to the page you were on, in the menu.** The current page was a link to itself, so NVDA said "same page link, current page". It is still named as the current page, but is no longer a link. Found by listening to a sister site.
- **9 November 2026: "Design fiction" said twice.** The note under each heading was a landmark named Design fiction that began with those words. It is now a plain note. Found the same way.
- **9 November 2026: columns that could overflow.** With text enlarged on a narrow screen, the "How we build" columns could be wider than the page. They now shrink to fit. Found in the same review.

## Reporting a problem

Every page has a link at the foot, "Fix something on this page", to a short form that already knows which page you were on. You can also use it for any site Unremarkable built.

The form doesn't ask who you are. We keep what you write, the page's address, how you were reading the page if you tell us, and your browser and device as your browser reports them. We don't keep your name, your email address or your IP address. Reports are used only to fix the sites, and to learn what to get right on the next one.

The Start form, for starting a website, keeps nothing while Unremarkable is design fiction: what you write is checked and thrown away.

## For agents

Agents acting for a person are welcome on every public page. There is a summary for agents at [llms.txt](https://unremarkable.me/llms.txt), the full text of the site in one file at [llms-full.txt](https://unremarkable.me/llms-full.txt), and a Markdown version of every page alongside it. All of them are generated from the pages you are reading when the site is built, not maintained by hand.

The site's permissions for search indexing and model training are declared separately in its [robots.txt file](https://unremarkable.me/robots.txt).

---

This site is Unremarkable

[Fix something on this page](https://unremarkable.me/fix/?page=https%3A%2F%2Funremarkable.me%2Faccessibility%2F)

Licensed under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

Built to [Zero Information Casualty v1.7](https://zeroinformationcasualty.org/)

For agents: [llms.txt](https://unremarkable.me/llms.txt)
