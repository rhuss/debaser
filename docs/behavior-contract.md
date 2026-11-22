# Behavior contract

debaser rewrites an earlier patched-build tool. Its integration suite pins the behavior debaser keeps.
Each of that suite's 141 scenarios (one per `test(...)` case, counted from the frozen reference copy) is listed here as **carried** (with the debaser test that covers it) or **dropped** (with the reason), per FR-052 and SC-001.

`tests/contract.test.ts` checks this table: every `carried` row must name a test title that exists under `tests/` or `src/`.

| Reference test | Status | debaser test or reason |
|---|---|---|
| add arguments name upstream PRs, other repositories' PRs and branches, or own branches | carried | add arguments name upstream PRs, other repositories' PRs and branches, or own branches |
| sources display as the report names them and slug into file names | carried | sources display as the report names them and slug into file names |
| the config directory comes from --dir, then the environment, then the checkout | carried | the config directory comes from --dir, then the environment, then the checkout |
| a missing config has defaults; a saved one reads back the same | carried | a missing config has defaults; a saved one reads back the same |
| a config from a newer tool, or with a broken harness, is refused | carried | a config from a newer tool, or with a broken harness, is refused |
| harness.kind must be claude or codex | carried | harness.kind must be one of the registered adapters |
| the test world publishes PR heads and fork branches | carried | the test world publishes PR heads and fork branches |
| rebuild merges an own branch, an upstream PR, a fork PR and a fork branch in order | carried | build merges an own branch, an upstream PR, a fork PR and a fork branch in order |
| rebuild refuses a dirty checkout or a stopped run and changes nothing | carried | build refuses a dirty checkout or a stopped run and changes nothing |
| a patch that can't be fetched stops the run before anything is reset | carried | a patch that can't be fetched stops the run before anything is reset |
| merged and contained patches are skipped, closed PRs merged with a warning | carried | merged and contained patches are skipped, closed PRs merged with a warning |
| the after-build command runs only after a successful run | carried | the after-build command runs only after a successful run |
| a conflict without a harness stops with the files, then continue finishes and rerere replays it | carried | a conflict without a harness stops with the files, then continue finishes and rerere replays it |
| a rebuild records its timings and the next one has history | carried | a build records its timings and the next one has history |
| a run state without timing loads | carried | a run state without timing loads |
| a stopped run is recorded once, when it finishes | carried | a stopped run is recorded once, when it finishes |
| a successful run keeps the previous build as -prev; a stopped run leaves the backups alone | carried | a successful run keeps the previous build as -prev; a stopped run leaves the backups alone |
| rollback with nothing built says so | carried | rollback with nothing built says so |
| rolling back a stopped first run returns to the branch it started on | carried | rolling back a stopped first run returns to the branch it started on |
| a run that is stopped refuses another with where it stopped and what to run | carried | a run that is stopped refuses another with where it stopped and what to run |
| rollback on a terminal shows its steps and ends in a card | carried | rollback on a terminal shows its steps and ends in a card |
| an error before the run began ends the live view in a card | carried | an error before the run began ends the live view in a card |
| an own branch behind its pushed copy uses the pushed one; a diverged one uses local with a warning | carried | an own branch behind its pushed copy uses the pushed one; a diverged one uses local with a warning |
| a step failing only on the custom branch stops with 3; failing on upstream too stops with 4 | carried | a step failing only on the custom branch stops with 3; failing on upstream too stops with 4 |
| a PR merged on another repository is still merged; one merged upstream is skipped | carried | a PR merged on another repository is still merged; one merged upstream is skipped |
| the config directory stays out of git status after the reset drops its .gitignore entry | dropped | debaser keeps its files in the checkout's shared git directory, outside the working tree, so no exclude entry is needed (research R4); the first-add test checks git status stays clean |
| a custom branch checked out in another worktree is refused before anything changes | carried | a custom branch checked out in another worktree is refused before anything changes |
| continue after an interrupted step commits only tracked changes | carried | continue after an interrupted step commits only tracked changes |
| add creates an ignored config, dates entries, refuses duplicates and takes PR titles | carried | add creates an ignored config, dates entries, refuses duplicates and takes PR titles |
| remove retires a patch with its reason, which it needs off a terminal | carried | remove retires a patch with its reason, which it needs off a terminal |
| --dir and CORGI_CUSTOM_BUILD_DIR move every read and write, the option winning | carried | --dir and DEBASER_DIR move every read and write, the option winning |
| a harness resolution that passes the checks is committed with a trailer | carried | a harness resolution that passes the checks is committed with a trailer |
| harness resolutions with markers, extra edits, commits or timeouts are rejected until attempts run out | carried | harness resolutions with markers, extra edits, commits or timeouts are rejected until attempts run out |
| a harness that can't be run is a warning, and the run stops as without one | carried | a harness that can't be run is a warning, and the run stops as without one |
| a harness build fix becomes its own commit and the steps rerun; the next rebuild drops it | carried | a harness build fix becomes its own commit and the steps rerun; the next build drops it |
| a harness that changes nothing exhausts its attempts; upstream breakage never calls it | carried | a harness that changes nothing exhausts its attempts; upstream breakage never calls it |
| a claude harness logs readable text, keeps the raw stream and records tokens | carried | a claude harness logs readable text, keeps the raw stream and records tokens |
| plain run with kind claude shows readable text | carried | plain run with kind claude shows readable text |
| a claude harness's activity reaches the sink, and a sink that throws on it stops nothing | carried | a claude harness's activity reaches the sink, and a sink that throws on it stops nothing |
| a harness without kind is run and logged as today | carried | a harness without kind is run and logged as today |
| rejected fixes and rebase conflicts are recorded as harness calls | carried | rejected fixes are recorded as harness calls + rebase conflicts are recorded as harness calls, in build and in the rebase command |
| a patch that conflicts with upstream is reported for a rebase with a handoff | carried | a patch that conflicts with upstream is reported for a rebase with a handoff |
| patches that only clash with each other get a note and no handoff, however resolved | carried | patches that only clash with each other get a note and no handoff, however resolved |
| an agent fix for a patch that fails alone on upstream hands off build drift to that patch | carried | an agent fix for a patch that fails alone on upstream hands off build drift to that patch |
| an agent fix for patches that only fail together hands off a clash naming each other | carried | an agent fix for patches that only fail together hands off a clash naming each other |
| a step stop names the patches behind it and writes a prompt for fixing it with an agent | carried | a step stop names the patches behind it and writes a prompt for fixing it with an agent |
| a harness that fails to start is asked once, and the stop says why | carried | a harness that fails to start is asked once, and the stop says why |
| reports/latest follows the newest run and only ten runs and ten rollback logs are kept | carried | reports/latest follows the newest run and only ten runs and ten rollback logs are kept |
| the real steps are the repository's checks, the unit tests after a native build | carried | the built-in project recipes resolve to the pilots' step orders |
| rebuild --push sends the custom branch to origin; a plain rebuild never pushes | carried | build --push sends the custom branch to origin; a plain build never pushes |
| rebuild refuses a patch named like a branch it resets, and --push to upstream under another name | carried | build refuses a patch named like a branch it resets, and --push to upstream under another name |
| an own branch known only from a stale origin copy stops instead of building the old commit | carried | an own branch known only from a stale origin copy stops instead of building the old commit |
| rollback of a stopped run keeps uncommitted edits on another branch | carried | rollback of a stopped run keeps uncommitted edits on another branch |
| install runs when nothing is installed yet, even with unchanged manifests | carried | install runs when nothing is installed yet, even with unchanged manifests |
| after a harness fix every step runs again, so a fix can't break a step that passed | carried | after a harness fix every step runs again, so a fix can't break a step that passed |
| a second fix for the same step is recorded against the failure it answered | carried | a second fix for the same step is recorded against the failure it answered |
| a fix for every step within one attempt each still finishes the run | carried | a fix for every step within one attempt each still finishes the run |
| a recorded resolution replays before any harness is called | carried | a recorded resolution replays before any harness is called |
| a harness retry keeps the files rerere replayed staged, so a later attempt can pass | carried | a harness retry keeps the files rerere replayed staged, so a later attempt can pass |
| the conflict prompt for a PR carries its link and description | carried | the conflict prompt for a PR carries its link and description |
| continue refuses when the custom branch is no longer checked out | carried | continue refuses when the custom branch is no longer checked out |
| a reset that fails forgets the run and changes nothing | carried | a reset that fails forgets the run and changes nothing |
| a fork URL with credentials is refused, on add and in the config | carried | a fork URL with credentials is refused, on add and in the config |
| a stopped and continued run keeps one set of handoffs | carried | a stopped and continued run keeps one set of handoffs |
| a harness that times out takes its children with it | carried | a harness that times out takes its children with it |
| a fix never commits the temporary files an interrupted bun build leaves | carried | a fix never commits the temporary files a build leaves |
| an agent fix touching a single patch that passes alone names the other merged patches as its clash | carried | an agent fix touching a single patch that passes alone names the other merged patches as its clash |
| a failure log names a file only outside lines that hold nothing but a path | carried | a failure log names a file only outside lines that hold nothing but a path |
| an agent fix that no patch is named for runs nothing to attribute it and hands off nothing | carried | an agent fix that no patch is named for runs nothing to attribute it and hands off nothing |
| attribution says which patch it runs alone and how many are left | carried | attribution says which patch it runs alone and how many are left |
| a step that fails once and passes when run again is reported as flaky, never fixed or blamed | carried | a step that fails once and passes when run again is reported as flaky, never fixed or blamed |
| a rebuild signals stages, items and the end | carried | a build signals stages, items and the end |
| a rebuild prints the same with and without a sink | carried | a build prints the same with and without a sink |
| a stopped run signals the stop, and continue replays it first | carried | a stopped run signals the stop, and continue replays it first |
| a rebase run signals its branches | carried | a rebase run signals its branches |
| a rebuild's rebase phase signals its branches and harness calls | carried | a build's rebase phase signals its branches and harness calls |
| rebuild --verbose is accepted and plain output is unchanged | carried | build --verbose is accepted and plain output is unchanged |
| a live rebuild prints a summary card that points at the report | carried | a live build prints a summary card that points at the report |
| a live command that throws ends its view with the error | carried | a live command that throws ends its view with the error |
| a timings history that can't be written is a warning, and the run keeps its outcome | carried | a timings history that can't be written is a warning, and the run keeps its outcome |
| the usage names --verbose for every command with a live view | carried | the usage names --verbose for every command with a live view |
| a live run shows its warnings on the card | carried | a live run shows its warnings on the card |
| a live run pauses for the push question | carried | a live run pauses for the push question |
| step names link to their logs, in a run and in its continue | carried | step names link to their logs, in a run and in its continue |
| continue shows the earlier progress | carried | continue shows the earlier progress |
| continue after an interrupted harness conflict call commits leftovers that pass the checks as the agent's | carried | continue after an interrupted harness conflict call commits leftovers that pass the checks as the agent's |
| continue after an interrupted harness conflict call rejects leftovers that fail the checks | carried | continue after an interrupted harness conflict call rejects leftovers that fail the checks |
| continue after an interrupted harness build call commits an accepted fix as the agent's and hands it off | carried | continue after an interrupted harness build call commits an accepted fix as the agent's and hands it off |
| continue after an interrupted harness build call that changed nothing stops without committing | carried | continue after an interrupted harness build call that changed nothing stops without committing |
| a continue that stops again before going on ends its item as stopped | carried | a continue that stops again before going on ends its item as stopped |
| rebuild rebases own branches behind upstream, conflicting or not, and merges the rebased tips | carried | build rebases own branches behind upstream, conflicting or not, and merges the rebased tips |
| the rebase mode comes from the config, --rebase overrides it, and conflicting leaves clean branches | carried | the rebase mode comes from the config, --rebase overrides it, and conflicting leaves clean branches |
| other people's branches and PRs are never rebased and keep their rebase handoffs | carried | other people's branches and PRs are never rebased and keep their rebase handoffs |
| status reads origin from git's own ref, so a branch force-pushed by hand isn't diverged | carried | status reads origin from git's own ref, so a branch force-pushed by hand isn't diverged |
| an own PR's head branch is rebased into a new local branch and pushed to the fork; without gh it is not | carried | an own PR's head branch is rebased into a new local branch and pushed to the fork; without gh it is not |
| status checks an own PR's rebased branch against upstream, not the PR as last fetched | carried | status checks an own PR's rebased branch against upstream, not the PR as last fetched |
| a rebased branch whose tests fail alone keeps its old tip and gets a rebase-checks handoff | carried | a rebased branch whose tests fail alone keeps its old tip and gets a rebase-checks handoff |
| the harness adapts a rebased branch whose checks fail, as a fix commit to review before pushing | carried | the harness adapts a rebased branch whose checks fail, as a fix commit to review before pushing |
| a harness that can't fix a rebased branch's checks leaves it at its old tip after its tries | carried | a harness that can't fix a rebased branch's checks leaves it at its old tip after its tries |
| a rebased branch whose check passes only when run again moves, with a flaky warning | carried | a rebased branch whose check passes only when run again moves, with a flaky warning |
| inside rebuild an unresolved rebase conflict keeps the old tip, and the run goes on to merge it | carried | inside build an unresolved rebase conflict keeps the old tip, and the run goes on to merge it |
| the rebase command stops at a conflict it can't resolve; continue, --skip-branch and rollback end it | carried | the rebase command stops at a conflict it can't resolve; continue, --skip-branch and rollback end it |
| a rebase run records its timings, without the wait for the push answer | carried | a rebase run records its timings, without the wait for the push answer |
| rebased branches are pushed with a lease after a yes or with --push, and a moved remote copy is kept | carried | rebased branches are pushed with a lease after a yes or with --push, and a moved remote copy is kept |
| own branches checked out, diverged or already upstream are left alone, and so is everything without a fork | carried | own branches checked out, diverged or already upstream are left alone, and so is everything without a fork |
| rebase --in-worktree rebases a checked-out branch in its own worktree, or skips a dirty one | carried | rebase --in-worktree rebases a checked-out branch in its own worktree, or skips a dirty one |
| a rejected in-worktree resolution keeps the worktree's untracked files | carried | a rejected in-worktree resolution keeps the worktree's untracked files |
| an in-worktree rebase whose checks fail puts the branch back where it was | carried | an in-worktree rebase whose checks fail puts the branch back where it was |
| an in-worktree rebase records its backup before the rebase moves the branch | carried | an in-worktree rebase records its backup before the rebase moves the branch |
| an in-worktree rebase whose checks approve an edit made while they ran stays unchecked | carried | an in-worktree rebase whose checks approve an edit made while they ran stays unchecked |
| an in-worktree rebase whose checks approve a commit made while they ran stays unchecked | carried | an in-worktree rebase whose checks approve a commit made while they ran stays unchecked |
| rebase --in-worktree leaves checked-out branches alone that are current or that the mode skips | carried | rebase --in-worktree leaves checked-out branches alone that are current or that the mode skips |
| rebase --in-worktree rebases a checked-out branch with a pending push onto the newer upstream | carried | rebase --in-worktree rebases a checked-out branch with a pending push onto the newer upstream |
| a rejected in-worktree resolution after an earlier commit keeps the branch attached and moves it | carried | a rejected in-worktree resolution after an earlier commit keeps the branch attached and moves it |
| an in-worktree rebase skips a worktree that switched branches since the run chose it | carried | an in-worktree rebase skips a worktree that switched branches since the run chose it |
| rollback of a rebase run interrupted during an in-worktree branch's checks puts the branch back | carried | rollback of a rebase run interrupted during an in-worktree branch's checks puts the branch back |
| rollback after an interrupted in-worktree rebase keeps commits made on the branch since | carried | rollback after an interrupted in-worktree rebase keeps commits made on the branch since |
| an in-worktree check that fails keeps a commit made in the worktree during the checks | carried | an in-worktree check that fails keeps a commit made in the worktree during the checks |
| an in-worktree check that fails keeps uncommitted edits made during the checks | carried | an in-worktree check that fails keeps uncommitted edits made during the checks |
| a branch named by two patches is rebased once and both merge its new tip | carried | a branch named by two patches is rebased once and both merge its new tip |
| status lists own branches behind, conflicting with or left alone by upstream | carried | status lists own branches behind, conflicting with or left alone by upstream |
| add refuses the custom branch and its backup as patches | carried | add refuses the custom branch and its backup as patches |
| a rejected harness resolution is retried from that commit, keeping git's choice of commits | carried | a rejected harness resolution is retried from that commit, keeping git's choice of commits |
| a rebase conflict resolved once replays through rerere the next time | carried | a rebase conflict resolved once replays through rerere the next time |
| a branch moved or checked out while it is rebased stays where it is | carried | a branch moved or checked out while it is rebased stays where it is |
| a rebased branch not pushed yet is offered again and keeps its backup until it is rebased again from its new tip | carried | a rebased branch not pushed yet is offered again and keeps its backup until it is rebased again from its new tip |
| a rebuild merges an own PR's rebased head that is not pushed yet, not the old PR head | carried | a build merges an own PR's rebased head that is not pushed yet, not the old PR head |
| a git rebase that fails before stopping is reported as failed, not as rebased | carried | a git rebase that fails before stopping is reported as failed, not as rebased |
| tips, leases and pushes use the URL origin pushes to | carried | tips, leases and pushes use the URL origin pushes to |
| without an origin nothing is rebased, and worktrees an interrupted run left are removed | carried | without an origin nothing is rebased, and worktrees an interrupted run left are removed |
| continuing a rebase run with unmerged files ends its branch as stopped | carried | continuing a rebase run with unmerged files ends its branch as stopped |
| a stopped rebase run whose worktree is gone can still be skipped or rolled back | carried | a stopped rebase run whose worktree is gone can still be skipped or rolled back |
| remote URLs compare by repository, however they are spelled | carried | remote URLs compare by repository, however they are spelled |
| a branch that was ahead of its fork copy is still recognized as pending after its rebase | carried | a branch that was ahead of its fork copy is still recognized as pending after its rebase |
| a rebase the user aborted in the stopped worktree is reported as failed, not rebased | carried | a rebase the user aborted in the stopped worktree is reported as failed, not rebased |
| a leftover directory that is no worktree is removed without touching the user's own rebase | carried | a leftover directory that is no worktree is removed without touching the user's own rebase |
| origin fetching upstream and pushing to the fork, with several push URLs, still rebases and pushes | carried | origin fetching upstream and pushing to the fork, with several push URLs, still rebases and pushes |
| a pending push stays offered while its branch is checked out | carried | a pending push stays offered while its branch is checked out |
| rollback reinstalls dependencies, and continue finishes a rollback whose install failed | carried | rollback reinstalls dependencies, and continue finishes a rollback whose install failed |
| a rollback refused for uncommitted changes leaves the stopped run to continue | carried | a rollback refused for uncommitted changes leaves the stopped run to continue |
| rollback to the previous build reinstalls dependencies | carried | rollback to the previous build reinstalls dependencies |
