// Container entry point (the Dockerfile's CMD). The image starts as root only so it can hand
// the data volume to the user a NAS expects, then drops to that user before serving anything.
// Every failure is reported without touching existing data.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './server.ts';

// The POSIX identity calls, which Node only defines on POSIX systems; the image is Linux.
const getuid = () => process.getuid!(),
  getgid = () => process.getgid!();

// Reads PUID or PGID. Root (0) and non-numeric values are refused, so the server can never keep
// running as root; `fallback` applies when the variable is unset.
const identity = (key: string, fallback: number) => {
  const value = process.env[key] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
    throw new Error(`${key} must be a non-root numeric ID between 1 and 2147483647.`);
  return Number(value);
};
try {
  // Started as root (the image default): default to 1000:1000, the image's `node` user.
  // Started with compose `user:`: default to that identity, since it cannot be changed.
  const root = getuid() === 0;
  const uid = identity('PUID', root ? 1000 : getuid()),
    gid = identity('PGID', root ? 1000 : getgid());
  // Refusing `/` keeps the ownership repair below from ever running over a whole filesystem.
  const dir = path.resolve(process.env.DATA_DIR || '/data');
  if (dir === path.parse(dir).root)
    throw new Error('DATA_DIR must be a dedicated planner folder, not the filesystem root.');
  if (root) {
    // A bind mount, such as a Synology shared folder, often arrives root-owned or owned by a NAS
    // UID/GID the server's user cannot write as. Repair ownership while still root.
    fs.mkdirSync(dir, { recursive: true });
    if (fs.realpathSync(dir) !== dir) throw new Error('DATA_DIR must not contain symbolic links.');
    // Hands one path to uid:gid through an open descriptor, so nothing swapped in between the
    // check and the chown can redirect it. O_NOFOLLOW refuses symbolic links and the nlink check
    // refuses hard links: either could make root chown a file outside the volume. Files become
    // 0600; the directory keeps its bits plus owner rwx. A missing file is skipped.
    const prepare = (file: string, directory = false) => {
      let fd: number | undefined;
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
        if (!directory && (e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return;
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
    // Drop supplementary groups, then the group, then the user. setuid must come last: after it
    // the process can no longer change its groups.
    process.setgroups!([]);
    process.setgid!(gid);
    process.setuid!(uid);
    // Not root, so nothing can be chowned or dropped: PUID/PGID must match the running user.
  } else if (uid !== getuid() || gid !== getgid()) {
    throw new Error(
      'PUID/PGID conflict with Docker user:. Remove user: to enable automatic ownership setup, or match the IDs and prepare the folder permissions yourself.',
    );
  }
  // Fail at startup with the guidance below rather than on the first save.
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  console.log(`Planner identity: ${getuid()}:${getgid()}`);
  const server = await createApp();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log('Planner ready at http://localhost:' + port),
  );
  // `docker stop` sends SIGTERM; server.close stops accepting connections and exits once
  // open ones finish.
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => server.close(() => process.exit(0)));
} catch (e) {
  console.error(
    `Planner startup failed: ${(e as Error | null)?.message}\nCheck PUID/PGID, the data mount's write access and NAS folder permissions. With cap_drop: ALL, allow CHOWN, DAC_OVERRIDE, FOWNER, SETUID and SETGID for startup. Existing data has not been deleted.`,
  );
  process.exitCode = 1;
}
