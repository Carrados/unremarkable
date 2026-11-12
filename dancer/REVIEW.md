# Cloud Dancer: review of 12 November 2026

A review of Cloud Dancer's connector and the agent runs behind it, for design, operational sanity and security. It was made from the source in this repo and from the live connector, using read-only calls only. It said Flo was not written yet. That was wrong: her API (`dancer/flo.js`) and her run (`flo.yml`) were on main and reachable, which is why finding 5 was done first, on 12 November 2026.

Each finding says where it stands: **done**, **partly done**, or **to do**.

## The short of it

The connector itself is sound. The weak point was the agent runs behind it. The rule "nothing goes live until the owner says publish" was kept by the agents' instructions, not by what their keys could do. Findings 1, 2 and 3 are now fixed in code for Cloud Dancer and for Phix. Flo will need the same treatment when she is written.

## What is solid

- **Ownership checks.** Every tool call re-checks that the request belongs to the signed-in owner and that they still own the site (`mine` in `mcp.js`). A request number that isn't yours gives the same answer as one that doesn't exist.
- **Publishing a pinned commit.** Publish merges the exact commit recorded at "ready". If the branch moved, GitHub refuses and nothing goes live.
- **Agent identity.** Flo and Cloud Dancer prove themselves with GitHub's run identity, pinned to their own workflow file on main. There is no shared secret, and neither can use the other's API.
- **The door to GitHub.** The connector Worker holds no GitHub token. The door (`fix/door.js`) allows only: look at, merge or close a pull request on the site repos, and the two wake events.
- **Sign-in.** The code is tied to the browser that asked, compared in constant time, limited in tries, and the page never says who is an owner.

## Security findings, most serious first

### 1. The agent's run held a key that could deploy straight to live. Done.

