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
- **`npm install -g timewright` assumes the package is published.** Until it
  is, install from a clone of the tool instead, and point the workflow at it:

  ```yaml
  - uses: actions/checkout@v4
    with:
      path: tool
      repository: your-org/timewright
  - run: npm install -g ./tool
  ```

The world itself needs no build step of its own: the YAML files are the
source of truth, and the site is rebuilt on every push.
