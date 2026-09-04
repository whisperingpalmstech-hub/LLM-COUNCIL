import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

export function createScoutRouter() {
  const router = express.Router();
  let activeAnalyses = 0;

  router.post("/analyze", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ success: false, error: "Invalid URL" }); }
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password) {
      return res.status(400).json({ success: false, error: "Use a public HTTPS github.com repository URL." });
    }

    const pathParts = parsed.pathname.replace(/\.git\/?$/, "").split("/").filter(Boolean);
    if (pathParts.length !== 2 || !pathParts.every((part) => /^[a-z0-9_.-]+$/i.test(part))) {
      return res.status(400).json({ success: false, error: "Use the repository root URL in the form https://github.com/owner/repository." });
    }

    const canonicalUrl = `https://github.com/${pathParts[0]}/${pathParts[1]}.git`;
    if (activeAnalyses >= 2) {
      return res.status(429).json({ success: false, code: "SCOUT_BUSY", error: "Scout is already analyzing two repositories. Try again shortly." });
    }
    const repoName = pathParts[1];
    let tmpDir;
    try { tmpDir = mkdtempSync(join(tmpdir(), "synod-scout-")); }
    catch { return res.status(503).json({ success: false, code: "SCOUT_STORAGE_UNAVAILABLE", error: "Scout could not allocate temporary analysis storage." }); }
    activeAnalyses += 1;
    console.log(`[Scout] Cloning ${canonicalUrl} → ${tmpDir}`);

    try {
      await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", "--no-tags", "--filter=blob:none", canonicalUrl, tmpDir], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      activeAnalyses -= 1;
      const detail = scoutCloneError(e);
      return res.status(422).json({ success: false, code: "SCOUT_CLONE_FAILED", error: detail });
    }

    try {
      const report = analyzeProject(tmpDir, canonicalUrl.replace(/\.git$/, ""), repoName);
      console.log(`[Scout] Analysis complete for ${repoName}`);
      return res.json({ success: true, ...report });
    } catch (error) {
      console.error(`[Scout] Analysis failed for ${repoName}:`, error.message);
      return res.status(500).json({ success: false, code: "SCOUT_ANALYSIS_FAILED", error: "The repository was cloned, but its structure could not be analyzed safely." });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      activeAnalyses -= 1;
    }
  });

  return router;
}

function scoutCloneError(error) {
  const raw = String(error?.stderr || error?.message || "").toLowerCase();
  if (error?.killed || error?.signal === "SIGTERM" || /timed out|timeout/.test(raw)) return "Repository cloning timed out. Try a smaller public repository.";
  if (/not found|repository not found|authentication/.test(raw)) return "Repository not found or not publicly accessible.";
  if (/could not resolve|failed to connect|network|connection/.test(raw)) return "GitHub could not be reached from the server. Check outbound network access and try again.";
  return "GitHub could not clone this repository. Confirm that the URL is public and points to the repository root.";
}

function analyzeProject(dir, url, repoName) {
  const tech = detectTechStack(dir);
  const files = countFiles(dir);
  const tests = countTests(dir);
  const loc = estimateLoc(dir);
  const structure = getStructure(dir);
  const gaps = findGaps(dir);
  const deps = countDependencies(dir, tech.packageJson);

  const report = [
    `# Project Scout Report: ${repoName}`,
    ``,
    `**URL**: ${url}`,
    `**Tech Stack**: ${tech.description}`,
    `**Files**: ${files.total} total (${files.source} source, ${files.config} config, ${files.doc} doc, ${files.other} other)`,
    `**Tests**: ${tests.files} test files, ${tests.cases} test cases (estimated)`,
    `**LOC**: ${loc}`,
    `**Structure**: ${structure.map((d) => `\`${d.path}/\` (${d.files} files)`).join(", ")}`,
    `**Dependencies**: ${deps ? `Direct: ${deps.direct}, Dev: ${deps.dev}` : "None detected"}`,
    ``,
  ];

  if (gaps.length) {
    report.push("**Gaps Detected**:");
    gaps.forEach((g) => report.push(`- ${g}`));
    report.push("");
  }

  if (tech.packageJson) {
    try {
      const pkg = JSON.parse(readFileSync(tech.packageJson, "utf-8"));
      if (pkg.scripts && Object.keys(pkg.scripts).length) {
        report.push("**Available Scripts**:");
        Object.entries(pkg.scripts).slice(0, 8).forEach(([k, v]) => {
          report.push(`- \`npm run ${k}\`: ${v}`);
        });
        report.push("");
      }
    } catch {}
  }

  report.push(`---`);
  report.push(`*Report generated by Synod Scout • ${new Date().toISOString().slice(0, 10)}*`);

  return {
    report: report.join("\n"),
    metadata: {
      repo: repoName,
      url,
      tech: tech.description,
      files: files.total,
      sourceFiles: files.source,
      tests: tests.files,
      testCases: tests.cases,
      loc,
      structure: structure.map((d) => d.path),
      gaps,
      deps,
    },
  };
}

