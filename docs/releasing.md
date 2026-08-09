# Release procedure

`gh-video-attach` is distributed through npm. Homebrew is not a release target
for the initial version.

## First release

The npm package must exist before npm can register a trusted publisher. Keep
the GitHub repository private until the package name has been claimed.

1. Merge the release PR with a merge commit.
2. Authenticate the maintainer account with `npm login --auth-type=web`.
3. From a clean checkout of the merged commit, run `npm publish --access public`.
4. Install a current npm CLI and register the release workflow as a trusted
   publisher limited to the protected `npm` environment:

   ```bash
   npm install --global npm@^11.15.0
   npm trust github gh-video-attach \
     --repo mimo-3/gh-video-attach \
     --file release.yml \
     --environment npm \
     --allow-publish \
     --yes
   ```

5. Make the GitHub repository public and enable private vulnerability reporting.
6. Publish the matching GitHub release. The workflow detects that the npm
   version already exists and does not publish it twice.

Never put an npm token in the workflow. The trusted publisher uses short-lived
OIDC credentials instead.

## Later releases

1. Update `version` in `package.json` and `package-lock.json`.
2. Merge the release PR with a merge commit.
3. Publish a GitHub release for the same tag, such as `v0.2.0`. The workflow
   fails if the tag and `package.json` version do not match.
4. Confirm that the release workflow published that exact npm version.

The release workflow fails rather than using a long-lived token when trusted
publishing is unavailable.
