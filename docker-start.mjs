import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './server.mjs';

const identity = (key, fallback) => {
  const value = process.env[key] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
    throw new Error(`${key} must be a non-root numeric ID between 1 and 2147483647.`);
  return Number(value);
};
try {
  const root = process.getuid() === 0;
  const uid = identity('PUID', root ? 1000 : process.getuid()),
    gid = identity('PGID', root ? 1000 : process.getgid());
  const dir = path.resolve(process.env.DATA_DIR || '/data');
  if (dir === path.parse(dir).root)
    throw new Error('DATA_DIR must be a dedicated planner folder, not the filesystem root.');
  if (root) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.realpathSync(dir) !== dir) throw new Error('DATA_DIR must not contain symbolic links.');
    const prepare = (file, directory = false) => {
      let fd;
      try {
        fd = fs.openSync(
          file,
          fs.constants.O_RDONLY |
            fs.constants.O_NOFOLLOW |
            (directory ? fs.constants.O_DIRECTORY : 0),
        );
        const stat = fs.fstatSync(fd);
        if (!directory && (!stat.isFile() || stat.nlink !== 1))
          throw new Error('Planner data files must be regular files without hard links.');
        fs.fchownSync(fd, uid, gid);
        fs.fchmodSync(fd, directory ? (stat.mode & 0o777) | 0o700 : 0o600);
      } catch (e) {
        if (!directory && e.code === 'ENOENT') return;
        throw e;
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    };
    prepare(dir, true);
    // Repair only planner-owned files, never unrelated files or nested NAS folders.
    for (const name of [
      'workspace.json',
      'workspace.json.bak',
      'workspace.json.tmp',
      'progress.json',
      'progress.json.bak',
      'progress.json.tmp',
      'account-setup-token.txt',
    ])
      prepare(path.join(dir, name));
    process.setgroups([]);
    process.setgid(gid);
    process.setuid(uid);
  } else if (uid !== process.getuid() || gid !== process.getgid()) {
    throw new Error(
      'PUID/PGID conflict with Docker user:. Remove user: to enable automatic ownership setup, or match the IDs and prepare the folder permissions yourself.',
    );
  }
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  console.log(`Planner identity: ${process.getuid()}:${process.getgid()}`);
  const server = await createApp();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log('Planner ready at http://localhost:' + port),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => server.close(() => process.exit(0)));
} catch (e) {
  console.error(
    `Planner startup failed: ${e.message}\nCheck PUID/PGID, the data mount's write access and NAS folder permissions. With cap_drop: ALL, allow CHOWN, DAC_OVERRIDE, FOWNER, SETUID and SETGID for startup. Existing data has not been deleted.`,
  );
  process.exitCode = 1;
}