function detectTechStack(dir) {
  const result = { description: "Unknown", packageJson: null };
  const parts = [];

  if (existsSync(join(dir, "package.json"))) {
    result.packageJson = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(result.packageJson, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps) {
        const frameworks = [];
        if (deps.react) frameworks.push(`React ${deps.react.replace("^", "")}`);
        if (deps.vue) frameworks.push(`Vue ${deps.vue.replace("^", "")}`);
        if (deps.next) frameworks.push(`Next.js`);
        if (deps.express) frameworks.push("Express");
        if (deps.fastify) frameworks.push("Fastify");
        if (deps.typescript || pkg.devDependencies?.typescript) frameworks.push("TypeScript");
        if (frameworks.length) parts.push(frameworks.join(" + "));
        parts.push("JavaScript (Node.js)");
      }
    } catch {}
  }

  if (existsSync(join(dir, "pyproject.toml"))) parts.push("Python");
  if (existsSync(join(dir, "go.mod"))) parts.push("Go");
  if (existsSync(join(dir, "Cargo.toml"))) parts.push("Rust");
  if (existsSync(join(dir, "requirements.txt"))) parts.push("Python");

  result.description = parts.length ? parts.join(" | ") : "Unknown";
  return result;
}

function countFiles(dir) {
  let total = 0, source = 0, config = 0, doc = 0, other = 0;

  function walk(d) {
    try {
      for (const entry of readdirSync(d)) {
        if (entry === ".git" || entry === "node_modules" || entry === "__pycache__" || entry === "target") continue;
        const p = join(d, entry);
        try {
          const s = statSync(p);
          if (s.isDirectory()) { walk(p); continue; }
          total++;
          const ext = entry.split(".").pop()?.toLowerCase();
          if (["js", "ts", "jsx", "tsx", "py", "go", "rs", "java", "rb", "php", "c", "cpp", "h", "swift", "kt"].includes(ext)) source++;
          else if (["json", "toml", "yaml", "yml", "env", "cfg", "ini", "lock"].includes(ext)) config++;
          else if (["md", "rst", "txt", "pdf"].includes(ext)) doc++;
          else other++;
        } catch {}
      }
    } catch {}
  }

  walk(dir);
  return { total, source, config, doc, other };
}

