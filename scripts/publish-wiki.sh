#!/usr/bin/env bash
# Publish docs/wiki/*.md to the GitHub wiki of this repository.
#
# The wiki is a separate git repository (<repo>.wiki.git). docs/wiki/ in the
# main repository is the source of truth; this script mirrors it:
#   1. clone the wiki repo into a temporary directory,
#   2. replace its Markdown pages with the content of docs/wiki/,
#   3. commit and push if anything changed.
#
# Requirements (host): git, ssh access to GitHub, an `origin` remote.
# GitHub limitation: the wiki repo only exists after a first page has been
# created through the web UI (Wiki tab > "Create the first page").

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
src_dir="${repo_root}/docs/wiki"

origin_url="$(git -C "${repo_root}" remote get-url origin)"
# git@github.com:owner/name.git -> git@github.com:owner/name.wiki.git
wiki_url="${origin_url%.git}.wiki.git"

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

echo "Cloning ${wiki_url}"
if ! git clone --quiet "${wiki_url}" "${work_dir}/wiki"; then
  echo "Cannot clone the wiki. Create the first wiki page in the GitHub UI, then retry." >&2
  exit 1
fi

# Mirror: remove existing pages, copy current ones.
find "${work_dir}/wiki" -maxdepth 1 -name '*.md' -delete
cp "${src_dir}"/*.md "${work_dir}/wiki/"

cd "${work_dir}/wiki"
git add -A
if git diff --cached --quiet; then
  echo "Wiki already up to date."
  exit 0
fi

main_sha="$(git -C "${repo_root}" rev-parse --short HEAD)"
# The temporary clone has no local config: reuse the main repository's
# identity (which may be set only locally there, not globally).
author_name="$(git -C "${repo_root}" config user.name)"
author_email="$(git -C "${repo_root}" config user.email)"
git -c user.name="${author_name}" -c user.email="${author_email}" \
  commit --quiet -m "docs: sync wiki from ${main_sha}"
git push --quiet
echo "Wiki published from ${main_sha}."