`dancer.yml` gave the agent `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit), with `curl`, `npx`, `node`, `git` and `gh` all allowed. That token can deploy any Worker on the account, including the one that holds the GitHub token. The agent also reads web pages to check links, so untrusted text reached a session that held live keys and could send data out.

What changed:

- The run is now two jobs on two machines. The agent's job has no Cloudflare key. A second job, `preview`, has the key and no model.
- The agent hands in two files: her branch as a git bundle, and `dancer-out/ready-<id>.json`. The preview job (`dancer/preview.mjs`) checks the branch, pushes it, opens the pull request, uploads that commit as a preview copy and calls `ready`.
- Nothing from the agent's branch is run. Wrangler comes from a folder of its own. The branch's `wrangler.jsonc` must be the same as main's. A branch with a link to another file, or a `.env` or `.dev.vars` file, is refused.
- The agent's commands are narrower: no `npm`, `npx`, `gh` or bare `node`, and only `step`, `flow` and `stuck` on her API.
- If the preview can't be made, the request is marked stuck and the owner is told why.

Still to do:

- **Phix: done too.** Her run is three jobs: the agent with no keys, a build job with no keys and no model, and a preview job with the keys and no model (`phix/build.mjs`, `phix/preview.mjs`). Her preview copy is the Worker as it is on main with only the built pages swapped in, so no code from her branch ever runs with a site's secrets. Cloud Dancer's preview still uploads her whole branch, guarded by the refused list. Moving her to the same "main's Worker, branch's pages" shape would be stronger.
- Phix's agent still holds `PHIX_SECRET`, because she needs it to tell the reporter and the owner what is happening. With it she could call `claim` or `ready` by hand. `ready` only accepts a pull request from her own branch, which she can no longer push. Moving her API to the run's GitHub identity, as Cloud Dancer's is, would let the Worker tell the agent's job from the preview job.
- The narrower command list is a speed bump, not a wall: `curl` and `git` are still allowed. What makes it safe is that her job now holds no key worth taking, apart from the Claude subscription token.

### 2. The agent's GitHub token could probably merge. Done for Cloud Dancer.

Checked on 12 November 2026: `main` is protected, and no other branch is. The workflow notes say the protection is "only a pull request can change it". That stops a direct push. It does not stop a merge. `PHIX_GITHUB_TOKEN` is a token for the Carrados account with Contents and Pull requests write, so an agent holding it could merge her own pull request, which publishes. I could not read the exact rule, so treat this as likely, not proven.

What changed: Cloud Dancer's agent no longer holds that token at all. She gets only the run's own read-only token. She commits on her branch and hands it in as a git bundle. The preview job, with no model in it, pushes that branch to `dancer/request-<id>` and nowhere else, never forced, and opens the pull request. So no settings change is needed for her.

The preview job also refuses a branch that touches the site's own machinery: `.github/`, `dancer/`, `flo/`, `phix/`, `fix/`, `wrangler.jsonc` or `CLAUDE.md`. Without that, a misled agent could slip a change to a workflow or a rulebook into a fabric change, and the owner would publish it without seeing it, because none of it shows on a preview.

Still to do:

- **Phix: done too**, in the same way, across all four site repos. Which repo a fix is pushed to comes from the reported page (`phix/sites.mjs`), never from her.
- **`flo.yml`: done.** Flo's run no longer holds `PHIX_GITHUB_TOKEN`, only its own read-only token, and may no longer use `gh`, `npm`, `npx` or bare `node`. She can't push, so she can't put flow live until her run has the same two-job shape as Cloud Dancer's. Do that before flow is turned on for any site.
- `build.mjs` and `README.md` are not on the refused list, because fabric can need them. `build.mjs` runs on Cloudflare when a change is published, and the agents read `README.md` as rules. A change to either deserves a line in the email to the owner saying so.

### 3. Owners' instructions were printed in public. Done for the logs. A decision is still open.

Both workflows ran `cat` on the claimed work, and this repo is public, so the full text of every request landed in public Actions logs. Request 3 carried a whole unpublished document. `display_report` also put the agent's own report in the public run summary.

What changed: `dancer.yml` and `flo.yml` now print request numbers only, and `display_report` is off in both. `DANCER.md` tells her not to copy the owner's request into the pull request.

Still to do:

- **Old runs.** Logs from runs before this change still hold the text. Delete those runs in the Actions tab (each run's menu has "Delete workflow run").
- **Is the preview private?** The branch, the pull request and the hand-in file are public before the owner approves, because the repo is public. The preview address is guessable from the request number and needs no sign-in. Either make site repos private, or stop calling the preview "private" in the connector's wording.
- `phix.yml`: done. It prints report numbers and sites only, and `display_report` is off.

### 4. The preview is not fully tied to the commit. Partly done.

At "ready", the Worker takes the preview address from the caller and only checks it ends in the account's workers.dev domain (`previewUrl` in `sites.js`). Nothing checks it was built from the commit that will be merged.

What changed: the preview job now builds the address itself from wrangler's output, from the commit GitHub named, and the agent is no longer allowed the `ready` command.

Still to do:

- The agent's job can still mint the run's identity token, so a determined misuse could call `ready` by hand. Have the Worker work out the expected host itself (`dancer-<id>-<worker>.<account>.workers.dev`) and refuse any other.
- Serve the commit id on the preview (a small `version.txt`), and have `ready` and `publish` both fetch and compare it. The alias `dancer-<id>` can be uploaded again later, so check at publish, not only at ready.

### 5. Flow has no server-side limit. Partly done.

The Worker merged whatever was in Flo's pull request (`posted` in `flo.js`). It did not check that the site had any flow shapes, or that only flow files changed. `FLOW.md` says "none yet", but only the agents read it. The sort between flow and fabric is a model's judgement, and the approval gate hung on it. Flo was live, with a token that could push and merge, so a misled Cloud Dancer calling `flow` was a way to put a change live, Worker code included, with no preview and no owner.

What changed:

- `sites.js` has a `flow` setting for each site: the folders flow may touch, empty for off. Every site is off.
- While it is off, the Worker refuses Cloud Dancer's `flow` and Flo's `posted`, and Flo's `claim` sends any flow request for that site back to Cloud Dancer as fabric.
- Flo's run holds no token that can push (finding 2).

Still to do, before flow is turned on for any site:

- Before merging, ask GitHub for the pull request's changed files and refuse anything outside that site's `flow` folders. The door needs one more allowed call for that.
- Give Flo's run Cloud Dancer's shape: an agent job with no keys, and a job with no model that pushes her branch.

### 6. The sign-in code can be guessed slowly, and sign-in can be blocked. To do.

Six codes an hour with five tries each is 30 guesses an hour against one address, out of a million. Kept up for a year, that is roughly a one in four chance, though the owner would get six emails an hour. The same hourly limit lets anyone who knows the address stop the owner signing in. Owners who are already signed in are not affected.

- Use eight figures.
- Cap wrong tries for one address across a day, not only for one code.
- Email Unremarkable when an address hits a limit.
- The hourly count in KV is read, then written, so two requests at once can both pass. Small.
- Sending the email is awaited, so the page answers more slowly for a real owner. That can tell a watcher who is an owner. Send it with `ctx.waitUntil`.

### 7. Smaller points. To do.

- The identity check pins the repository's name, not its numeric id. Add `repository_id` and `repository_owner_id` to `checkClaims`, so a renamed and re-registered account can't stand in.
- `request_change` is marked not destructive and closed-world, though flow goes public within minutes. Agents use those marks to decide whether to ask first. Mark it honestly.
- An agent's "stuck" reason is emailed to the owner word for word, so a misled agent could send a persuasive link. Consider stripping addresses that aren't on the owner's site.
- The sign-in email names the app by the name it gave itself. Add the address access will go to, as the page does.
- The agents' API has no rate limit, and an unknown key id makes the Worker fetch GitHub's keys again each time. Small.

### 8. Files that change how Claude behaves could be published unseen. Done.

Cloud Dancer's preview job refused `CLAUDE.md` at the top of the repo, and nothing else of the kind. A `.claude/settings.json` with a hook, a `.mcp.json`, or a `CLAUDE.md` or `AGENTS.md` in a folder shows nothing on a preview. Once published, a hook runs commands in every later agent run on the repo, past its list of allowed tools. Phix's list had `.claude/` at the top only, and no `.mcp.json`.

What changed: both lists (`dancer/preview.mjs`, `phix/sites.mjs`) now refuse, anywhere in the repo, a `.claude/` folder, a `.mcp.json` file, and `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md`, in any letter case.

## Operational findings. To do.

- **A failed run strands requests.** Stale work is only reclaimed inside `claim`, and `claim` only runs on a wake. There is no timer. A crashed run leaves "working on it now" showing until someone asks for something else. Add a scheduled sweep that re-wakes the agents.
- **A failed wake is silent.** It is logged, but the owner is still told "Cloud Dancer has it".
- **No limit on retries.** `tries` goes up on every claim, but nothing stops a request that keeps crashing. After three, mark it stuck and email the owner.
- **More than three at once.** A run claims three requests. With seven or more waiting, some wait for the next wake. Have the run claim again until there is nothing left.
- **No cancel while working.** A request that is "working" or "retry" cannot be sent back to be left. For flow, that means no stop once Flo has started.
- **Long text is cut silently.** Instructions are trimmed at 20,000 characters and reasons at 5,000, with no error. A long page could go out cut short. Refuse it and say so.
- **Misleading publish errors.** A merge conflict answers "try again in a minute", which will never work. If the merge succeeds but the database write fails, a retry says "nothing went live" when it did. On a refusal, look at the pull request and answer from what is true.
- **No spending cap.** Twenty waiting requests is the only limit, and each wake starts a long model run on the subscription. Add a daily cap for each owner.
- **Leftovers.** Closed and published requests leave their branch and preview copy up.
- **The off switch is partial.** `DANCER_OPEN` set to `0` stops wakes, but not `publish`, and not a run started by hand.

## Design points. To think about.

- **Words and material share one field.** Requests 2 and 3 show agents wrapping the owner's words and pasting whole files into `instruction`. A separate field for text to be placed, never read as instruction, would give the agents a real boundary.
- **One shared set of keys for every site.** Fine while there is one owner. Before a second owner joins, each site needs its own token and its own run.
- **Co-owners cannot see each other's requests.** One could have a change waiting that the other never hears about.
- **Publish merges into main as it is now.** The owner saw the branch as it was. If main has moved since, the live result is the two together. Workers Builds rebuilds on merge, so the pages come out right, but the owner approved a slightly older picture.

## What was not checked

- The exact branch protection rule on `main`, and the real scopes of the three tokens.
- The deployed Workers' settings on Cloudflare, against what the repo says.
- `dancer/e2e.mjs`, the sign-in run end to end.
- Cloud Dancer's new run was tested end to end on 12 November 2026 with request 4, a test request that was then closed. It worked.
- Phix's new run has unit tests, and its build step was rehearsed by hand for unremarkable.me and carrados.com, but it has not yet run on a real report. The first real report is its test. Watch that run.
