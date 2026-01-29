This project welcomes contributions and suggestions for the `@belyas/pubsub-mfe` library.

As a contributor, please follow these guidelines to help us maintain a high-quality project and a smooth review process.

- [Code of Conduct](#code-of-conduct)
- [Found a bug?](#found-a-bug)
- [Missing a feature?](#missing-a-feature)
- [Submission guidelines](#submission-guidelines)
  - [Submitting an issue](#submitting-an-issue)
  - [Building locally](#build-the-project-from-source)
  - [Submitting a pull request (PR)](#submitting-a-pull-request-pr)
  - [Reviewing a pull request](#reviewing-a-pull-request)
    - [Addressing review feedback](#addressing-review-feedback)
      - [Updating the commit message](#updating-the-commit-message)
    - [After your pull request is merged](#after-your-pull-request-is-merged)
- [Coding rules](#coding-rules)
- [Commit message guidelines](#commit-message-guidelines)

## Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
Please read and adhere to the `CODE_OF_CONDUCT.md` in the repository.

## Found a bug?

Thanks for helping improve `@belyas/pubsub-mfe`! If you find a bug in the source code or a mistake in the documentation, please open an issue on GitHub: https://github.com/belyas/pubsub-mfe/issues/new/choose. When possible, include a minimal reproduction (see below).

Contributions that fix bugs are very welcome — if you can, open a PR with tests and a short description of the fix.

## Missing a feature?

If you'd like to request a feature, open an issue describing the problem and proposed solution. For larger features, please open an issue first to discuss design and scope before implementing.

- Major feature: open an issue and outline the design before implementation.
- Small feature: you can implement it and submit a PR directly, but consider opening an issue if the change affects public API or docs.

## Submission guidelines

### Submitting an issue

Before opening a new issue, search existing issues to avoid duplicates. A good issue contains:

- A short, descriptive title.
- The version of `@belyas/pubsub-mfe` you're using.
- A minimal reproducible example (code sandbox, small repo, or steps to reproduce).
- Expected vs actual behavior and any error messages or stack traces.

Issues with no reproduction are often closed as "needs more information" — providing a small runnable example speeds up triage and fixes.

### Build the project from source

If you're working on code changes, run tests locally before opening a PR.

Quick start:

```bash
git clone https://github.com/belyas/pubsub-mfe.git
cd pubsub-mfe
pnpm install
pnpm build
pnpm test
```

### Submitting a Pull Request (PR)

Before submitting a PR, please:

1. Search existing issues and PRs to avoid duplicating work.
2. Prefer opening an issue for non-trivial or breaking changes to discuss the approach.
3. Fork the repository and create a branch from `main`:

```bash
git checkout -b fix/my-fix-branch main
```

4. Implement your change and include appropriate tests.
5. Follow the coding rules below.
6. Commit your changes using the commit message conventions below.

```bash
git add .
git commit -m "<type>(<scope>): short summary"
git push origin fix/my-fix-branch
```

7. Open a PR against `belyas/pubsub-mfe:main` and include a clear description of the change, why it was made, and any relevant links to issues.

### Reviewing a Pull Request

We value thoughtful, constructive reviews. The maintainers may ask you to:

1. Add or update tests.
2. Split a large PR into smaller pieces.
3. Clarify the implementation or documentation.

If you're asked for changes:

1. Make the requested updates.
2. Re-run the test suites locally.
3. Push additional commits to the same branch. Use `--fixup` commits if appropriate.

```bash
git commit --all --fixup HEAD
git push
```

##### Updating the last commit message

To amend the last commit message:

```bash
git commit --amend
git push --force-with-lease
```

If you need to rewrite earlier commits, use interactive rebase (`git rebase -i`) and push with `--force-with-lease`.

#### After your pull request is merged

After your PR is merged you can clean up your local branch:

```bash
git push origin --delete fix/my-fix-branch
git checkout main -f
git pull --ff upstream main
git branch -D fix/my-fix-branch
```

## Coding rules

To keep the project consistent:

- All features and bug fixes must include unit tests where applicable.
- All public API changes must be documented in the relevant API reference and changelog.
- Keep changes focused and small. Large refactors should be discussed first.
- Follow existing code style and lint rules. Run `pnpm lint` before submitting.

## Commit message guidelines

We use conventional commit-style messages with a strict header format. This helps generate changelogs and release notes.

Format:

```
<type>(<scope>): <short summary>

<optional longer description>

<optional footer>
```

Where `<type>` must be one of:

- `build`
- `ci`
- `style`
- `dev`
- `docs`
- `feat`
- `fix`
- `perf`
- `refactor`
- `test`

Supported scopes (use the part of the project your change affects):

- `core`       – core runtime and public API
- `adapters`   – cross-tab, history, iframe adapters
- `docs`       – docs-site and documentation
- `examples`   – example apps and demos
- `workers`    – shared worker scripts
- `scripts`    – build/release scripts and CI

Example header:

```
feat(adapters): add broadcast-channel transport auto-fallback
```

### Commit body

When present (required for non-docs commits), the body should explain why the change is necessary and how it addresses the problem. Keep it concise but informative (20+ characters).

### Footer

Use the footer to reference issues, breaking changes, or deprecations:

```
BREAKING CHANGE: description of change and migration instructions

Closes #123
```

### Reverting commits

If you revert a commit, start the header with `revert: ` and include the SHA of the reverted commit in the body:

```
revert: fix(core): recover from x

This reverts commit <SHA>.
```

## Tests and CI

Run tests and linting locally before opening a PR:

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

The repository uses GitHub Actions for CI. All PRs should pass CI checks before being merged.

## Links

- Repository: https://github.com/belyas/pubsub-mfe
- Issues: https://github.com/belyas/pubsub-mfe/issues
- Pull Requests: https://github.com/belyas/pubsub-mfe/pulls
- Contributor Covenant: https://www.contributor-covenant.org/

Thank you for contributing to `@belyas/pubsub-mfe`!


Just as in the summary, use the imperative, present tense: "fix" **not "fixed" nor "fixes".**

Explain the motivation for the change in the commit message body. This commit message should explain _why_ you are making the change.
You can include a comparison of the previous behavior with the new behavior in order to illustrate the impact of the change.

#### Commit Message Footer

The footer can contain information about breaking changes and deprecations and is also the place to reference GitHub issues, ADO tickets, and other PRs that this commit closes or is related to.

For example:

```
BREAKING CHANGE: <breaking change summary>
<BLANK LINE>
<breaking change description + migration instructions>
<BLANK LINE>
<BLANK LINE>
Fixes #<issue number>
```

or

```
DEPRECATED: <what is deprecated>
<BLANK LINE>
<deprecation description + recommended update path>
<BLANK LINE>
<BLANK LINE>
Closes #<pr number>
```

Breaking Change section should start with the phrase "BREAKING CHANGE: " followed by a summary of the breaking change, a blank line, and a detailed description of the breaking change that also includes migration instructions.

Similarly, a Deprecation section should start with "DEPRECATED: " followed by a short description of what is deprecated, a blank line, and a detailed description of the deprecation that also mentions the recommended update path.

### Revert commits

If the commit reverts a previous commit, it should begin with `revert: `, followed by the header of the reverted commit.

The content of the commit message body should contain:

- information about the SHA of the commit being reverted in the following format: `This reverts commit <SHA>`,
- a clear description of the reason for reverting the commit message.

[coc]: https://github.com/belyas/pubsub-mfe/blob/main/CODE_OF_CONDUCT.md
[github]: https://github.com/belyas/pubsub-mfe
[github-issues]: https://github.com/belyas/pubsub-mfe/issues/new/choose
[github-pull-request]: https://github.com/belyas/pubsub-mfe/pulls
[dev-doc]: https://belyas.github.io/pubsub-mfe/