const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    // Get inputs
    const token = core.getInput('github-token');
    const octokit = github.getOctokit(token);
    
    const context = github.context;
    const { owner, repo } = context.repo;
    const pull_number = context.payload.pull_request.number;
    
    console.log(`Processing PR #${pull_number} in ${owner}/${repo}`);
    
    // Get pull request data
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number,
    });
    
    // Get commits
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number,
    });
    
    // Get files changed
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });
    
    // Calculate estimated review time
    const reviewTime = calculateReviewTime(pullRequest, commits, files);
    const reviewLabel = getReviewLabel(reviewTime);
    
    console.log(`Estimated review time: ${reviewTime} minutes`);
    console.log(`Applying label: ${reviewLabel}`);
    
    // Remove any existing time review labels
    await removeExistingTimeLabels(octokit, owner, repo, pull_number);
    
    // Add the review time label
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pull_number,
      labels: [reviewLabel],
    });
    
    console.log('Label added successfully');
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
    console.log(error);
  }
}

/**
 * Calculate review time based on various factors
 */
function calculateReviewTime(pullRequest, commits, files) {
  let score = 0;
  
  // Check if this PR is only documentation or metadata updates
  const isDocumentationOnly = files.every(file => isDocOrMetadataFile(file.filename));
  
  if (isDocumentationOnly) {
    // Fast-track documentation-only changes with minimal review time
    return 1; // 1 minute review for docs-only changes
  }
  
  // Count documentation and metadata files to reduce their impact
  let codeFiles = 0;
  let docFiles = 0;
  
  // Factor 1: Number of files changed
  const fileCount = files.length;
  
  files.forEach(file => {
    if (isDocOrMetadataFile(file.filename)) {
      docFiles++;
    } else {
      codeFiles++;
    }
  });
  
  // Only count code files for the file count score calculation
  score += Math.min(codeFiles * 0.5, 15); // 0.5 minutes per code file, max 15 minutes
  
  // Factor 2: Lines of code changed
  let addedLines = 0;
  let deletedLines = 0;
  let complexFileChanges = 0;
  
  files.forEach(file => {
    // For documentation/metadata files, count only a fraction of their changes
    const multiplier = isDocOrMetadataFile(file.filename) ? 0.2 : 1;
    
    addedLines += file.additions * multiplier;
    deletedLines += file.deletions * multiplier;
    
    // Add more time for complex file types, ignoring doc files
    if (!isDocOrMetadataFile(file.filename)) {
      const ext = file.filename.split('.').pop().toLowerCase();
      if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'].includes(ext)) {
        complexFileChanges++;
      }
    }
  });
  
  const totalLinesChanged = addedLines + deletedLines;
  score += Math.min(totalLinesChanged * 0.01, 10); // 0.01 minutes per line, max 10 minutes
  
  // Factor 3: Add time for complex file changes
  score += complexFileChanges * 0.5; // 0.5 minutes per complex file
  
  // Factor 4: Commit messages analysis (conventional commits check)
  let unconventionalCommits = 0;
  let largeCommits = 0;
  
  commits.forEach(commit => {
    const message = commit.commit.message;
    
    // Check if commit follows conventional commits format
    // Example format: type(scope): description
    const conventionalPattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9-_]+\))?: .+/;
    if (!conventionalPattern.test(message.split('\n')[0])) {
      unconventionalCommits++;
    }
    
    // Check commit size
    if (commit.stats && (commit.stats.additions + commit.stats.deletions > 300)) {
      largeCommits++;
    }
    
    // Check for specific commit types and add review time accordingly
    const firstLine = message.split('\n')[0];
    if (/^feat(\([a-zA-Z0-9-_]+\))?: .+/.test(firstLine)) {
      // Feature commits need more review time
      score += 2;
    } else if (/^fix(\([a-zA-Z0-9-_]+\))?: .+/.test(firstLine)) {
      // Bug fixes need careful review
      score += 1.5;
    } else if (/^refactor(\([a-zA-Z0-9-_]+\))?: .+/.test(firstLine)) {
      // Refactoring needs thorough review
      score += 2.5;
    } else if (/^revert(\([a-zA-Z0-9-_]+\))?: .+/.test(firstLine)) {
      // Reverts need less time typically
      score += 1;
    } else if (/^docs(\([a-zA-Z0-9-_]+\))?: .+/.test(firstLine)) {
      // Documentation commits need less review time
      score += 0.5;
    }
  });
  
  score += unconventionalCommits * 0.5; // 0.5 minutes per unconventional commit
  score += largeCommits * 1; // 1 minute per large commit
  
  // Factor 5: PR description analysis
  if (!pullRequest.body || pullRequest.body.length < 50) {
    score += 2; // Poor PR description adds 2 minutes
  }
  
  // Round to nearest available time bucket
  return Math.max(1, Math.round(score));
}

/**
 * Check if the file is a documentation or metadata file
 */
function isDocOrMetadataFile(filename) {
  // Check file extension
  const ext = filename.split('.').pop().toLowerCase();
  if (['md', 'txt', 'rst', 'adoc'].includes(ext)) {
    return true;
  }
  
  // Check for common documentation file patterns
  if (filename.toLowerCase().includes('readme') || 
      filename.toLowerCase().includes('changelog') ||
      filename.toLowerCase().includes('license') ||
      filename.toLowerCase().includes('contributing') ||
      filename.toLowerCase().includes('authors')) {
    return true;
  }
  
  // Check for metadata files
  if (['.gitignore', '.editorconfig', '.prettierrc', '.eslintrc', 
       'package.json', 'package-lock.json', 'yarn.lock', 
       'tsconfig.json', 'tslint.json', '.npmrc', '.npmignore',
       '.github', '.vscode', '.idea'].some(meta => 
        filename.toLowerCase().includes(meta.toLowerCase()))) {
    return true;
  }
  
  // Check for documentation directories
  if (filename.startsWith('docs/') || 
      filename.startsWith('documentation/') || 
      filename.startsWith('wiki/')) {
    return true;
  }
  
  return false;
}

/**
 * Get the appropriate review time label
 */
function getReviewLabel(minutes) {
  const timeOptions = [1, 5, 10, 15, 20, 30];
  
  // Find the closest time option that is >= our calculated time
  for (const option of timeOptions) {
    if (minutes <= option) {
      return `${option} min review`;
    }
  }
  
  // If longer than the largest option, use the largest
  return `${timeOptions[timeOptions.length - 1]} min review`;
}

/**
 * Remove existing time review labels
 */
async function removeExistingTimeLabels(octokit, owner, repo, issue_number) {
  const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number,
  });
  
  const timeLabels = currentLabels
    .map(label => label.name)
    .filter(name => /^\d+ min review$/.test(name));
  
  for (const label of timeLabels) {
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number,
      name: label,
    });
  }
}

run();