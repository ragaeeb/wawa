import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type BumpType = "major" | "minor" | "patch" | "none";

interface ConventionalCommit {
  subject: string;
  body: string;
}

function run(command: string): string {
  return execSync(command, { encoding: "utf8" }).trim();
}

function tryRun(command: string): string | null {
  try {
    return run(command);
  } catch {
    return null;
  }
}

function parseCommits(logOutput: string): ConventionalCommit[] {
  return logOutput
    .split("\u001e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [, subject = "", body = ""] = record.split("\u001f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

function determineBump(commits: ConventionalCommit[]): BumpType {
  let hasMinor = false;
  let hasPatch = false;

  for (const commit of commits) {
    const subject = commit.subject;
    const body = commit.body;

    const isBreaking = /^([a-z]+)(\([^)]+\))?!:/i.test(subject) || /BREAKING CHANGE:/i.test(body);
    if (isBreaking) return "major";

    if (/^feat(\([^)]+\))?:/i.test(subject)) {
      hasMinor = true;
      continue;
    }

    if (/^(fix|perf|refactor|revert)(\([^)]+\))?:/i.test(subject)) {
      hasPatch = true;
    }
  }

  if (hasMinor) return "minor";
  if (hasPatch) return "patch";
  return "none";
}

function incrementVersion(version: string, bump: Exclude<BumpType, "none">): string {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error(`Invalid semver in package.json: ${version}`);
  }

  const [major, minor, patch] = parts;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeOutput(key: string, value: string): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) return;
  writeFileSync(githubOutput, `${key}=${value}\n`, { flag: "a" });
}

const packageJsonPath = resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  version: string;
};
const dryRun = process.argv.includes("--dry-run");

const lastTag = tryRun("git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null");
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const logOutput = tryRun(`git log --format='%H%x1f%s%x1f%b%x1e' ${range}`) ?? "";
const commits = parseCommits(logOutput);
const bump = determineBump(commits);

writeOutput("bump_type", bump);
writeOutput("current_version", packageJson.version);

if (bump === "none") {
  writeOutput("release_required", "false");
  process.stdout.write("No semantic release bump detected.\n");
  process.exit(0);
}

const nextVersion = incrementVersion(packageJson.version, bump);
if (!dryRun) {
  packageJson.version = nextVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

writeOutput("release_required", "true");
writeOutput("version", nextVersion);

process.stdout.write(
  `${dryRun ? "Would bump" : "Bumped"} version ${nextVersion} (${bump}) based on commits in range ${range}.\n`,
);
