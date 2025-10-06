import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface StaticPackage {
  name: string;
  dist: string;
  target: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const serverRoot = path.resolve(__dirname, '..');

const staticPackages: StaticPackage[] = [
  {
    name: '@affine/web',
    dist: path.join(repoRoot, 'packages/frontend/apps/web/dist'),
    target: path.join(serverRoot, 'static'),
  },
  {
    name: '@affine/mobile',
    dist: path.join(repoRoot, 'packages/frontend/apps/mobile/dist'),
    target: path.join(serverRoot, 'static/mobile'),
  },
  {
    name: '@affine/admin',
    dist: path.join(repoRoot, 'packages/frontend/admin/dist'),
    target: path.join(serverRoot, 'static/admin'),
  },
];

function run(command: string) {
  execSync(command, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

function prepareTarget(target: string) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
}

function copyDist(dist: string, target: string) {
  if (!existsSync(dist)) {
    throw new Error(`Expected build output at ${dist}, but it does not exist.`);
  }

  prepareTarget(target);
  cpSync(dist, target, { recursive: true, force: true });
}

function buildStaticAssets() {
  for (const pkg of staticPackages) {
    console.log(`Building static assets for ${pkg.name}...`);
    run(`yarn affine bundle --package ${pkg.name}`);
    console.log(`Copying ${pkg.dist} -> ${pkg.target}`);
    copyDist(pkg.dist, pkg.target);
  }
}

try {
  if (process.env.SKIP_STATIC_ASSETS === 'true') {
    console.log('Skipping static asset build because SKIP_STATIC_ASSETS=true');
  } else {
    buildStaticAssets();
  }
} catch (err) {
  console.error('Failed to build static assets.');
  throw err;
}
