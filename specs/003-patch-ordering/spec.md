# Feature Specification: Managing the order of patches

**Feature Branch**: `003-patch-ordering`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: brainstorm `brainstorm/04-patch-ordering.md`. Insert a new patch at a chosen place (`add <source> --after/--before <patch>`), reorder patches with a `move` command (non-interactive `move <patch> --after/--before <patch>`; interactive `move` with numbered prompts that loops with "Move another patch?"), and `move --propose`, which test-merges every pair of patches in memory, derives a conflict-reducing order (base patches before patches built on them, own branches after the patches they clash with, everything else in place), verifies the whole order once, shows current and proposed order with a one-line reason per moved patch and the conflicts no order avoids, and asks before applying. `move` never resolves conflicts; `build` does. Reordering is refused while a run is stopped or in progress. No full-screen interface, no new runtime dependencies.

## Context

The patch list's order is the merge order: `build` merges the live patches onto upstream one after the other, in the order they appear in the patch list, and `list` shows them numbered (`#`) in that order. Today `add` always appends, and the only way to change the order is to edit `patches.json` by hand. Nothing tells the user whether another order would merge with fewer conflicts.

A merge conflict always lands on the patch that merges later. Two patches that change the same lines usually conflict in either order, so reordering mainly helps in two cases: a patch written on top of another patch (it merges cleanly only after its base), and choosing which patch takes an unavoidable conflict. The user's own branches are the patches the user controls and that debaser already rebases, so an unavoidable conflict belongs on them.

`build` already resolves merge conflicts: it hands them to the harness, checks the result, commits each fix separately, records the resolution so later builds replay it, and can push. Reordering only changes the list; the next `build` does the resolving.

A stopped run records the patches it planned and where it stopped. `continue` resumes against that record, so the list must not be reordered underneath it.

## Clarifications

### Session 2026-11-26

- Q: In `move` and `--after`/`--before`, should `#12` mean position 12 or PR #12? → A: PR #12, as everywhere else in debaser (`add #12`, `remove #12`). A bare number (`12`) is a position; `#12`, `owner/repo#12` and URLs are sources.
- Q: What exit code do `move --propose` runs that apply nothing return (declined, already best, printed without a terminal)? → A: 0. Refusals (stopped run, held lock, unfetched patches, bad references) exit 1, like other usage or precondition errors.
- Q: Which answers to "Move another patch?" continue the session? → A: `y` or `yes` (any case) continue; anything else, including Enter, ends it.
- Q: Should `status` hint that another order would avoid conflicts? → A: No, out of scope for this feature; the proposal runs only on `move --propose`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Insert a new patch at a chosen place (Priority: P1)

A user adds a patch that has to merge before an existing one (for example, a PR that another patch in the list builds on). They run `debaser add <source> --before <patch>` (or `--after <patch>`) and the new patch lands right there instead of at the end. debaser prints the resulting list.

**Why this priority**: It is the smallest useful piece and the most frequent need: putting a patch in the right place at the moment it is added.

**Independent Test**: With a list of three patches, run `add` with `--after 1`, then `add` with `--before` naming a patch by its source, and check the positions in `list` and in `patches.json`.

**Acceptance Scenarios**:

1. **Given** a list with patches #1, #2, #3, **When** the user runs `debaser add <source> --after 1`, **Then** the new patch is #2, the former #2 and #3 become #3 and #4, and the resulting list is printed with the new patch marked.
2. **Given** a list with patches #1, #2, #3, **When** the user runs `debaser add <source> --before <source of #1>`, **Then** the new patch is #1.
3. **Given** any list, **When** the user runs `debaser add <source>` without `--after` or `--before`, **Then** the patch is appended as today.
4. **Given** a reference that names no live patch, **When** the user runs `add <source> --after 9` on a list of three patches, **Then** debaser refuses with a message naming the valid range and adds nothing.
5. **Given** both `--after` and `--before` on one command, **When** it runs, **Then** debaser refuses with a usage error and adds nothing.

---

### User Story 2 - Move a patch from the command line (Priority: P1)

A user wants patch #4 to merge right after #1. They run `debaser move 4 --after 1` (or name the patches by source). debaser saves the new order and prints the list with the moved patch marked.

