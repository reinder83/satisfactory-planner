# CI runner on the Synology NAS

The source repository is private, so every GitHub-hosted minute counts against the account's monthly Actions allowance. The `test` job (about 5 minutes, run for every pull request and again for every push to `main`) is most of that. This folder runs it on a self-hosted runner on the DS423+ instead, where it costs no minutes. The `publish` and `publish-pages` jobs stay on GitHub's runners: the multi-arch image build needs QEMU for arm64, which is slow on a NAS CPU.

The workflow picks the runner from the `TEST_RUNNER` repository variable. Unset, `test` runs on `ubuntu-latest` as before, so the NAS can be switched off or removed at any time by deleting the variable.

## Setup

1. In File Station, create `docker/github-runner/work` and `docker/github-runner/config` on `volume1`.
2. On GitHub, open the repository's Settings > Actions > Runners > New self-hosted runner, choose Linux x64 and copy the token from the `./config.sh --url ... --token <TOKEN>` line. It is valid for an hour.
3. In Container Manager, create a project in `/volume1/docker/github-runner` from `compose.yaml`. Put the token in a `.env` file next to it as `RUNNER_TOKEN=<TOKEN>` (or paste it into the compose file). Start the project.
4. The runner `ds423-planner` should show as Idle under Settings > Actions > Runners. The token can now be removed; the registration is kept in `config/`.
5. Under Settings > Secrets and variables > Actions > Variables, add the repository variable `TEST_RUNNER` with the value `["self-hosted", "linux", "x64", "nas"]`.

The next pull request's `test` job runs on the NAS. To go back to GitHub's runners, delete the variable.

## Notes

- **Docker access.** The runner uses the NAS's own Docker daemon through `/var/run/docker.sock`, which makes it root-equivalent on the NAS. That is acceptable only because the repository is private and only its owner can push branches or open pull requests. Do not keep this runner if that changes.
- **Paths and network.** The smoke tests curl their containers on `127.0.0.1`, hence `network_mode: host`. Ports 18080 and 18081 must be free on the NAS. The containers' data lives in named Docker volumes, never in a bind mount of a runner path: the NAS's Docker daemon resolves a host path on the NAS, not in the runner container (#399). `tests/ci.test.ts` keeps it that way. The work directory still has the same path on both sides, so a future step that does bind-mount one works too.
- **One job at a time.** A single runner runs jobs one after another; a busy queue waits rather than failing.
- **Memory.** The DS423+ ships with 2 GB. The job runs the test suites, Chromium and a Docker build on it; if jobs get killed or the NAS becomes sluggish while they run, add memory (it takes up to 6 GB) or delete the variable.
- **Disk.** The smoke-test image is removed after each run. Docker's build cache is kept to speed up later builds; reclaim it with `docker builder prune` if space runs low.