function countTests(dir) {
  let files = 0, cases = 0;

  function walk(d) {
    try {
      for (const entry of readdirSync(d)) {
        if (entry === ".git" || entry === "node_modules" || entry === "__pycache__" || entry === "target") continue;
        const p = join(d, entry);
        try {
          const s = statSync(p);
          if (s.isDirectory()) { walk(p); continue; }
          if (entry.includes(".test.") || entry.includes("_test.") || entry.includes(".spec.") || entry.includes("_spec.")) {
            files++;
            try {
              const content = readFileSync(p, "utf-8");
              cases += (content.match(/\b(it|test|describe|def test_|func Test)\b/g) || []).length;
            } catch {}
          }
          if (entry === "tests" || entry === "test" || entry === "__tests__" || entry === "spec") {
            // count all files inside test dirs
            try {
              for (const f of readdirSync(p)) {
                if (statSync(join(p, f)).isFile()) files++;
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  walk(dir);
  return { files, cases };
}

function estimateLoc(dir) {
  const sourceExtensions = new Set(["js", "ts", "jsx", "tsx", "py", "go", "rs", "css", "html"]);
  let lines = 0;
  let inspectedFiles = 0;
  let inspectedBytes = 0;
  const maxFiles = 20_000;
  const maxBytes = 100 * 1024 * 1024;

  function walk(current) {
    if (inspectedFiles >= maxFiles || inspectedBytes >= maxBytes) return;
    let entries;
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if ([".git", "node_modules", "__pycache__", "target"].includes(entry)) continue;
      const filename = join(current, entry);
      let stats;
      try { stats = statSync(filename); } catch { continue; }
      if (stats.isDirectory()) { walk(filename); continue; }
      if (!sourceExtensions.has(entry.split(".").pop()?.toLowerCase()) || stats.size > 2 * 1024 * 1024) continue;
      inspectedFiles += 1;
      inspectedBytes += stats.size;
      try { lines += readFileSync(filename, "utf8").split(/\r?\n/).length; } catch {}
      if (inspectedFiles >= maxFiles || inspectedBytes >= maxBytes) break;
    }
  }

  walk(dir);
  return lines ? `${lines.toLocaleString()} lines${inspectedFiles >= maxFiles || inspectedBytes >= maxBytes ? "+" : ""}` : "Unknown";
}

function getStructure(dir) {
  const dirs = [];

  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      try {
        if (!statSync(p).isDirectory()) continue;
        if (entry.startsWith(".") || entry === "node_modules" || entry === "__pycache__" || entry === "target") continue;
        let fileCount = 0;
        try { fileCount = readdirSync(p).filter((f) => statSync(join(p, f)).isFile()).length; } catch {}
        dirs.push({ path: entry, files: fileCount });
      } catch {}
    }
    dirs.sort((a, b) => b.files - a.files);
  } catch {}

  return dirs.slice(0, 8);
}

function findGaps(dir) {
  const gaps = [];

  if (!existsSync(join(dir, "README.md")) && !existsSync(join(dir, "README"))) {
    gaps.push("No README found");
  }

  const hasTestFiles = hasMatchingFile(dir, (entry) => /(?:\.test\.|_test\.|\.spec\.)/i.test(entry), 3);

  if (!hasTestFiles && !existsSync(join(dir, "tests")) && !existsSync(join(dir, "test")) && !existsSync(join(dir, "__tests__"))) {
    gaps.push("No tests detected");
  }

  const hasCI = existsSync(join(dir, ".github/workflows")) ||
    existsSync(join(dir, ".gitlab-ci.yml")) ||
    existsSync(join(dir, "Jenkinsfile")) ||
    existsSync(join(dir, ".circleci"));

  if (!hasCI) gaps.push("No CI/CD configuration detected");

  const hasLint = existsSync(join(dir, ".eslintrc.js")) ||
    existsSync(join(dir, ".eslintrc.json")) ||
    existsSync(join(dir, ".eslintrc")) ||
    existsSync(join(dir, "eslint.config.js")) ||
    existsSync(join(dir, ".prettierrc")) ||
    existsSync(join(dir, "prettier.config.js")) ||
    existsSync(join(dir, ".pylintrc")) ||
    existsSync(join(dir, "ruff.toml")) ||
    existsSync(join(dir, "pyproject.toml")); // Python lint tools often in pyproject.toml

  if (!hasLint) gaps.push("No linter/formatter configuration detected");

  if (existsSync(join(dir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (pkg.type !== "module" && !existsSync(join(dir, "tsconfig.json"))) {
        // Not necessarily a gap — skip
      }
    } catch {}
  }

  return gaps;
}

function hasMatchingFile(dir, predicate, maxDepth, depth = 0) {
  if (depth > maxDepth) return false;
  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    if ([".git", "node_modules", "__pycache__", "target"].includes(entry)) continue;
    const filename = join(dir, entry);
    let stats;
    try { stats = statSync(filename); } catch { continue; }
    if (stats.isFile() && predicate(entry)) return true;
    if (stats.isDirectory() && hasMatchingFile(filename, predicate, maxDepth, depth + 1)) return true;
  }
  return false;
}

function countDependencies(dir, packageJsonPath) {
  if (!packageJsonPath || !existsSync(packageJsonPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const direct = Object.keys(pkg.dependencies || {}).length;
    const dev = Object.keys(pkg.devDependencies || {}).length;
    return { direct, dev };
  } catch {
    return null;
  }
}