**Why this priority**: Scriptable reordering is the core of the feature; the interactive mode and the proposal build on it.

**Independent Test**: With four patches, run `move 4 --after 1`, `move <source> --before <source>`, and a move onto its own position, and check the saved order after each.

**Acceptance Scenarios**:

1. **Given** patches #1 to #4, **When** the user runs `debaser move 4 --after 1`, **Then** the order becomes the former #1, #4, #2, #3, and the list is printed with the moved patch marked.
2. **Given** patches named by source, **When** the user runs `debaser move owner/repo#12 --before my-branch`, **Then** the patch moves accordingly; any spelling `remove` accepts for a source works here.
3. **Given** a move that leaves the order unchanged (`move 2 --after 1`), **When** it runs, **Then** debaser says the order is unchanged and does not rewrite the patch list.
4. **Given** a patch moved relative to itself (`move 2 --after 2`), **When** it runs, **Then** debaser refuses with a usage error.
5. **Given** `move <patch>` with neither `--after` nor `--before`, **When** it runs, **Then** debaser refuses with a usage error naming both options.

---

### User Story 3 - Reorder interactively with numbered prompts (Priority: P2)

A user runs `debaser move` with no arguments on a terminal. debaser prints the numbered list and asks "Move which patch?", then "To which position?". It prints the new order with the moved patch marked and asks "Move another patch?". The user moves a few patches, answers "n" (or presses Enter), and debaser saves the new order once.

**Why this priority**: It makes reordering easy without remembering references, but the command-line form already covers the need.

**Independent Test**: Drive `move` with scripted answers on a pseudo-terminal: two moves, then "n"; check the saved order. Repeat with an interrupt in the middle and check that nothing was saved.

**Acceptance Scenarios**:

1. **Given** patches #1 to #4 on a terminal, **When** the user answers "4", "1", then "n", **Then** the former #4 becomes #1, the list is printed after the move with that patch marked, and the order is saved once at the end.
2. **Given** an answer that is not a valid patch number or position, **When** it is entered, **Then** debaser names the valid range and asks the same question again.
3. **Given** an empty answer to "Move which patch?", **When** it is entered, **Then** the session ends and any moves made so far are saved.
4. **Given** the session is interrupted (Ctrl-C or end of input) before it ends, **When** debaser exits, **Then** the patch list is unchanged.
5. **Given** `debaser move` without arguments and no terminal on standard input, **When** it runs, **Then** debaser refuses with a usage hint showing `move <patch> --after|--before <patch>` and `move --propose`.
6. **Given** a list with fewer than two patches, **When** the user runs `debaser move`, **Then** debaser says there is nothing to reorder.

---

### User Story 4 - Ask debaser for a conflict-reducing order (Priority: P2)

A user runs `debaser move --propose`. debaser test-merges the patches in memory, without touching any working directory, and shows the current and proposed order side by side. Each moved patch gets a one-line reason, for example "#5 moved after #2: both change `src/x.ts`; #5 is your branch". It names the conflicts no order avoids and says the next `build` hands them to the harness. It states that only merge conflicts were tested, not checks. It asks "Apply this order?" On yes it saves the order, prints the list and prints `debaser build` as the next step.

**Why this priority**: It is the most valuable insight the feature adds, but it depends on the ordering primitives from stories 1 and 2.

**Independent Test**: Build fixtures where (a) patch B was written on top of patch A but listed before it, and (b) an own branch and a PR change the same lines with the own branch listed first; run `move --propose`, accept, and check the saved order and the printed reasons. Check that the build directory and the user's checkout are unchanged.

**Acceptance Scenarios**:

