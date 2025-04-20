# Time to Review

A GitHub Action that automatically estimates the time required to review a pull request and adds an appropriate time-based label.

## How it works

This action analyzes pull requests and applies labels like `1 min review`, `5 min review`, etc., to help reviewers prioritize their work. It considers several factors:

1. Number of files changed
2. Lines of code added and deleted
3. File complexity based on file extensions
4. Quality of commit messages (Conventional Commits check)
5. Size of individual commits
6. Quality of pull request description
7. Commit type (feat, fix, refactor, revert, docs)
8. Documentation and metadata file changes

### Special handling

- **Documentation and metadata files**: Pull requests containing only documentation or metadata files are automatically assigned the minimum review time (1 minute). In mixed PRs, changes to documentation files are weighted at only 20% compared to code changes.

- **Commit types**: Different commit types receive different review time weights:
  - `feat`: +2 minutes (new features need more review time)
  - `fix`: +1.5 minutes (bug fixes need careful review)
  - `refactor`: +2.5 minutes (refactorings need thorough review)
  - `revert`: +1 minute (reverts typically need less review time)
  - `docs`: +0.5 minutes (documentation changes need minimal review)

## Usage

Add this to your workflow file (e.g., `.github/workflows/time-to-review.yml`):

```yaml
name: Time to Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  time-to-review:
    runs-on: ubuntu-latest
    name: Calculate review time
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Calculate review time
        uses: srajasimman/time-to-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Labels

The action will add one of the following labels to your pull request:

- `1 min review`
- `5 min review`
- `10 min review`
- `15 min review`
- `20 min review`
- `30 min review`

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.