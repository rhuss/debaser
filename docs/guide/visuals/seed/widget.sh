#!/bin/sh
# Seed for the debaser guide's CLI visuals: the fictional project example/widget.
# Usage: sh /visuals/seed/widget.sh built|fresh|conflict
#   fresh     upstream, origin, a helper fork, the clone /work/widget with two
#             patches (own branch fast-start, the fork branch helper-colors) and
#             a local recipe override; nothing built yet
#   built     fresh, one build (which trusts the project recipe), then one new
#             upstream commit, so upstream moved since the last build
#   conflict  fresh plus own branch rename-flag, which edits the line
#             fast-start edits, added third
# Offline: every repository is a local bare repository under /srv.
set -eu

mode="${1:-}"
case "$mode" in
  built | fresh | conflict) ;;
  *)
    echo "usage: widget.sh built|fresh|conflict" >&2
    exit 2
    ;;
esac

# Fixed dates keep the seed commits the same on every capture.
export GIT_AUTHOR_DATE="2026-01-05T09:00:00Z" GIT_COMMITTER_DATE="2026-01-05T09:00:00Z"

UP=/srv/upstream/widget.git
ORIGIN=/srv/origin/widget.git
HELPER=/srv/forks/helper/widget.git
WORK=/work/widget
SCRATCH=/tmp/widget-seed

# Idempotent: a second run starts from scratch, clone and build directory included.
cd /
rm -rf /srv/upstream /srv/origin /srv/forks "$SCRATCH" "$WORK" "$WORK-debaser"
mkdir -p "$SCRATCH" "$(dirname "$WORK")"
for bare in "$UP" "$ORIGIN" "$HELPER"; do
  git init --quiet --bare "$bare"
done

# Upstream main: the tool, its scripts, and the project's own debaser recipe.
# The steps take fixed times (lint 1s, test 2s, smoke 1s, build 1s), so the
# verify phase dominates the build and the live view's timeline bar keeps its
# proportions from capture to capture.
git init --quiet "$SCRATCH/up"
cd "$SCRATCH/up"
cat > widget.sh <<'EOF'
#!/bin/sh
# widget: greets whoever is named on the command line.

# Seconds widget waits before it starts (the environment may set it).
START_DELAY="${START_DELAY:-2}"

NAME="${1:-world}"

sleep "$START_DELAY"

# Plain output, no colors.
printf 'Hello, %s\n' "$NAME"
EOF
cat > test.sh <<'EOF'
#!/bin/sh
# Tiny test: widget greets the name it is given.
set -e
out=$(START_DELAY=2 sh widget.sh tester)
case "$out" in
  *"Hello, tester"*) echo "ok - widget greets by name" ;;
  *) echo "not ok - widget greets by name: $out"; exit 1 ;;
esac
EOF
cat > lint.sh <<'EOF'
#!/bin/sh
# Stands in for a linter that takes a second: checks the syntax of widget.sh.
sleep 1
sh -n widget.sh
EOF
cat > build.sh <<'EOF'
#!/bin/sh
# Builds widget: copies widget.sh to the output path ($1); takes a second.
set -e
sleep 1
mkdir -p "$(dirname "$1")"
cp widget.sh "$1"
EOF
printf 'dist/\n' > .gitignore
mkdir -p .debaser
cat > .debaser/recipe.toml <<'EOF'
# debaser recipe of example/widget.

[artifact]
output = "dist/widget"
install = "dist/widget-custom"

[[steps]]
name = "lint"
run = ["sh", "lint.sh"]

[[steps]]
name = "test"
run = ["sh", "test.sh"]

[[steps]]
name = "build"
run = ["sh", "build.sh", "{output}"]
EOF
git add -A
git commit --quiet -m "Add widget, its test, and a debaser recipe"
git push --quiet "$UP" HEAD:refs/heads/main
git push --quiet "$ORIGIN" HEAD:refs/heads/main
git push --quiet "$HELPER" HEAD:refs/heads/main

# The helper fork's branch helper-colors.
git checkout --quiet -b helper-colors
cat > widget.sh <<'EOF'
#!/bin/sh
# widget: greets whoever is named on the command line.

# Seconds widget waits before it starts (the environment may set it).
START_DELAY="${START_DELAY:-2}"

NAME="${1:-world}"

sleep "$START_DELAY"

# Green output.
printf '\033[32mHello, %s\033[0m\n' "$NAME"
EOF
git commit --quiet -am "Color the greeting green"
git push --quiet "$HELPER" helper-colors

# The maintainer's clone: origin is their fork, upstream the project.
git clone --quiet "$ORIGIN" "$WORK"
cd "$WORK"
git remote add upstream "$UP"
git fetch --quiet upstream

# Own branch fast-start, pushed to origin.
git checkout --quiet -b fast-start upstream/main
sed 's/^START_DELAY="\${START_DELAY:-2}"$/START_DELAY="${START_DELAY:-0}"/' widget.sh > widget.sh.new && mv widget.sh.new widget.sh
git commit --quiet -am "Start without the delay"
git push --quiet origin fast-start
git checkout --quiet main

debaser add --upstream example/widget fast-start "Start faster"
debaser add "$HELPER#branch=helper-colors" "Colored output"

# The maintainer's local recipe override in the data directory: one more step after test.
DATA="$(git rev-parse --path-format=absolute --git-common-dir)/debaser"
mkdir -p "$DATA"
cat > "$DATA/recipe.toml" <<'EOF'
# Local additions to the project's recipe.

[[steps]]
name = "smoke"
after = "test"
run = ["sh", "-c", "START_DELAY=1 sh widget.sh smoke"]
EOF

case "$mode" in
  built)
    # debaser trust asks on a terminal; the first build trusts the recipe instead.
    debaser build --trust-recipe > /tmp/widget-first-build.log 2>&1 || {
      cat /tmp/widget-first-build.log >&2
      exit 1
    }
    # Upstream moves on after the build.
    export GIT_AUTHOR_DATE="2026-01-06T09:00:00Z" GIT_COMMITTER_DATE="2026-01-06T09:00:00Z"
    cd "$SCRATCH/up"
    git checkout --quiet main
    printf '# widget\n\nGreets whoever is named on the command line.\n' > README.md
    git add README.md
    git commit --quiet -m "Add a README"
    git push --quiet "$UP" main
    cd "$WORK"
    ;;
  conflict)
    # Own branch rename-flag edits the line fast-start edits.
    git checkout --quiet -b rename-flag upstream/main
    sed 's/START_DELAY/WIDGET_DELAY/g' widget.sh > widget.sh.new && mv widget.sh.new widget.sh
    sed 's/START_DELAY=/WIDGET_DELAY=/' test.sh > test.sh.new && mv test.sh.new test.sh
    git commit --quiet -am "Rename START_DELAY to WIDGET_DELAY"
    git push --quiet origin rename-flag
    git checkout --quiet main
    debaser add rename-flag "Rename the delay setting"
    ;;
esac

rm -rf "$SCRATCH"