1. **Given** patch B listed before patch A, where B merges cleanly only after A, **When** the user runs `move --propose`, **Then** the proposal puts A before B with a reason saying B builds on A.
2. **Given** an own branch listed before a PR that changes the same lines, so they conflict in either order, **When** the user runs `move --propose`, **Then** the proposal puts the own branch after the PR, names the shared files, and lists this conflict as unavoidable and left for the harness on the next build.
3. **Given** two non-own patches (PRs or other forks' branches) that conflict in either order, **When** the user runs `move --propose`, **Then** their relative order is kept and the conflict is listed as unavoidable.
4. **Given** patches that do not conflict with any other patch, **When** a proposal is made, **Then** they keep their current relative order.
5. **Given** the proposal, **When** it is shown, **Then** it reports the conflict count for the current and the proposed order, both established by merging each order from start to finish in memory.
6. **Given** a proposal identical to the current order, **When** it is computed, **Then** debaser says the current order is already the best it found, still lists the unavoidable conflicts and the patches that conflict with upstream alone, and asks nothing.
7. **Given** the user declines, **When** debaser exits, **Then** the patch list is unchanged.
8. **Given** a patch that conflicts with upstream alone, **When** a proposal is made, **Then** it is reported as needing a rebase or a fix that no order avoids and keeps its place.
9. **Given** `move --propose` and no terminal on standard input, **When** it runs, **Then** the proposal is printed and not applied, with a hint to add `--yes`; with `--yes` it is applied without asking.
10. **Given** a patch whose commits are not available locally (never fetched), **When** `move --propose` runs without `--fetch`, **Then** debaser refuses, names the patches, and suggests `--fetch`; with `--fetch` it fetches upstream and every patch first.

---

### User Story 5 - Safe reordering around runs and builds (Priority: P1)

A build stopped at a conflict, and the user tries to reorder. debaser refuses and tells them to finish or abandon the run first (`continue` or `rollback`). After an order change, the next build notes once that recorded conflict resolutions may no longer apply, so a previously clean build may stop again.

**Why this priority**: Without it, reordering can silently break `continue`, which would be worse than not having the feature.

**Independent Test**: Stop a build at a conflict, then run `move`, `move --propose` and `add --after`; each must refuse and leave the list unchanged. Hold the run lock with another process and repeat. Reorder after a successful build and run `build`; check the note appears once and not on the build after.

**Acceptance Scenarios**:

1. **Given** a stopped run, **When** the user runs `move` (any form) or `add` with `--after`/`--before`, **Then** debaser refuses, names the stopped run, suggests `continue` or `rollback`, and changes nothing.
2. **Given** another debaser process holding the checkout's run lock, **When** the user tries to reorder, **Then** debaser refuses, naming the running command.
3. **Given** a stopped run, **When** the user runs `move --propose`, **Then** debaser refuses before doing any merge test.
4. **Given** the order of patches changed since the last successful build, **When** the user runs `debaser build`, **Then** the build prints one note that the order changed and recorded conflict resolutions may not apply; once a build with that order succeeds, the following build with an unchanged order prints no such note.
5. **Given** a plain `add` without position options or a `remove` during a stopped run, **When** it runs, **Then** its behavior is unchanged by this feature.

### Edge Cases

- A list of zero or one patch: `move` (all forms) says there is nothing to reorder; `--propose` says the same.
- A bare number given to `--after`, `--before` or `move` is a position in the live list; `#N` is the upstream PR N, as in `add` and `remove`. So `move 3 --after #12` moves the patch at position 3 after the patch for PR #12.
- A source reference that matches a retired patch only: refused as "not in the list", like `remove`.
- Positions in interactive mode refer to the list as currently shown, after the previous moves in the same session.
- `--propose` with own branches that are behind upstream: the proposal uses the branches' current tips, not a rebased version; the next build may rebase them first.
- Pinned patches take part in the proposal at their pinned commit.
- Patches with acceptance checks are treated like any other; checks are not run by the proposal.
- `--propose` combined with `--after`/`--before` or a patch reference: usage error.
- The patch list is rewritten only when the order actually changes.

## Requirements *(mandatory)*

### Functional Requirements

#### Patch references

- **FR-001**: Wherever a command takes an existing patch to position against or to move (`add --after/--before`, `move`), the user MUST be able to name it by its position in the live list (a bare number such as `3`, as shown in `list`'s `#` column) or by any source spelling `remove` accepts.
- **FR-002**: A bare number in these places MUST be read as a position; `#N` and every other source form MUST be read as a source, exactly as `remove` reads it. An out-of-range position or an unknown source MUST be refused with a message naming the valid range or "not in the list".

#### Insert on add

- **FR-003**: `add` MUST accept `--after <patch>` and `--before <patch>` (mutually exclusive) and insert the new patch at that place; without them it MUST append as today.
- **FR-004**: After an insert with a position option, `add` MUST print the resulting numbered list with the new patch marked.

#### Move

- **FR-005**: `move <patch> --after <patch>` and `move <patch> --before <patch>` MUST move one patch to the given place and save the list.
- **FR-006**: `move` MUST refuse with a usage error when the patch is positioned relative to itself, when both or neither of `--after`/`--before` are given with a patch reference, when `--propose` is combined with a reference or position option, or when `--yes` or `--fetch` is given without `--propose`.
- **FR-007**: When a move leaves the order unchanged, `move` MUST say so and MUST NOT rewrite the patch list.
- **FR-008**: Every reorder that changes the order MUST print the resulting numbered list with each moved patch marked.

#### Interactive move

- **FR-009**: `move` without arguments on a terminal MUST print the numbered list, ask which patch to move (by number), ask for the target position (a number from 1 to the list length, the position the patch ends up at), print the new order with the moved patch marked, and ask whether to move another patch.
- **FR-010**: An invalid answer MUST be explained (valid range) and the same question asked again. An empty answer to the patch question MUST end the session. To "Move another patch?", `y` or `yes` (any case) MUST continue and any other answer, including Enter, MUST end the session.
- **FR-011**: The interactive session MUST save the new order once, at its end, and only if it changed. An interrupted session (signal or end of input) MUST leave the patch list unchanged.
- **FR-012**: `move` without arguments and without a terminal on standard input MUST refuse with a usage hint naming the command-line forms.

#### Proposal

- **FR-013**: `move --propose` MUST test-merge patches in memory only: it MUST NOT touch any working tree or index, and MUST NOT change the build directory, the user's checkout, the integration branch, any branch or other ref, or the recorded conflict resolutions. Writing unreachable objects to the git object database (as `git merge-tree --write-tree` does) is allowed. Recorded conflict resolutions are not consulted; every count is of raw merge conflicts.
- **FR-014**: It MUST test each live patch against upstream alone, and every pair of live patches that both merge cleanly on upstream alone in both orders on top of upstream, recording for each pair whether it merges cleanly in neither, one or both orders, and which files conflict. A patch that conflicts with upstream alone takes no part in the pair rules of FR-015 and keeps its current position.
- **FR-015**: It MUST derive the proposed order with these rules, in priority order: (1) when patches A and B merge cleanly in the order A, B but not in the order B, A, B goes after A ("B builds on A"); (2) when two patches conflict in either order and exactly one of them is the user's own branch, the own branch goes after the other (when both or neither are own branches, rule 3 applies); (3) all other patches keep their current relative order. The order MUST be computed as a stable topological sort of the rule constraints, using the current position as the tie-breaker, so patches move only as far as a constraint requires. Constraints MUST be added in priority order (all rule 1 constraints before rule 2), and within a rule in the current order of the patch that would move; a constraint that would close a cycle with those already accepted MUST be dropped, leaving the patches involved in their current relative order, and the conflict reported as one no order avoids.
- **FR-016**: It MUST merge the current order and the proposed order each from start to finish in memory and report how many patches conflict in each. A patch that conflicts in this sequence MUST be counted, left out of the in-memory result, and merging MUST continue with the next patch on the last clean result. If the proposed order has more conflicts than the current one, it MUST keep the current order and say so; with an equal or lower count the proposal is shown.
- **FR-017**: It MUST show the current and proposed order side by side, a one-line reason for each moved patch naming the patch it moved relative to and the files involved (patch numbers in reasons are current positions), the conflicts no order avoids (marked as going to the harness on the next build), patches that conflict with upstream alone, and a note that only merge conflicts were tested, not checks. Unavoidable conflicts and patches that conflict with upstream alone MUST also be shown when the current order is kept.
- **FR-018**: It MUST ask "Apply this order?" and apply only on yes; on apply it MUST save the order, print the list, and print `debaser build` as the next step. It MUST NOT start a build.
- **FR-019**: Without a terminal on standard input, `--propose` MUST print the proposal without applying it and hint at `--yes`; `--yes` MUST apply without asking.
- **FR-020**: `--propose` MUST use the patch and upstream commits from the last fetch. If any live patch or upstream has no fetched commit, it MUST refuse, naming them, and suggest `--fetch`. Own branches are local and need no fetch. `--fetch` MUST fetch upstream and every live patch first, the same way `build` does. Patches that the last fetch found merged upstream or contained in upstream are skipped, as `build` skips them, and keep their position.
- **FR-021**: Pinned patches MUST take part at their pinned commit; own branches at their current local tip.

#### Safety

- **FR-022**: `move` (every form, including `--propose`) and `add` with `--after`/`--before` MUST refuse, changing nothing, while a stopped run exists (naming `continue` and `rollback`) or while another live process holds the checkout's run lock (naming its command).
- **FR-023**: Reordering commands MUST hold the checkout's run lock from before they read the patch list until after they write it, including the whole interactive session and the "Apply this order?" prompt, so neither a build nor another change to the patch list can happen in between.
- **FR-024**: When the order of the patches that were in the last successful build differs from that build's order, `build` MUST print one note at its start that the merge order changed and that recorded conflict resolutions may not apply. Patches added or retired since then MUST NOT by themselves trigger the note. The reference order is the merged patch order recorded in the newest kept report of a successful build; when no such report exists, no note is printed. The note repeats on every build until a build with the new order succeeds.

#### Scope limits

- **FR-025**: `move` MUST NOT resolve conflicts, call the harness, or push.
- **FR-026**: The feature MUST NOT add runtime dependencies and MUST NOT use a full-screen terminal interface; interactive input is line-based.
- **FR-027**: `usage` and the README MUST document `move`, its options, and the new `add` options.
- **FR-028**: `move` MUST exit 0 when it applies an order and when it applies nothing on purpose (declined proposal, order already best or unchanged, proposal printed without a terminal), and exit 1 on every refusal (stopped run, held lock, unfetched patches, invalid references or options). `add` MUST exit 1 on refusals of its new position options. An interactive session ended by end of input exits 1; one ended by a signal exits with the existing signal codes (129/130/143).
- **FR-029**: `status` MUST NOT run or hint at the proposal; the proposal runs only on `move --propose`.

### Key Entities

- **Patch reference**: how a user names an existing live patch: its 1-based position in the live list, or a source.
- **Pair result**: for two patches, whether each order merges cleanly on upstream, and the files that conflict.
- **Proposal**: the current order, the proposed order, a reason per moved patch, the unavoidable conflicts, the patches that conflict with upstream alone, and the conflict counts of both orders.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can put a new patch at any position with one `add` command, and move any patch with one `move` command, without editing `patches.json`.
- **SC-002**: In interactive mode, moving a patch takes two numeric answers, and the user sees the affected patch marked in the printed list after every move.
- **SC-003**: For a list with a patch listed before the patch it builds on, `move --propose` produces an order in which that patch merges cleanly, and every moved patch has a reason that names the other patch and the files involved.
- **SC-004**: For 15 patches on a repository of up to 10,000 tracked files, `move --propose` (without `--fetch`) finishes in under 30 seconds on a current developer laptop.
- **SC-005**: After any `move --propose` run, the build directory, the user's checkout (working tree and index), every ref, and the recorded conflict resolutions are byte-for-byte unchanged; only unreachable objects may be added to the object database.
- **SC-006**: No reordering command changes the patch list while a run is stopped or another debaser process holds the run lock.

## Assumptions

- "Own branch" means a patch whose source kind is a local branch (`branch`); PRs and other forks' branches are not own.
- Positions count from 1, as in `list`.
- `--propose` runs over live patches only; retired patches are ignored.
- The proposal does not rebase own branches first; it reports conflicts as they stand at the current tips.
- The "order changed" note compares against the merged patch order recorded in the newest kept report of a successful build (reports are pruned to the newest 10); there is no extra stored state.
- The marked patch in printed lists uses the existing terminal coloring and a textual marker, so piped output still shows it.
- A JSON output for `move` is out of scope.
