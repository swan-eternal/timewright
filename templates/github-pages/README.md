# GitHub Pages template

Copy `.github/workflows/pages.yml` into the repository that holds your world,
and put the world files at the root of that repository.

The workflow builds the site with `timewright build` and publishes it to
GitHub Pages. Set the repository's Pages source to "GitHub Actions" under
Settings → Pages.

Two things worth knowing:

- **`--base` is the repository name.** GitHub Pages serves a project site
  from `/<repository>/`, and the build has to know that, or the assets will
  404. The template already passes it.
- **The tool is installed from GitHub.** The workflow runs
  `npm install -g github:swan-eternal/timewright`, which npm handles by
  cloning the repository and building it. Nothing has to be published to npm
  first. If you fork the tool, change that line to your fork.

The world itself needs no build step of its own: the YAML files are the
source of truth, and the site is rebuilt on every push.
