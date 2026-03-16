#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BLUE_PACKAGES = [
  '@blue-repository/types',
  '@blue-labs/language',
  '@blue-labs/document-processor',
] as const;

type BluePackageName = (typeof BLUE_PACKAGES)[number];

type Issue = {
  kind: 'resolution-mismatch' | 'nested-install' | 'lockfile-nested-entry';
  workspace: string;
  packageName: BluePackageName;
  details: string;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const rootRequire = createRequire(path.join(rootDir, 'package.json'));

const readJson = (filePath: string): unknown =>
  JSON.parse(fs.readFileSync(filePath, 'utf8'));

const toPosixRelative = (filePath: string): string =>
  path.relative(rootDir, filePath).split(path.sep).join('/');

const getPackageManifest = (
  packageDir: string
): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} => readJson(path.join(packageDir, 'package.json')) as any;

const packageUsesBlueDeps = (packageDir: string): boolean => {
  const manifest = getPackageManifest(packageDir);
  const declared = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };

  return BLUE_PACKAGES.some(packageName => packageName in declared);
};

const expandWorkspacePattern = (pattern: string): string[] => {
  const absolutePattern = path.join(rootDir, pattern);

  if (!pattern.includes('*')) {
    return fs.existsSync(path.join(absolutePattern, 'package.json'))
      ? [absolutePattern]
      : [];
  }

  if (!pattern.endsWith('/*')) {
    throw new Error(`Unsupported workspace pattern: ${pattern}`);
  }

  const parentDir = absolutePattern.slice(0, -2);
  if (!fs.existsSync(parentDir)) {
    return [];
  }

  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(parentDir, entry.name))
    .filter(candidate => fs.existsSync(path.join(candidate, 'package.json')));
};

const getWorkspaceDirs = (): string[] => {
  const rootManifest = readJson(path.join(rootDir, 'package.json')) as {
    workspaces?: string[];
  };
  const patterns = rootManifest.workspaces ?? [];

  return Array.from(
    new Set(patterns.flatMap(pattern => expandWorkspacePattern(pattern)))
  )
    .filter(packageUsesBlueDeps)
    .sort();
};

const getRootPackageInfo = (
  packageName: BluePackageName
): { resolvedPath: string; version: string } => {
  const resolvedPath = resolvePackageManifest(rootRequire, packageName);
  const manifest = readJson(resolvedPath) as { version: string };
  return { resolvedPath, version: manifest.version };
};

const getNestedPackageJsonPath = (
  workspaceDir: string,
  packageName: BluePackageName
) =>
  path.join(
    workspaceDir,
    'node_modules',
    ...packageName.split('/'),
    'package.json'
  );

const resolvePackageManifest = (
  requireFn: NodeRequire,
  packageName: BluePackageName
): string => {
  const entryPath = requireFn.resolve(packageName);
  let currentDir = path.dirname(entryPath);
  const packageRoot = path.join('node_modules', ...packageName.split('/'));

  while (true) {
    const candidate = path.join(currentDir, 'package.json');
    if (fs.existsSync(candidate)) {
      const relative = candidate.split(path.sep).join('/');
      if (relative.includes(packageRoot.split(path.sep).join('/'))) {
        return candidate;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve package.json for ${packageName}`);
    }
    currentDir = parentDir;
  }
};

const main = () => {
  const workspaceDirs = getWorkspaceDirs();
  const rootPackageInfo = new Map(
    BLUE_PACKAGES.map(packageName => [
      packageName,
      getRootPackageInfo(packageName),
    ])
  );
  const issues: Issue[] = [];

  for (const workspaceDir of workspaceDirs) {
    const workspaceLabel = toPosixRelative(workspaceDir);
    const workspaceRequire = createRequire(
      path.join(workspaceDir, 'package.json')
    );

    for (const packageName of BLUE_PACKAGES) {
      const rootInfo = rootPackageInfo.get(packageName);
      if (!rootInfo) {
        continue;
      }

      const resolvedPath = resolvePackageManifest(
        workspaceRequire,
        packageName
      );
      const resolvedManifest = readJson(resolvedPath) as { version: string };

      if (path.resolve(resolvedPath) !== path.resolve(rootInfo.resolvedPath)) {
        issues.push({
          kind: 'resolution-mismatch',
          workspace: workspaceLabel,
          packageName,
          details:
            `resolves to ${toPosixRelative(resolvedPath)} (${
              resolvedManifest.version
            }) ` +
            `instead of ${toPosixRelative(rootInfo.resolvedPath)} (${
              rootInfo.version
            })`,
        });
      }

      const nestedPackageJsonPath = getNestedPackageJsonPath(
        workspaceDir,
        packageName
      );
      if (fs.existsSync(nestedPackageJsonPath)) {
        const nestedManifest = readJson(nestedPackageJsonPath) as {
          version: string;
        };
        issues.push({
          kind: 'nested-install',
          workspace: workspaceLabel,
          packageName,
          details: `nested workspace install found at ${toPosixRelative(
            nestedPackageJsonPath
          )} (${nestedManifest.version})`,
        });
      }
    }
  }

  const packageLockPath = path.join(rootDir, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    const packageLock = readJson(packageLockPath) as {
      packages?: Record<string, { version?: string }>;
    };
    const lockPackages = packageLock.packages ?? {};

    for (const workspaceDir of workspaceDirs) {
      const workspaceLabel = toPosixRelative(workspaceDir);
      for (const packageName of BLUE_PACKAGES) {
        const lockKey = `${workspaceLabel}/node_modules/${packageName}`;
        const entry = lockPackages[lockKey];
        if (!entry) {
          continue;
        }

        issues.push({
          kind: 'lockfile-nested-entry',
          workspace: workspaceLabel,
          packageName,
          details:
            `package-lock contains nested entry ${lockKey}` +
            (entry.version ? ` (${entry.version})` : ''),
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log(
      `Blue dependency check passed across ${workspaceDirs.length} workspace packages.`
    );
    return;
  }

  console.error('Blue dependency consistency check failed.\n');
  for (const issue of issues) {
    console.error(
      `- [${issue.kind}] ${issue.workspace} :: ${issue.packageName} :: ${issue.details}`
    );
  }

  console.error(
    '\nExpected state: every workspace must resolve the same Blue packages from the repo root install.'
  );
  console.error(
    'Install rule: run npm installs only from the repository root.'
  );
  console.error(
    'Suggested recovery: find apps libs -type d -name node_modules -prune -exec rm -rf {} + && npm install'
  );

  process.exit(1);
};

main();
