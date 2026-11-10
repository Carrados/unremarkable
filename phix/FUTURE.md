# Phix: future development notes, to be considered

Notes for Charli-Jo on where Phix could go. Nothing here is decided, and nothing here is an instruction to Phix: Phix follows `PHIX.md` and nothing else.

## How wide Phix's scope should be (10 November 2026)

The question: Phix is ambitious. It can't fix every accessibility problem, but it could fix a great many, and models well short of the newest can work out what needs doing from the HTML and the person's own words. So how wide should its scope be, should its limitations be stated, or should it simply grow as models do?

The answer reached: keep the scope wide, and put the limits somewhere other than on the kinds of problem.

### Don't limit Phix by what the problem is

Any list of "what Phix can fix" is a snapshot of one month's model and will be wrong within months. The price of Phix trying and failing is small: it calls `stuck` and the owner gets an email. So let it attempt everything.

### Limit Phix by what it may change

This boundary has nothing to do with how clever the model is, so it doesn't date:

- The owner's words, unless the words are the problem.
- Design, and new content.
- The machinery: Workers, build scripts, and Phix's own instructions.
- Anything going live without the owner.

A better model fixes more inside that fence. It doesn't earn the right to move the fence. The owner moves it, deliberately, when the record justifies it.

### State the process publicly, not the capability

"Phix can fix X but not Y" is a claim that would need revising for ever. "A person checks every fix before it goes live, and you tell us whether it worked" stays true whatever the model.

One limitation is worth stating, because it explains the design: Phix reads the code, it doesn't use a screen reader. That is exactly why the person who reported the problem has the last word.

### Let the record draw the boundary

Every `stuck` comes with a reason. Keep those. After a few months they are a measured account of what an agent could and couldn't fix, with dates, and it moves as models do. That is worth more than any limitation written in advance.

The one risk in letting Phix simply develop is that the same fence starts to feel fussy as Phix gets better. The record is what says when widening it has been earned, and not just when it is tempting.

## Also open, from the review of 10 November 2026

Done that day: Publish merges only the commit that was handed in; `ready` is checked with GitHub; previews must be on the account's own workers.dev address; the look-alike address bug (pull request 39).

Still to consider:

- **Phix holds keys that can publish.** Its Cloudflare token can deploy and its GitHub token can merge. Putting that right needs a second GitHub account for Phix, with a rule on `main` that only the owner can bypass, and a preview step that runs outside Phix (build with no secrets, then upload with the token and no code from the branch).
- **Previews for the five sites in Carrados/Charli.info.** Their wrangler files have preview addresses switched off, so Phix most likely can't show a fix for those sites. Not yet confirmed by a real run.
- **Changes to the machinery** (`fix/`, `phix/`, the workflow, any Worker or wrangler file) should always go to the owner as `stuck`, enforced by the Worker and not only by Phix's instructions.
- **Report text becomes public before the owner sees it,** because Phix writes what the visitor said into a pull request on a public repo.
- **How Phix checks a fix.** It has no browser. Give it Playwright, axe and an accessibility-tree readout, and have `ready` say how the fix was checked, so "checked it" is only said when it's true.
- **Publish says "fixed and live" before the build has finished.** Check the build before telling the reporter.
- **Two fixes can collide,** because built output is committed, and a blocked merge has no route back to Phix.
- **Junk can starve the queue.** Reports are taken oldest first, five per run, with no daily cap. A cheap first pass could catch spam and duplicates before the main model is used.
- **The owner's page can't mark a report as spam or a duplicate.**
- **A report sent just after midday waits 18 hours.**
- **The list of sites lives in three places:** `fix/common.js`, `fix/phix.js` and `PHIX.md`.
- **Fix once, sweep everywhere.** After a fix, run the new check across every site. The unused `rule` column in the database is waiting for this.
- **A Markdown or JSON version of the reporter's page,** so their agent can watch it.
- **An owner for each site,** for when there is a client.
- **A summary of what changed on the owner's page,** written by the Worker from GitHub and not by Phix.
- **Smaller:** pin the GitHub Actions to commit hashes; keep report text for a limited time only.
